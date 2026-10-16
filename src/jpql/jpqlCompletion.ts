import * as vscode from 'vscode';
import { EntityInfo, ProjectionTypeInfo } from '../entityModel';
import { createEntityLookup, referencedEntityNames, resolveEntityHierarchy, resolveEntityPropertyPath } from '../entityDiscovery';
import { extractAllJpqlQueries } from './jpqlParser';
import { JPQL_KEYWORDS, JPQL_CONDITIONAL, JPQL_FUNCTIONS } from './jpqlLanguage';
import { getJpqlDocumentation } from './jpqlDocumentation';
import { createNativeSqlCompletions } from './nativeSqlCompletion';
import { SqlDialect } from './sqlDialect';

export function createJpqlCompletions(
	document: vscode.TextDocument,
	position: vscode.Position,
	entities: readonly EntityInfo[],
	sqlDialect: SqlDialect = 'generic',
	projectionTypes: readonly ProjectionTypeInfo[] = entities.map((entity) => ({
		name: entity.name,
		packageName: entity.packageName,
		kind: 'class',
		uri: entity.uri,
	})),
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
	const queryPrefix = activeQuery
		? activeQuery.queryContent.slice(0, queryOffsetAt(activeQuery.sourceOffsets, offset))
		: linePrefix;
	if (activeQuery?.isNative) {
		return createNativeSqlCompletions(document, position, entities, queries, sqlDialect);
	}

	if (!activeQuery) {
		// Fallback check for single line query being typed
		if (!/@Query\s*\([^)\n]*["'][^"'\n]*$/.test(linePrefix)) {
			return undefined;
		}
		if (/\bnativeQuery\s*=\s*true\b/.test(linePrefix)) {
			return undefined;
		}
	}
	const items: vscode.CompletionItem[] = [];
	const dtoMatch = queryPrefix.match(/\bNEW\s+([\w$.]*)$/i);
	if (dtoMatch) {
		const typedType = dtoMatch[1];
		const partial = typedType.split('.').pop() ?? '';
		const startPos = new vscode.Position(position.line, position.character - typedType.length);
		const replaceRange = new vscode.Range(startPos, position);
		const dtoItems = projectionTypes
			.filter((type) => {
				const qualifiedName = type.packageName ? `${type.packageName}.${type.name}` : type.name;
				return typedType.includes('.')
					? qualifiedName.toLowerCase().startsWith(typedType.toLowerCase())
					: type.name.toLowerCase().startsWith(partial.toLowerCase());
			})
			.map((type) => {
				const item = new vscode.CompletionItem(type.name, type.kind === 'interface'
					? vscode.CompletionItemKind.Interface
					: vscode.CompletionItemKind.Class);
				const qualifiedName = type.packageName ? `${type.packageName}.${type.name}` : type.name;
				item.detail = `DTO projection: ${qualifiedName}`;
				item.insertText = qualifiedName;
				item.sortText = `0_${type.name}`;
				item.range = replaceRange;
				return item;
			});
		if (dtoItems.length > 0) {
			return dtoItems;
		}
	}
	const positionalMatch = queryPrefix.match(/\?(\d*)$/);
	if (positionalMatch && activeQuery?.methodSignature) {
		const partial = positionalMatch[1];
		const placeholderStart = offset - partial.length - 1;
		const previousIndexes = activeQuery.positionalParameters
			.filter((parameter) => parameter.startOffset < placeholderStart)
			.map((parameter) => parameter.index);
		const nextIndex = Math.max(0, ...previousIndexes) + 1;
		const startPos = new vscode.Position(position.line, position.character - partial.length - 1);
		const item = new vscode.CompletionItem(`?${nextIndex}`, vscode.CompletionItemKind.Variable);
		item.detail = `Method parameter ${nextIndex}`;
		item.sortText = `0_${String(nextIndex).padStart(4, '0')}`;
		item.range = new vscode.Range(startPos, position);
		return [item];
	}

	// 1. Check for alias property completion: e.g. "u."
	const aliasPropMatch = queryPrefix.match(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)?$/);
	if (aliasPropMatch) {
		const path = aliasPropMatch[1].split('.');
		const alias = path[0];
		const nestedPath = path.slice(1).join('.');
		const partial = aliasPropMatch[2] ?? '';
		const startPos = new vscode.Position(position.line, position.character - partial.length);
		const replaceRange = new vscode.Range(startPos, position);

		// Resolve alias target entity
		let targetEntityName = activeQuery?.aliases.get(alias);
		if (!targetEntityName) {
			// Fallback: search query content for "FROM User u"
			const fromMatch = queryPrefix.match(new RegExp(`\\bFROM\\s+([A-Z]\\w*)\\s+${alias}\\b`, 'i'));
			if (fromMatch) {
				targetEntityName = fromMatch[1];
			}
		}

		const repositoryImports = activeQuery?.repositoryImports.map((name) => `import ${name};`).join('\n');
		const entityMap = createEntityLookup(entities, activeQuery?.repositoryPackage, repositoryImports);
		let targetEntity = targetEntityName
			? entityMap.get(targetEntityName.toLowerCase())
			: entities[0]; // fallback to first entity if only 1

		if (targetEntity && nestedPath) {
			const nestedProperty = resolveEntityPropertyPath(targetEntity, nestedPath, entityMap);
			const nestedEntityName = nestedProperty?.targetEntity
				?? referencedEntityNames(nestedProperty?.type ?? '').find((name) => entityMap.has(name.toLowerCase()));
			targetEntity = nestedEntityName ? entityMap.get(nestedEntityName.toLowerCase()) : undefined;
		}

		if (targetEntity) {
			const resolvedTarget = resolveEntityHierarchy(targetEntity, createEntityLookup(entities, activeQuery?.repositoryPackage, repositoryImports));
			for (const prop of resolvedTarget.properties) {
				if (!partial || prop.name.toLowerCase().startsWith(partial.toLowerCase())) {
					const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Field);
					item.detail = `${targetEntity.name}.${prop.name} : ${prop.type}`;
					item.sortText = `0_${prop.name}`;
					item.range = replaceRange;
					items.push(item);
				}
			}
			return items;
		}
	}

	// 2. Check for named parameter completion after ":"
	const colonMatch = queryPrefix.match(/:([A-Za-z_]\w*)?$/);
	if (colonMatch && activeQuery?.methodSignature) {
		const partial = colonMatch[1] ?? '';
		const startPos = new vscode.Position(position.line, position.character - partial.length);
		const replaceRange = new vscode.Range(startPos, position);

		for (const param of activeQuery.methodSignature.parameters) {
			const paramName = param.paramName ?? param.name;
			if (!partial || paramName.toLowerCase().startsWith(partial.toLowerCase())) {
				const item = new vscode.CompletionItem(paramName, vscode.CompletionItemKind.Variable);
				item.detail = `Method parameter: ${param.type} ${paramName}`;
				item.sortText = `0_${paramName}`;
				item.range = replaceRange;
				items.push(item);
			}
		}
		return items;
	}

	// 3. Check for entity completion after FROM or JOIN
	const fromOrJoinMatch = queryPrefix.match(/\b(?:FROM|JOIN)\s+([A-Z]\w*)?$/i);
	if (fromOrJoinMatch) {
		const partial = fromOrJoinMatch[1] ?? '';
		const startPos = new vscode.Position(position.line, position.character - partial.length);
		const replaceRange = new vscode.Range(startPos, position);

		for (const entity of entities) {
			if (!partial || entity.name.toLowerCase().startsWith(partial.toLowerCase())) {
				const item = new vscode.CompletionItem(entity.name, vscode.CompletionItemKind.Class);
				item.detail = `JPA Entity: ${entity.name}`;
				item.sortText = `1_${entity.name}`;
				item.range = replaceRange;
				items.push(item);
			}
		}
		return items;
	}

	// 4. General JPQL keywords + conditional snippets
	const lastWordMatch = linePrefix.match(/[A-Za-z_]+$/);
	const lastWord = lastWordMatch ? lastWordMatch[0] : '';
	if (lastWord.length > 0) {
		const wordRange = new vscode.Range(new vscode.Position(position.line, position.character - lastWord.length), position);

		// 4a. CASE expression snippet — expands to a full CASE…WHEN…THEN…ELSE…END template
		if ('CASE'.toLowerCase().startsWith(lastWord.toLowerCase())) {
			const caseSnippet = new vscode.CompletionItem('CASE … END', vscode.CompletionItemKind.Snippet);
			caseSnippet.insertText = new vscode.SnippetString('CASE WHEN ${1:condition} THEN ${2:result} ELSE ${3:default} END');
			caseSnippet.detail = 'JPQL conditional expression';
			caseSnippet.documentation = new vscode.MarkdownString(
				'**JPQL Conditional** — searched CASE expression\n\n'
				+ '```jpql\nCASE WHEN condition THEN result [WHEN … THEN …] [ELSE default] END\n```',
			);
			caseSnippet.sortText = '1_CASE';
			caseSnippet.range = wordRange;
			items.push(caseSnippet);
		}

		// 4b. COALESCE / NULLIF snippets
		for (const fn of ['COALESCE', 'NULLIF'] as const) {
			if (fn.toLowerCase().startsWith(lastWord.toLowerCase())) {
				const doc = getJpqlDocumentation(fn);
				const snippet = new vscode.CompletionItem(fn, vscode.CompletionItemKind.Function);
				snippet.insertText = fn === 'COALESCE'
					? new vscode.SnippetString('COALESCE(${1:expression1}, ${2:expression2})')
					: new vscode.SnippetString('NULLIF(${1:expression1}, ${2:expression2})');
				snippet.detail = `JPQL Function: ${fn}`;
				if (doc) {
					snippet.documentation = new vscode.MarkdownString(
						`**JPQL Function**\n\n### ${fn}\n${doc.description}\n\n**Syntaxe**\n\`${doc.syntax}\`\n\n**Exemple**\n\`${doc.useCase}\``,
					);
				}
				snippet.sortText = `1_${fn}`;
				snippet.range = wordRange;
				items.push(snippet);
			}
		}

		// 4c. All other JPQL keywords (clauses, operators, functions, conditional tokens)
		for (const kw of JPQL_KEYWORDS) {
			// Skip keywords already handled above as rich snippets
			if (['CASE', 'COALESCE', 'NULLIF'].includes(kw)) {
				continue;
			}
			if (kw.toLowerCase().startsWith(lastWord.toLowerCase())) {
				const isConditional = (JPQL_CONDITIONAL as readonly string[]).includes(kw);
				const isFunction = (JPQL_FUNCTIONS as readonly string[]).includes(kw);
				const kind = isFunction ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Keyword;
				const item = new vscode.CompletionItem(kw, kind);
				item.detail = isConditional ? `JPQL Conditional: ${kw}` : isFunction ? `JPQL Function: ${kw}` : `JPQL keyword: ${kw}`;
				const doc = getJpqlDocumentation(kw);
				if (doc) {
					item.documentation = new vscode.MarkdownString(
						`**JPQL ${doc.kind}**\n\n### ${doc.title}\n${doc.description}\n\n**Syntaxe**\n\`${doc.syntax}\`\n\n**Exemple**\n\`${doc.useCase}\``,
					);
				}
				item.sortText = `2_${kw}`;
				item.range = wordRange;
				items.push(item);
			}
		}
	}

	return items.length > 0 ? items : undefined;
}

function queryOffsetAt(sourceOffsets: readonly number[], documentOffset: number): number {
	const index = sourceOffsets.findIndex((sourceOffset) => sourceOffset >= documentOffset);
	return index < 0 ? sourceOffsets.length : index;
}
