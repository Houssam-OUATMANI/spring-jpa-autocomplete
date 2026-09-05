import * as vscode from 'vscode';
import { clearEntityCache, findEntityProperties, discoverEntities } from './entityDiscovery';
import { createQueryMethodSuggestions, isJpaPrefix, isRepositoryMethodContext, JPA_KEYWORDS, validateDerivedMethod } from './jpaKeywords';
import { validateJpqlQuery } from './jpql';

export function activate(context: vscode.ExtensionContext) {
	const diagnostics = vscode.languages.createDiagnosticCollection('spring-jpa-autocomplete');
	context.subscriptions.push(diagnostics);
	const provider = vscode.languages.registerCompletionItemProvider({ language: 'java', scheme: 'file' }, {
		async provideCompletionItems(document, position) {
			const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
			if (/@Query\s*\([^"\n]*"[^"\n]*$/.test(linePrefix)) {
				const propertyMatch = linePrefix.match(/\b[A-Za-z_]\w*\.([A-Za-z_]\w*)?$/);
				if (!propertyMatch) {
					return undefined;
				}
				const entities = await discoverEntities(document);
				const properties = findEntityProperties(document.getText(), entities);
				const partial = propertyMatch[1] ?? '';
				const start = position.character - partial.length;
				return properties
					.filter((property) => property.name.toLowerCase().startsWith(partial.toLowerCase()))
					.map((property) => {
						const item = new vscode.CompletionItem(property.name, vscode.CompletionItemKind.Field);
						item.detail = `JPQL property: ${property.type}`;
						item.textEdit = vscode.TextEdit.replace(
							new vscode.Range(new vscode.Position(position.line, start), position),
							property.name,
						);
						return item;
					});
			}
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
			const properties = findEntityProperties(document.getText(), entities);
			const derivedMethodText = linePrefix.match(/\b(?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By\w*$/)?.[0] ?? '';
			const derivedMethodSuggestions = createQueryMethodSuggestions(derivedMethodText, properties);
			const derivedMethodRange = new vscode.Range(
				new vscode.Position(position.line, position.character - derivedMethodText.length),
				position,
			);
			for (const method of derivedMethodSuggestions) {
				const item = new vscode.CompletionItem(method.label, vscode.CompletionItemKind.Method);
				item.detail = method.detail;
				const parameterSnippets = method.parameters.map((parameter, index) => {
					const parameterName = parameter.split(' ').pop() ?? `value${index + 1}`;
					return `\${${index + 1}:${parameterName}}`;
				});
				item.range = derivedMethodRange;
				item.insertText = new vscode.SnippetString(`${method.label}(${parameterSnippets.join(', ')})$0`);
				item.documentation = new vscode.MarkdownString(`\`${method.label}(${method.parameters.join(', ')})\``);
				items.push(item);
			}

			for (const property of properties) {
				if (word.length === 0 || property.name.toLowerCase().startsWith(word.toLowerCase())) {
					const item = new vscode.CompletionItem(property.name, vscode.CompletionItemKind.Field);
					item.detail = `Entity property: ${property.type}`;
					item.textEdit = vscode.TextEdit.replace(
						replacementRange,
						property.name[0].toUpperCase() + property.name.slice(1),
					);
					items.push(item);
				}
			}

			return items;
		},
	}, '.', ':');

	context.subscriptions.push(provider);
	const refreshJavaDiagnostics = async (document: vscode.TextDocument) => {
		if (document.languageId !== 'java') {
			return;
		}

		const entities = await discoverEntities(document);
		const properties = findEntityProperties(document.getText(), entities);
		const documentDiagnostics: vscode.Diagnostic[] = [];
		for (let line = 0; line < document.lineCount; line++) {
			const lineText = document.lineAt(line).text;
			for (const match of lineText.matchAll(/\b(?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By[A-Za-z]+/g)) {
				const message = validateDerivedMethod(match[0], properties);
				if (message) {
					const start = new vscode.Position(line, match.index ?? 0);
					const end = new vscode.Position(line, (match.index ?? 0) + match[0].length);
					documentDiagnostics.push(new vscode.Diagnostic(new vscode.Range(start, end), message, vscode.DiagnosticSeverity.Error));
				}
			}
		}
		for (const match of document.getText().matchAll(/@Query\s*\(\s*"([^"\n]*)"/g)) {
			const query = match[1];
			const queryStart = (match.index ?? 0) + match[0].indexOf(query);
			const methodText = document.getText().slice(queryStart + query.length).match(/\b[\w$]+(?:\s*<[^>\n]+>)?(?:\[\])?\s+[A-Za-z_$]\w*\s*\(([\s\S]*?)\)\s*;/)?.[1] ?? '';
			const methodParameters = extractMethodParameterNames(methodText);
			for (const result of validateJpqlQuery(query, methodParameters, properties, entities.map((entity) => entity.name))) {
				const tokenOffset = query.indexOf(result.token);
				if (tokenOffset < 0) {
					continue;
				}
				const start = document.positionAt(queryStart + tokenOffset);
				const end = document.positionAt(queryStart + tokenOffset + result.token.length);
				documentDiagnostics.push(new vscode.Diagnostic(new vscode.Range(start, end), result.message, vscode.DiagnosticSeverity.Error));
			}
		}
		diagnostics.set(document.uri, documentDiagnostics);
	};

	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refreshJavaDiagnostics));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(({ document }) => refreshJavaDiagnostics(document)));
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
		if (document.languageId === 'java') {
			clearEntityCache();
			void refreshJavaDiagnostics(document);
		}
	}));
	for (const document of vscode.workspace.textDocuments) {
		void refreshJavaDiagnostics(document);
	}
}

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

// This method is called when your extension is deactivated
export function deactivate() {}
