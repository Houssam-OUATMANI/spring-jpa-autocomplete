import * as vscode from 'vscode';
import { EntityInfo, EntityProperty, parseEntityModels, ProjectionTypeInfo, PropertyLocation } from './entityModel';
import { maskJavaSource } from './javaParsing';

export { EntityInfo, EntityProperty, ProjectionTypeInfo, PropertyLocation };

export interface RepositoryInfo {
	readonly uri: vscode.Uri;
	readonly name: string;
	readonly managedEntityNames: readonly string[];
}

const REPOSITORY_ENTITY = /\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor|Repository|RevisionRepository)\s*<\s*([A-Z]\w*)/g;
const PACKAGE_DECLARATION = /\bpackage\s+([\w.]+)\s*;/;
const ALWAYS_EXCLUDED_JAVA_DIRECTORIES = new Set([
	'node_modules', 'target', 'build', 'out', '.gradle', '.vscode-test',
	'.git', '.idea', '.settings', '.vscode', 'bin', 'dist',
]);

export function isExcludedJavaUri(uri: vscode.Uri, includeTestSources = true): boolean {
	const segments = uri.path.split('/').filter(Boolean);
	if (segments.some((segment) => ALWAYS_EXCLUDED_JAVA_DIRECTORIES.has(segment.toLowerCase()))) {
		return true;
	}
	if (!includeTestSources) {
		return segments.some((segment, index) => segment.toLowerCase() === 'src' && segments[index + 1]?.toLowerCase() === 'test');
	}
	return false;
}

function sourceFingerprint(text: string): string {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++) {
		hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
	}
	return `${text.length}:${hash >>> 0}`;
}

