import { EntityInfo } from '../entityModel';
import { createEntityLookup, resolveEntityPropertyPath } from '../entityDiscovery';
import { decodeJavaString, maskJavaSource, parseJavaParameters, splitTopLevelParameters } from '../javaParsing';

export interface JpqlQueryInfo {
	readonly rawQuery: string;
	readonly queryContent: string;
	readonly queryStartOffset: number; // offset in document where query string content starts
	readonly queryEndOffset: number;
	readonly sourceOffsets: readonly number[];
	readonly repositoryPackage?: string;
	readonly isNative: boolean;
	readonly selectedExpression?: string;
	readonly selectedAlias?: string;
	readonly functions: readonly { name: string; startOffset: number; endOffset: number }[];
	readonly aliases: ReadonlyMap<string, string>; // alias -> EntityName
	readonly namedParameters: readonly { name: string; startOffset: number; endOffset: number; contentStart: number; contentEnd: number }[];
	readonly propertyAccesses: readonly { alias: string; property: string; startOffset: number; endOffset: number; contentStart: number; contentEnd: number }[];
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
	const maskedText = maskJavaSource(documentText);
	const queryAnnotationRegex = /@Query\s*\(/g;

	let match: RegExpExecArray | null;
	while ((match = queryAnnotationRegex.exec(maskedText)) !== null) {
		const argsStart = queryAnnotationRegex.lastIndex;
		const argsEnd = findClosingParenthesis(maskedText, argsStart - 1);
		if (argsEnd < 0) {
			continue;
		}
		const annotationArgs = documentText.slice(argsStart, argsEnd);
		const methodEnd = findMethodEnd(maskedText, argsEnd + 1);
		if (methodEnd < 0) {
			queryAnnotationRegex.lastIndex = argsEnd + 1;
			continue;
		}
		const fullMatch = documentText.slice(match.index, methodEnd);
		const signatureMatch = maskedText.slice(argsEnd + 1, methodEnd).match(/(?:@\w+(?:\([^)]*\))?\s*)*([\w$<>?[\]\s]+?)\s+([A-Za-z_$]\w*)\s*\(([\s\S]*?)\)\s*;/);
		if (!signatureMatch) {
			queryAnnotationRegex.lastIndex = argsEnd + 1;
			continue;
		}
		const returnType = signatureMatch[1].trim();
		const methodName = signatureMatch[2];
		const paramsStart = argsEnd + 1 + (signatureMatch.index ?? 0) + signatureMatch[0].indexOf(signatureMatch[3]);
		const paramsText = documentText.slice(paramsStart, paramsStart + signatureMatch[3].length);

		const isNative = /\bnativeQuery\s*=\s*true\b/.test(annotationArgs);

		const querySource = extractQuerySource(documentText, argsStart, argsEnd, annotationArgs);

		if (!querySource || !querySource.content) {
			continue;
		}
		const { content: queryContent, sourceOffsets } = querySource;
		const contentStartOffset = sourceOffsets[0];
		const queryEndOffset = sourceOffsets[sourceOffsets.length - 1] + 1;

		// Extract method signature
		const methodParamsOffset = paramsStart;
		const methodSignature: JpqlMethodSignature = {
			rawText: fullMatch,
			methodName,
			returnType,
			startOffset: match.index,
			endOffset: match.index + fullMatch.length,
			parameters: parseMethodParametersWithOffsets(paramsText, methodParamsOffset),
		};

		// Parse JPQL structure
		const aliases = resolveAliases(queryContent, knownEntities, documentText.match(/\bpackage\s+([\w.]+)\s*;/)?.[1]);
		const selectionMatch = queryContent.match(/\bSELECT\s+(?:DISTINCT\s+)?([\s\S]*?)\s+FROM\b/i);
		const selectedExpression = selectionMatch?.[1].trim();
		const selectedAlias = selectedExpression && /^[A-Za-z_]\w*$/.test(selectedExpression) ? selectedExpression : undefined;
		const sourceOffsetAt = (index: number) => sourceOffsets[Math.min(index, sourceOffsets.length - 1)];
		const functions = extractFunctions(queryContent, sourceOffsetAt);
		const namedParameters = extractNamedParameters(queryContent, sourceOffsetAt);
		const propertyAccesses = extractPropertyAccesses(queryContent, sourceOffsetAt);
		const referencedEntities = extractReferencedEntities(queryContent, sourceOffsetAt);

		queries.push({
			rawQuery: fullMatch,
			queryContent,
			queryStartOffset: contentStartOffset,
			queryEndOffset,
			sourceOffsets,
			repositoryPackage: documentText.match(/\bpackage\s+([\w.]+)\s*;/)?.[1],
			isNative,
			selectedExpression,
			selectedAlias,
			functions,
			aliases,
			namedParameters,
			propertyAccesses,
			referencedEntities,
			methodSignature,
		});
	}

