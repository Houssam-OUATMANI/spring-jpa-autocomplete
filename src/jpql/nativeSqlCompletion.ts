import * as vscode from 'vscode';
import { EntityInfo } from '../entityModel';
import { extractAllJpqlQueries, JpqlQueryInfo } from './jpqlParser';

const SQL_KEYWORDS = [
	'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON',
	'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'LIKE', 'BETWEEN', 'EXISTS', 'AS', 'GROUP BY', 'HAVING',
	'ORDER BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'INSERT INTO', 'UPDATE',
	'SET', 'DELETE FROM', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION', 'NULL', 'TRUE', 'FALSE',
];

const SQL_RESERVED = new Set(SQL_KEYWORDS.flatMap((keyword) => keyword.toLowerCase().split(/\s+/)));

interface SqlSuggestion {
	readonly label: string;
	readonly detail: string;
	readonly kind: vscode.CompletionItemKind;
}

export function createNativeSqlCompletions(
	document: vscode.TextDocument,
	position: vscode.Position,
	entities: readonly EntityInfo[],
	queries?: readonly JpqlQueryInfo[],
): vscode.CompletionItem[] | undefined {
	const documentText = document.getText();
	const documentOffset = document.offsetAt(position);
	const query = (queries ?? extractAllJpqlQueries(documentText, entities)).find((candidate) =>
		candidate.isNative
			&& candidate.sourceOffsets.length > 0
			&& documentOffset >= candidate.sourceOffsets[0]
			&& documentOffset <= candidate.sourceOffsets[candidate.sourceOffsets.length - 1] + 1,
	);
	if (!query) {
		return undefined;
	}

	const queryOffset = query.sourceOffsets.findIndex((sourceOffset) => sourceOffset >= documentOffset);
	const cursorOffset = queryOffset < 0 ? query.queryContent.length : queryOffset;
	const beforeCursor = query.queryContent.slice(0, cursorOffset);
	const partial = beforeCursor.match(/[A-Za-z_$][\w$]*$/)?.[0] ?? '';
	const replacementRange = new vscode.Range(
		new vscode.Position(position.line, position.character - partial.length),
		position,
	);
	const aliasEntities = resolveSqlAliases(query.queryContent, entities);
	const tableContext = beforeCursor.match(/\b(?:FROM|JOIN)\s+([A-Za-z_$][\w$]*)?$/i);
	const columnContext = beforeCursor.match(/\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)?$/);
	let suggestions: SqlSuggestion[];

	if (tableContext) {
		suggestions = entities.map((entity) => ({
			label: entity.tableName ?? entity.name,
			detail: `Table for ${entity.name}`,
			kind: vscode.CompletionItemKind.Class,
		}));
	} else if (columnContext && aliasEntities.has(columnContext[1].toLowerCase())) {
		const entity = aliasEntities.get(columnContext[1].toLowerCase())!;
		suggestions = entity.properties.map((property) => ({
			label: property.columnName ?? property.name,
			detail: `${entity.name}.${property.name}: ${property.type}`,
			kind: vscode.CompletionItemKind.Field,
		}));
	} else {
		suggestions = [
			...SQL_KEYWORDS.map((label) => ({ label, detail: 'SQL keyword', kind: vscode.CompletionItemKind.Keyword })),
			...entities.flatMap((entity) => entity.properties.map((property) => ({
				label: property.columnName ?? property.name,
				detail: `${entity.name}.${property.name}: ${property.type}`,
				kind: vscode.CompletionItemKind.Field,
			}))),
		];
	}

	const seen = new Set<string>();
	return suggestions
		.filter((suggestion) => {
			const key = suggestion.label.toLowerCase();
			if (!key.startsWith(partial.toLowerCase()) || seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		})
		.map((suggestion) => {
			const item = new vscode.CompletionItem(suggestion.label, suggestion.kind);
			item.detail = suggestion.detail;
			item.filterText = suggestion.label;
			item.textEdit = vscode.TextEdit.replace(replacementRange, suggestion.label);
			return item;
		});
}

function resolveSqlAliases(
	query: string,
	entities: readonly EntityInfo[],
): Map<string, EntityInfo> {
	const aliases = new Map<string, EntityInfo>();
	for (const match of query.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_$][\w$.]*)(?:\s+(?:AS\s+)?([A-Za-z_$][\w$]*))?/gi)) {
		const table = match[1].toLowerCase();
		const tableSimpleName = table.split('.').at(-1)!;
		const entity = entities.find((candidate) => [
			candidate.tableName,
			candidate.name,
			candidate.entityName,
		].some((name) => name?.toLowerCase() === table || name?.toLowerCase() === tableSimpleName));
		if (!entity) {
			continue;
		}
		const alias = match[2] && !SQL_RESERVED.has(match[2].toLowerCase()) ? match[2] : tableSimpleName;
		aliases.set(alias.toLowerCase(), entity);
	}
	return aliases;
}