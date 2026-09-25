import * as vscode from 'vscode';
import { clearEntityCache, discoverEntities, extractRepositoryEntityNameAt, findEntityProperties, WorkspaceEntityIndex } from './entityDiscovery';
import { isJpaPrefix, isRepositoryMethodContext, JPA_KEYWORDS, validateDerivedMethod } from './jpaKeywords';
import { createKeywordItem } from './legacyHelpers';
import { createDerivedQueryCompletions } from './derivedQuery/queryCompletion';
import { validateDerivedMethodSignature, MethodSignatureInfo } from './derivedQuery/queryValidator';
import { extractAllJpqlQueries } from './jpql/jpqlParser';
import { validateJpql } from './jpql/jpqlValidator';
import { createJpqlCompletions } from './jpql/jpqlCompletion';
import { SpringJpaDefinitionProvider } from './navigation/definitionProvider';
import { SpringJpaHoverProvider } from './navigation/hoverProvider';
import { SpringJpaCodeLensProvider } from './navigation/codeLensProvider';
import { SpringJpaCodeActionProvider } from './actions/codeActionProvider';
import { generateRepositoryMethod, RepositoryMethodKind, RepositoryQueryOperator } from './repositoryGenerator';
import { parseJavaParameters } from './javaParsing';

export { createKeywordItem, extractMethodParameterNames } from './legacyHelpers';

export type DiagnosticDisplayMode = 'all' | 'errors' | 'warnings' | 'off';

export function shouldDisplayDiagnostic(mode: DiagnosticDisplayMode, severity: 'error' | 'warning'): boolean {
	return mode === 'all' || (mode === 'errors' && severity === 'error') || (mode === 'warnings' && severity === 'warning');
}