export class WorkspaceEntityIndex {
	private static instance: WorkspaceEntityIndex | undefined;
	private entitiesByUri = new Map<string, readonly EntityInfo[]>();
	private projectionTypesByUri = new Map<string, readonly ProjectionTypeInfo[]>();
	private repositoriesByUri = new Map<string, readonly RepositoryInfo[]>();
	private entitiesByName = new Map<string, EntityInfo[]>();
	private sourceFingerprints = new Map<string, string>();
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
		this.projectionTypesByUri.clear();
		this.repositoriesByUri.clear();
		this.entitiesByName.clear();
		this.sourceFingerprints.clear();
		this.isInitialized = false;
		this.initPromise = undefined;
	}

	public updateDocument(document: vscode.TextDocument): EntityInfo | undefined {
		if (document.languageId !== 'java' || isExcludedJavaUri(document.uri, this.includeTestSources())) {
			return undefined;
		}
		const uriKey = document.uri.toString();
		const text = document.getText();
		const fingerprint = sourceFingerprint(text);
		if (this.sourceFingerprints.get(uriKey) === fingerprint) {
			return this.entitiesByUri.get(uriKey)?.[0];
		}
		const previousEntities = this.entitiesByUri.get(uriKey);
		const projectionTypes: ProjectionTypeInfo[] = [];
		const entities = parseEntityModels(text, document.uri, projectionTypes);
		this.sourceFingerprints.set(uriKey, fingerprint);
		this.projectionTypesByUri.set(uriKey, projectionTypes);
		if (entities.length > 0) {
			this.entitiesByUri.set(uriKey, entities);
		} else {
			this.entitiesByUri.delete(uriKey);
		}

		const repos = extractRepositoryInfos(text, document.uri);
		if (repos.length > 0) {
			this.repositoriesByUri.set(uriKey, repos);
		} else {
			this.repositoriesByUri.delete(uriKey);
		}

		if (previousEntities || entities.length > 0) {
			this.rebuildNameIndex();
		}
		return entities[0];
	}

	public removeUri(uri: vscode.Uri): void {
		const uriKey = uri.toString();
		this.entitiesByUri.delete(uriKey);
		this.projectionTypesByUri.delete(uriKey);
		this.repositoriesByUri.delete(uriKey);
		this.sourceFingerprints.delete(uriKey);
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
		return [...this.entitiesByUri.values()].flat();
	}

	public getAllProjectionTypes(): readonly ProjectionTypeInfo[] {
		const uniqueTypes = new Map<string, ProjectionTypeInfo>();
		for (const type of [...this.projectionTypesByUri.values()].flat()) {
			const qualifiedName = type.packageName ? `${type.packageName}.${type.name}` : type.name;
			if (!uniqueTypes.has(qualifiedName)) {
				uniqueTypes.set(qualifiedName, type);
			}
		}
		return [...uniqueTypes.values()];
	}

	public getEntitiesForUri(uri: vscode.Uri): readonly EntityInfo[] {
		return this.entitiesByUri.get(uri.toString()) ?? [];
	}

	public getRepositoriesForEntity(entityName: string): readonly RepositoryInfo[] {
		const result: RepositoryInfo[] = [];
		const search = entityName.toLowerCase();
		for (const repos of this.repositoriesByUri.values()) {
			for (const r of repos) {
				if (r.managedEntityNames.some((m) => m.toLowerCase() === search)) {
					result.push(r);
				}
			}
		}
		return result;
	}

	public getAllRepositories(): readonly RepositoryInfo[] {
		return [...this.repositoriesByUri.values()].flat();
	}

	public getRepositoryUris(): readonly vscode.Uri[] {
		const uris = new Map<string, vscode.Uri>();
		for (const repos of this.repositoriesByUri.values()) {
			for (const r of repos) {
				uris.set(r.uri.toString(), r.uri);
			}
		}
		return [...uris.values()];
	}

	public async getCandidateDocuments(): Promise<vscode.TextDocument[]> {
		const openDocsByUri = new Map<string, vscode.TextDocument>();
		for (const doc of vscode.workspace.textDocuments) {
			if (doc.languageId === 'java') {
				openDocsByUri.set(doc.uri.toString(), doc);
			}
		}

		const targetUris = new Map<string, vscode.Uri>();
		for (const repo of this.getAllRepositories()) {
			targetUris.set(repo.uri.toString(), repo.uri);
		}
		for (const [uriStr, doc] of openDocsByUri) {
			targetUris.set(uriStr, doc.uri);
		}

		const docs: vscode.TextDocument[] = [];
		for (const [uriStr, uri] of targetUris) {
			const openDoc = openDocsByUri.get(uriStr);
			if (openDoc) {
				docs.push(openDoc);
			} else {
				try {
					const doc = await vscode.workspace.openTextDocument(uri);
					docs.push(doc);
				} catch {
					// ignore
				}
			}
		}
		return docs;
	}

	private async scanWorkspace(): Promise<void> {
		try {
			const includeTestSources = this.includeTestSources();
			const excluded = includeTestSources
				? '**/{node_modules,target,build,out,.gradle,.vscode-test,.git,.idea,.settings,.vscode,bin,dist}/**'
				: '**/{node_modules,target,build,out,.gradle,.vscode-test,.git,.idea,.settings,.vscode,bin,dist,src/test}/**';
			const files = await vscode.workspace.findFiles('**/*.java', excluded);
			let lastYield = Date.now();
			for (const uri of files) {
				try {
					if (isExcludedJavaUri(uri, includeTestSources)) {
						continue;
					}
					const contents = await vscode.workspace.fs.readFile(uri);
					const text = Buffer.from(contents).toString('utf8');
					const uriKey = uri.toString();
					const fingerprint = sourceFingerprint(text);
					this.sourceFingerprints.set(uriKey, fingerprint);
					const projectionTypes: ProjectionTypeInfo[] = [];
					const entities = parseEntityModels(text, uri, projectionTypes);
					this.projectionTypesByUri.set(uriKey, projectionTypes);
					if (entities.length > 0) {
						this.entitiesByUri.set(uriKey, entities);
					}
					const repos = extractRepositoryInfos(text, uri);
					if (repos.length > 0) {
						this.repositoriesByUri.set(uriKey, repos);
					}
				} catch {
					// ignore
				}
				if (Date.now() - lastYield >= 15) {
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
					lastYield = Date.now();
				}
			}
		} finally {
			this.rebuildNameIndex();
			this.isInitialized = true;
		}
	}

	private includeTestSources(): boolean {
		return typeof vscode.workspace.getConfiguration !== 'undefined'
			? vscode.workspace.getConfiguration('springJpa').get<boolean>('includeTestSources', true)
			: true;
	}

	private rebuildNameIndex(): void {
		this.entitiesByName.clear();
		for (const entities of this.entitiesByUri.values()) {
			for (const entity of entities) {
				const key = entity.name.toLowerCase();
				this.entitiesByName.set(key, [...(this.entitiesByName.get(key) ?? []), entity]);
			}
		}
	}
}

export function parseEntity(text: string, uri: vscode.Uri): EntityInfo | undefined {
	return parseEntityModels(text, uri)[0];
}

export function extractRepositoryEntityNames(text: string): string[] {
	return [...text.matchAll(REPOSITORY_ENTITY)].map((match) => match[1]);
}

