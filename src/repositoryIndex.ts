import type * as vscode from 'vscode';
import { maskJavaSource } from './javaParsing';

export interface RepositoryInfo<TUri = vscode.Uri> {
	readonly uri: TUri;
	readonly name: string;
	readonly managedEntityNames: readonly string[];
}

const REPOSITORY_ENTITY = /\b(?:JpaRepository|MongoRepository|ReactiveMongoRepository|ReactiveCrudRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor|Repository|RevisionRepository)\s*<\s*([A-Z]\w*)/g;
const REPO_FILE_PATTERN = /\b(?:JpaRepository|MongoRepository|ReactiveMongoRepository|ReactiveCrudRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|Repository|RevisionRepository)\b|@(Query|NativeQuery|Aggregation)\b/;

export function extractRepositoryEntityNames(text: string): string[] {
	return [...text.matchAll(REPOSITORY_ENTITY)].map((match) => match[1]);
}

export function extractRepositoryInfos<TUri>(text: string, uri: TUri): RepositoryInfo<TUri>[] {
	if (!REPO_FILE_PATTERN.test(text)) {
		return [];
	}
	const repos: RepositoryInfo<TUri>[] = [];
	const masked = maskJavaSource(text);
	const repoRegex = /\binterface\s+([A-Za-z_$]\w*)\s*(?:<[^>]*>)?\s*extends\s+([^{]+)\{/g;
	let match: RegExpExecArray | null;
	while ((match = repoRegex.exec(masked)) !== null) {
		const repoName = match[1];
		const managedEntities = extractRepositoryEntityNames(match[2]);
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
