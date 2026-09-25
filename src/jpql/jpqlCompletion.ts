import * as vscode from 'vscode';
import { EntityInfo } from '../entityModel';
import { createEntityLookup, referencedEntityNames, resolveEntityHierarchy, resolveEntityPropertyPath } from '../entityDiscovery';
import { extractAllJpqlQueries } from './jpqlParser';
import { JPQL_KEYWORDS } from './jpqlLanguage';

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
		if (/\bnativeQuery\s*=\s*true\b/.test(linePrefix)) {
			return undefined;
		}
	}
	if (activeQuery?.isNative) {
		return undefined;
	}

	const items: vscode.CompletionItem[] = [];
	const dtoMatch = linePrefix.match(/\bNEW\s+([\w$.]*)$/i);
	if (dtoMatch) {
		const typedType = dtoMatch[1];
		const partial = typedType.split('.').pop() ?? '';
		const startPos = new vscode.Position(position.line, position.character - typedType.length);
		const replaceRange = new vscode.Range(startPos, position);
		const dtoItems = entities
			.filter((entity) => {
				const qualifiedName = entity.packageName ? `${entity.packageName}.${entity.name}` : entity.name;
				return typedType.includes('.')
					? qualifiedName.toLowerCase().startsWith(typedType.toLowerCase())
					: entity.name.toLowerCase().startsWith(partial.toLowerCase());
			})
			.map((entity) => {
				const item = new vscode.CompletionItem(entity.name, vscode.CompletionItemKind.Class);
				const qualifiedName = entity.packageName ? `${entity.packageName}.${entity.name}` : entity.name;
				item.detail = `DTO projection: ${qualifiedName}`;
				item.insertText = typedType.includes('.') ? qualifiedName : entity.name;
				item.sortText = `0_${entity.name}`;
				item.range = replaceRange;
				return item;
			});
		if (dtoItems.length > 0) {
			return dtoItems;
		}
	}
	const positionalMatch = linePrefix.match(/\?(\d*)$/);
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
	const aliasPropMatch = linePrefix.match(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)?$/);
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
			const fromMatch = linePrefix.match(new RegExp(`\\bFROM\\s+([A-Z]\\w*)\\s+${alias}\\b`, 'i'));
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
				item.sortText = `0_${paramName}`;
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
				item.sortText = `1_${entity.name}`;
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
				item.sortText = `2_${kw}`;
				item.range = wordRange;
				items.push(item);
			}
		}
	}

	return items.length > 0 ? items : undefined;
}
