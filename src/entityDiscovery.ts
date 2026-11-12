import * as vscode from 'vscode';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { EntityInfo, EntityProperty, parseEntityModels, ProjectionTypeInfo, PropertyLocation } from './entityModel';
import { extractRepositoryEntityNames, extractRepositoryInfos, RepositoryInfo } from './repositoryIndex';
import { isSameModule, isSameOrSharedModule } from './workspace/moduleResolver';

export { EntityInfo, EntityProperty, ProjectionTypeInfo, PropertyLocation, RepositoryInfo };
export { extractRepositoryEntityNames, extractRepositoryInfos } from './repositoryIndex';

export interface StorageMemento {
	get<T>(key: string): T | undefined;
	update(key: string, value: any): Thenable<void>;
}

const CACHE_STORAGE_KEY = 'springJpa.workspaceEntityCache';
const CACHE_VERSION = 4;

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

interface WorkerSource {
	readonly uri: string;
	readonly revision: number;
	readonly text: string;
	readonly force?: boolean;
}

interface WorkerIndexedFile {
	readonly uri: string;
	readonly revision: number;
	readonly fingerprint: string;
	readonly unchanged?: boolean;
	readonly entities?: readonly EntityInfo<string>[];
	readonly projectionTypes?: readonly ProjectionTypeInfo<string>[];
	readonly repositories?: readonly RepositoryInfo<string>[];
}

interface WorkerResponse {
	readonly id: number;
	readonly results?: readonly WorkerIndexedFile[];
	readonly error?: string;
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
		name: proj.name,
		packageName: proj.packageName,
		kind: proj.kind,
		uri: proj.uri.toString(),
		properties: proj.properties ? [...proj.properties] : undefined,
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
	const uri = typeof item.uri === 'string' ? vscode.Uri.parse(item.uri) : item.uri;
	return {
		name: item.name,
		packageName: item.packageName,
		kind: item.kind,
		uri,
		properties: item.properties ? [...item.properties] : [],
	};
}

