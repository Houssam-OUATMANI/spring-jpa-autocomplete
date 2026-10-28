import * as vscode from 'vscode';
import { extractRepositoryEntityNameAt, WorkspaceEntityIndex } from '../entityDiscovery';
import { extractAllJpqlQueries } from '../jpql/jpqlParser';
import { parseDerivedMethodName } from '../derivedQuery/queryParser';

export class SpringJpaRenameProvider implements vscode.RenameProvider {
	public prepareRename(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}
		const word = document.getText(wordRange);
		const index = WorkspaceEntityIndex.getInstance();
		const currentEntities = index.getEntitiesForUri(document.uri);
		const entity = currentEntities.find((e) =>
			e.properties.some((p) => p.name.toLowerCase() === word.toLowerCase()),
		);
		if (!entity) {
			return undefined;
		}
		return wordRange;
	}

	public async provideRenameEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		newName: string,
		_token: vscode.CancellationToken,
	): Promise<vscode.WorkspaceEdit | undefined> {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}
		const oldName = document.getText(wordRange);
		const index = WorkspaceEntityIndex.getInstance();
		await index.ensureInitialized();
		const allEntities = index.getAllEntities();
		const currentEntities = index.getEntitiesForUri(document.uri);
		const entity = currentEntities.find((e) =>
			e.properties.some((p) => p.name.toLowerCase() === oldName.toLowerCase()),
		);
		if (!entity) {
			return undefined;
		}

		const edit = new vscode.WorkspaceEdit();

		// 1. Rename declaration in the entity file itself
		edit.replace(document.uri, wordRange, newName);

		// 2. Scan documents for references in repositories and JPQL
		const capitalizedNew = newName[0].toUpperCase() + newName.slice(1);
		const candidateDocs = await index.getCandidateDocuments();

		for (const doc of candidateDocs) {
			if (doc.languageId !== 'java') {
				continue;
			}
			const text = doc.getText();

			// Replace in JPQL queries
			const jpqlQueries = extractAllJpqlQueries(text, allEntities);
			for (const query of jpqlQueries) {
				for (const access of query.propertyAccesses) {
					const targetEntity = query.aliases.get(access.alias);
					if (targetEntity && targetEntity.toLowerCase() === entity.name.toLowerCase()) {
						if (access.property.toLowerCase() === oldName.toLowerCase()) {
							const start = doc.positionAt(access.startOffset);
							const end = doc.positionAt(access.endOffset);
							edit.replace(doc.uri, new vscode.Range(start, end), newName);
						}
					}
				}
			}

			// Replace in derived query repository methods
			const isRepo = /\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor)\s*<\s*([A-Z]\w*)/.test(text);
			if (isRepo) {
				const methodRegex = /\b(?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By[A-Za-z0-9_]+/g;
				let match: RegExpExecArray | null;
				while ((match = methodRegex.exec(text)) !== null) {
					const startOffset = match.index;
					const repoEntityName = extractRepositoryEntityNameAt(text, startOffset);
					if (repoEntityName?.toLowerCase() !== entity.name.toLowerCase()) {
						continue;
					}

					const parsed = parseDerivedMethodName(match[0]);
					if (!parsed) {
						continue;
					}

					for (const predicate of parsed.predicates) {
						const cleaned = predicate.propertyName.replace(/_/g, '').toLowerCase();
						if (cleaned === oldName.toLowerCase()) {
							const predStartOffset = startOffset + predicate.startOffset;
							const start = doc.positionAt(predStartOffset);
							const end = doc.positionAt(predStartOffset + predicate.propertyName.length);
							const replacement = predicate.propertyName.includes('_')
								? predicate.propertyName.replace(new RegExp(oldName, 'i'), capitalizedNew)
								: capitalizedNew;
							edit.replace(doc.uri, new vscode.Range(start, end), replacement);
						}
					}
				}
			}
		}

		return edit;
	}
}
