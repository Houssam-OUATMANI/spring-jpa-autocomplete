import * as vscode from 'vscode';
import { maskJavaSource } from './javaParsing';
import { extractRepositoryEntityNameAt } from './entityDiscovery';
import { EntityInfo, EntityProperty } from './entityModel';
import { extractAllJpqlQueries } from './jpql/jpqlParser';
import { findClosestProperty } from './propertySuggestions';

const MONGO_REPOSITORY_TYPES = /\b(?:MongoRepository|ReactiveMongoRepository)\s*</;

interface MongoQuerySource {
	readonly queryContent: string;
	readonly sourceOffsets: readonly number[];
	readonly queryStartOffset: number;
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
	readonly code: 'UNKNOWN_MONGO_FIELD';
}

export interface MongoFieldAccess {
	readonly entity: EntityInfo;
	readonly property: EntityProperty;
	readonly startOffset: number;
	readonly endOffset: number;
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
		const fields = getMongoFields(documents, repositoryEntityName);
		for (const match of query.queryContent.matchAll(/(["'])([^"'$][^"']*)\1\s*:/g)) {
			const path = match[2].toLowerCase();
			const field = fields.find((candidate) => candidate.path.toLowerCase() === path);
			if (!field) {
				continue;
			}
			accesses.push({
				entity: field.entity,
				property: field.property,
				startOffset: query.sourceOffsets[match.index + 1],
				endOffset: query.sourceOffsets[match.index + 1 + match[2].length - 1] + 1,
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
	const keyMatch = prefix.match(/(?:^|[{,]\s*)["']?([A-Za-z_][\w.]*)?$/);
	if (!keyMatch) {
		return undefined;
	}
	const partial = keyMatch[1] ?? '';
	const range = new vscode.Range(document.positionAt(offset - partial.length), position);
	const repositoryEntityName = extractRepositoryEntityNameAt(text, query.queryStartOffset);
	const fields = getMongoFields(documents, repositoryEntityName);
	const seen = new Set<string>();

	return fields.flatMap(({ path, property }) => {
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
}

export function validateMongoQueries(text: string, documents: readonly EntityInfo[]): MongoQueryDiagnostic[] {
	const diagnostics: MongoQueryDiagnostic[] = [];
	for (const query of extractMongoQueries(text, documents)) {
		const repositoryEntityName = extractRepositoryEntityNameAt(text, query.queryStartOffset);
		const fields = getMongoFields(documents, repositoryEntityName);
		const knownFields = new Set(fields.map(({ path }) => path.toLowerCase()));
		for (const match of query.queryContent.matchAll(/(["'])([^"'$][^"']*)\1\s*:/g)) {
			const propertyName = match[2];
			if (knownFields.has(propertyName.toLowerCase()) || ['and', 'or', 'nor', 'not', 'text', 'where'].includes(propertyName.toLowerCase())) {
				continue;
			}
			const startOffset = query.sourceOffsets[match.index + 1];
			const endOffset = query.sourceOffsets[match.index + 1 + propertyName.length - 1] + 1;
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

function getMongoFields(
	documents: readonly EntityInfo[],
	repositoryEntityName?: string,
): { path: string; property: EntityProperty; entity: EntityInfo }[] {
	const rootEntities = documents.filter((candidate) =>
		!repositoryEntityName || candidate.name === repositoryEntityName || candidate.entityName === repositoryEntityName,
	);
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
				.map((typeName) => documents.find((candidate) => candidate.name === typeName || candidate.entityName === typeName))
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
	const queries = extractAllJpqlQueries(text, documents)
		.filter((query) => isMongoRepositoryAt(text, query.queryStartOffset))
		.map((query) => ({
			queryContent: query.queryContent,
			sourceOffsets: query.sourceOffsets,
			queryStartOffset: query.queryStartOffset,
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
