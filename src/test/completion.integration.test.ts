import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Completion Integration Tests', () => {
	test('limits repository prefixes to the body and replaces the typed fragment', async () => {
		const extension = vscode.extensions.getExtension('houssam-ouatmani.spring-jpa-autocomplete');
		assert.ok(extension);
		await extension.activate();

		const source = [
			'interface UserRepository extends JpaRepository<User, Long> {',
			'    ex',
			'}',
		].join('\n');
		const documentUri = vscode.Uri.file(path.join(os.tmpdir(), `UserRepository-${process.pid}.java`));
		await vscode.workspace.fs.writeFile(documentUri, Buffer.from(source));

		try {
			const document = await vscode.workspace.openTextDocument(documentUri);
			const headerPosition = new vscode.Position(0, source.indexOf('extends') + 'extends'.length);
			const headerCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
				'vscode.executeCompletionItemProvider',
				document.uri,
				headerPosition,
			);
			assert.strictEqual(headerCompletions?.items.some((item) => item.label === 'existsBy'), false);

			const partialPosition = new vscode.Position(1, '    ex'.length);
			const bodyCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
				'vscode.executeCompletionItemProvider',
				document.uri,
				partialPosition,
			);
			const existsBy = bodyCompletions?.items.find((item) => item.label === 'existsBy');
			assert.ok(existsBy);
			assert.strictEqual(existsBy.insertText, 'existsBy');
			const replacementRange = existsBy.range as vscode.Range;
			assert.strictEqual(document.getText(replacementRange), 'ex');

			const edit = new vscode.WorkspaceEdit();
			edit.replace(document.uri, replacementRange, existsBy.insertText as string);
			assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
			assert.match(document.getText(), /\bexistsBy\b/);
			assert.doesNotMatch(document.getText(), /exexistsBy/);
		} finally {
			await vscode.workspace.fs.delete(documentUri, { useTrash: false });
		}
	});

	test('reports an incorrect entity return type from an opened multi-type source file', async function () {
		this.timeout(15_000);
		const extension = vscode.extensions.getExtension('houssam-ouatmani.spring-jpa-autocomplete');
		assert.ok(extension);
		await extension.activate();

		const fixtureUri = vscode.Uri.file(path.join(os.tmpdir(), `spring-jpa-vscode-integration-${process.pid}-${Date.now()}`));
		const entityUri = vscode.Uri.joinPath(fixtureUri, 'Entities.java');
		const repositoryUri = vscode.Uri.joinPath(fixtureUri, 'UserRepository.java');

		try {
			await vscode.workspace.fs.createDirectory(fixtureUri);
			await vscode.workspace.fs.writeFile(
				entityUri,
				Buffer.from('package fixture; @Entity class User { String email; } @Entity class Order { Long id; }'),
			);
			await vscode.workspace.fs.writeFile(
				repositoryUri,
				Buffer.from('package fixture; interface UserRepository extends JpaRepository<User, Long> { List<Order> findByEmail(String email); }'),
			);
			await vscode.workspace.openTextDocument(entityUri);
			await vscode.workspace.openTextDocument(repositoryUri);

			const deadline = Date.now() + 5_000;
			let returnTypeDiagnostic: vscode.Diagnostic | undefined;
			while (Date.now() < deadline) {
				returnTypeDiagnostic = vscode.languages.getDiagnostics(repositoryUri).find(
					(diagnostic) => diagnostic.source === 'spring-jpa' && diagnostic.code === 'INVALID_RETURN_TYPE',
				);
				if (returnTypeDiagnostic) {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			assert.ok(returnTypeDiagnostic, 'Expected an invalid derived-query entity return type diagnostic.');
			assert.match(returnTypeDiagnostic.message, /belongs to entity 'User', but returns 'List<Order>'/);
		} finally {
			await vscode.workspace.fs.delete(fixtureUri, { recursive: true, useTrash: false });
		}
	});

	test('completes Mongo document properties and reports unknown @Query fields', async function () {
		this.timeout(15_000);
		const extension = vscode.extensions.getExtension('houssam-ouatmani.spring-jpa-autocomplete');
		assert.ok(extension);
		await extension.activate();

		const fixtureUri = vscode.Uri.file(path.join(os.tmpdir(), `spring-mongo-vscode-integration-${process.pid}-${Date.now()}`));
		const documentUri = vscode.Uri.joinPath(fixtureUri, 'UserDocument.java');
		const repositoryUri = vscode.Uri.joinPath(fixtureUri, 'UserMongoRepository.java');
		const repositorySource = [
			'interface UserMongoRepository extends MongoRepository<UserDocument, String> {',
			'    List<UserDocument> findByDis',
			`    @Query("{ 'emial': ?0 }") List<UserDocument> findByEmailQuery(String email);`,
			'}',
		].join('\n');

		try {
			await vscode.workspace.fs.createDirectory(fixtureUri);
			await vscode.workspace.fs.writeFile(
				documentUri,
				Buffer.from('@Document class UserDocument { @Id String id; @Field("display_name") String displayName; String email; }'),
			);
			await vscode.workspace.fs.writeFile(repositoryUri, Buffer.from(repositorySource));
			await vscode.workspace.openTextDocument(documentUri);
			const repository = await vscode.workspace.openTextDocument(repositoryUri);

			const completionPosition = new vscode.Position(1, repositorySource.split('\n')[1].length);
			const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
				'vscode.executeCompletionItemProvider',
				repository.uri,
				completionPosition,
			);
			assert.ok(completions?.items.some((item) => item.label === 'DisplayName'));

			const deadline = Date.now() + 5_000;
			let mongoDiagnostic: vscode.Diagnostic | undefined;
			while (Date.now() < deadline) {
				mongoDiagnostic = vscode.languages.getDiagnostics(repositoryUri).find(
					(diagnostic) => diagnostic.source === 'spring-jpa' && diagnostic.code === 'UNKNOWN_MONGO_FIELD',
				);
				if (mongoDiagnostic) {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			assert.ok(mongoDiagnostic, 'Expected an unknown Mongo query field diagnostic.');
			assert.match(mongoDiagnostic.message, /Unknown MongoDB document field 'emial'/);
		} finally {
			await vscode.workspace.fs.delete(fixtureUri, { recursive: true, useTrash: false });
		}
	});
});