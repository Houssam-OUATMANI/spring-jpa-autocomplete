import * as vscode from 'vscode';
import { extractRepositoryEntityNameAt, WorkspaceEntityIndex } from '../entityDiscovery';
import { extractAllJpqlQueries } from '../jpql/jpqlParser';
import { parseDerivedMethodName } from '../derivedQuery/queryParser';

export class SpringJpaReferenceProvider implements vscode.ReferenceProvider {
	public async provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.ReferenceContext,
		_token: vscode.CancellationToken,
	): Promise<vscode.Location[]> {
		const index = WorkspaceEntityIndex.getInstance();
		await index.ensureInitialized();
		const allEntities = index.getAllEntities();

		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return [];
		}
		const word = document.getText(wordRange);

		// 1. Check if the cursor is on an entity property in an indexed entity
		const currentEntities = index.getEntitiesForUri(document.uri);
		const entity = currentEntities.find((e) =>
			e.properties.some((p) => p.name.toLowerCase() === word.toLowerCase()),
		);
		if (!entity) {
			return [];
		}
		const property = entity.properties.find((p) => p.name.toLowerCase() === word.toLowerCase())!;

		const references: vscode.Location[] = [];

		// Add property definition location itself
		if (property.location) {
			const defPos = new vscode.Position(property.location.line, property.location.character);
			references.push(new vscode.Location(document.uri, new vscode.Range(defPos, new vscode.Position(property.location.line, property.location.character + property.name.length))));
		}

		// Search across all workspace text documents
		for (const doc of vscode.workspace.textDocuments) {
			if (doc.languageId !== 'java') {
				continue;
			}
			const text = doc.getText();

			// Check JPQL queries
			const jpqlQueries = extractAllJpqlQueries(text, allEntities);
			for (const query of jpqlQueries) {
				for (const access of query.propertyAccesses) {
					const targetEntity = query.aliases.get(access.alias);
					if (targetEntity && targetEntity.toLowerCase() === entity.name.toLowerCase()) {
						if (access.property.toLowerCase() === property.name.toLowerCase()) {
							const start = doc.positionAt(access.startOffset);
							const end = doc.positionAt(access.endOffset);
							references.push(new vscode.Location(doc.uri, new vscode.Range(start, end)));
						}
					}
				}
			}

			// Check derived query repository methods
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
						if (cleaned === property.name.toLowerCase()) {
							const predStartOffset = startOffset + predicate.startOffset;
							const start = doc.positionAt(predStartOffset);
							const end = doc.positionAt(predStartOffset + predicate.propertyName.length);
							references.push(new vscode.Location(doc.uri, new vscode.Range(start, end)));
						}
					}
				}
			}
		}

		return references;
	}
}