const PACKAGE_DECLARATION = /\bpackage\s+([\w.]+)\s*;/;
const REPOSITORY_ENTITY = /\b(?:JpaRepository|MongoRepository|ReactiveMongoRepository|ReactiveCrudRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor|Repository|RevisionRepository)\s*<\s*([A-Z]\w*)/g;
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
		if (prev.name !== curr.name || prev.entityName !== curr.entityName || prev.tableName !== curr.tableName
			|| prev.packageName !== curr.packageName || prev.isEntity !== curr.isEntity
			|| prev.hasEntityAnnotation !== curr.hasEntityAnnotation || prev.isMongoDocument !== curr.isMongoDocument
			|| prev.isFinal !== curr.isFinal || prev.isProjection !== curr.isProjection
			|| prev.superclassName !== curr.superclassName || prev.isMappedSuperclass !== curr.isMappedSuperclass
			|| prev.isEmbeddable !== curr.isEmbeddable
			|| prev.location?.line !== curr.location?.line
			|| prev.location?.character !== curr.location?.character
			|| prev.location?.length !== curr.location?.length) {
			return true;
		}
		if (prev.properties.length !== curr.properties.length) {
			return true;
		}
		for (let j = 0; j < curr.properties.length; j++) {
			const p1 = prev.properties[j];
			const p2 = curr.properties[j];
			if (p1.name !== p2.name || p1.type !== p2.type || p1.isId !== p2.isId
				|| p1.isTransient !== p2.isTransient || p1.relation !== p2.relation
				|| p1.targetEntity !== p2.targetEntity || p1.mappedBy !== p2.mappedBy
				|| p1.fetchType !== p2.fetchType || p1.columnName !== p2.columnName
				|| p1.mongoFieldName !== p2.mongoFieldName || p1.isCollection !== p2.isCollection
				|| p1.location?.line !== p2.location?.line
				|| p1.location?.character !== p2.location?.character
				|| p1.location?.length !== p2.location?.length) {
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
	private entityNameKeysByUri = new Map<string, ReadonlySet<string>>();
	private sourceFingerprints = new Map<string, string>();
	private fileStats = new Map<string, { mtime: number; size: number }>();
	private allEntitiesCache: readonly EntityInfo[] | undefined;
	private projectionTypesCache: readonly ProjectionTypeInfo[] | undefined;
	private lastUpdateStructuralChange = true;
	private isInitialized = false;
	private initPromise: Promise<void> | undefined;
	private storage: StorageMemento | undefined;
	private persistTimer: ReturnType<typeof setTimeout> | undefined;
	private worker: Worker | undefined;
	private workerRequestId = 0;
	private revisionCounter = 0;
	private indexGeneration = 0;
	private documentRevisions = new Map<string, number>();
	private pendingWorkerRequests = new Map<number, {
		resolve: (results: readonly WorkerIndexedFile[]) => void;
		reject: (error: Error) => void;
	}>();

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
		const initialization = this.initPromise;
		try {
			await initialization;
		} catch (error) {
			if (this.initPromise === initialization) {
				this.initPromise = undefined;
			}
			throw error;
		}
	}

	public didLastUpdateCauseStructuralChange(): boolean {
		return this.lastUpdateStructuralChange;
	}

	public clear(clearDisk = false): void {
		this.indexGeneration++;
		this.entitiesByUri.clear();
		this.projectionTypesByUri.clear();
		this.repositoriesByUri.clear();
		this.entitiesByName.clear();
		this.entityNameKeysByUri.clear();
		this.sourceFingerprints.clear();
		this.fileStats.clear();
		this.allEntitiesCache = undefined;
		this.projectionTypesCache = undefined;
		this.documentRevisions.clear();
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
		let serializedFileCount = 0;
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
			if (++serializedFileCount % 4 === 0) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
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

	public disposeWorker(): void {
		const worker = this.worker;
		this.worker = undefined;
		if (worker) {
			void worker.terminate();
		}
		for (const pending of this.pendingWorkerRequests.values()) {
			pending.reject(new Error('Entity index worker was stopped.'));
		}
		this.pendingWorkerRequests.clear();
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

	public updateDocument(document: vscode.TextDocument, persist = false): EntityInfo | undefined {
		if (document.languageId !== 'java' || isExcludedJavaUri(document.uri, this.includeTestSources())) {
			this.lastUpdateStructuralChange = false;
			return undefined;
		}
		const uriKey = document.uri.toString();
		this.documentRevisions.set(uriKey, ++this.revisionCounter);
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

		if (entitiesChanged) {
			this.updateNameIndex(uriKey, entities);
			this.allEntitiesCache = undefined;
		}
		this.projectionTypesCache = undefined;
		if (persist) {
			this.schedulePersistCache();
		}
		return entities[0];
	}

	public async updateDocumentAsync(document: vscode.TextDocument, persist = false): Promise<boolean> {
		if (document.languageId !== 'java' || isExcludedJavaUri(document.uri, this.includeTestSources())) {
			return false;
		}
		const uriKey = document.uri.toString();
		const revision = ++this.revisionCounter;
		const generation = this.indexGeneration;
		this.documentRevisions.set(uriKey, revision);
		const text = document.getText();
		const [result] = await this.parseInBackground([{
			uri: uriKey,
			text,
			revision,
			force: !this.sourceFingerprints.has(uriKey),
		}]);
		if (generation !== this.indexGeneration || this.documentRevisions.get(uriKey) !== revision || result.unchanged) {
			return false;
		}
		return this.applyWorkerResult(result, document.uri, persist);
	}

	public removeUri(uri: vscode.Uri): void {
		const uriKey = uri.toString();
		this.documentRevisions.set(uriKey, ++this.revisionCounter);
		const hadEntities = this.entitiesByUri.has(uriKey);
		const hadRepos = this.repositoriesByUri.has(uriKey);
		this.entitiesByUri.delete(uriKey);
		this.projectionTypesByUri.delete(uriKey);
		this.repositoriesByUri.delete(uriKey);
		this.sourceFingerprints.delete(uriKey);
		this.fileStats.delete(uriKey);
		this.lastUpdateStructuralChange = hadEntities || hadRepos;
		this.updateNameIndex(uriKey, []);
		this.allEntitiesCache = undefined;
		this.projectionTypesCache = undefined;
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
		if (!this.allEntitiesCache) {
			this.allEntitiesCache = [...this.entitiesByUri.values()].flat();
		}
		return this.allEntitiesCache;
	}

	public getAllProjectionTypes(): readonly ProjectionTypeInfo[] {
		if (this.projectionTypesCache) {
			return this.projectionTypesCache;
		}
		const uniqueTypes = new Map<string, ProjectionTypeInfo>();
		for (const type of [...this.projectionTypesByUri.values()].flat()) {
			const qualifiedName = type.packageName ? `${type.packageName}.${type.name}` : type.name;
			if (!uniqueTypes.has(qualifiedName)) {
				uniqueTypes.set(qualifiedName, type);
			}
		}
		this.projectionTypesCache = [...uniqueTypes.values()];
		return this.projectionTypesCache;
	}

	public getEntitiesForUri(uri: vscode.Uri): readonly EntityInfo[] {
		return this.entitiesByUri.get(uri.toString()) ?? [];
	}

	public getEntitiesForDocument(documentOrUri: vscode.TextDocument | vscode.Uri): readonly EntityInfo[] {
		const contextUri = 'uri' in documentOrUri ? documentOrUri.uri : documentOrUri;
		const currentEntities = this.getEntitiesForUri(contextUri);
		const all = this.getAllEntities();
		if (all.length === 0) {
			return currentEntities;
		}

		// Rank entities by module proximity to contextUri:
		// Priority 4: Exact same file
		// Priority 3: Same module
		// Priority 2: Shared / common module
		// Priority 1: Unrelated module (only kept if name doesn't collide with higher priority)
		const highestPriorityByName = new Map<string, number>();
		const scoredEntities: { entity: EntityInfo; priority: number }[] = [];

		for (const entity of all) {
			const isCurrentFile = entity.uri.toString() === contextUri.toString();
			const sameMod = !isCurrentFile && isSameModule(entity.uri, contextUri);
			const sharedMod = !isCurrentFile && !sameMod && isSameOrSharedModule(entity.uri, contextUri);
			const priority = isCurrentFile ? 4 : sameMod ? 3 : sharedMod ? 2 : 1;

			const nameKey = entity.name.toLowerCase();
			const currentHighest = highestPriorityByName.get(nameKey) ?? 0;
			if (priority > currentHighest) {
				highestPriorityByName.set(nameKey, priority);
			}
			scoredEntities.push({ entity, priority });
		}

		scoredEntities.sort((a, b) => b.priority - a.priority);
		const filtered: EntityInfo[] = [];
		const seenUriEntity = new Set<string>();

		for (const { entity, priority } of scoredEntities) {
			const nameKey = entity.name.toLowerCase();
			const highest = highestPriorityByName.get(nameKey) ?? 1;
			if (priority < highest && priority === 1) {
				continue;
			}
			const key = `${entity.uri.toString()}:${entity.name}`;
			if (!seenUriEntity.has(key)) {
				seenUriEntity.add(key);
				filtered.push(entity);
			}
		}

		return filtered;
	}

	public getProjectionTypesForDocument(documentOrUri: vscode.TextDocument | vscode.Uri): readonly ProjectionTypeInfo[] {
		const contextUri = 'uri' in documentOrUri ? documentOrUri.uri : documentOrUri;
		const all = this.getAllProjectionTypes();
		if (all.length === 0) {
			return all;
		}

		const highestPriorityByName = new Map<string, number>();
		const scoredTypes: { type: ProjectionTypeInfo; priority: number }[] = [];

		for (const type of all) {
			const isCurrentFile = type.uri ? type.uri.toString() === contextUri.toString() : false;
			const sameMod = type.uri ? !isCurrentFile && isSameModule(type.uri, contextUri) : true;
			const sharedMod = type.uri ? !isCurrentFile && !sameMod && isSameOrSharedModule(type.uri, contextUri) : false;
			const priority = isCurrentFile ? 4 : sameMod ? 3 : sharedMod ? 2 : 1;

			const nameKey = type.name.toLowerCase();
			const currentHighest = highestPriorityByName.get(nameKey) ?? 0;
			if (priority > currentHighest) {
				highestPriorityByName.set(nameKey, priority);
			}
			scoredTypes.push({ type, priority });
		}

		scoredTypes.sort((a, b) => b.priority - a.priority);
		const filtered: ProjectionTypeInfo[] = [];
		const seenNames = new Set<string>();

		for (const { type, priority } of scoredTypes) {
			const nameKey = type.name.toLowerCase();
			const highest = highestPriorityByName.get(nameKey) ?? 1;
			if (priority < highest && priority === 1) {
				continue;
			}
			const qualifiedName = type.packageName ? `${type.packageName}.${type.name}` : type.name;
			if (!seenNames.has(qualifiedName)) {
				seenNames.add(qualifiedName);
				filtered.push(type);
			}
		}

		return filtered;
	}

	public getRepositoriesForEntity(entityName: string, contextUri?: vscode.Uri): readonly RepositoryInfo[] {
		const result: RepositoryInfo[] = [];
		const search = entityName.toLowerCase();
		for (const repos of this.repositoriesByUri.values()) {
			for (const r of repos) {
				if (r.managedEntityNames.some((m) => m.toLowerCase() === search)) {
					result.push(r);
				}
			}
		}
		if (!contextUri || result.length <= 1) {
			return result;
		}
		const sameModuleRepos = result.filter((r) => isSameModule(r.uri, contextUri));
		if (sameModuleRepos.length > 0) {
			return sameModuleRepos;
		}
		const sharedModuleRepos = result.filter((r) => isSameOrSharedModule(r.uri, contextUri));
		if (sharedModuleRepos.length > 0) {
			return sharedModuleRepos;
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
		let completed = false;
		try {
			const generation = this.indexGeneration;
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

			const BATCH_SIZE = 16;
			for (let i = 0; i < files.length; i += BATCH_SIZE) {
				const batch = files.slice(i, i + BATCH_SIZE);
				const sources: WorkerSource[] = [];
				await Promise.all(batch.map(async (uri) => {
					try {
						if (isExcludedJavaUri(uri, includeTestSources)) {
							return;
						}
						const uriKey = uri.toString();
						const revision = this.documentRevisions.get(uriKey) ?? 0;
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
							this.applyCachedFile(uriKey, cached, stat, generation, revision);
							return;
						}

						const contents = await vscode.workspace.fs.readFile(uri);
						const text = Buffer.from(contents).toString('utf8');

						if (stat) {
							this.fileStats.set(uriKey, stat);
						}

						if (generation === this.indexGeneration && revision === (this.documentRevisions.get(uriKey) ?? 0)) {
							sources.push({
								uri: uriKey,
								text,
								revision,
								force: !this.sourceFingerprints.has(uriKey),
							});
						}
					} catch {
						// ignore
					}
				}));
				if (generation === this.indexGeneration && sources.length > 0) {
					const results = await this.parseInBackground(sources);
					for (const result of results) {
						if (result.revision !== (this.documentRevisions.get(result.uri) ?? 0)) {
							continue;
						}
						this.applyWorkerResult(result, vscode.Uri.parse(result.uri));
					}
				}
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
			completed = true;
		} finally {
			this.isInitialized = completed;
			if (completed) {
				void this.persistCache();
			}
		}
	}

	private includeTestSources(): boolean {
		return typeof vscode.workspace.getConfiguration !== 'undefined'
			? vscode.workspace.getConfiguration('springJpa').get<boolean>('includeTestSources', true)
			: true;
	}

	private updateNameIndex(uriKey: string, entities: readonly EntityInfo[]): void {
		for (const key of this.entityNameKeysByUri.get(uriKey) ?? []) {
			const remaining = (this.entitiesByName.get(key) ?? []).filter((entity) => entity.uri.toString() !== uriKey);
			if (remaining.length > 0) {
				this.entitiesByName.set(key, remaining);
			} else {
				this.entitiesByName.delete(key);
			}
		}
		const keys = new Set<string>();
		for (const entity of entities) {
			const key = entity.name.toLowerCase();
			keys.add(key);
			this.entitiesByName.set(key, [...(this.entitiesByName.get(key) ?? []), entity]);
		}
		if (keys.size > 0) {
			this.entityNameKeysByUri.set(uriKey, keys);
		} else {
			this.entityNameKeysByUri.delete(uriKey);
		}
	}

	private applyCachedFile(
		uriKey: string,
		cached: CachedFileEntry,
		stat: { mtime: number; size: number } | undefined,
		generation: number,
		revision: number,
	): void {
		if (generation !== this.indexGeneration || revision !== (this.documentRevisions.get(uriKey) ?? 0)) {
			return;
		}
		this.sourceFingerprints.set(uriKey, cached.fingerprint);
		if (stat) {
			this.fileStats.set(uriKey, stat);
		}
		if (cached.entities?.length > 0) {
			this.entitiesByUri.set(uriKey, cached.entities.map(rehydrateEntity));
		} else {
			this.entitiesByUri.delete(uriKey);
		}
		if (cached.projectionTypes?.length > 0) {
			this.projectionTypesByUri.set(uriKey, cached.projectionTypes.map(rehydrateProjection));
		} else {
			this.projectionTypesByUri.delete(uriKey);
		}
		if (cached.repositories?.length > 0) {
			this.repositoriesByUri.set(uriKey, cached.repositories.map(rehydrateRepository));
		} else {
			this.repositoriesByUri.delete(uriKey);
		}
		this.updateNameIndex(uriKey, this.entitiesByUri.get(uriKey) ?? []);
		this.allEntitiesCache = undefined;
		this.projectionTypesCache = undefined;
	}

	private async parseInBackground(sources: readonly WorkerSource[]): Promise<readonly WorkerIndexedFile[]> {
		if (sources.length === 0) {
			return [];
		}
		const worker = this.getWorker();
		const id = ++this.workerRequestId;
		worker.ref();
		return new Promise<readonly WorkerIndexedFile[]>((resolve, reject) => {
			this.pendingWorkerRequests.set(id, { resolve, reject });
			try {
				worker.postMessage({ id, sources });
			} catch (error) {
				this.pendingWorkerRequests.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private getWorker(): Worker {
		if (this.worker) {
			return this.worker;
		}
		const worker = new Worker(join(__dirname, 'entityIndexWorker.js'));
		worker.on('message', (response: WorkerResponse) => {
			const pending = this.pendingWorkerRequests.get(response.id);
			if (!pending) {
				return;
			}
			this.pendingWorkerRequests.delete(response.id);
			if (response.error) {
				pending.reject(new Error(`Entity index worker failed: ${response.error}`));
			} else {
				pending.resolve(response.results ?? []);
			}
			if (this.pendingWorkerRequests.size === 0) {
				worker.unref();
			}
		});
		worker.on('error', (error) => this.failWorker(worker, error));
		worker.on('exit', (code) => {
			if (this.worker !== worker) {
				return;
			}
			this.worker = undefined;
			if (code !== 0 || this.pendingWorkerRequests.size > 0) {
				this.rejectPendingWorkerRequests(new Error(`Entity index worker exited unexpectedly (code ${code}).`));
			}
		});
		this.worker = worker;
		worker.unref();
		return worker;
	}

	private failWorker(worker: Worker, error: Error): void {
		if (this.worker === worker) {
			this.worker = undefined;
		}
		this.rejectPendingWorkerRequests(error);
	}

	private rejectPendingWorkerRequests(error: Error): void {
		for (const pending of this.pendingWorkerRequests.values()) {
			pending.reject(error);
		}
		this.pendingWorkerRequests.clear();
	}

	private applyWorkerResult(result: WorkerIndexedFile, uri: vscode.Uri, persist = false): boolean {
		if (result.unchanged) {
			return false;
		}
		const uriKey = uri.toString();
		const previousEntities = this.entitiesByUri.get(uriKey);
		const previousRepos = this.repositoriesByUri.get(uriKey);
		const entities = (result.entities ?? []).map((entity) => ({ ...entity, uri }));
		const projectionTypes = (result.projectionTypes ?? []).map((projection) => ({ ...projection, uri }));
		const repositories = (result.repositories ?? []).map((repository) => ({ ...repository, uri }));
		this.sourceFingerprints.set(uriKey, result.fingerprint);
		this.projectionTypesByUri.set(uriKey, projectionTypes);
		if (entities.length > 0) {
			this.entitiesByUri.set(uriKey, entities);
		} else {
			this.entitiesByUri.delete(uriKey);
		}
		if (repositories.length > 0) {
			this.repositoriesByUri.set(uriKey, repositories);
		} else {
			this.repositoriesByUri.delete(uriKey);
		}
		const entitiesChanged = haveEntitiesChanged(previousEntities, entities);
		const reposChanged = haveRepositoriesChanged(previousRepos, repositories);
		this.lastUpdateStructuralChange = entitiesChanged || reposChanged;
		if (entitiesChanged) {
			this.updateNameIndex(uriKey, entities);
			this.allEntitiesCache = undefined;
		}
		this.projectionTypesCache = undefined;
		if (persist) {
			this.schedulePersistCache();
		}
		return entitiesChanged || reposChanged;
	}
}

export function parseEntity(text: string, uri: vscode.Uri): EntityInfo | undefined {
	return parseEntityModels(text, uri)[0];
}

let lastRepoText: string | undefined;
let lastRepoMatches: { offset: number; entityName: string }[] = [];

export function extractRepositoryEntityNameAt(text: string, offset: number): string | undefined {
	if (lastRepoText !== text) {
		lastRepoText = text;
		lastRepoMatches = [];
		for (const match of text.matchAll(REPOSITORY_ENTITY)) {
			lastRepoMatches.push({ offset: match.index ?? 0, entityName: match[1] });
		}
	}
	let selected: string | undefined;
	for (const match of lastRepoMatches) {
		if (match.offset > offset) {
			break;
		}
		selected = match.entityName;
	}
	return selected;
}

export function createEntityLookup(
	entities: readonly EntityInfo[],
	preferredPackage?: string,
	sourceText?: string,
	contextUri?: vscode.Uri,
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
		const isImported = imports.get(entity.name.toLowerCase())?.toLowerCase() === qualifiedName.toLowerCase();
		const sameMod = contextUri ? isSameModule(entity.uri, contextUri) : true;
		const sharedMod = contextUri ? isSameOrSharedModule(entity.uri, contextUri) : true;
		const priority = isImported
			? 5
			: preferredPackage && entity.packageName === preferredPackage && sameMod
				? 4
				: sameMod
					? 3
					: sharedMod
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
	return index.getEntitiesForDocument(currentDocument);
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
	contextUri?: vscode.Uri,
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
	const entitiesByName = createEntityLookup(entities, repositoryPackage, repositoryText, contextUri);

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
	depth = 0,
): void {
	if (ancestors.has(entity.name) || depth > 2) {
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
				addEntityProperties(resolvedReferenced, camelName, nextAncestors, properties, entitiesByName, depth + 1);
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