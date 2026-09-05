import * as vscode from 'vscode';
import { EntityInfo } from '../entityModel';
import { extractAllJpqlQueries } from './jpqlParser';

const JPQL_KEYWORDS = [
	'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'LEFT JOIN FETCH',
	'INNER JOIN', 'ORDER BY', 'GROUP BY', 'HAVING', 'AND', 'OR', 'NOT',
	'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL', 'EXISTS', 'COUNT',
	'DISTINCT', 'AVG', 'SUM', 'MIN', 'MAX', 'ASC', 'DESC',
];

export function createJpqlCompletions(
	document: vscode.TextDocument,
	position: vscode.Position,
	entities: readonly EntityInfo[],
): vscode.CompletionItem[] | undefined {
	const linePrefix = document.lineAt(position.line).text.slice(0, position.character);

	// Quick check: are we inside a @Query string?
	// Look backwards for @Query( ... "
	const docText = document.getText();
	const queries = extractAllJpqlQueries(docText, entities);
	const offset = document.offsetAt(position);

	const activeQuery = queries.find(
		(q) => offset >= q.queryStartOffset && offset <= q.queryEndOffset,
	);

	if (!activeQuery) {
		// Fallback check for single line query being typed
		if (!/@Query\s*\([^)\n]*["'][^"'\n]*$/.test(linePrefix)) {
			return undefined;
		}
	}

	const items: vscode.CompletionItem[] = [];

	// 1. Check for alias property completion: e.g. "u."
	const aliasPropMatch = linePrefix.match(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)?$/);
	if (aliasPropMatch) {
		const alias = aliasPropMatch[1];
		const partial = aliasPropMatch[2] ?? '';
		const startPos = new vscode.Position(position.line, position.character - partial.length);
		const replaceRange = new vscode.Range(startPos, position);

		// Resolve alias target entity
		let targetEntityName = activeQuery?.aliases.get(alias);
		if (!targetEntityName) {
			// Fallback: search query content for "FROM User u"
			const fromMatch = linePrefix.match(new RegExp(`\\bFROM\\s+([A-Z]\\w*)\\s+${alias}\\b`, 'i'));
			if (fromMatch) {
				targetEntityName = fromMatch[1];
			}
		}

		const entityMap = new Map(entities.map((e) => [e.name.toLowerCase(), e]));
		const targetEntity = targetEntityName
			? entityMap.get(targetEntityName.toLowerCase())
			: entities[0]; // fallback to first entity if only 1

		if (targetEntity) {
			for (const prop of targetEntity.properties) {
				if (!partial || prop.name.toLowerCase().startsWith(partial.toLowerCase())) {
					const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Field);
					item.detail = `${targetEntity.name}.${prop.name} : ${prop.type}`;
					item.range = replaceRange;
					items.push(item);
				}
			}
			return items;
		}
	}

	// 2. Check for named parameter completion after ":"
	const colonMatch = linePrefix.match(/:([A-Za-z_]\w*)?$/);
	if (colonMatch && activeQuery?.methodSignature) {
		const partial = colonMatch[1] ?? '';
		const startPos = new vscode.Position(position.line, position.character - partial.length);
		const replaceRange = new vscode.Range(startPos, position);

		for (const param of activeQuery.methodSignature.parameters) {
			const paramName = param.paramName ?? param.name;
			if (!partial || paramName.toLowerCase().startsWith(partial.toLowerCase())) {
				const item = new vscode.CompletionItem(paramName, vscode.CompletionItemKind.Variable);
				item.detail = `Method parameter: ${param.type} ${paramName}`;
				item.range = replaceRange;
				items.push(item);
			}
		}
		return items;
	}

	// 3. Check for entity completion after FROM or JOIN
	const fromOrJoinMatch = linePrefix.match(/\b(?:FROM|JOIN)\s+([A-Z]\w*)?$/i);
	if (fromOrJoinMatch) {
		const partial = fromOrJoinMatch[1] ?? '';
		const startPos = new vscode.Position(position.line, position.character - partial.length);
		const replaceRange = new vscode.Range(startPos, position);

		for (const entity of entities) {
			if (!partial || entity.name.toLowerCase().startsWith(partial.toLowerCase())) {
				const item = new vscode.CompletionItem(entity.name, vscode.CompletionItemKind.Class);
				item.detail = `JPA Entity: ${entity.name}`;
				item.range = replaceRange;
				items.push(item);
			}
		}
		return items;
	}

	// 4. General JPQL keywords
	const lastWordMatch = linePrefix.match(/[A-Za-z_]+$/);
	const lastWord = lastWordMatch ? lastWordMatch[0] : '';
	if (lastWord.length > 0) {
		const wordRange = new vscode.Range(new vscode.Position(position.line, position.character - lastWord.length), position);
		for (const kw of JPQL_KEYWORDS) {
			if (kw.toLowerCase().startsWith(lastWord.toLowerCase())) {
				const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
				item.detail = `JPQL keyword: ${kw}`;
				item.range = wordRange;
				items.push(item);
			}
		}
	}

	return items.length > 0 ? items : undefined;
}
