import * as vscode from 'vscode';
import { createEntityLookup, WorkspaceEntityIndex } from '../entityDiscovery';

export class SpringJpaCodeLensProvider implements vscode.CodeLensProvider {
	public async provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
		if (document.languageId !== 'java') {
			return [];
		}
		if (!vscode.workspace.getConfiguration('springJpa').get<boolean>('enableCodeLens', true)) {
			return [];
		}
		const repositoryMatch = document.getText().match(/\b(?:JpaRepository|CrudRepository|ListCrudRepository|PagingAndSortingRepository)\s*<\s*([A-Z]\w*)/);
		if (!repositoryMatch || repositoryMatch.index === undefined) {
			return [];
		}
		const index = WorkspaceEntityIndex.getInstance();
		await index.ensureInitialized();
		const repositoryText = document.getText();
		const repositoryPackage = repositoryText.match(/\bpackage\s+([\w.]+)\s*;/)?.[1];
		const entities = createEntityLookup(index.getAllEntities(), repositoryPackage, repositoryText);
		const entity = entities.get(repositoryMatch[1].toLowerCase());
		if (!entity) {
			return [];
		}
		const start = document.positionAt(repositoryMatch.index);
		const range = new vscode.Range(start, document.positionAt(repositoryMatch.index + repositoryMatch[0].length));
		const lens = new vscode.CodeLens(range, {
			command: 'springJpa.rebuildIndex',
			title: `Spring JPA: ${entity.name} (${entity.properties.length} properties)`,
		});
		return [lens];
	}
}
