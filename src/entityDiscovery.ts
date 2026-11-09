import * as vscode from 'vscode';
import { EntityInfo, EntityProperty, parseEntityModels, ProjectionTypeInfo, PropertyLocation } from './entityModel';
import { maskJavaSource } from './javaParsing';

export { EntityInfo, EntityProperty, ProjectionTypeInfo, PropertyLocation };

export interface RepositoryInfo {
	readonly uri: vscode.Uri;
	readonly name: string;
	readonly managedEntityNames: readonly string[];
}

export interface StorageMemento {
	get<T>(key: string): T | undefined;
	update(key: string, value: any): Thenable<void>;
}

const CACHE_STORAGE_KEY = 'springJpa.workspaceEntityCache';
const CACHE_VERSION = 3;

interface SerializedEntityInfo extends Omit<EntityInfo, 'uri'> {
	uri: string;
}
interface SerializedRepositoryInfo extends Omit<RepositoryInfo, 'uri'> {
	uri: string;
}
interface SerializedProjectionTypeInfo extends Omit<ProjectionTypeInfo, 'uri'> {
	uri: string;
}
interface CachedFileEntry {
	fingerprint: string;
	mtime?: number;
	size?: number;
	entities: readonly SerializedEntityInfo[];
	projectionTypes: readonly SerializedProjectionTypeInfo[];
	repositories: readonly SerializedRepositoryInfo[];
}
interface WorkspaceCacheData {
	version: number;
	files: Record<string, CachedFileEntry>;
}

function serializeEntity(entity: EntityInfo): SerializedEntityInfo {
	return {
		...entity,
		uri: entity.uri.toString(),
	};
}

function serializeRepository(repo: RepositoryInfo): SerializedRepositoryInfo {
	return {
		...repo,
		uri: repo.uri.toString(),
	};
}

function serializeProjection(proj: ProjectionTypeInfo): SerializedProjectionTypeInfo {
	return {
		...proj,
		uri: proj.uri.toString(),
	};
}

function rehydrateEntity(item: SerializedEntityInfo): EntityInfo {
	return {
		...item,
		uri: typeof item.uri === 'string' ? vscode.Uri.parse(item.uri) : item.uri,
	};
}

function rehydrateRepository(item: SerializedRepositoryInfo): RepositoryInfo {
	return {
		...item,
		uri: typeof item.uri === 'string' ? vscode.Uri.parse(item.uri) : item.uri,
	};
}

function rehydrateProjection(item: SerializedProjectionTypeInfo): ProjectionTypeInfo {
	return {
		...item,
		uri: typeof item.uri === 'string' ? vscode.Uri.parse(item.uri) : item.uri,
	};
}

const REPOSITORY_ENTITY = /\b(?:JpaRepository|MongoRepository|ReactiveMongoRepository|ReactiveCrudRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor|Repository|RevisionRepository)\s*<\s*([A-Z]\w*)/g;
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

function haveEntitiesChanged(
	previous: readonly EntityInfo[] | undefined,
	current: readonly EntityInfo[],
): boolean {
	if (!previous && current.length === 0) {
		return false;
	}
	if (!previous || previous.length !== current.length) {
		return true;
	}
	for (let i = 0; i < current.length; i++) {
		const prev = previous[i];
		const curr = current[i];
		if (prev.name !== curr.name || prev.entityName !== curr.entityName || prev.packageName !== curr.packageName || prev.isMongoDocument !== curr.isMongoDocument) {
			return true;
		}
		if (prev.properties.length !== curr.properties.length) {
			return true;
		}
		for (let j = 0; j < curr.properties.length; j++) {
			const p1 = prev.properties[j];
			const p2 = curr.properties[j];
			if (p1.name !== p2.name || p1.type !== p2.type || p1.relation !== p2.relation || p1.targetEntity !== p2.targetEntity || p1.mongoFieldName !== p2.mongoFieldName) {
				return true;
			}
		}
	}
	return false;
}

