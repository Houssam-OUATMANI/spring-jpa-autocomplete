import { EntityInfo } from '../entityModel';
import { resolveEntityPropertyPath } from '../entityDiscovery';

export interface JpqlQueryInfo {
	readonly rawQuery: string;
	readonly queryContent: string;
	readonly queryStartOffset: number; // offset in document where query string content starts
	readonly queryEndOffset: number;
	readonly isNative: boolean;
	readonly selectedAlias?: string;
	readonly aliases: ReadonlyMap<string, string>; // alias -> EntityName
	readonly namedParameters: readonly { name: string; startOffset: number; endOffset: number }[];
	readonly propertyAccesses: readonly { alias: string; property: string; startOffset: number; endOffset: number }[];
	readonly referencedEntities: readonly { name: string; startOffset: number; endOffset: number }[];
	readonly methodSignature?: JpqlMethodSignature;
}

export interface JpqlMethodSignature {
	readonly rawText: string;
	readonly methodName: string;
	readonly returnType: string;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly parameters: readonly { name: string; type: string; isParamAnnotated: boolean; paramName?: string; startOffset: number; endOffset: number }[];
}

export function extractAllJpqlQueries(documentText: string, knownEntities: readonly EntityInfo[]): JpqlQueryInfo[] {
	const queries: JpqlQueryInfo[] = [];

	// Match @Query(...) including text blocks """...""" or single/multi-line "..."
	// Also detect nativeQuery = true
	const queryAnnotationRegex = /@Query\s*(((?:\("""[\s\S]*?"""\)|"(?:\\.|[^"\\])*"|[^)])*))\)\s*(?:@\w+(?:\([\s\S]*?\))?\s*)*\b([\w$<>?[\]\s]+?)\s+([A-Za-z_$]\w*)\s*\(([\s\S]*?)\)\s*;/g;

	let match: RegExpExecArray | null;
	while ((match = queryAnnotationRegex.exec(documentText)) !== null) {
		const fullMatch = match[0];
		const annotationArgs = match[1];
		let returnType = match[2].trim();
		let methodName = match[3];
		let paramsText = match[4];
		const signatureMatch = fullMatch.match(/(?:^|\)\s*)(?:@[\w.]+(?:\([\s\S]*?\))?\s*)*([\w$<>?[\]\s]+?)\s+([A-Za-z_$]\w*)\s*\(([\s\S]*?)\)\s*;\s*$/);
		if (signatureMatch) {
			returnType = signatureMatch[1].trim();
			methodName = signatureMatch[2];
			paramsText = signatureMatch[3];
		}

		const isNative = /\bnativeQuery\s*=\s*true\b/.test(annotationArgs);

		// Extract string content: either """...""" or "..."
		let queryContent = '';
		let contentStartOffset = 0;

		const textBlockMatch = annotationArgs.match(/"""([\s\S]*?)"""/);
		if (textBlockMatch && textBlockMatch.index !== undefined) {
			queryContent = textBlockMatch[1];
			contentStartOffset = match.index + fullMatch.indexOf(textBlockMatch[0]) + 3;
		} else {
			// Find string literals inside annotationArgs
			const stringLiterals = [...annotationArgs.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
			if (stringLiterals.length > 0) {
				// Combine string literals if multi-line / concatenated
				queryContent = stringLiterals.map((m) => m[1]).join(' ');
				const firstLit = stringLiterals[0];
				contentStartOffset = match.index + fullMatch.indexOf(firstLit[0]) + 1;
			}
		}

		if (!queryContent) {
			continue;
		}

		const queryEndOffset = contentStartOffset + queryContent.length;

		// Extract method signature
		const methodParamsOffset = match.index + fullMatch.indexOf(paramsText);
		const methodSignature: JpqlMethodSignature = {
			rawText: fullMatch,
			methodName,
			returnType,
			startOffset: match.index,
			endOffset: match.index + fullMatch.length,
			parameters: parseMethodParametersWithOffsets(paramsText, methodParamsOffset),
		};

		// Parse JPQL structure
		const aliases = resolveAliases(queryContent, knownEntities);
		const selectedAlias = queryContent.match(/\bSELECT\s+(?:DISTINCT\s+)?([A-Za-z_]\w*)/i)?.[1];
		const namedParameters = extractNamedParameters(queryContent, contentStartOffset);
		const propertyAccesses = extractPropertyAccesses(queryContent, contentStartOffset);
		const referencedEntities = extractReferencedEntities(queryContent, contentStartOffset);

		queries.push({
			rawQuery: fullMatch,
			queryContent,
			queryStartOffset: contentStartOffset,
			queryEndOffset,
			isNative,
			selectedAlias,
			aliases,
			namedParameters,
			propertyAccesses,
			referencedEntities,
			methodSignature,
		});
	}

	return queries;
}

function resolveAliases(query: string, knownEntities: readonly EntityInfo[]): Map<string, string> {
	const aliases = new Map<string, string>();
	const entityMap = new Map(knownEntities.map((e) => [e.name.toLowerCase(), e]));

	// 1. FROM Entity [AS] alias
	const fromMatches = query.matchAll(/\bFROM\s+([A-Z]\w*)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi);
	for (const m of fromMatches) {
		const entityName = m[1];
		const alias = m[2] ?? entityName;
		aliases.set(alias, entityName);
	}

	// 2. JOIN alias.prop [AS] joinAlias. Repeat to resolve chained joins.
	const joinMatches = [...query.matchAll(/\bJOIN\s+(?:FETCH\s+)?([A-Za-z_]\w*)\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+(?:AS\s+)?([A-Za-z_]\w*)/gi)];
	let changed = true;
	while (changed) {
		changed = false;
		for (const m of joinMatches) {
			const parentEntityName = aliases.get(m[1]);
			const parentEntity = parentEntityName ? entityMap.get(parentEntityName.toLowerCase()) : undefined;
			if (!parentEntity) {
				continue;
			}
			const property = resolveEntityPropertyPath(parentEntity, m[2], entityMap);
			const targetEntity = property && [...entityMap.values()].find((entity) =>
				property.type.split(/[<>,\s]/).some((type) => type.toLowerCase() === entity.name.toLowerCase()),
			);
			if (targetEntity && aliases.get(m[3]) !== targetEntity.name) {
				aliases.set(m[3], targetEntity.name);
				changed = true;
			}
		}
	}

	return aliases;
}

function extractNamedParameters(query: string, baseOffset: number): { name: string; startOffset: number; endOffset: number }[] {
	const results: { name: string; startOffset: number; endOffset: number }[] = [];
	const regex = /:([A-Za-z_]\w*)/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(query)) !== null) {
		const name = match[1];
		results.push({
			name,
			startOffset: baseOffset + match.index,
			endOffset: baseOffset + match.index + match[0].length,
		});
	}
	return results;
}

