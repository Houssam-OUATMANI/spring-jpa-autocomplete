import * as vscode from 'vscode';
import { maskJavaSource } from './javaParsing';
import { createEntityLookup, extractRepositoryEntityNameAt } from './entityDiscovery';
import { EntityInfo, EntityProperty } from './entityModel';
import { extractAllJpqlQueries } from './jpql/jpqlParser';
import { findClosestProperty } from './propertySuggestions';
import { getMongoOperatorDocumentation, getMongoOperators } from './mongoQueryLanguage';

const MONGO_REPOSITORY_TYPES = /\b(?:MongoRepository|ReactiveMongoRepository)\s*</;

interface MongoQuerySource {
	readonly queryContent: string;
	readonly sourceOffsets: readonly number[];
	readonly queryStartOffset: number;
	readonly kind: 'query' | 'aggregation';
}

export function isMongoRepositoryAt(text: string, offset: number): boolean {
	const maskedText = maskJavaSource(text);
	const declarationPattern = /\b(?:interface|class)\s+[\w$]+(?:\s*<[^{};]*>)?\s+(?:extends|implements)\s+([^{}]+)\{/g;
	let match: RegExpExecArray | null;

	while ((match = declarationPattern.exec(maskedText)) !== null) {
		const bodyStart = declarationPattern.lastIndex;
		if (offset < bodyStart) {
			continue;
		}
		let depth = 1;
		let bodyEnd = bodyStart;
		for (; bodyEnd < maskedText.length && depth > 0; bodyEnd++) {
			if (maskedText[bodyEnd] === '{') {
				depth++;
			} else if (maskedText[bodyEnd] === '}') {
				depth--;
			}
		}
		if (offset < bodyEnd && MONGO_REPOSITORY_TYPES.test(match[1])) {
			return true;
		}
	}

	return false;
}

export interface MongoQueryDiagnostic {
	readonly message: string;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly suggestedProperty?: string;
	readonly code: 'UNKNOWN_MONGO_FIELD' | 'UNKNOWN_MONGO_OPERATOR' | 'INVALID_MONGO_QUERY';
}

export interface MongoFieldAccess {
	readonly entity: EntityInfo;
	readonly property: EntityProperty;
	readonly startOffset: number;
	readonly endOffset: number;
}

interface MongoTemplateMethod {
	readonly entity: EntityInfo;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly body: string;
	readonly bodyStartOffset: number;
}

export function findMongoFieldAt(
	text: string,
	offset: number,
	documents: readonly EntityInfo[],
): MongoFieldAccess | undefined {
	return findMongoFieldAccesses(text, documents).find((access) =>
		offset >= access.startOffset && offset <= access.endOffset,
	);
}

export function findMongoFieldAccesses(
	text: string,
	documents: readonly EntityInfo[],
): MongoFieldAccess[] {
	const accesses: MongoFieldAccess[] = [];
	for (const query of extractMongoQueries(text, documents)) {
		const repositoryEntityName = extractRepositoryEntityNameAt(text, query.queryStartOffset);
		const fields = getMongoFields(documents, repositoryEntityName, text);
		for (const key of extractMongoKeys(query.queryContent)) {
			const path = key.name.toLowerCase();
			const field = fields.find((candidate) => candidate.path.toLowerCase() === path);
			if (!field) {
				continue;
			}
			accesses.push({
				entity: field.entity,
				property: field.property,
				startOffset: query.sourceOffsets[key.startOffset],
				endOffset: query.sourceOffsets[key.endOffset - 1] + 1,
			});
		}
	}
	return accesses;
}

export function createMongoTemplateCompletions(
	document: vscode.TextDocument,
	position: vscode.Position,
	documents: readonly EntityInfo[],
): vscode.CompletionItem[] | undefined {
	const text = document.getText();
	const offset = document.offsetAt(position);
	const method = findMongoTemplateMethod(text, offset, documents);
	if (!method) {
		return undefined;
	}
	const prefix = text.slice(method.startOffset, offset);
	const keyMatch = prefix.match(/(?:Criteria\s*\.\s*where|\.and|\.set|\.inc|\.unset|\.push|\.addToSet|\.pull|\.rename)\s*\(\s*(['"])([^'"]*)$/);
	if (!keyMatch) {
		return undefined;
	}
	const partial = keyMatch[2];
	const range = new vscode.Range(document.positionAt(offset - partial.length), position);
	const fields = getMongoFields(documents, method.entity.name, text);
	return fields
		.filter(({ path }) => path.toLowerCase().startsWith(partial.toLowerCase()))
		.map(({ path, property }) => {
			const item = new vscode.CompletionItem(path, vscode.CompletionItemKind.Field);
			item.detail = `MongoDB field: ${property.name} (${property.type})`;
			item.filterText = path;
			item.textEdit = vscode.TextEdit.replace(range, path);
			return item;
		});
}

export function validateMongoTemplateQueries(text: string, documents: readonly EntityInfo[]): MongoQueryDiagnostic[] {
	const diagnostics: MongoQueryDiagnostic[] = [];
	for (const method of findMongoTemplateMethods(text, documents)) {
		const fields = getMongoFields(documents, method.entity.name, text);
		const knownFields = new Set(fields.map(({ path }) => path.toLowerCase()));
		const fieldPattern = /(?:Criteria\s*\.\s*where|\.and|\.set|\.inc|\.unset|\.push|\.addToSet|\.pull|\.rename)\s*\(\s*(['"])([^'"]+)\1/g;
		for (const match of method.body.matchAll(fieldPattern)) {
			const propertyName = match[2];
			if (knownFields.has(propertyName.toLowerCase())) {
				continue;
			}
			const startInDocument = method.bodyStartOffset + match.index + match[0].indexOf(propertyName);
			const suggestion = findClosestProperty(propertyName, fields.map(({ path }) => path));
			diagnostics.push({
				message: `Unknown MongoDB document field '${propertyName}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
				startOffset: startInDocument,
				endOffset: startInDocument + propertyName.length,
				suggestedProperty: suggestion,
				code: 'UNKNOWN_MONGO_FIELD',
			});
		}
	}
	return diagnostics;
}

export function findMongoTemplateFieldAccesses(
	text: string,
	documents: readonly EntityInfo[],
): MongoFieldAccess[] {
	const accesses: MongoFieldAccess[] = [];
	for (const method of findMongoTemplateMethods(text, documents)) {
		const fields = getMongoFields(documents, method.entity.name, text);
		const fieldPattern = /(?:Criteria\s*\.\s*where|\.and|\.set|\.inc|\.unset|\.push|\.addToSet|\.pull|\.rename)\s*\(\s*(['"])([^'"]+)\1/g;
		for (const match of method.body.matchAll(fieldPattern)) {
			const propertyName = match[2];
			const field = fields.find((candidate) => candidate.path.toLowerCase() === propertyName.toLowerCase());
			if (!field) {
				continue;
			}
			const startOffset = method.bodyStartOffset + match.index + match[0].indexOf(propertyName);
			accesses.push({
				entity: field.entity,
				property: field.property,
				startOffset,
				endOffset: startOffset + propertyName.length,
			});
		}
	}
	return accesses;
}

export function createMongoQueryCompletions(
	document: vscode.TextDocument,
	position: vscode.Position,
	documents: readonly EntityInfo[],
): vscode.CompletionItem[] | undefined {
	const text = document.getText();
	const offset = document.offsetAt(position);
	const query = findMongoQueryAt(text, offset, documents);
	if (!query) {
		return undefined;
	}
	const cursorOffset = query.sourceOffsets.findIndex((sourceOffset) => sourceOffset >= offset);
	const contentOffset = cursorOffset < 0 ? query.queryContent.length : cursorOffset;
	const prefix = query.queryContent.slice(0, contentOffset);
	const optionsValueMatch = prefix.match(/["']\$options["']\s*:\s*["']([^"']*)$/);
	if (optionsValueMatch) {
		const partial = optionsValueMatch[1];
		const range = new vscode.Range(document.positionAt(offset - partial.length), position);
		return ['i', 'm', 's', 'x'].map((option) => {
			const item = new vscode.CompletionItem(option, vscode.CompletionItemKind.EnumMember);
			item.detail = mongoRegexOptionDetails[option];
			item.documentation = new vscode.MarkdownString(`MongoDB regular expression option: ${mongoRegexOptionDetails[option]}`);
			item.textEdit = vscode.TextEdit.replace(range, option);
			return item;
		}).filter((item) => item.label.toString().startsWith(partial));
	}

	const keyMatch = prefix.match(/(?:^|[{,]\s*)["']?([\w$.]*)?$/);
	if (!keyMatch) {
		return undefined;
	}
	const partial = keyMatch[1] ?? '';
	const range = new vscode.Range(document.positionAt(offset - partial.length), position);
	const inFieldOperatorDocument = /(?:["'][^"'$][^"']*["']|[A-Za-z_][\w.]*)\s*:\s*\{[^{}]*$/s.test(prefix);
	if (inFieldOperatorDocument) {
		return getMongoOperators()
			.filter(({ name, category }) => (query.kind === 'aggregation' || category !== 'Aggregation') && name.toLowerCase().startsWith(partial.toLowerCase()))
			.map(({ name, category, description, syntax, example }) => {
				const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Operator);
				item.detail = `MongoDB ${category} operator`;
				item.documentation = new vscode.MarkdownString(`### \`${name}\`\n\n${description}\n\n**Syntax**\n\`${syntax}\`\n\n**Example**\n\`${example}\``);
				item.sortText = `0_${name}`;
				item.textEdit = vscode.TextEdit.replace(range, name);
				return item;
			});
	}

	const repositoryEntityName = extractRepositoryEntityNameAt(text, query.queryStartOffset);
	const fields = getMongoFields(documents, repositoryEntityName, text);
	const seen = new Set<string>();

	const fieldItems = fields.flatMap(({ path, property }) => {
		const fieldName = path;
		const key = fieldName.toLowerCase();
		if (!fieldName.toLowerCase().startsWith(partial.toLowerCase()) || seen.has(key)) {
			return [];
		}
		seen.add(key);
		const item = new vscode.CompletionItem(fieldName, vscode.CompletionItemKind.Field);
		item.detail = `MongoDB field: ${property.name} (${property.type})`;
		item.filterText = fieldName;
		item.textEdit = vscode.TextEdit.replace(range, fieldName);
		return [item];
	});
	const logicalItems = getMongoOperators()
		.filter(({ name, category }) =>
			(category === 'Logical' || (query.kind === 'aggregation' && category === 'Aggregation'))
			&& name.startsWith('$')
			&& name.toLowerCase().startsWith(partial.toLowerCase()),
		)
		.map(({ name, category, description, syntax, example }) => {
			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Operator);
			item.detail = `MongoDB ${category} operator`;
			item.documentation = new vscode.MarkdownString(`### \`${name}\`\n\n${description}\n\n**Syntax**\n\`${syntax}\`\n\n**Example**\n\`${example}\``);
			item.sortText = `1_${name}`;
			item.textEdit = vscode.TextEdit.replace(range, name);
			return item;
		});
	return [...logicalItems, ...fieldItems];
}

export function validateMongoQueries(text: string, documents: readonly EntityInfo[]): MongoQueryDiagnostic[] {
	const diagnostics: MongoQueryDiagnostic[] = [];
	for (const query of extractMongoQueries(text, documents)) {
		const repositoryEntityName = extractRepositoryEntityNameAt(text, query.queryStartOffset);
		const fields = getMongoFields(documents, repositoryEntityName, text);
		const canValidateFields = !repositoryEntityName || fields.length > 0;
		const knownFields = new Set(fields.map(({ path }) => path.toLowerCase()));
		for (const issue of validateMongoStructure(query.queryContent)) {
			const startOffset = query.sourceOffsets[issue.offset] ?? query.queryStartOffset;
			diagnostics.push({
				message: issue.message,
				startOffset,
				endOffset: startOffset + 1,
				code: 'INVALID_MONGO_QUERY',
			});
		}
		for (const match of query.queryContent.matchAll(/(["'])\$options\1\s*:\s*(["'])([^"']*)\2/g)) {
			const unsupportedOptionIndex = [...match[3]].findIndex((option, index) =>
				!/[imsx]/.test(option) || match[3].indexOf(option) !== index,
			);
			if (unsupportedOptionIndex < 0) {
				continue;
			}
			const startInQuery = match.index + match[0].indexOf(match[3]) + unsupportedOptionIndex;
			const startOffset = query.sourceOffsets[startInQuery] ?? query.queryStartOffset;
			diagnostics.push({
				message: `Unsupported MongoDB regex option '${match[3][unsupportedOptionIndex]}'. Use i, m, s, or x.`,
				startOffset,
				endOffset: startOffset + 1,
				code: 'INVALID_MONGO_QUERY',
			});
		}
		for (const key of extractMongoKeys(query.queryContent)) {
			const propertyName = key.name;
			const startOffset = query.sourceOffsets[key.startOffset];
			const endOffset = query.sourceOffsets[key.endOffset - 1] + 1;
			if (propertyName.startsWith('$')) {
				if (!knownMongoOperators.has(propertyName)) {
					const suggestion = findClosestProperty(propertyName, [...knownMongoOperators]);
					diagnostics.push({
						message: `Unknown MongoDB operator '${propertyName}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
						startOffset,
						endOffset,
						suggestedProperty: suggestion,
						code: 'UNKNOWN_MONGO_OPERATOR',
					});
				}
				continue;
			}
			if (!canValidateFields) {
				continue;
			}
			if (knownFields.has(propertyName.toLowerCase()) || ['and', 'or', 'nor', 'not', 'text', 'where'].includes(propertyName.toLowerCase())) {
				continue;
			}
			const suggestion = findClosestProperty(propertyName, fields.map(({ path }) => path));
			diagnostics.push({
				message: `Unknown MongoDB document field '${propertyName}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
				startOffset,
				endOffset,
				suggestedProperty: suggestion,
				code: 'UNKNOWN_MONGO_FIELD',
			});
		}
	}
	return diagnostics;
}

const mongoRegexOptionDetails: Readonly<Record<string, string>> = {
	i: 'Case-insensitive matching.',
	m: 'Multiline matching; ^ and $ match the beginning and end of each line.',
	s: 'Allows . to match newline characters.',
	x: 'Ignores unescaped whitespace in the regular expression pattern.',
};

const knownMongoOperators = new Set([
	...getMongoOperators().map(({ name }) => name),
	'$abs', '$acos', '$acosh', '$add', '$addToSet', '$allElementsTrue', '$anyElementTrue', '$arrayElemAt', '$arrayToObject',
	'$asin', '$asinh', '$atan', '$atan2', '$atanh', '$avg', '$ceil', '$cmp', '$concat', '$concatArrays', '$cond',
	'$convert', '$cos', '$cosh', '$dateAdd', '$dateDiff', '$dateFromParts', '$dateSubtract', '$dateToParts', '$dateToString',
	'$dayOfMonth', '$dayOfWeek', '$dayOfYear', '$degreesToRadians', '$divide', '$eq', '$exp', '$filter', '$first',
	'$firstN', '$floor', '$getField', '$gt', '$gte', '$hour', '$ifNull', '$in', '$indexOfArray', '$indexOfBytes',
	'$indexOfCP', '$isArray', '$isoDayOfWeek', '$isoWeek', '$isoWeekYear', '$last', '$lastN', '$let', '$ln', '$log',
	'$log10', '$lt', '$lte', '$ltrim', '$map', '$max', '$maxN', '$mergeObjects', '$millisecond', '$min', '$minN',
	'$minute', '$month', '$multiply', '$not', '$objectToArray', '$or', '$pow', '$push', '$radiansToDegrees',
	'$range', '$reduce', '$regexFind', '$regexFindAll', '$regexMatch', '$replaceOne', '$replaceAll', '$round', '$rtrim',
	'$second', '$setDifference', '$setEquals', '$setField', '$setIntersection', '$setIsSubset', '$setUnion', '$sin', '$sinh', '$size',
	'$slice', '$split', '$sqrt', '$stdDevPop', '$stdDevSamp', '$strcasecmp', '$strLenBytes', '$strLenCP', '$substr',
	'$sortByCount', '$substrBytes', '$substrCP', '$subtract', '$sum', '$switch', '$tan', '$tanh', '$toBool', '$toDate', '$toDecimal',
	'$toDouble', '$toInt', '$toLong', '$toLower', '$toObjectId', '$toString', '$toUpper', '$trim', '$trunc', '$type',
	'$week', '$year', '$merge', '$out', '$facet', '$bucket', '$bucketAuto', '$unionWith', '$documents', '$sample',
	'$dateTrunc', '$denseRank', '$documentNumber', '$densify', '$fill', '$rank', '$setWindowFields', '$search', '$searchMeta', '$vectorSearch', '$geoNear', '$redact', '$graphLookup', '$unsetField',
	'$collStats', '$indexStats', '$planCacheStats', '$currentOp', '$listSessions', '$listLocalSessions',
]);

function validateMongoStructure(query: string): { offset: number; message: string }[] {
	const issues: { offset: number; message: string }[] = [];
	let cursor = 0;
	const skipWhitespace = () => {
		while (/\s/.test(query[cursor] ?? '')) {
			cursor++;
		}
	};
	const fail = (offset: number, message: string) => {
		issues.push({ offset: Math.min(offset, Math.max(0, query.length - 1)), message });
		return false;
	};
	const parseString = (): boolean => {
		const quote = query[cursor++];
		while (cursor < query.length) {
			if (query[cursor] === '\\') {
				cursor += 2;
			} else if (query[cursor++] === quote) {
				return true;
			}
		}
		return fail(Math.max(0, cursor - 1), 'Unterminated string in MongoDB query.');
	};
	const parseValue = (): boolean => {
		skipWhitespace();
		const character = query[cursor];
		if (character === '{') {
			const opening = cursor++;
			skipWhitespace();
			if (query[cursor] === '}') {
				cursor++;
				return true;
			}
			while (cursor < query.length) {
				skipWhitespace();
				if (query[cursor] === '"' || query[cursor] === "'") {
					if (!parseString()) {
						return false;
					}
				} else {
					const keyStart = cursor;
					while (cursor < query.length && !/[\s:,{}[\]]/.test(query[cursor])) {
						cursor++;
					}
					if (cursor === keyStart) {
						return fail(cursor, 'Expected a field name in MongoDB query.');
					}
				}
				skipWhitespace();
				if (query[cursor] !== ':') {
					return fail(cursor, "Expected ':' after MongoDB query key.");
				}
				cursor++;
				if (!parseValue()) {
					return false;
				}
				skipWhitespace();
				if (query[cursor] === '}') {
					cursor++;
					return true;
				}
				if (query[cursor] !== ',') {
					return fail(opening, "Unclosed '{' in MongoDB query.");
				}
				cursor++;
			}
			return fail(opening, "Unclosed '{' in MongoDB query.");
		}
		if (character === '[') {
			const opening = cursor++;
			skipWhitespace();
			if (query[cursor] === ']') {
				cursor++;
				return true;
			}
			while (cursor < query.length) {
				if (!parseValue()) {
					return false;
				}
				skipWhitespace();
				if (query[cursor] === ']') {
					cursor++;
					return true;
				}
				if (query[cursor] !== ',') {
					return fail(opening, "Unclosed '[' in MongoDB query.");
				}
				cursor++;
			}
			return fail(opening, "Unclosed '[' in MongoDB query.");
		}
		if (character === '"' || character === "'") {
			return parseString();
		}
		if (character === '}' || character === ']') {
			return fail(cursor, `Unexpected '${character}' in MongoDB query.`);
		}
		const start = cursor;
		if (query.startsWith('?#{', cursor) || query.startsWith(':#{', cursor)) {
			const expressionStart = cursor;
			cursor += 3;
			let depth = 1;
			while (cursor < query.length && depth > 0) {
				if (query[cursor] === '{') {
					depth++;
				} else if (query[cursor] === '}') {
					depth--;
				}
				cursor++;
			}
			if (depth > 0) {
				return fail(expressionStart, 'Unterminated expression in MongoDB query.');
			}
			return true;
		}
		while (cursor < query.length && !/[\s,}\]]/.test(query[cursor])) {
			cursor++;
		}
		return cursor > start || fail(cursor, 'Expected a MongoDB query value.');
	};

	skipWhitespace();
	if (query[cursor] !== '{' && query[cursor] !== '[') {
		return [{ offset: cursor, message: 'MongoDB query must start with an object or array.' }];
	}
	if (!parseValue()) {
		return issues;
	}
	skipWhitespace();
	if (cursor < query.length) {
		fail(cursor, `Unexpected '${query[cursor]}' after MongoDB query.`);
	}
	return issues;
}

export function getMongoOperatorAt(
	text: string,
	offset: number,
	documents: readonly EntityInfo[],
): { name: string; startOffset: number; endOffset: number } | undefined {
	for (const query of extractMongoQueries(text, documents)) {
		for (const match of query.queryContent.matchAll(/\$[A-Za-z][A-Za-z0-9]*/g)) {
			const startOffset = query.sourceOffsets[match.index];
			const endOffset = query.sourceOffsets[match.index + match[0].length - 1] + 1;
			if (offset >= startOffset && offset <= endOffset && getMongoOperatorDocumentation(match[0])) {
				return { name: match[0], startOffset, endOffset };
			}
		}
	}
	return undefined;
}

function extractMongoKeys(query: string): { name: string; startOffset: number; endOffset: number }[] {
	const keys: { name: string; startOffset: number; endOffset: number }[] = [];
	for (const match of query.matchAll(/(["'])([^'"]+)\1\s*:|([A-Za-z_$][\w.$]*)\s*:/g)) {
		const name = match[2] ?? match[3];
		const startOffset = match[2] !== undefined ? match.index + 1 : match.index;
		keys.push({ name, startOffset, endOffset: startOffset + name.length });
	}
	return keys;
}

function getMongoFields(
	documents: readonly EntityInfo[],
	repositoryEntityName?: string,
	repositoryText?: string,
): { path: string; property: EntityProperty; entity: EntityInfo }[] {
	const mongoDocuments = documents.filter((candidate) => candidate.isMongoDocument);
	const repositoryPackage = repositoryText?.match(/\bpackage\s+([\w.]+)\s*;/)?.[1];
	const entityLookup = createEntityLookup(mongoDocuments, repositoryPackage, repositoryText);
	const resolvedRoot = repositoryEntityName ? entityLookup.get(repositoryEntityName.toLowerCase()) : undefined;
	const rootEntities = repositoryEntityName ? (resolvedRoot ? [resolvedRoot] : []) : mongoDocuments;
	const fields = new Map<string, { path: string; property: EntityProperty; entity: EntityInfo }>();
	const addEntityFields = (entity: EntityInfo, prefix: string, visited: ReadonlySet<string>) => {
		const key = `${entity.uri.toString()}:${entity.name}`;
		if (visited.has(key)) {
			return;
		}
		const nextVisited = new Set(visited).add(key);
		for (const property of entity.properties) {
			const fieldName = property.mongoFieldName ?? property.name;
			const path = prefix ? `${prefix}.${fieldName}` : fieldName;
			fields.set(path.toLowerCase(), { path, property, entity });
			const referencedTypes = property.targetEntity
				? [property.targetEntity.split('.').at(-1)!]
				: [...property.type.matchAll(/[A-Z]\w*/g)].map((match) => match[0]);
			const target = referencedTypes
				.map((typeName) => entityLookup.get(typeName.toLowerCase()))
				.find((candidate) => candidate !== undefined);
			if (target) {
				addEntityFields(target, path, nextVisited);
			}
		}
	};

	for (const entity of rootEntities) {
		addEntityFields(entity, '', new Set());
	}
	return [...fields.values()];
}

function extractMongoQueries(text: string, documents: readonly EntityInfo[]): MongoQuerySource[] {
	const queries: MongoQuerySource[] = extractAllJpqlQueries(text, documents)
		.filter((query) => isMongoRepositoryAt(text, query.queryStartOffset))
		.map((query) => ({
			queryContent: query.queryContent,
			sourceOffsets: query.sourceOffsets,
			queryStartOffset: query.queryStartOffset,
			kind: 'query',
		}));
	const maskedText = maskJavaSource(text);
	const aggregationPattern = /@Aggregation\s*\(/g;
	let match: RegExpExecArray | null;
	while ((match = aggregationPattern.exec(maskedText)) !== null) {
		const openingParen = maskedText.indexOf('(', match.index);
		const closingParen = findClosingParenthesis(maskedText, openingParen);
		if (closingParen < 0 || !isMongoRepositoryAt(text, match.index)) {
			continue;
		}
		const argsStart = openingParen + 1;
		const args = text.slice(argsStart, closingParen);
		const stringPattern = /"""([\s\S]*?)"""|"((?:\\.|[^"\\])*)"/g;
		let stringMatch: RegExpExecArray | null;
		while ((stringMatch = stringPattern.exec(args)) !== null) {
			const content = stringMatch[1] ?? stringMatch[2];
			const groupOffset = stringMatch[1] !== undefined ? stringMatch[0].indexOf(content) : stringMatch[0].indexOf(content);
			const contentStart = argsStart + stringMatch.index + groupOffset;
			queries.push({
				queryContent: content,
				sourceOffsets: [...content].map((_character, index) => contentStart + index),
				queryStartOffset: contentStart,
				kind: 'aggregation',
			});
		}
		aggregationPattern.lastIndex = closingParen + 1;
	}
	return queries;
}

function findMongoQueryAt(text: string, offset: number, documents: readonly EntityInfo[]): MongoQuerySource | undefined {
	return extractMongoQueries(text, documents).find((query) =>
		query.sourceOffsets.length > 0
		&& offset >= query.sourceOffsets[0]
		&& offset <= query.sourceOffsets[query.sourceOffsets.length - 1] + 1,
	);
}

function findMongoTemplateMethod(
	text: string,
	offset: number,
	documents: readonly EntityInfo[],
): MongoTemplateMethod | undefined {
	return findMongoTemplateMethods(text, documents).find((method) =>
		offset >= method.startOffset && offset <= method.endOffset,
	);
}

function findMongoTemplateMethods(text: string, documents: readonly EntityInfo[]): MongoTemplateMethod[] {
	const maskedText = maskJavaSource(text);
	if (!/\b(?:Reactive)?MongoTemplate\b/.test(maskedText)) {
		return [];
	}
	const methods: MongoTemplateMethod[] = [];
	const repositoryPackage = text.match(/\bpackage\s+([\w.]+)\s*;/)?.[1];
	const entityLookup = createEntityLookup(documents.filter((entity) => entity.isMongoDocument), repositoryPackage, text);
	const methodPattern = /\b(?:(?:public|protected|private)\s+)?(?:(?:static|final|synchronized)\s+)*[\w$.,<>\[\]? ]+\s+[\w$]+\s*\([^;{}]*\)\s*(?:throws\s+[\w$.,\s]+)?\{/g;
	let match: RegExpExecArray | null;
	while ((match = methodPattern.exec(maskedText)) !== null) {
		const bodyStartOffset = methodPattern.lastIndex;
		const bodyEndOffset = findMatchingBrace(maskedText, bodyStartOffset - 1);
		if (bodyEndOffset < 0) {
			continue;
		}
		const body = text.slice(bodyStartOffset, bodyEndOffset);
		const entityName = [...body.matchAll(/\b([A-Z]\w*)\.class\b/g)]
			.map((classMatch) => classMatch[1])
			.find((name) => entityLookup.has(name.toLowerCase()));
		const entity = entityName ? entityLookup.get(entityName.toLowerCase()) : undefined;
		if (entity) {
			methods.push({
				entity,
				startOffset: match.index,
				endOffset: bodyEndOffset + 1,
				body,
				bodyStartOffset,
			});
		}
		methodPattern.lastIndex = bodyEndOffset + 1;
	}
	return methods;
}

function findClosingParenthesis(maskedText: string, openingOffset: number): number {
	let depth = 0;
	for (let offset = openingOffset; offset < maskedText.length; offset++) {
		if (maskedText[offset] === '(') {
			depth++;
		} else if (maskedText[offset] === ')' && --depth === 0) {
			return offset;
		}
	}
	return -1;
}

function findMatchingBrace(maskedText: string, openingOffset: number): number {
	let depth = 0;
	for (let offset = openingOffset; offset < maskedText.length; offset++) {
		if (maskedText[offset] === '{') {
			depth++;
		} else if (maskedText[offset] === '}' && --depth === 0) {
			return offset;
		}
	}
	return -1;
}