function haveRepositoriesChanged(
	previous: readonly RepositoryInfo[] | undefined,
	current: readonly RepositoryInfo[],
): boolean {
	if (!previous && current.length === 0) {
		return false;
	}
	if (!previous || previous.length !== current.length) {
		return true;
	}
	for (let i = 0; i < current.length; i++) {
		const prev = previous[i];
		const curr = current[i];
		if (prev.name !== curr.name) {
			return true;
		}
		if (prev.managedEntityNames.length !== curr.managedEntityNames.length) {
			return true;
		}
		for (let j = 0; j < curr.managedEntityNames.length; j++) {
			if (prev.managedEntityNames[j] !== curr.managedEntityNames[j]) {
				return true;
			}
		}
	}
	return false;
}

export class WorkspaceEntityIndex {
	private static instance: WorkspaceEntityIndex | undefined;
	private entitiesByUri = new Map<string, readonly EntityInfo[]>();
	private projectionTypesByUri = new Map<string, readonly ProjectionTypeInfo[]>();
	private repositoriesByUri = new Map<string, readonly RepositoryInfo[]>();
	private entitiesByName = new Map<string, EntityInfo[]>();
	private sourceFingerprints = new Map<string, string>();
	private fileStats = new Map<string, { mtime: number; size: number }>();
	private lastUpdateStructuralChange = true;
	private isInitialized = false;
	private initPromise: Promise<void> | undefined;
	private storage: StorageMemento | undefined;
	private persistTimer: ReturnType<typeof setTimeout> | undefined;

	public static getInstance(): WorkspaceEntityIndex {
		if (!WorkspaceEntityIndex.instance) {
			WorkspaceEntityIndex.instance = new WorkspaceEntityIndex();
		}
		return WorkspaceEntityIndex.instance;
	}

	public setStorage(storage: StorageMemento | undefined): void {
		this.storage = storage;
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

	public didLastUpdateCauseStructuralChange(): boolean {
		return this.lastUpdateStructuralChange;
	}

	public clear(clearDisk = false): void {
		this.entitiesByUri.clear();
		this.projectionTypesByUri.clear();
		this.repositoriesByUri.clear();
		this.entitiesByName.clear();
		this.sourceFingerprints.clear();
		this.fileStats.clear();
		this.lastUpdateStructuralChange = true;
		this.isInitialized = false;
		this.initPromise = undefined;
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = undefined;
		}
		if (clearDisk && this.storage) {
			void this.storage.update(CACHE_STORAGE_KEY, undefined);
		}
	}

	public async persistCache(): Promise<void> {
		if (!this.storage) {
			return;
		}
		const files: Record<string, CachedFileEntry> = {};
		for (const [uriKey, fingerprint] of this.sourceFingerprints) {
			const entities = this.entitiesByUri.get(uriKey) ?? [];
			const projectionTypes = this.projectionTypesByUri.get(uriKey) ?? [];
			const repositories = this.repositoriesByUri.get(uriKey) ?? [];
			const stat = this.fileStats.get(uriKey);
			files[uriKey] = {
				fingerprint,
				...(stat ? { mtime: stat.mtime, size: stat.size } : {}),
				entities: entities.map(serializeEntity),
				projectionTypes: projectionTypes.map(serializeProjection),
				repositories: repositories.map(serializeRepository),
			};
		}
		const cache: WorkspaceCacheData = {
			version: CACHE_VERSION,
			files,
		};
		try {
			await this.storage.update(CACHE_STORAGE_KEY, cache);
		} catch {
			// ignore storage errors
		}
	}

