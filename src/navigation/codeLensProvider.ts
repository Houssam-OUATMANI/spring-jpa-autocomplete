import * as vscode from 'vscode';
import { WorkspaceEntityIndex } from '../entityDiscovery';

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
		const entity = index.getAllEntities().find((candidate) => candidate.name === repositoryMatch[1]);
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