export function extractRepositoryInfos(text: string, uri: vscode.Uri): RepositoryInfo[] {
	const repos: RepositoryInfo[] = [];
	const masked = maskJavaSource(text);
	const repoRegex = /\binterface\s+([A-Za-z_$]\w*)\s*(?:<[^>]*>)?\s*extends\s+([^{]+)\{/g;
	let match: RegExpExecArray | null;
	while ((match = repoRegex.exec(masked)) !== null) {
		const repoName = match[1];
		const extendsClause = match[2];
		const managedEntities = extractRepositoryEntityNames(extendsClause);
		if (managedEntities.length > 0) {
			repos.push({
				uri,
				name: repoName,
				managedEntityNames: [...new Set(managedEntities)],
			});
		}
	}
	if (repos.length === 0 && (/@(?:Query|NativeQuery)\b/.test(masked) || /\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|Repository|RevisionRepository)\b/.test(masked))) {
		const typeMatch = masked.match(/\b(?:interface|class)\s+([A-Za-z_$]\w*)/);
		const managedEntities = extractRepositoryEntityNames(text);
		if (typeMatch || managedEntities.length > 0) {
			repos.push({
				uri,
				name: typeMatch ? typeMatch[1] : 'SpringRepository',
				managedEntityNames: [...new Set(managedEntities)],
			});
		}
	}
	return repos;
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
		const qualifiedName = entity.packageName ? `${entity.packageName}.${entity.name}` : entity.name;
		lookup.set(qualifiedName.toLowerCase(), entity);
		const priority = imports.get(entity.name.toLowerCase())?.toLowerCase() === qualifiedName.toLowerCase()
			? 3
			: preferredPackage && entity.packageName === preferredPackage
				? 2
				: 1;
		for (const name of new Set([entity.name, entity.entityName].filter((candidate): candidate is string => Boolean(candidate)))) {
			const key = name.toLowerCase();
			if ((priorities.get(key) ?? 0) < priority) {
				lookup.set(key, entity);
				priorities.set(key, priority);
			}
		}
	}
	return lookup;
}

export async function discoverEntities(currentDocument: vscode.TextDocument): Promise<readonly EntityInfo[]> {
	const index = WorkspaceEntityIndex.getInstance();
	const includeTestSources = typeof vscode.workspace.getConfiguration !== 'undefined'
		? vscode.workspace.getConfiguration('springJpa').get<boolean>('includeTestSources', true)
		: true;
	if (isExcludedJavaUri(currentDocument.uri, includeTestSources)) {
		return [];
	}
	await index.ensureInitialized();
	return getIndexedEntities(currentDocument);
}

export function getIndexedEntities(currentDocument: vscode.TextDocument): readonly EntityInfo[] {
	const index = WorkspaceEntityIndex.getInstance();
	const includeTestSources = typeof vscode.workspace.getConfiguration !== 'undefined'
		? vscode.workspace.getConfiguration('springJpa').get<boolean>('includeTestSources', true)
		: true;
	if (isExcludedJavaUri(currentDocument.uri, includeTestSources)) {
		return [];
	}
	const currentEntities = index.getEntitiesForUri(currentDocument.uri);
	const all = index.getAllEntities();
	if (currentEntities.length === 0) {
		return all;
	}
	const otherEntities = all.filter((e) => e.uri.toString() !== currentDocument.uri.toString());
	return [...currentEntities, ...otherEntities];
}

export function clearEntityCache(): void {
	WorkspaceEntityIndex.getInstance().clear();
}

export function parseEntities(text: string, uri: vscode.Uri): EntityInfo[] {
	return parseEntityModels(text, uri);
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

export const COMMON_NON_ENTITY_TYPES = new Set([
	'string', 'long', 'integer', 'int', 'boolean', 'double', 'float', 'byte', 'short', 'char', 'character',
	'bigdecimal', 'biginteger', 'uuid', 'date', 'localdate', 'localdatetime', 'localtime', 'instant',
	'zoneddatetime', 'offsetdatetime', 'duration', 'list', 'set', 'collection', 'iterable', 'map',
	'optional', 'page', 'slice', 'stream', 'void', 'object',
	'arraylist', 'hashset', 'treeset', 'linkedhashset', 'linkedlist', 'vector',
]);

export function findEntityByName(entitiesByName: ReadonlyMap<string, EntityInfo>, name: string): EntityInfo | undefined {
	const key = name.toLowerCase();
	if (COMMON_NON_ENTITY_TYPES.has(key)) {
		return undefined;
	}
	const direct = entitiesByName.get(key);
	if (direct) {
		return direct;
	}
	return entitiesByName.get(name);
}

export function referencedEntityNames(type: string): string[] {
	return [...type.matchAll(/\b[A-Z]\w*\b/g)]
		.map((match) => match[0])
		.filter((name) => !COMMON_NON_ENTITY_TYPES.has(name.toLowerCase()));
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

function capitalize(value: string): string {
	return value[0].toUpperCase() + value.slice(1);
}