	public schedulePersistCache(debounceMs = 1500): void {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
		}
		this.persistTimer = setTimeout(() => {
			this.persistTimer = undefined;
			void this.persistCache();
		}, debounceMs);
	}

	public updateDocument(document: vscode.TextDocument): EntityInfo | undefined {
		if (document.languageId !== 'java' || isExcludedJavaUri(document.uri, this.includeTestSources())) {
			this.lastUpdateStructuralChange = false;
			return undefined;
		}
		const uriKey = document.uri.toString();
		const text = document.getText();
		const fingerprint = sourceFingerprint(text);
		if (this.sourceFingerprints.get(uriKey) === fingerprint) {
			this.lastUpdateStructuralChange = false;
			return this.entitiesByUri.get(uriKey)?.[0];
		}
		const previousEntities = this.entitiesByUri.get(uriKey);
		const previousRepos = this.repositoriesByUri.get(uriKey);
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

		const entitiesChanged = haveEntitiesChanged(previousEntities, entities);
		const reposChanged = haveRepositoriesChanged(previousRepos, repos);
		this.lastUpdateStructuralChange = entitiesChanged || reposChanged;

		if (previousEntities || entities.length > 0) {
			this.rebuildNameIndex();
		}
		this.schedulePersistCache();
		return entities[0];
	}

	public removeUri(uri: vscode.Uri): void {
		const uriKey = uri.toString();
		const hadEntities = this.entitiesByUri.has(uriKey);
		const hadRepos = this.repositoriesByUri.has(uriKey);
		this.entitiesByUri.delete(uriKey);
		this.projectionTypesByUri.delete(uriKey);
		this.repositoriesByUri.delete(uriKey);
		this.sourceFingerprints.delete(uriKey);
		this.fileStats.delete(uriKey);
		this.lastUpdateStructuralChange = hadEntities || hadRepos;
		this.rebuildNameIndex();
		this.schedulePersistCache();
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

			let cachedFiles: Record<string, CachedFileEntry> | undefined;
			try {
				const cachedData = this.storage?.get<WorkspaceCacheData>(CACHE_STORAGE_KEY);
				if (cachedData && cachedData.version === CACHE_VERSION && cachedData.files) {
					cachedFiles = cachedData.files;
				}
			} catch {
				cachedFiles = undefined;
			}

			let lastYield = Date.now();
			for (const uri of files) {
				try {
					if (isExcludedJavaUri(uri, includeTestSources)) {
						continue;
					}
					const uriKey = uri.toString();
					const cached = cachedFiles?.[uriKey];

					// FAST PATH: Check file stat (mtime + size) without reading file content from disk
					let stat: { mtime: number; size: number } | undefined;
					try {
						if (vscode.workspace.fs?.stat) {
							const fileStat = await vscode.workspace.fs.stat(uri);
							stat = { mtime: fileStat.mtime, size: fileStat.size };
						}
					} catch {
						stat = undefined;
					}

					if (cached && stat && cached.mtime !== undefined && cached.size !== undefined
						&& cached.mtime === stat.mtime && cached.size === stat.size) {
						this.sourceFingerprints.set(uriKey, cached.fingerprint);
						this.fileStats.set(uriKey, stat);
						if (cached.entities?.length > 0) {
							this.entitiesByUri.set(uriKey, cached.entities.map(rehydrateEntity));
						}
						if (cached.projectionTypes?.length > 0) {
							this.projectionTypesByUri.set(uriKey, cached.projectionTypes.map(rehydrateProjection));
						}
						if (cached.repositories?.length > 0) {
							this.repositoriesByUri.set(uriKey, cached.repositories.map(rehydrateRepository));
						}
						continue;
					}

					// SLOW PATH: Read file from disk
					const contents = await vscode.workspace.fs.readFile(uri);
					const text = Buffer.from(contents).toString('utf8');
					const fingerprint = sourceFingerprint(text);

					if (stat) {
						this.fileStats.set(uriKey, stat);
					}

					if (cached && cached.fingerprint === fingerprint) {
						this.sourceFingerprints.set(uriKey, fingerprint);
						if (cached.entities?.length > 0) {
							this.entitiesByUri.set(uriKey, cached.entities.map(rehydrateEntity));
						}
						if (cached.projectionTypes?.length > 0) {
							this.projectionTypesByUri.set(uriKey, cached.projectionTypes.map(rehydrateProjection));
						}
						if (cached.repositories?.length > 0) {
							this.repositoriesByUri.set(uriKey, cached.repositories.map(rehydrateRepository));
						}
						continue;
					}

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
			void this.persistCache();
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
	if (repos.length === 0 && (/@(?:Query|NativeQuery|Aggregation)\b/.test(masked) || /\b(?:JpaRepository|MongoRepository|ReactiveMongoRepository|ReactiveCrudRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|Repository|RevisionRepository)\b/.test(masked))) {
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
			mongoFieldName: property.mongoFieldName,
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
				mongoFieldName: property.mongoFieldName,
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

export function resolveDerivedPropertyPath(
	entityName: string,
	derivedPropertyName: string,
	entities: readonly EntityInfo[],
): string | undefined {
	const entityLookup = createEntityLookup(entities);
	const rootEntity = entityLookup.get(entityName.toLowerCase());
	if (!rootEntity) {
		return undefined;
	}

	if (derivedPropertyName.includes('_')) {
		const path: string[] = [];
		let currentEntity = rootEntity;
		const segments = derivedPropertyName.split('_');
		for (let index = 0; index < segments.length; index++) {
			const propertyName = uncapitalize(segments[index]);
			const current = resolveEntityHierarchy(currentEntity, entityLookup);
			const property = current.properties.find((candidate) => candidate.name.toLowerCase() === propertyName.toLowerCase());
			if (!property) {
				return undefined;
			}
			path.push(property.name);
			if (index < segments.length - 1) {
				const nextEntity = resolvePropertyEntity(property, entityLookup);
				if (!nextEntity) {
					return undefined;
				}
				currentEntity = nextEntity;
			}
		}
		return path.join('.');
	}

	const resolveCamelPath = (entity: EntityInfo, remaining: string, ancestors: ReadonlySet<string>): string | undefined => {
		const current = resolveEntityHierarchy(entity, entityLookup);
		const direct = current.properties.find((property) => capitalize(property.name) === remaining);
		if (direct) {
			return direct.name;
		}

		for (const property of current.properties) {
			const prefix = capitalize(property.name);
			if (!remaining.startsWith(prefix) || remaining.length === prefix.length) {
				continue;
			}
			const nextEntity = resolvePropertyEntity(property, entityLookup);
			if (!nextEntity) {
				continue;
			}
			const entityKey = `${nextEntity.uri.toString()}:${nextEntity.name}`;
			if (ancestors.has(entityKey)) {
				continue;
			}
			const nestedPath = resolveCamelPath(nextEntity, remaining.slice(prefix.length), new Set(ancestors).add(entityKey));
			if (nestedPath) {
				return `${property.name}.${nestedPath}`;
			}
		}
		return undefined;
	};

	const rootKey = `${rootEntity.uri.toString()}:${rootEntity.name}`;
	return resolveCamelPath(rootEntity, derivedPropertyName, new Set([rootKey]));
}

function resolvePropertyEntity(
	property: EntityProperty,
	entitiesByName: ReadonlyMap<string, EntityInfo>,
): EntityInfo | undefined {
	if (property.targetEntity) {
		const target = findEntityByName(entitiesByName, property.targetEntity);
		if (target) {
			return target;
		}
	}
	const referencedName = referencedEntityNames(property.type)
		.find((name) => findEntityByName(entitiesByName, name));
	return referencedName ? findEntityByName(entitiesByName, referencedName) : undefined;
}

function capitalize(value: string): string {
	return value[0].toUpperCase() + value.slice(1);
}

function uncapitalize(value: string): string {
	return value.length > 0 ? value[0].toLowerCase() + value.slice(1) : value;
}