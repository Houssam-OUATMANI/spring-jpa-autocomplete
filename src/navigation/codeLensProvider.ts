import * as vscode from 'vscode';
import { createEntityLookup, extractRepositoryEntityNames, WorkspaceEntityIndex } from '../entityDiscovery';

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
		const repositoryMatch = docText.match(/\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository|Repository|RevisionRepository)\s*<\s*([A-Z]\w*)/);
		if (repositoryMatch && repositoryMatch.index !== undefined) {
			const entity = entityLookup.get(repositoryMatch[1].toLowerCase());
			if (entity) {
				const start = document.positionAt(repositoryMatch.index);
				const range = new vscode.Range(start, document.positionAt(repositoryMatch.index + repositoryMatch[0].length));
				lenses.push(new vscode.CodeLens(range, {
					command: 'springJpa.openEntity',
					title: `Spring Data: Managed Entity '${entity.name}' (${entity.properties.length} properties)`,
					arguments: [entity.uri],
				}));
			}
		}

		// 2. CodeLens on Entity classes: Link to Repositories
		const currentEntities = index.getEntitiesForUri(document.uri);
		for (const entity of currentEntities) {
			if (!entity.isEntity || !entity.location) {
				continue;
			}
			const entityPos = new vscode.Position(entity.location.line, entity.location.character);
			const entityRange = new vscode.Range(entityPos, new vscode.Position(entity.location.line, entity.location.character + entity.name.length));

			// Find repositories in index or open workspace documents that manage this entity
			const indexedRepos = index.getRepositoriesForEntity(entity.name);
			const seenUris = new Set<string>();

			for (const repo of indexedRepos) {
				if (repo.uri.toString() === document.uri.toString()) {
					continue;
				}
				seenUris.add(repo.uri.toString());
				lenses.push(new vscode.CodeLens(entityRange, {
					command: 'springJpa.openRepository',
					title: `Spring Data: ${repo.name}`,
					arguments: [repo.uri],
				}));
			}

			for (const otherDoc of vscode.workspace.textDocuments) {
				if (otherDoc.uri.toString() === document.uri.toString() || otherDoc.languageId !== 'java' || seenUris.has(otherDoc.uri.toString())) {
					continue;
				}
				const otherText = otherDoc.getText();
				const managedEntities = extractRepositoryEntityNames(otherText);
				if (managedEntities.some((name) => name.toLowerCase() === entity.name.toLowerCase())) {
					const repoNameMatch = otherText.match(/\binterface\s+([A-Z]\w*Repository)\b/);
					const repoTitle = repoNameMatch ? repoNameMatch[1] : 'Spring Data Repository';
					lenses.push(new vscode.CodeLens(entityRange, {
						command: 'springJpa.openRepository',
						title: `Spring Data: ${repoTitle}`,
						arguments: [otherDoc.uri],
					}));
				}
			}
		}

		return lenses;
	}
}