export function activate(context: vscode.ExtensionContext) {
	const entityIndex = WorkspaceEntityIndex.getInstance();
	void entityIndex.ensureInitialized();
	const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const output = vscode.window.createOutputChannel('Spring Data JPA Tools');
	context.subscriptions.push(output);

	const rebuildIndex = vscode.commands.registerCommand('springJpa.rebuildIndex', async () => {
		const started = Date.now();
		entityIndex.clear();
		await entityIndex.ensureInitialized();
		for (const document of vscode.workspace.textDocuments) {
			if (document.languageId === 'java') {
				await refreshJavaDiagnostics(document);
			}
		}
		vscode.window.showInformationMessage(`Spring JPA index rebuilt (${entityIndex.getAllEntities().length} entities).`);
		if (vscode.workspace.getConfiguration('springJpa').get<boolean>('enablePerformanceDiagnostics', false)) {
			output.appendLine(`Index rebuilt in ${Date.now() - started}ms.`);
		}
	});
	context.subscriptions.push(rebuildIndex);

	const generateMethod = vscode.commands.registerCommand('springJpa.generateRepositoryMethod', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'java') {
			vscode.window.showWarningMessage('Open a Java repository to generate a method.');
			return;
		}
		const repositoryMatch = editor.document.getText().match(/\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository)\s*<\s*([A-Z]\w*)/);
		if (!repositoryMatch) {
			vscode.window.showWarningMessage('The active Java file is not a supported Spring Data repository.');
			return;
		}
		const entities = await discoverEntities(editor.document);
		const properties = findEntityProperties(editor.document.getText(), entities, repositoryMatch[1]);
		const selectedWord = editor.document.getText(editor.document.getWordRangeAtPosition(editor.selection.active) ?? new vscode.Range(editor.selection.active, editor.selection.active));
		const property = properties.find((candidate) => candidate.name.toLowerCase() === selectedWord.toLowerCase());
		if (!property) {
			vscode.window.showWarningMessage('Place the cursor on an entity property.');
			return;
		}
		const kind = await vscode.window.showQuickPick([
			{ label: 'find', description: 'Generate Optional<Entity> findBy...' },
			{ label: 'read', description: 'Generate readBy...' },
			{ label: 'get', description: 'Generate getBy...' },
			{ label: 'query', description: 'Generate queryBy...' },
			{ label: 'search', description: 'Generate searchBy...' },
			{ label: 'stream', description: 'Generate Stream<Entity> streamBy...' },
			{ label: 'exists', description: 'Generate boolean existsBy...' },
			{ label: 'count', description: 'Generate long countBy...' },
			{ label: 'delete', description: 'Generate void deleteBy...' },
			{ label: 'remove', description: 'Generate void removeBy...' },
		], { placeHolder: 'Choose a repository method' });
		if (!kind) {
			return;
		}
		let returnType: string | undefined;
		if (['find', 'read', 'get', 'query', 'search'].includes(kind.label)) {
			const result = await vscode.window.showQuickPick([
				{ label: 'Optional', description: `Optional<${repositoryMatch[1]}>` },
				{ label: 'List', description: `List<${repositoryMatch[1]}>` },
				{ label: 'Page', description: `Page<${repositoryMatch[1]}> with Pageable` },
				{ label: 'Slice', description: `Slice<${repositoryMatch[1]}> with Pageable` },
				{ label: 'Entity', description: repositoryMatch[1] },
			], { placeHolder: 'Choose a return type' });
			if (!result) {
				return;
			}
			returnType = result.label === 'Entity' ? repositoryMatch[1] : `${result.label}<${repositoryMatch[1]}>`;
		}
		const operator = await vscode.window.showQuickPick([
			{ label: 'Equals', description: 'Exact match' },
			{ label: 'Containing', description: 'Contains text' },
			{ label: 'StartingWith', description: 'Starts with text' },
			{ label: 'EndingWith', description: 'Ends with text' },
			{ label: 'In', description: 'Match a collection of values' },
			{ label: 'NotIn', description: 'Exclude a collection of values' },
			{ label: 'Between', description: 'Match a range' },
			{ label: 'GreaterThan', description: 'Strictly greater than' },
			{ label: 'LessThan', description: 'Strictly less than' },
			{ label: 'IsNull', description: 'Match null values' },
			{ label: 'IsNotNull', description: 'Match non-null values' },
			{ label: 'True', description: 'Match true values' },
			{ label: 'False', description: 'Match false values' },
		], { placeHolder: 'Choose a query operator' });
		if (!operator) {
			return;
		}
		const method = generateRepositoryMethod({
			entityName: repositoryMatch[1],
			propertyName: property.name,
			propertyType: property.type,
			kind: kind.label as RepositoryMethodKind,
			operator: operator.label as RepositoryQueryOperator,
			returnType,
		});
		const closeBrace = editor.document.getText().lastIndexOf('}');
		if (closeBrace < 0) {
			return;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.insert(editor.document.uri, editor.document.positionAt(closeBrace), `\n\t${method}\n`);
		const imports = new Set<string>();
		if (method.includes('Optional<')) {
			imports.add('java.util.Optional');
		}
		if (method.includes('Collection<')) {
			imports.add('java.util.Collection');
		}
		if (method.includes('List<')) {
			imports.add('java.util.List');
		}
		if (method.includes('Set<')) {
			imports.add('java.util.Set');
		}
		if (method.includes('Stream<')) {
			imports.add('java.util.stream.Stream');
		}
		if (method.includes('Page<')) {
			imports.add('org.springframework.data.domain.Page');
		}
		if (method.includes('Slice<')) {
			imports.add('org.springframework.data.domain.Slice');
		}
		if (method.includes('Pageable ')) {
			imports.add('org.springframework.data.domain.Pageable');
		}
		const missingImports = [...imports].filter((importName) =>
			!new RegExp(`\\bimport\\s+${importName.replaceAll('.', '\\.')}\\s*;`).test(editor.document.getText()),
		);
		if (missingImports.length > 0) {
			const importOffset = editor.document.getText().startsWith('package ')
				? editor.document.getText().indexOf(';') + 1
				: 0;
			edit.insert(editor.document.uri, editor.document.positionAt(importOffset), `\n\n${missingImports.map((importName) => `import ${importName};`).join('\n')}`);
		}
		await vscode.workspace.applyEdit(edit);
	});
	context.subscriptions.push(generateMethod);

	// Incremental file watcher for Java files
	const watcher = vscode.workspace.createFileSystemWatcher('**/*.java');
	watcher.onDidChange(async (uri) => {
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			const wasIndexed = entityIndex.hasUri(uri);
			entityIndex.updateDocument(doc);
			scheduleJavaDiagnostics(doc);
			if (wasIndexed || entityIndex.hasUri(uri)) {
				scheduleWorkspaceJavaDiagnostics();
			}
		} catch {
			// ignore
		}
	});
	watcher.onDidCreate(async (uri) => {
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			const wasIndexed = entityIndex.hasUri(uri);
			entityIndex.updateDocument(doc);
			scheduleJavaDiagnostics(doc);
			if (wasIndexed || entityIndex.hasUri(uri)) {
				scheduleWorkspaceJavaDiagnostics();
			}
		} catch {
			// ignore
		}
	});
	watcher.onDidDelete((uri) => {
		entityIndex.removeUri(uri);
		diagnostics.delete(uri);
		scheduleWorkspaceJavaDiagnostics();
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
				const properties = findEntityProperties(document.getText(), entities, extractRepositoryEntityNameAt(document.getText(), document.offsetAt(position)));
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

	const hoverProvider = vscode.languages.registerHoverProvider(
		{ language: 'java', scheme: 'file' },
		new SpringJpaHoverProvider(),
	);
	context.subscriptions.push(hoverProvider);

	const codeLensProvider = vscode.languages.registerCodeLensProvider(
		{ language: 'java', scheme: 'file' },
		new SpringJpaCodeLensProvider(),
	);
	context.subscriptions.push(codeLensProvider);

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

		const started = Date.now();
		const entities = await discoverEntities(document);
		const documentDiagnostics: vscode.Diagnostic[] = [];
		const docText = document.getText();
		const derivedMode = vscode.workspace.getConfiguration('springJpa').get<DiagnosticDisplayMode>('diagnostics.derivedQueries', 'all');
		const jpqlMode = vscode.workspace.getConfiguration('springJpa').get<DiagnosticDisplayMode>('diagnostics.jpql', 'all');

		// Check if current file is a repository interface
		const isRepo = /\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor)\s*<\s*[A-Z]\w*/.test(docText);

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

				const properties = findEntityProperties(docText, entities, extractRepositoryEntityNameAt(docText, startOffset));
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
					if (!shouldDisplayDiagnostic(derivedMode, d.severity)) {
						continue;
					}
					const start = document.positionAt(d.startOffset);
					const end = document.positionAt(d.endOffset);
					const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
					const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end), d.message, severity);
					diagnostic.source = 'spring-jpa';
					if (d.code) {
						diagnostic.code = d.code;
					}
					if (d.missingParam) {
						(diagnostic as vscode.Diagnostic & { missingParam?: typeof d.missingParam }).missingParam = d.missingParam;
					}
					if (d.expectedReturnType) {
						(diagnostic as vscode.Diagnostic & { expectedReturnType?: string }).expectedReturnType = d.expectedReturnType;
					}
					if (d.suggestedProperty) {
						(diagnostic as vscode.Diagnostic & { suggestedProperty?: string }).suggestedProperty = d.suggestedProperty;
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
				if (!shouldDisplayDiagnostic(jpqlMode, d.severity)) {
					continue;
				}
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
		if (vscode.workspace.getConfiguration('springJpa').get<boolean>('enablePerformanceDiagnostics', false)) {
			output.appendLine(`Diagnostics ${document.uri.toString()} computed in ${Date.now() - started}ms (${documentDiagnostics.length} findings).`);
		}
	};

	const scheduleJavaDiagnostics = (document: vscode.TextDocument) => {
		if (document.languageId !== 'java') {
			return;
		}
		const key = document.uri.toString();
		const existingTimer = diagnosticTimers.get(key);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}
		diagnosticTimers.set(key, setTimeout(() => {
			diagnosticTimers.delete(key);
			void refreshJavaDiagnostics(document);
		}, Math.max(0, vscode.workspace.getConfiguration('springJpa').get<number>('diagnosticDebounceMs', 150))));
	};

	const scheduleWorkspaceJavaDiagnostics = () => {
		for (const document of vscode.workspace.textDocuments) {
			if (document.languageId === 'java') {
				scheduleJavaDiagnostics(document);
			}
		}
	};

	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refreshJavaDiagnostics));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(({ document }) => {
		if (document.languageId !== 'java') {
			return;
		}
		const wasIndexed = entityIndex.hasUri(document.uri);
		entityIndex.updateDocument(document);
		scheduleJavaDiagnostics(document);
		if (wasIndexed || entityIndex.hasUri(document.uri)) {
			scheduleWorkspaceJavaDiagnostics();
		}
	}));
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
		if (document.languageId === 'java') {
			const wasIndexed = entityIndex.hasUri(document.uri);
			entityIndex.updateDocument(document);
			void refreshJavaDiagnostics(document);
			if (wasIndexed || entityIndex.hasUri(document.uri)) {
				scheduleWorkspaceJavaDiagnostics();
			}
		}
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('springJpa')) {
			scheduleWorkspaceJavaDiagnostics();
		}
	}));

	for (const document of vscode.workspace.textDocuments) {
		void refreshJavaDiagnostics(document);
	}

	context.subscriptions.push({
		dispose: () => {
			for (const timer of diagnosticTimers.values()) {
				clearTimeout(timer);
			}
			diagnosticTimers.clear();
		},
	});
}

function parseMethodParameters(paramsText: string): { name: string; type: string }[] {
	return parseJavaParameters(paramsText).map(({ name, type }) => ({ name, type }));
}

export function deactivate() { }
