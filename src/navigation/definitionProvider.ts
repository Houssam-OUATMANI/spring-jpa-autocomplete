import * as vscode from 'vscode';
import { findEntityProperties, resolveEntityPropertyPath, WorkspaceEntityIndex } from '../entityDiscovery';
import { extractAllJpqlQueries } from '../jpql/jpqlParser';
import { parseDerivedMethodName } from '../derivedQuery/queryParser';

export class SpringJpaDefinitionProvider implements vscode.DefinitionProvider {
	public async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Promise<vscode.Definition | undefined> {
		const index = WorkspaceEntityIndex.getInstance();
		await index.ensureInitialized();
		const entities = index.getAllEntities();
		const entityMap = new Map(entities.map((e) => [e.name.toLowerCase(), e]));

		const lineText = document.lineAt(position.line).text;
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}
		const word = document.getText(wordRange);

		// 1. Navigation from Repository generic: JpaRepository<User, Long>
		const genericMatch = lineText.match(/\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository)\s*<\s*([A-Z]\w*)/);
		if (genericMatch && genericMatch[1] === word) {
			const targetEntity = entityMap.get(word.toLowerCase());
			if (targetEntity) {
				return new vscode.Location(targetEntity.uri, new vscode.Position(0, 0));
			}
		}

		// 2. Navigation inside @Query
		const docText = document.getText();
		const offset = document.offsetAt(position);
		const jpqlQueries = extractAllJpqlQueries(docText, entities);
		const activeQuery = jpqlQueries.find(
			(q) => offset >= q.queryStartOffset && offset <= q.queryEndOffset,
		);

		if (activeQuery) {
			// Check if clicking on named parameter :param
			const param = activeQuery.namedParameters.find(
				(p) => offset >= p.startOffset && offset <= p.endOffset,
			);
			if (param && activeQuery.methodSignature) {
				const methodParam = activeQuery.methodSignature.parameters.find(
					(mp) => (mp.paramName ?? mp.name).toLowerCase() === param.name.toLowerCase(),
				);
				if (methodParam) {
					const pos = document.positionAt(methodParam.startOffset);
					return new vscode.Location(document.uri, pos);
				}
			}

			// Check if clicking on alias property: u.email
			const propAccess = activeQuery.propertyAccesses.find(
				(pa) => offset >= pa.startOffset && offset <= pa.endOffset,
			);
			if (propAccess) {
				const entityName = activeQuery.aliases.get(propAccess.alias);
				if (entityName) {
					const entity = entityMap.get(entityName.toLowerCase());
					if (entity) {
						const prop = resolveEntityPropertyPath(entity, propAccess.property, entityMap);
						if (prop && prop.location) {
							return new vscode.Location(
								entity.uri,
								new vscode.Position(prop.location.line, prop.location.character),
							);
						}
					}
				}
			}
		}

		// 3. Navigation inside Derived Query method: findByEmailAndActive
		const methodRegex = /\b(?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By[A-Za-z_]+/g;
		let methodMatch: RegExpExecArray | null;
		while ((methodMatch = methodRegex.exec(lineText)) !== null) {
			const methodStart = methodMatch.index;
			const methodEnd = methodMatch.index + methodMatch[0].length;

			if (position.character >= methodStart && position.character <= methodEnd) {
				const methodName = methodMatch[0];
				const parsed = parseDerivedMethodName(methodName);
				if (!parsed) break;

				// Find which entity this repository manages
				const repoEntityMatch = docText.match(/\b(?:JpaRepository|CrudRepository|ListCrudRepository)\s*<\s*([A-Z]\w*)/);
				const targetEntityName = repoEntityMatch ? repoEntityMatch[1] : undefined;
				const targetEntity = targetEntityName ? entityMap.get(targetEntityName.toLowerCase()) : entities[0];

				if (!targetEntity) break;

				const offsetInMethod = position.character - methodStart;
				const predicate = parsed.predicates.find(
					(p) => offsetInMethod >= p.startOffset && offsetInMethod <= p.endOffset,
				);

				if (predicate) {
					// Match property in target entity
					const cleanedPropName = predicate.propertyName.replace(/_/g, '').toLowerCase();
					const accessibleProperties = findEntityProperties(docText, entities);
					const prop = accessibleProperties.find(
						(p) => p.name.replace(/_/g, '').toLowerCase() === cleanedPropName,
					);
					if (prop && prop.location) {
						return new vscode.Location(
							targetEntity.uri,
							new vscode.Position(prop.location.line, prop.location.character),
						);
					}
				}
			}
		}

		return undefined;
	}
}
