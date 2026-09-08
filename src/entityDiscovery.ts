import * as vscode from 'vscode';
import { EntityInfo, EntityProperty, parseEntityModel, PropertyLocation } from './entityModel';

export { EntityInfo, EntityProperty, PropertyLocation };

const REPOSITORY_ENTITY = /\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor)\s*<\s*([A-Z]\w*)/g;
const PACKAGE_DECLARATION = /\bpackage\s+([\w.]+)\s*;/;

export class WorkspaceEntityIndex {
	private static instance: WorkspaceEntityIndex | undefined;
	private entitiesByUri = new Map<string, EntityInfo>();
	private entitiesByName = new Map<string, EntityInfo>();
	private isInitialized = false;
	private initPromise: Promise<void> | undefined;

	public static getInstance(): WorkspaceEntityIndex {
		if (!WorkspaceEntityIndex.instance) {
			WorkspaceEntityIndex.instance = new WorkspaceEntityIndex();
		}
		return WorkspaceEntityIndex.instance;
	}

	public async ensureInitialized(): Promise<void> {
		if (this.isInitialized) {
			return;
		}
		if (!this.initPromise) {
			this.initPromise = this.scanWorkspace();
		}
		await this.initPromise;
	}

	public clear(): void {
		this.entitiesByUri.clear();
		this.entitiesByName.clear();
		this.isInitialized = false;
		this.initPromise = undefined;
	}

	public updateDocument(document: vscode.TextDocument): EntityInfo | undefined {
		if (document.languageId !== 'java') {
			return undefined;
		}
		const entity = parseEntityModel(document.getText(), document.uri);
		const uriKey = document.uri.toString();
		this.entitiesByUri.delete(uriKey);
		if (entity) {
			this.entitiesByUri.set(uriKey, entity);
		}
		this.rebuildNameIndex();
		return entity;
	}

	public removeUri(uri: vscode.Uri): void {
		const uriKey = uri.toString();
		this.entitiesByUri.delete(uriKey);
		this.rebuildNameIndex();
	}

	public getEntity(name: string): EntityInfo | undefined {
		return this.entitiesByName.get(name);
	}

	public getAllEntities(): readonly EntityInfo[] {
		return [...this.entitiesByUri.values()];
	}

	private async scanWorkspace(): Promise<void> {
		try {
			const includeTestSources = typeof vscode.workspace.getConfiguration !== 'undefined'
				? vscode.workspace.getConfiguration('springJpa').get<boolean>('includeTestSources', true)
				: true;
			const excluded = includeTestSources
				? '**/{node_modules,target,build,out,.gradle}/**'
				: '**/{node_modules,target,build,out,.gradle,src/test}/**';
			const files = await vscode.workspace.findFiles('**/*.java', excluded);
			for (const uri of files) {
				try {
					const document = await vscode.workspace.openTextDocument(uri);
					const entity = parseEntityModel(document.getText(), document.uri);
					if (entity) {
						this.entitiesByUri.set(uri.toString(), entity);
						this.entitiesByName.set(entity.name, entity);
					}
				} catch {
					// Ignore unreadable files
				}
			}
		} finally {
			this.rebuildNameIndex();
			this.isInitialized = true;
		}
	}

	private rebuildNameIndex(): void {
		this.entitiesByName.clear();
		for (const entity of this.entitiesByUri.values()) {
			if (!this.entitiesByName.has(entity.name)) {
				this.entitiesByName.set(entity.name, entity);
			}
		}
	}
}

export function parseEntity(text: string, uri: vscode.Uri): EntityInfo | undefined {
	return parseEntityModel(text, uri);
}

export function extractRepositoryEntityNames(text: string): string[] {
	return [...text.matchAll(REPOSITORY_ENTITY)].map((match) => match[1]);
}

export async function discoverEntities(currentDocument: vscode.TextDocument): Promise<readonly EntityInfo[]> {
	const index = WorkspaceEntityIndex.getInstance();
	await index.ensureInitialized();

	const currentEntity = index.updateDocument(currentDocument);
	const all = index.getAllEntities();
	if (!currentEntity) {
		return all;
	}
	const otherEntities = all.filter((e) => e.uri.toString() !== currentDocument.uri.toString());
	return [currentEntity, ...otherEntities];
}

export function clearEntityCache(): void {
	WorkspaceEntityIndex.getInstance().clear();
}

