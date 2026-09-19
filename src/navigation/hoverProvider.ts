import * as vscode from 'vscode';
import { findEntityProperties, resolveEntityPropertyPathWithOwner, WorkspaceEntityIndex } from '../entityDiscovery';
import { extractAllJpqlQueries } from '../jpql/jpqlParser';
import { getJpqlDocumentation } from '../jpql/jpqlDocumentation';

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
			const compoundDocumentation = findCompoundJpqlDocumentation(query.queryContent, query.queryStartOffset, offset);
			const jpqlDocumentation = compoundDocumentation?.documentation ?? getJpqlDocumentation(word);
			if (jpqlDocumentation) {
				const documentationRange = compoundDocumentation
					? new vscode.Range(document.positionAt(compoundDocumentation.startOffset), document.positionAt(compoundDocumentation.endOffset))
					: wordRange;
				return new vscode.Hover(new vscode.MarkdownString(formatJpqlDocumentation(jpqlDocumentation)), documentationRange);
			}
			const access = query.propertyAccesses.find((candidate) => offset >= candidate.startOffset && offset <= candidate.endOffset);
			if (access) {
				const entityName = query.aliases.get(access.alias);
				const target = entities.find((candidate) => candidate.name.toLowerCase() === entityName?.toLowerCase());
				const resolved = target && resolveEntityPropertyPathWithOwner(target, access.property, new Map(entities.map((candidate) => [candidate.name, candidate])));
				if (resolved) {
					return new vscode.Hover(new vscode.MarkdownString(formatProperty(resolved.property.name, resolved.property.type, resolved.property.relation, resolved.owner.name)), wordRange);
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

function findCompoundJpqlDocumentation(
	queryContent: string,
	queryStartOffset: number,
	documentOffset: number,
): { documentation: ReturnType<typeof getJpqlDocumentation>; startOffset: number; endOffset: number } | undefined {
	for (const match of queryContent.matchAll(/\b(LEFT(?:\s+OUTER)?|INNER|RIGHT|FULL|CROSS)\s+JOIN\b/gi)) {
		const startOffset = queryStartOffset + (match.index ?? 0);
		const endOffset = startOffset + match[0].length;
		if (documentOffset >= startOffset && documentOffset <= endOffset) {
			return { documentation: getJpqlDocumentation(match[0]), startOffset, endOffset };
		}
	}
	return undefined;
}

function formatProperty(name: string, type: string, relation?: string, entityName?: string): string {
	const relationText = relation ? `\n\nRelation JPA: ${relation}` : '';
	const ownerText = entityName ? `\n\nEntité: ${entityName}` : '';
	return `**JPA property** ${name}\n\nType: ${type}${relationText}${ownerText}`;
}

function formatJpqlDocumentation(documentation: ReturnType<typeof getJpqlDocumentation>): string {
	if (!documentation) {
		return '';
	}
	return `**JPQL ${documentation.kind}**\n\n### ${documentation.title}\n${documentation.description}\n\n**Syntaxe**\n\`${documentation.syntax}\`\n\n**Exemple**\n\`${documentation.useCase}\``;
}