	return queries;
}

function extractFunctions(query: string, sourceOffsetAt: (index: number) => number): { name: string; startOffset: number; endOffset: number }[] {
	const functions: { name: string; startOffset: number; endOffset: number }[] = [];
	for (const match of query.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
		const name = match[1].toUpperCase();
		if (name === 'FROM' || name === 'JOIN' || name === 'WHERE') {
			continue;
		}
		const startOffset = sourceOffsetAt(match.index);
		functions.push({ name, startOffset, endOffset: sourceOffsetAt(match.index + match[1].length - 1) + 1 });
	}
	return functions;
}

function findClosingParenthesis(text: string, openingOffset: number): number {
	let depth = 0;
	let quote: '"' | "'" | undefined;
	for (let offset = openingOffset; offset < text.length; offset++) {
		if (text.startsWith('"""', offset)) {
			offset += 2;
			continue;
		}
		const character = text[offset];
		if (quote) {
			if (character === '\\') {
				offset++;
			} else if (character === quote) {
				quote = undefined;
			}
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
		} else if (character === '(') {
			depth++;
		} else if (character === ')' && --depth === 0) {
			return offset;
		}
	}
	return -1;
}

function findMethodEnd(text: string, startOffset: number): number {
	const methodText = text.slice(startOffset);
	const methodMatch = methodText.match(/^(?:\s*@\w+(?:\([^)]*\))?\s*)*[\w$<>?[\]\s]+?\s+[A-Za-z_$]\w*\s*\(([\s\S]*?)\)\s*;/);
	return methodMatch ? startOffset + methodMatch[0].length : -1;
}

interface QuerySource {
	readonly content: string;
	readonly sourceOffsets: readonly number[];
}

function extractQuerySource(text: string, argsStart: number, argsEnd: number, annotationArgs: string): QuerySource | undefined {
	const valueMatch = /\bvalue\s*=/.exec(annotationArgs);
	const expressionStart = argsStart + (valueMatch ? valueMatch.index + valueMatch[0].length : 0);
	const tokens: { content: string; offsets: number[]; start: number; end: number }[] = [];
	let index = expressionStart;
	let depth = 0;
	while (index < argsEnd) {
		if (text[index] === ',' && depth === 0) {
			break;
		}
		if (text.startsWith('"""', index)) {
			const end = text.indexOf('"""', index + 3);
			if (end < 0) {
				break;
			}
			const content = text.slice(index + 3, end);
			tokens.push({ content, offsets: [...content].map((_character, offset) => index + 3 + offset), start: index, end: end + 3 });
			index = end + 3;
			continue;
		}
		if (text[index] === '"') {
			const start = index++;
			let escaped = false;
			while (index < argsEnd) {
				if (!escaped && text[index] === '"') {
					break;
				}
				escaped = !escaped && text[index] === '\\';
				if (text[index] !== '\\') {
					escaped = false;
				}
				index++;
			}
			const raw = text.slice(start + 1, index);
			const content = decodeJavaString(raw);
			const offsets: number[] = [];
			for (let rawIndex = 0; rawIndex < raw.length; rawIndex++) {
				if (raw[rawIndex] === '\\' && rawIndex + 1 < raw.length) {
					offsets.push(start + 1 + rawIndex);
					rawIndex++;
				} else {
					offsets.push(start + 1 + rawIndex);
				}
			}
			tokens.push({ content, offsets, start, end: Math.min(index + 1, argsEnd) });
			index++;
			continue;
		}
		if (text[index] === '(') {
			depth++;
		} else if (text[index] === ')') {
			depth = Math.max(0, depth - 1);
		}
		index++;
	}
	const selected = tokens;
	if (selected.length === 0) {
		return undefined;
	}
	return {
		content: selected.map((token) => token.content).join(''),
		sourceOffsets: selected.flatMap((token) => token.offsets),
	};
}

