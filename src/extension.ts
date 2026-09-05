import * as vscode from 'vscode';
import { clearEntityCache, discoverEntities, findEntityProperties, WorkspaceEntityIndex } from './entityDiscovery';
import { isJpaPrefix, isRepositoryMethodContext, JPA_KEYWORDS, validateDerivedMethod } from './jpaKeywords';
import { createKeywordItem } from './legacyHelpers';
import { createDerivedQueryCompletions } from './derivedQuery/queryCompletion';
import { validateDerivedMethodSignature, MethodSignatureInfo } from './derivedQuery/queryValidator';
import { extractAllJpqlQueries } from './jpql/jpqlParser';
import { validateJpql } from './jpql/jpqlValidator';
import { createJpqlCompletions } from './jpql/jpqlCompletion';
import { SpringJpaDefinitionProvider } from './navigation/definitionProvider';
import { SpringJpaCodeActionProvider } from './actions/codeActionProvider';

export { createKeywordItem, extractMethodParameterNames } from './legacyHelpers';

export function activate(context: vscode.ExtensionContext) {
	const entityIndex = WorkspaceEntityIndex.getInstance();
	void entityIndex.ensureInitialized();

	// Incremental file watcher for Java files
	const watcher = vscode.workspace.createFileSystemWatcher('**/*.java');
	watcher.onDidChange(async (uri) => {
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			entityIndex.updateDocument(doc);
		} catch {
			// ignore
		}
	});
	watcher.onDidCreate(async (uri) => {
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			entityIndex.updateDocument(doc);
		} catch {
			// ignore
		}
	});
	watcher.onDidDelete((uri) => {
		entityIndex.removeUri(uri);
	});
	context.subscriptions.push(watcher);

	const diagnostics = vscode.languages.createDiagnosticCollection('spring-jpa-autocomplete');
	context.subscriptions.push(diagnostics);

	// 1. Completion Provider
	const completionProvider = vscode.languages.registerCompletionItemProvider(
		{ language: 'java', scheme: 'file' },
		{
			async provideCompletionItems(document, position) {
				const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
				const entities = await discoverEntities(document);

				// A. JPQL Completion inside @Query
				const jpqlItems = createJpqlCompletions(document, position, entities);
				if (jpqlItems && jpqlItems.length > 0) {
					return jpqlItems;
				}

				if (!isRepositoryMethodContext(linePrefix)) {
					return undefined;
				}

				// B. Derived Query & Keyword Completion
				const properties = findEntityProperties(document.getText(), entities);
				const derivedItems = createDerivedQueryCompletions(linePrefix, properties, position);
				if (derivedItems.length > 0) {
					return derivedItems;
				}

				const word = linePrefix.match(/[A-Za-z]*$/)?.[0] ?? '';
				const afterBy = /\b(?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By\w+$/.test(linePrefix);
				const replacementRange = new vscode.Range(
					new vscode.Position(position.line, afterBy ? position.character : position.character - word.length),
					position,
				);

				const items: vscode.CompletionItem[] = JPA_KEYWORDS
					.filter((keyword) => afterBy ? keyword.kind !== 'prefix' : keyword.label.toLowerCase().startsWith(word.toLowerCase()))
					.map((keyword) => createKeywordItem(keyword, word, replacementRange));

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
		},
		'.', ':', ' '
	);
	context.subscriptions.push(completionProvider);

	// 2. Definition Provider (Go to Definition - Ctrl+Click)
	const definitionProvider = vscode.languages.registerDefinitionProvider(
		{ language: 'java', scheme: 'file' },
		new SpringJpaDefinitionProvider()
	);
	context.subscriptions.push(definitionProvider);

	// 3. Code Action Provider (Quick-Fixes - Alt+Enter)
	const codeActionProvider = vscode.languages.registerCodeActionsProvider(
		{ language: 'java', scheme: 'file' },
		new SpringJpaCodeActionProvider(),
		{ providedCodeActionKinds: SpringJpaCodeActionProvider.providedCodeActionKinds }
	);
	context.subscriptions.push(codeActionProvider);

	// 4. Diagnostics Refresh
	const refreshJavaDiagnostics = async (document: vscode.TextDocument) => {
		if (document.languageId !== 'java') {
			return;
		}

		const entities = await discoverEntities(document);
		const properties = findEntityProperties(document.getText(), entities);
		const documentDiagnostics: vscode.Diagnostic[] = [];
		const docText = document.getText();

		// Check if current file is a repository interface
		const isRepo = /\binterface\s+\w+Repository\b/.test(docText);

		if (isRepo) {
			// A. Derived Query Methods Diagnostics (Validation of signature, return types, parameters, properties)
			const methodRegex = /\b([\w$<>?[\]\s]+?)\s+((?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
			let methodMatch: RegExpExecArray | null;

			while ((methodMatch = methodRegex.exec(docText)) !== null) {
				const fullText = methodMatch[0];
				const returnType = methodMatch[1].trim();
				const methodName = methodMatch[2];
				const paramsText = methodMatch[3];
				const startOffset = methodMatch.index;
				const endOffset = methodMatch.index + fullText.length;

				const parameters = parseMethodParameters(paramsText);
				const sig: MethodSignatureInfo = {
					rawText: fullText,
					returnType,
					methodName,
					parameters,
					startOffset,
					endOffset,
				};

				const diags = validateDerivedMethodSignature(sig, properties);
				for (const d of diags) {
					const start = document.positionAt(d.startOffset);
					const end = document.positionAt(d.endOffset);
					const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
					const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end), d.message, severity);
					diagnostic.source = 'spring-jpa';
					if (d.code) {
						diagnostic.code = d.code;
					}
					documentDiagnostics.push(diagnostic);
				}
			}
		}

		// B. JPQL Query Diagnostics (@Query annotations, multi-line, text blocks, aliases, params)
		const jpqlQueries = extractAllJpqlQueries(docText, entities);
		for (const q of jpqlQueries) {
			const jpqlDiags = validateJpql(q, entities);
			for (const d of jpqlDiags) {
				const start = document.positionAt(d.startOffset);
				const end = document.positionAt(d.endOffset);
				const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
				const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end), d.message, severity);
				diagnostic.source = 'spring-jpa';
				diagnostic.code = d.code;
				documentDiagnostics.push(diagnostic);
			}
		}

		diagnostics.set(document.uri, documentDiagnostics);
	};

	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refreshJavaDiagnostics));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(({ document }) => refreshJavaDiagnostics(document)));
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
		if (document.languageId === 'java') {
			entityIndex.updateDocument(document);
			void refreshJavaDiagnostics(document);
		}
	}));

	for (const document of vscode.workspace.textDocuments) {
		void refreshJavaDiagnostics(document);
	}
}

function parseMethodParameters(paramsText: string): { name: string; type: string }[] {
	if (!paramsText.trim()) {
		return [];
	}
	return paramsText.split(',').map((p) => {
		const trimmed = p.trim();
		const match = trimmed.match(/([\w$<>?[\]\s]+?)\s+([A-Za-z_$]\w*)$/);
		if (match) {
			return { type: match[1].trim(), name: match[2] };
		}
		return { type: 'Object', name: trimmed };
	});
}

export function deactivate() { }
