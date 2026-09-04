import * as vscode from 'vscode';
import { clearEntityCache, findEntityProperties, discoverEntities } from './entityDiscovery';
import { isJpaPrefix, isRepositoryMethodContext, JPA_KEYWORDS } from './jpaKeywords';

export function activate(context: vscode.ExtensionContext) {
	const provider = vscode.languages.registerCompletionItemProvider({ language: 'java', scheme: 'file' }, {
		async provideCompletionItems(document, position) {
			const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
			if (!isRepositoryMethodContext(linePrefix)) {
				return undefined;
			}

			const word = linePrefix.match(/[A-Za-z]*$/)?.[0] ?? '';
			const afterBy = /\b(?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By\w+$/.test(linePrefix);
			const replacementRange = new vscode.Range(
				new vscode.Position(position.line, afterBy ? position.character : position.character - word.length),
				position,
			);
			const items = JPA_KEYWORDS
				.filter((keyword) => afterBy ? keyword.kind !== 'prefix' : keyword.label.toLowerCase().startsWith(word.toLowerCase()))
				.map((keyword) => createKeywordItem(keyword, word, replacementRange));

			const entities = await discoverEntities(document);
			for (const property of findEntityProperties(document.getText(), entities)) {
				if (word.length === 0 || property.toLowerCase().startsWith(word.toLowerCase())) {
					const item = new vscode.CompletionItem(property, vscode.CompletionItemKind.Field);
					item.detail = 'Entity property';
					item.insertText = property[0].toUpperCase() + property.slice(1);
					item.range = replacementRange;
					items.push(item);
				}
			}

			return items;
		},
	}, '.');

	context.subscriptions.push(provider);
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
		if (document.languageId === 'java') {
			clearEntityCache();
		}
	}));
}

function createKeywordItem(keyword: typeof JPA_KEYWORDS[number], word: string, range: vscode.Range): vscode.CompletionItem {
	const item = new vscode.CompletionItem(keyword.label, vscode.CompletionItemKind.Keyword);
	item.detail = keyword.detail;
	item.documentation = new vscode.MarkdownString(keyword.documentation);
	item.filterText = keyword.label;
	item.insertText = new vscode.SnippetString(`${keyword.label}$0`);
	item.range = range;
	item.sortText = keyword.kind === 'prefix' ? `0-${keyword.label}` : `1-${keyword.label}`;
	if (word.length > 0 && !isJpaPrefix(word)) {
		item.sortText = `2-${keyword.label}`;
	}
	return item;
}

// This method is called when your extension is deactivated
export function deactivate() {}