function resolveAliases(query: string, knownEntities: readonly EntityInfo[], preferredPackage?: string): Map<string, string> {
	const aliases = new Map<string, string>();
	const entityMap = createEntityLookup(knownEntities, preferredPackage);

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

function extractNamedParameters(query: string, sourceOffsetAt: (index: number) => number): { name: string; startOffset: number; endOffset: number; contentStart: number; contentEnd: number }[] {
	const results: { name: string; startOffset: number; endOffset: number; contentStart: number; contentEnd: number }[] = [];
	const regex = /:([A-Za-z_]\w*)/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(query)) !== null) {
		const name = match[1];
		results.push({
			name,
			startOffset: sourceOffsetAt(match.index),
			endOffset: sourceOffsetAt(match.index + match[0].length - 1) + 1,
			contentStart: match.index,
			contentEnd: match.index + match[0].length,
		});
	}
	return results;
}

function extractPropertyAccesses(query: string, sourceOffsetAt: (index: number) => number): { alias: string; property: string; startOffset: number; endOffset: number; contentStart: number; contentEnd: number }[] {
	const results: { alias: string; property: string; startOffset: number; endOffset: number; contentStart: number; contentEnd: number }[] = [];
	const regex = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\b/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(query)) !== null) {
		const alias = match[1];
		const property = match[2];
		const propStart = match.index + alias.length + 1;
		results.push({
			alias,
			property,
			startOffset: sourceOffsetAt(propStart),
			endOffset: sourceOffsetAt(propStart + property.length - 1) + 1,
			contentStart: propStart,
			contentEnd: propStart + property.length,
		});
	}
	return results;
}

function extractReferencedEntities(query: string, sourceOffsetAt: (index: number) => number): { name: string; startOffset: number; endOffset: number }[] {
	const results: { name: string; startOffset: number; endOffset: number }[] = [];
	const regex = /\b(?:FROM|JOIN)\s+(?:FETCH\s+)?([A-Z]\w*)\b/gi;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(query)) !== null) {
		const name = match[1];
		const nameOffset = match.index + match[0].lastIndexOf(name);
		results.push({
			name,
			startOffset: sourceOffsetAt(nameOffset),
			endOffset: sourceOffsetAt(nameOffset + name.length - 1) + 1,
		});
	}
	return results;
}

function parseMethodParametersWithOffsets(
	paramsText: string,
	baseOffset: number,
): JpqlMethodSignature['parameters'] {
	return splitTopLevelParameters(paramsText, baseOffset).map((part) => {
		const parsed = parseJavaParameters(part.text, part.startOffset)[0];
		return parsed ? {
			name: parsed.name,
			type: parsed.type,
			isParamAnnotated: parsed.isParamAnnotated,
			paramName: parsed.paramName,
			startOffset: parsed.nameOffset,
			endOffset: parsed.nameOffset + parsed.name.length,
		} : undefined;
	}).filter((parameter): parameter is NonNullable<typeof parameter> => parameter !== undefined);
}
