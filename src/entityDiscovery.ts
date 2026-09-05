import * as vscode from 'vscode';
import { EntityProperty, extractPropertyNames } from './jpaKeywords';

export interface EntityInfo {
	readonly name: string;
	readonly properties: readonly EntityProperty[];
	readonly uri: vscode.Uri;
}

const ENTITY_ANNOTATION = /@Entity(?:\s*\([^)]*\))?/;
const REPOSITORY_ENTITY = /\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor)\s*<\s*([A-Z]\w*)/g;
const TYPE_DECLARATION = /\b(?:class|record)\s+([A-Z]\w*)\b/;
let workspaceEntitiesPromise: Promise<readonly EntityInfo[]> | undefined;

export function parseEntity(text: string, uri: vscode.Uri): EntityInfo | undefined {
	if (!ENTITY_ANNOTATION.test(text)) {
		return undefined;
	}

	const typeName = text.match(TYPE_DECLARATION)?.[1];
	if (!typeName) {
		return undefined;
	}

	return {
		name: typeName,
		properties: extractPropertyNames(text),
		uri,
	};
}

export function extractRepositoryEntityNames(text: string): string[] {
	return [...text.matchAll(REPOSITORY_ENTITY)].map((match) => match[1]);
}

export async function discoverEntities(currentDocument: vscode.TextDocument): Promise<readonly EntityInfo[]> {
	if (!workspaceEntitiesPromise) {
		workspaceEntitiesPromise = scanWorkspaceEntities();
	}

	const currentEntity = parseEntity(currentDocument.getText(), currentDocument.uri);
	const otherEntities = (await workspaceEntitiesPromise)
		.filter((entity) => entity.uri.toString() !== currentDocument.uri.toString());
	return currentEntity ? [currentEntity, ...otherEntities] : otherEntities;
}

export function clearEntityCache(): void {
	workspaceEntitiesPromise = undefined;
}

async function scanWorkspaceEntities(): Promise<readonly EntityInfo[]> {
	const files = await vscode.workspace.findFiles('**/*.java', '**/{node_modules,target,build,out,.gradle}/**');
	const documents = await Promise.all(files.map((uri) => vscode.workspace.openTextDocument(uri)));
	return documents
		.map((document) => parseEntity(document.getText(), document.uri))
		.filter((entity): entity is EntityInfo => entity !== undefined);
}

export function findEntityProperties(
		repositoryText: string,
		entities: readonly EntityInfo[],
	): readonly EntityProperty[] {
	const names = extractRepositoryEntityNames(repositoryText);
	const selected = names.length > 0
		? entities.filter((entity) => names.includes(entity.name))
		: entities;

	const properties = new Map<string, EntityProperty>();
	const entitiesByName = new Map(entities.map((entity) => [entity.name, entity]));
	for (const entity of selected) {
		addEntityProperties(entity, '', new Set(), properties, entitiesByName);
	}
	return [...properties.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function addEntityProperties(
	entity: EntityInfo,
	prefix: string,
	ancestors: ReadonlySet<string>,
	properties: Map<string, EntityProperty>,
	entitiesByName: ReadonlyMap<string, EntityInfo>,
): void {
	if (ancestors.has(entity.name)) {
		return;
	}

	const nextAncestors = new Set(ancestors).add(entity.name);
	for (const property of entity.properties) {
		const propertyName = `${prefix}${prefix ? capitalize(property.name) : property.name}`;
		properties.set(propertyName, { name: propertyName, type: property.type });

		for (const referencedEntityName of referencedEntityNames(property.type)) {
			const referencedEntity = entitiesByName.get(referencedEntityName);
			if (referencedEntity) {
				addEntityProperties(referencedEntity, propertyName, nextAncestors, properties, entitiesByName);
			}
		}
	}
}

function referencedEntityNames(type: string): string[] {
	return [...type.matchAll(/\b[A-Z]\w*\b/g)].map((match) => match[0]);
}

function capitalize(value: string): string {
	return value[0].toUpperCase() + value.slice(1);
}