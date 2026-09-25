import * as vscode from 'vscode';
import { EntityInfo, EntityProperty, parseEntityModel, PropertyLocation } from './entityModel';

export { EntityInfo, EntityProperty, PropertyLocation };

const REPOSITORY_ENTITY = /\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor)\s*<\s*([A-Z]\w*)/g;
const PACKAGE_DECLARATION = /\bpackage\s+([\w.]+)\s*;/;

export class WorkspaceEntityIndex {
	private static instance: WorkspaceEntityIndex | undefined;
	private entitiesByUri = new Map<string, EntityInfo>();
	private entitiesByName = new Map<string, EntityInfo[]>();
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

	public getEntity(name: string, preferredPackage?: string): EntityInfo | undefined {
		const matches = this.entitiesByName.get(name.toLowerCase()) ?? [];
		return matches.find((entity) => entity.packageName === preferredPackage) ?? matches[0];
	}

	public hasUri(uri: vscode.Uri): boolean {
		return this.entitiesByUri.has(uri.toString());
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
			for (let offset = 0; offset < files.length; offset += 32) {
				const batch = await Promise.all(files.slice(offset, offset + 32).map(async (uri) => {
					try {
						const document = await vscode.workspace.openTextDocument(uri);
						return parseEntityModel(document.getText(), document.uri);
					} catch {
						return undefined;
					}
				}));
				for (const entity of batch) {
					if (entity) {
						this.entitiesByUri.set(entity.uri.toString(), entity);
					}
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
			const key = entity.name.toLowerCase();
			this.entitiesByName.set(key, [...(this.entitiesByName.get(key) ?? []), entity]);
		}
	}
}

export function parseEntity(text: string, uri: vscode.Uri): EntityInfo | undefined {
	return parseEntityModel(text, uri);
}

export function extractRepositoryEntityNames(text: string): string[] {
	return [...text.matchAll(REPOSITORY_ENTITY)].map((match) => match[1]);
}

export function extractRepositoryEntityNameAt(text: string, offset: number): string | undefined {
	let selected: string | undefined;
	for (const match of text.matchAll(REPOSITORY_ENTITY)) {
		if ((match.index ?? 0) > offset) {
			break;
		}
		selected = match[1];
	}
	return selected;
}

export function createEntityLookup(
	entities: readonly EntityInfo[],
	preferredPackage?: string,
	sourceText?: string,
): Map<string, EntityInfo> {
	const lookup = new Map<string, EntityInfo>();
	const priorities = new Map<string, number>();
	const imports = new Map<string, string>();
	for (const match of sourceText?.matchAll(/\bimport\s+([\w.]+)\s*;/g) ?? []) {
		const qualifiedName = match[1];
		imports.set(qualifiedName.split('.').pop()!.toLowerCase(), qualifiedName);
	}
	for (const entity of entities) {
		const key = entity.name.toLowerCase();
		const qualifiedName = entity.packageName ? `${entity.packageName}.${entity.name}` : entity.name;
		lookup.set(qualifiedName.toLowerCase(), entity);
		const priority = imports.get(key)?.toLowerCase() === qualifiedName.toLowerCase()
			? 3
			: preferredPackage && entity.packageName === preferredPackage
				? 2
				: 1;
		if ((priorities.get(key) ?? 0) < priority) {
			lookup.set(key, entity);
			priorities.set(key, priority);
		}
	}
	return lookup;
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
	repositoryEntityName?: string,
): readonly EntityProperty[] {
	const names = repositoryEntityName ? [repositoryEntityName] : extractRepositoryEntityNames(repositoryText);
	const repositoryPackage = repositoryText.match(PACKAGE_DECLARATION)?.[1];
	const namedEntities = names.length > 0
		? entities.filter((entity) => names.includes(entity.name))
		: entities;
	const samePackage = repositoryPackage
		? namedEntities.filter((entity) => entity.packageName === repositoryPackage)
		: [];
	const importedTypes = new Set([...repositoryText.matchAll(/\bimport\s+([\w.]+)\s*;/g)].map((match) => match[1].toLowerCase()));
	const explicitlyImported = namedEntities.filter((entity) =>
		importedTypes.has(`${entity.packageName ? `${entity.packageName}.` : ''}${entity.name}`.toLowerCase()),
	);
	const selected = explicitlyImported.length > 0
		? explicitlyImported
		: samePackage.length > 0
			? samePackage
			: namedEntities;

	const properties = new Map<string, EntityProperty>();
	const entitiesByName = createEntityLookup(entities, repositoryPackage, repositoryText);

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
			relation: property.relation,
			targetEntity: property.targetEntity,
			isCollection: property.isCollection,
			location: property.location,
		});

		// Underscore style: address_city (if nested)
		if (prefix) {
			const underscoreName = `${prefix}_${property.name}`;
			properties.set(underscoreName, {
				name: underscoreName,
				type: property.type,
				isId: property.isId,
				relation: property.relation,
				targetEntity: property.targetEntity,
				isCollection: property.isCollection,
				location: property.location,
			});
		}

		const referencedNames = property.targetEntity ? [property.targetEntity] : referencedEntityNames(property.type);
		for (const referencedEntityName of referencedNames) {
			const referencedEntity = findEntityByName(entitiesByName, referencedEntityName);
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
	return resolveEntityPropertyPathWithOwner(entity, propertyPath, entitiesByName)?.property;
}

export function resolveEntityPropertyPathWithOwner(
	entity: EntityInfo,
	propertyPath: string,
	entitiesByName: ReadonlyMap<string, EntityInfo>,
): { property: EntityProperty; owner: EntityInfo } | undefined {
	let currentEntity = entity;
	let resolved: EntityProperty | undefined;
	let owner: EntityInfo | undefined;

	for (const segment of propertyPath.split('.')) {
		const current = resolveEntityHierarchy(currentEntity, entitiesByName);
		resolved = current.properties.find((property) => property.name.toLowerCase() === segment.toLowerCase());
		if (!resolved) {
			return undefined;
		}
		owner = current;
		const nextEntityName = referencedEntityNames(resolved.type).find((name) => findEntityByName(entitiesByName, name));
		if (nextEntityName) {
			currentEntity = findEntityByName(entitiesByName, nextEntityName)!;
		}
	}

	return resolved && owner ? { property: resolved, owner } : undefined;
}

function findEntityByName(entitiesByName: ReadonlyMap<string, EntityInfo>, name: string): EntityInfo | undefined {
	return entitiesByName.get(name) ?? [...entitiesByName.values()].find((entity) => entity.name.toLowerCase() === name.toLowerCase());
}

function capitalize(value: string): string {
	return value[0].toUpperCase() + value.slice(1);
}