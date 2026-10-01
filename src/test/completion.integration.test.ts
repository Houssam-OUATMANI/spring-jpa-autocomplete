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
});