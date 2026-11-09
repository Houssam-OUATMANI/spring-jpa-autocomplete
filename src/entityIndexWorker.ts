import { parentPort } from 'node:worker_threads';
import { parseEntityModels } from './entityModel';
import type { EntityInfo, ProjectionTypeInfo } from './entityModel';
import { extractRepositoryInfos } from './repositoryIndex';
import type { RepositoryInfo } from './repositoryIndex';

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

interface WorkerRequest {
	readonly id: number;
	readonly sources: readonly WorkerSource[];
}

interface WorkerResponse {
	readonly id: number;
	readonly results?: readonly WorkerIndexedFile[];
	readonly error?: string;
}

const port = parentPort;
if (!port) {
	throw new Error('Entity index worker must run in a worker thread.');
}

const cachedFingerprints = new Map<string, string>();

port.on('message', (request: WorkerRequest) => {
	try {
		const results = request.sources.map((source) => {
			const fingerprint = sourceFingerprint(source.text);
			if (!source.force && cachedFingerprints.get(source.uri) === fingerprint) {
				return {
					uri: source.uri,
					revision: source.revision,
					fingerprint,
					unchanged: true,
				};
			}

			const projectionTypes: ProjectionTypeInfo<string>[] = [];
			const entities = parseEntityModels(source.text, source.uri, projectionTypes);
			const repositories = extractRepositoryInfos(source.text, source.uri);
			const result: WorkerIndexedFile = {
				uri: source.uri,
				revision: source.revision,
				fingerprint,
				entities,
				projectionTypes,
				repositories,
			};
			cachedFingerprints.set(source.uri, fingerprint);
			return result;
		});
		const response: WorkerResponse = { id: request.id, results };
		port.postMessage(response);
	} catch (error) {
		const response: WorkerResponse = {
			id: request.id,
			error: error instanceof Error ? error.message : String(error),
		};
		port.postMessage(response);
	}
});

function sourceFingerprint(text: string): string {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++) {
		hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
	}
	return `${text.length}:${hash >>> 0}`;
}