/**
 * Returns all accessible properties for the repository's entity,
 * resolving inheritance (@MappedSuperclass, superclasses) and nested relations/embedded types.
 */
export function findEntityProperties(
	repositoryText: string,
	entities: readonly EntityInfo[],
): readonly EntityProperty[] {
	const names = extractRepositoryEntityNames(repositoryText);
	const repositoryPackage = repositoryText.match(PACKAGE_DECLARATION)?.[1];
	const namedEntities = names.length > 0
		? entities.filter((entity) => names.includes(entity.name))
		: entities;
	const samePackage = repositoryPackage
		? namedEntities.filter((entity) => entity.packageName === repositoryPackage)
		: [];
	const selected = samePackage.length > 0 ? samePackage : namedEntities;

	const properties = new Map<string, EntityProperty>();
	const entitiesByName = new Map(entities.map((entity) => [entity.name, entity]));

	for (const entity of selected) {
		const fullEntity = resolveEntityHierarchy(entity, entitiesByName);
		addEntityProperties(fullEntity, '', new Set(), properties, entitiesByName);
	}

	return [...properties.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Merges superclass properties (e.g. from @MappedSuperclass) into the entity.
 */
export function resolveEntityHierarchy(
	entity: EntityInfo,
	entitiesByName: ReadonlyMap<string, EntityInfo>,
	visited = new Set<string>(),
): EntityInfo {
	if (!entity.superclassName || visited.has(entity.name)) {
		return entity;
	}

	visited.add(entity.name);
	const superEntity = findEntityByName(entitiesByName, entity.superclassName);
	if (!superEntity) {
		return entity;
	}

	const resolvedSuper = resolveEntityHierarchy(superEntity, entitiesByName, visited);
	const combinedProps = new Map<string, EntityProperty>();

	// Add superclass properties first
	for (const prop of resolvedSuper.properties) {
		combinedProps.set(prop.name, prop);
	}
	// Subclass overrides / adds properties
	for (const prop of entity.properties) {
		combinedProps.set(prop.name, prop);
	}

	return {
		...entity,
		properties: [...combinedProps.values()].sort((a, b) => a.name.localeCompare(b.name)),
	};
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
		// CamelCase style: addressCity
		const camelName = `${prefix}${prefix ? capitalize(property.name) : property.name}`;
		properties.set(camelName, {
			name: camelName,
			type: property.type,
			isId: property.isId,
			location: property.location,
		});

		// Underscore style: address_city (if nested)
		if (prefix) {
			const underscoreName = `${prefix}_${property.name}`;
			properties.set(underscoreName, {
				name: underscoreName,
				type: property.type,
				isId: property.isId,
				location: property.location,
			});
		}

		for (const referencedEntityName of referencedEntityNames(property.type)) {
			const referencedEntity = entitiesByName.get(referencedEntityName);
			if (referencedEntity) {
				const resolvedReferenced = resolveEntityHierarchy(referencedEntity, entitiesByName);
				addEntityProperties(resolvedReferenced, camelName, nextAncestors, properties, entitiesByName);
			}
		}
	}
}

export function referencedEntityNames(type: string): string[] {
	return [...type.matchAll(/\b[A-Z]\w*\b/g)].map((match) => match[0]);
}

export function resolveEntityPropertyPath(
	entity: EntityInfo,
	propertyPath: string,
	entitiesByName: ReadonlyMap<string, EntityInfo>,
): EntityProperty | undefined {
	let currentEntity = entity;
	let resolved: EntityProperty | undefined;

	for (const segment of propertyPath.split('.')) {
		const current = resolveEntityHierarchy(currentEntity, entitiesByName);
		resolved = current.properties.find((property) => property.name.toLowerCase() === segment.toLowerCase());
		if (!resolved) {
			return undefined;
		}
		const nextEntityName = referencedEntityNames(resolved.type).find((name) => findEntityByName(entitiesByName, name));
		if (nextEntityName) {
			currentEntity = findEntityByName(entitiesByName, nextEntityName)!;
		}
	}

	return resolved;
}

function findEntityByName(entitiesByName: ReadonlyMap<string, EntityInfo>, name: string): EntityInfo | undefined {
	return entitiesByName.get(name) ?? [...entitiesByName.values()].find((entity) => entity.name.toLowerCase() === name.toLowerCase());
}

function capitalize(value: string): string {
	return value[0].toUpperCase() + value.slice(1);
}