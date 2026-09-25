import * as vscode from 'vscode';
import { maskJavaSource, parseJavaParameter, splitTopLevelParameters } from './javaParsing';

export interface PropertyLocation {
	readonly line: number;
	readonly character: number;
	readonly length: number;
}

export interface EntityProperty {
	readonly name: string;
	readonly type: string;
	readonly isId?: boolean;
	readonly isTransient?: boolean;
	readonly relation?: JpaRelation;
	readonly targetEntity?: string;
	readonly isCollection?: boolean;
	readonly location?: PropertyLocation;
}

export type JpaRelation = 'OneToOne' | 'OneToMany' | 'ManyToOne' | 'ManyToMany' | 'ElementCollection' | 'Embedded' | 'EmbeddedId';

export interface EntityInfo {
	readonly name: string;
	readonly packageName?: string;
	readonly uri: vscode.Uri;
	readonly isProjection?: boolean;
	readonly superclassName?: string;
	readonly isMappedSuperclass?: boolean;
	readonly isEmbeddable?: boolean;
	readonly properties: readonly EntityProperty[];
	readonly location?: PropertyLocation;
}

const ENTITY_ANNOTATION = /@Entity\b(?:\s*\([^)]*\))?/;
const MAPPED_SUPERCLASS_ANNOTATION = /@MappedSuperclass\b/;
const EMBEDDABLE_ANNOTATION = /@Embeddable\b/;
const LOMBOK_DATA_OR_GETTER = /@(Data|Getter|Value)\b/;
const RECORD_DECLARATION = /\brecord\s+([A-Z]\w*)\s*\(([\s\S]*?)\)/;
const CLASS_DECLARATION = /\b(?:class|interface)\s+([A-Z]\w*)(?:\s+extends\s+([A-Z]\w*))?/;
const PACKAGE_DECLARATION = /\bpackage\s+([\w.]+)\s*;/;

