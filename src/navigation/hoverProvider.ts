import * as vscode from 'vscode';
import { findEntityProperties, resolveEntityPropertyPath, WorkspaceEntityIndex } from '../entityDiscovery';
import { extractAllJpqlQueries } from '../jpql/jpqlParser';

export class SpringJpaHoverProvider implements vscode.HoverProvider {
	public async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): Promise<vscode.Hover | undefined> {
		const index = WorkspaceEntityIndex.getInstance();
		await index.ensureInitialized();
		const entities = index.getAllEntities();
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}

		const word = document.getText(wordRange);
		const entity = entities.find((candidate) => candidate.name === word);
		if (entity) {
			return new vscode.Hover(new vscode.MarkdownString(`**JPA entity** ${entity.name}\n\n${entity.properties.length} properties\n\n${entity.uri.fsPath}`), wordRange);
		}

		const offset = document.offsetAt(position);
		const query = extractAllJpqlQueries(document.getText(), entities).find(
			(candidate) => offset >= candidate.queryStartOffset && offset <= candidate.queryEndOffset,
		);
		if (query) {
			const access = query.propertyAccesses.find((candidate) => offset >= candidate.startOffset && offset <= candidate.endOffset);
			if (access) {
				const entityName = query.aliases.get(access.alias);
				const target = entities.find((candidate) => candidate.name.toLowerCase() === entityName?.toLowerCase());
				const property = target && resolveEntityPropertyPath(target, access.property, new Map(entities.map((candidate) => [candidate.name, candidate])));
				if (property) {
					return new vscode.Hover(new vscode.MarkdownString(formatProperty(property.name, property.type, property.relation, target?.name)), wordRange);
				}
			}
		}

		const properties = findEntityProperties(document.getText(), entities);
		const property = properties.find((candidate) => candidate.name.toLowerCase() === word.toLowerCase());
		if (property) {
			return new vscode.Hover(new vscode.MarkdownString(formatProperty(property.name, property.type, property.relation)), wordRange);
		}
		return undefined;
	}
}

function formatProperty(name: string, type: string, relation?: string, entityName?: string): string {
	const relationText = relation ? `\n\nRelation JPA: ${relation}` : '';
	const ownerText = entityName ? `\n\nEntité: ${entityName}` : '';
	return `**JPA property** ${name}\n\nType: ${type}${relationText}${ownerText}`;
}
