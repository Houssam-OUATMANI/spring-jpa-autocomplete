import * as vscode from 'vscode';
import { extractPropertyNames } from './jpaKeywords';

export interface EntityInfo {
	readonly name: string;
	readonly properties: readonly string[];
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
	): readonly string[] {
	const names = extractRepositoryEntityNames(repositoryText);
	const selected = names.length > 0
		? entities.filter((entity) => names.includes(entity.name))
		: entities;

	return [...new Set(selected.flatMap((entity) => entity.properties))].sort();
}