function extractPropertyAccesses(query: string, baseOffset: number): { alias: string; property: string; startOffset: number; endOffset: number }[] {
	const results: { alias: string; property: string; startOffset: number; endOffset: number }[] = [];
	const regex = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\b/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(query)) !== null) {
		const alias = match[1];
		const property = match[2];
		const propStart = baseOffset + match.index + alias.length + 1;
		results.push({
			alias,
			property,
			startOffset: propStart,
			endOffset: propStart + property.length,
		});
	}
	return results;
}

function extractReferencedEntities(query: string, baseOffset: number): { name: string; startOffset: number; endOffset: number }[] {
	const results: { name: string; startOffset: number; endOffset: number }[] = [];
	const regex = /\b(?:FROM|JOIN)\s+(?:FETCH\s+)?([A-Z]\w*)\b/gi;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(query)) !== null) {
		const name = match[1];
		const nameOffset = baseOffset + match.index + match[0].lastIndexOf(name);
		results.push({
			name,
			startOffset: nameOffset,
			endOffset: nameOffset + name.length,
		});
	}
	return results;
}

function parseMethodParametersWithOffsets(
	paramsText: string,
	baseOffset: number,
): JpqlMethodSignature['parameters'] {
	const parameters: { name: string; type: string; isParamAnnotated: boolean; paramName?: string; startOffset: number; endOffset: number }[] = [];
	if (!paramsText.trim()) {
		return parameters;
	}

	const parts = paramsText.split(',');
	let currentOffset = baseOffset;

	for (const part of parts) {
		const trimmed = part.trim();
		const paramMatch = trimmed.match(/(?:@Param\s*\(\s*"([^"]+)"\s*\)\s*)?([\w$<>?[\]\s]+?)\s+([A-Za-z_$]\w*)$/);
		if (paramMatch) {
			const paramAnnotationName = paramMatch[1];
			const type = paramMatch[2].trim();
			const paramVarName = paramMatch[3];

			const paramNameOffset = currentOffset + part.indexOf(paramVarName);
			parameters.push({
				name: paramVarName,
				type,
				isParamAnnotated: paramAnnotationName !== undefined,
				paramName: paramAnnotationName,
				startOffset: paramNameOffset,
				endOffset: paramNameOffset + paramVarName.length,
			});
		}
		currentOffset += part.length + 1;
	}

	return parameters;
}
