import * as vscode from 'vscode';

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

const ENTITY_ANNOTATION = /@Entity(?:\s*\([^)]*\))?/;
const MAPPED_SUPERCLASS_ANNOTATION = /@MappedSuperclass\b/;
const EMBEDDABLE_ANNOTATION = /@Embeddable\b/;
const LOMBOK_DATA_OR_GETTER = /@(Data|Getter|Value)\b/;
const RECORD_DECLARATION = /\brecord\s+([A-Z]\w*)\s*\(([\s\S]*?)\)/;
const CLASS_DECLARATION = /\b(?:class|interface)\s+([A-Z]\w*)(?:\s+extends\s+([A-Z]\w*))?/;
const PACKAGE_DECLARATION = /\bpackage\s+([\w.]+)\s*;/;

export function parseEntityModel(text: string, uri: vscode.Uri): EntityInfo | undefined {
	const isEntity = ENTITY_ANNOTATION.test(text);
	const isMappedSuperclass = MAPPED_SUPERCLASS_ANNOTATION.test(text);
	const isEmbeddable = EMBEDDABLE_ANNOTATION.test(text);
	const recordMatch = text.match(RECORD_DECLARATION);
	const packageName = text.match(PACKAGE_DECLARATION)?.[1];
	const projectionMatch = text.match(/\binterface\s+([A-Z]\w*)\b[\s\S]*?\b(?:get|is|has)[A-Z]\w*\s*\(/);

	if (!isEntity && !isMappedSuperclass && !isEmbeddable && !recordMatch && !projectionMatch) {
		return undefined;
	}
	if (projectionMatch && !isEntity && !isMappedSuperclass && !isEmbeddable && !recordMatch) {
		return {
			name: projectionMatch[1],
			packageName,
			uri,
			isProjection: true,
			properties: extractClassProperties(text, false),
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

	const classMatch = text.match(CLASS_DECLARATION);
	if (!classMatch) {
		return undefined;
	}

	const name = classMatch[1];
	const superclassName = classMatch[2];
	const hasLombok = LOMBOK_DATA_OR_GETTER.test(text);
	const properties = extractClassProperties(text, hasLombok);

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
	const properties: EntityProperty[] = [];
	const parts = paramsText.split(',');
	let currentOffset = recordOffset + fullText.slice(recordOffset).indexOf(paramsText);

	for (const part of parts) {
		const trimmed = part.trim();
		const match = trimmed.match(/([\w$.[\]<>?]+)\s+([a-zA-Z_$]\w*)$/);
		if (match) {
			const type = match[1];
			const name = match[2];
			const propOffset = fullText.indexOf(name, currentOffset);
			const location = propOffset >= 0 ? calculateLocation(fullText, propOffset, name.length) : undefined;
			properties.push({
				name,
				type,
				location,
			});
		}
		currentOffset += part.length + 1;
	}
	return properties;
}

function extractClassProperties(text: string, hasLombok: boolean): EntityProperty[] {
	const properties = new Map<string, EntityProperty>();

	// Field regex: matches fields with optional annotations, modifiers, type, name
	const fieldRegex = /(?:(@[\w.]+(?:\s*\([^)]*\))?\s*)*)(?:(?:public|protected|private|final|volatile|transient)\s+)*(?<![a-zA-Z_$])(?!(?:return|if|for|while|switch|throw|new)\b)([\w$.[\]<>?]+(?:\s*<[\w$.[\],<>?\s]+>)?)\s+([a-zA-Z_$]\w*)\s*(?:=[\s\S]*?)?;/g;
	// Getter regex: matches getX() or isX()
	const getterRegex = /\b(?:public|protected|private)?\s*(?:static\s+)?([\w<>?,[\]\s.]+)\s+(?:get|is|has)([A-Z]\w*)\s*\(\s*\)/g;

	let match: RegExpExecArray | null;
	while ((match = fieldRegex.exec(text)) !== null) {
		const annotations = match[1] ?? '';
		const fullMatch = match[0];
		const type = match[2].trim();
		const name = match[3];

		// Check if transient
		const isTransient = annotations.includes('@Transient') || fullMatch.includes('transient ');
		if (isTransient) {
			continue;
		}

		// Check if id
		const isId = annotations.includes('@Id');
		const relation = extractRelation(annotations);
		const targetEntity = annotations.match(/targetEntity\s*=\s*([A-Z]\w*)\.class/)?.[1];
		const isCollection = /\b(?:Collection|List|Set|Iterable|Map)<|\[\]/.test(type);

		const isStatic = fullMatch.includes('static ');
		if (isStatic) {
			continue;
		}

		const propOffset = match.index + fullMatch.lastIndexOf(name);
		const location = calculateLocation(text, propOffset, name.length);

		properties.set(name, {
			name,
			type,
			isId,
			isTransient: false,
			relation,
			targetEntity,
			isCollection,
			location,
		});
	}

	// Also inspect getters for properties
	while ((match = getterRegex.exec(text)) !== null) {
		const type = match[1].trim();
		const rawName = match[2];
		const propName = rawName[0].toLowerCase() + rawName.slice(1);
		const existing = properties.get(propName);
		if (!existing) {
			const propOffset = match.index;
			const location = calculateLocation(text, propOffset, match[0].length);
			properties.set(propName, {
				name: propName,
				type,
				location,
			});
		}
	}

	return [...properties.values()].sort((a, b) => a.name.localeCompare(b.name));
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
