import * as vscode from 'vscode';
import { createEntityLookup, WorkspaceEntityIndex } from '../entityDiscovery';

export class SpringJpaCodeLensProvider implements vscode.CodeLensProvider {
	public async provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
		if (document.languageId !== 'java') {
			return [];
		}
		if (typeof vscode.workspace.getConfiguration !== 'undefined' && !vscode.workspace.getConfiguration('springJpa').get<boolean>('enableCodeLens', true)) {
			return [];
		}
		const index = WorkspaceEntityIndex.getInstance();
		await index.ensureInitialized();
		const docText = document.getText();
		const allEntities = index.getAllEntities();
		const repositoryPackage = docText.match(/\bpackage\s+([\w.]+)\s*;/)?.[1];
		const entityLookup = createEntityLookup(allEntities, repositoryPackage, docText);
		const lenses: vscode.CodeLens[] = [];

		// 1. CodeLens on Repository interfaces: Link to Managed Entity
		const repositoryMatch = docText.match(/\b(?:JpaRepository|MongoRepository|ReactiveMongoRepository|CrudRepository|ReactiveCrudRepository|ListCrudRepository|PagingAndSortingRepository|Repository|RevisionRepository)\s*<\s*([A-Z]\w*)/);
		if (repositoryMatch && repositoryMatch.index !== undefined) {
			const entity = entityLookup.get(repositoryMatch[1].toLowerCase());
			if (entity) {
				const start = document.positionAt(repositoryMatch.index);
				const range = new vscode.Range(start, document.positionAt(repositoryMatch.index + repositoryMatch[0].length));
				lenses.push(new vscode.CodeLens(range, {
					command: 'springJpa.openEntity',
					title: `Spring Data: Managed ${entity.isMongoDocument ? 'Document' : 'Entity'} '${entity.name}' (${entity.properties.length} properties)`,
					arguments: [entity.uri],
				}));
			}
		}

		// 2. CodeLens on Entity classes: Link to Repositories
		const currentEntities = index.getEntitiesForUri(document.uri);
		for (const entity of currentEntities) {
			if ((!entity.isEntity && !entity.isMongoDocument) || !entity.location) {
				continue;
			}
			const entityPos = new vscode.Position(entity.location.line, entity.location.character);
			const entityRange = new vscode.Range(entityPos, new vscode.Position(entity.location.line, entity.location.character + entity.name.length));

			// Find repositories in index or open workspace documents that manage this entity
			const indexedRepos = index.getRepositoriesForEntity(entity.name);

			for (const repo of indexedRepos) {
				if (repo.uri.toString() === document.uri.toString()) {
					continue;
				}
				lenses.push(new vscode.CodeLens(entityRange, {
					command: 'springJpa.openRepository',
					title: `Spring Data: ${repo.name}`,
					arguments: [repo.uri],
				}));
			}
		}

		return lenses;
	}
}