export function parseEntityModel(text: string, uri: vscode.Uri): EntityInfo | undefined {
	const maskedText = maskJavaSource(text);
	const isEntity = ENTITY_ANNOTATION.test(maskedText);
	const isMappedSuperclass = MAPPED_SUPERCLASS_ANNOTATION.test(maskedText);
	const isEmbeddable = EMBEDDABLE_ANNOTATION.test(maskedText);
	const recordMatch = maskedText.match(RECORD_DECLARATION);
	const packageName = maskedText.match(PACKAGE_DECLARATION)?.[1];
	const projectionMatch = maskedText.match(/\binterface\s+([A-Z]\w*)\b[\s\S]*?\b(?:get|is|has)[A-Z]\w*\s*\(/);

	if (!isEntity && !isMappedSuperclass && !isEmbeddable && !recordMatch && !projectionMatch) {
		return undefined;
	}
	if (projectionMatch && !isEntity && !isMappedSuperclass && !isEmbeddable && !recordMatch) {
		const bodyStart = maskedText.indexOf('{', projectionMatch.index ?? 0);
		const bodyEnd = bodyStart < 0 ? -1 : findMatchingBrace(maskedText, bodyStart);
		return {
			name: projectionMatch[1],
			packageName,
			uri,
			isProjection: true,
			properties: bodyStart >= 0 && bodyEnd >= 0
				? extractClassProperties(text, maskedText, bodyStart, false, bodyEnd)
				: [],
		};
	}
	if (recordMatch) {
		const name = recordMatch[1];
		const paramsText = recordMatch[2];
		const properties = extractRecordProperties(paramsText, text, recordMatch.index ?? 0);
		return {
			name,
			packageName,
			uri,
			isMappedSuperclass,
			isEmbeddable,
			properties,
		};
	}

	const entityAnnotationOffset = [
		ENTITY_ANNOTATION.exec(maskedText)?.index,
		MAPPED_SUPERCLASS_ANNOTATION.exec(maskedText)?.index,
		EMBEDDABLE_ANNOTATION.exec(maskedText)?.index,
	].filter((offset): offset is number => offset !== undefined).sort((left, right) => left - right)[0];
	const classDeclarations = [...maskedText.matchAll(new RegExp(CLASS_DECLARATION.source, 'g'))];
	const classMatch = entityAnnotationOffset === undefined
		? classDeclarations[0]
		: classDeclarations.find((match) => (match.index ?? -1) > entityAnnotationOffset);
	if (!classMatch) {
		return undefined;
	}
	const bodyStart = maskedText.indexOf('{', classMatch.index ?? 0);
	const bodyEnd = bodyStart < 0 ? -1 : findMatchingBrace(maskedText, bodyStart);
	if (bodyStart < 0 || bodyEnd < 0) {
		return undefined;
	}

	const name = classMatch[1];
	const superclassName = classMatch[2];
	const hasLombok = LOMBOK_DATA_OR_GETTER.test(maskedText);
	const properties = extractClassProperties(text, maskedText, bodyStart, hasLombok, bodyEnd);

	return {
		name,
		packageName,
		uri,
		superclassName,
		isMappedSuperclass,
		isEmbeddable,
		properties,
	};
}

function extractRecordProperties(paramsText: string, fullText: string, recordOffset: number): EntityProperty[] {
	const paramsOffset = recordOffset + fullText.indexOf(paramsText, recordOffset);
	return splitTopLevelParameters(paramsText, paramsOffset)
		.map((part) => {
			const parameter = parseJavaParameter(part);
			if (!parameter) {
				return undefined;
			}
			return {
				name: parameter.name,
				type: parameter.type,
				location: calculateLocation(fullText, parameter.nameOffset, parameter.name.length),
			};
		})
		.filter((property): property is NonNullable<typeof property> => property !== undefined);
}

function extractClassProperties(text: string, maskedText: string, bodyStart: number, hasLombok: boolean, bodyEnd?: number): EntityProperty[] {
	const properties = new Map<string, EntityProperty>();
	const end = bodyEnd ?? findMatchingBrace(maskedText, bodyStart);
	if (end < 0) {
		return [];
	}
	const fieldRegex = /^\s*((?:@[\w.]+(?:\s*\([^)]*\))?\s*)*)(?:(?:public|protected|private|static|final|volatile|transient)\s+)*([\w$.[\]<>?]+(?:\s*<[\w$.[\],<>?\s]+>)?)\s+([a-zA-Z_$]\w*)\s*(?:=[\s\S]*?)?;\s*$/;
	const getterRegex = /(?:^|\s)(?:public|protected|private)?\s*(?:static\s+)?([\w<>?,[\]\s.]+)\s+(?:get|is|has)([A-Z]\w*)\s*\(\s*\)\s*;?\s*$/;
	let memberStart = bodyStart + 1;
	let braceDepth = 0;

	const addGetter = (member: string, memberOffset: number) => {
		const getter = member.match(getterRegex);
		if (!getter) {
			return;
		}
		const rawName = getter[2];
		const propName = rawName[0].toLowerCase() + rawName.slice(1);
		if (!properties.has(propName)) {
			const nameOffset = memberOffset + member.lastIndexOf(`get${rawName}`);
			properties.set(propName, {
				name: propName,
				type: getter[1].trim(),
				location: calculateLocation(text, nameOffset, rawName.length + 3),
			});
		}
	};

	const addField = (member: string, memberOffset: number) => {
		const maskedMember = maskedText.slice(memberOffset, memberOffset + member.length);
		if (getterRegex.test(maskedMember)) {
			addGetter(member, memberOffset);
			return;
		}
		const field = maskedMember.match(fieldRegex);
		if (!field) {
			addGetter(member, memberOffset);
			return;
		}
		const annotations = field[1] ?? '';
		const modifiers = maskedMember.match(/^\s*(?:(?:@[\w.]+(?:\s*\([^)]*\))?\s*)*)(?:(?:public|protected|private|static|final|volatile|transient)\s+)*/)?.[0] ?? '';
		if (annotations.includes('@Transient') || modifiers.includes('transient ') || modifiers.includes('static ')) {
			return;
		}
		const type = field[2].trim();
		const name = field[3];
		const nameOffset = memberOffset + maskedMember.lastIndexOf(name);
		const targetEntity = annotations.match(/targetEntity\s*=\s*([A-Z]\w*)\.class/)?.[1];
		properties.set(name, {
			name,
			type,
			isId: annotations.includes('@Id'),
			isTransient: false,
			relation: extractRelation(annotations),
			targetEntity,
			isCollection: /\b(?:Collection|List|Set|Iterable|Map)<|\[\]/.test(type),
			location: calculateLocation(text, nameOffset, name.length),
		});
	};

	for (let offset = bodyStart + 1; offset < end; offset++) {
		if (maskedText[offset] === '{') {
			if (braceDepth === 0) {
				const header = maskedText.slice(memberStart, offset);
				if (!header.includes('=')) {
					addGetter(text.slice(memberStart, offset), memberStart);
				}
			}
			braceDepth++;
		} else if (maskedText[offset] === '}') {
			braceDepth--;
			if (braceDepth === 0 && !maskedText.slice(memberStart, offset).includes('=')) {
				memberStart = offset + 1;
			}
		} else if (maskedText[offset] === ';' && braceDepth === 0) {
			addField(text.slice(memberStart, offset + 1), memberStart);
			memberStart = offset + 1;
		}
	}

	return [...properties.values()].sort((a, b) => a.name.localeCompare(b.name));
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

function extractRelation(annotations: string): JpaRelation | undefined {
	for (const relation of ['OneToOne', 'OneToMany', 'ManyToOne', 'ManyToMany', 'ElementCollection', 'EmbeddedId', 'Embedded'] as const) {
		if (annotations.includes(`@${relation}`)) {
			return relation;
		}
	}
	return undefined;
}

function calculateLocation(fullText: string, offset: number, length: number): PropertyLocation {
	const before = fullText.slice(0, offset);
	const lines = before.split(/\r?\n/);
	const line = lines.length - 1;
	const character = lines[lines.length - 1].length;
	return { line, character, length };
}
