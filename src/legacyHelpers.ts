import * as vscode from 'vscode';
import { isJpaPrefix, JPA_KEYWORDS } from './jpaKeywords';

export function extractMethodParameterNames(parametersText: string): readonly string[] {
	return parametersText
		.split(',')
		.map((parameter) => parameter.match(/@Param\s*\(\s*"([^"]+)"\s*\)/)?.[1] ?? parameter.trim().match(/([A-Za-z_$]\w*)\s*$/)?.[1])
		.filter((name): name is string => name !== undefined);
}

export function createKeywordItem(keyword: typeof JPA_KEYWORDS[number], word: string, range: vscode.Range): vscode.CompletionItem {
	const item = new vscode.CompletionItem(keyword.label, vscode.CompletionItemKind.Keyword);
	item.detail = keyword.detail;
	item.documentation = new vscode.MarkdownString(keyword.documentation);
	item.filterText = keyword.label;
	item.textEdit = vscode.TextEdit.replace(range, keyword.label);
	item.sortText = keyword.kind === 'prefix' ? `0-${keyword.label}` : `1-${keyword.label}`;
	if (word.length > 0 && !isJpaPrefix(word)) {
		item.sortText = `2-${keyword.label}`;
	}
	return item;
}
