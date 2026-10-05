import * as vscode from 'vscode';

export const SQL_DIALECT_OPTIONS = [
	{ label: 'Auto-detect', value: 'auto' },
	{ label: 'Generic SQL', value: 'generic' },
	{ label: 'PostgreSQL', value: 'postgresql' },
	{ label: 'MySQL', value: 'mysql' },
	{ label: 'MariaDB', value: 'mariadb' },
	{ label: 'SQL Server', value: 'sqlserver' },
	{ label: 'Oracle', value: 'oracle' },
	{ label: 'H2', value: 'h2' },
] as const;

export type SqlDialectSetting = typeof SQL_DIALECT_OPTIONS[number]['value'];
export type SqlDialect = Exclude<SqlDialectSetting, 'auto'>;

const DIALECT_FILES = '**/{application.properties,application.yml,application.yaml,persistence.xml,hibernate.properties}';
const DIALECT_FILES_EXCLUDE = '**/{target,build,out,.gradle,.vscode-test,node_modules}/**';
const DETECTION_CACHE_MS = 10_000;
const detectionCache = new Map<string, { expiresAt: number; result: Promise<SqlDialect | undefined>; resolved?: SqlDialect }>();
const documentDialectOverrides = new Map<string, SqlDialectSetting>();

export function setDocumentSqlDialect(document: vscode.TextDocument, dialect: SqlDialectSetting | undefined): void {
	if (!dialect || dialect === 'auto') {
		documentDialectOverrides.delete(document.uri.toString());
		return;
	}
	documentDialectOverrides.set(document.uri.toString(), dialect);
}

export function clearDocumentSqlDialect(document: vscode.TextDocument): void {
	documentDialectOverrides.delete(document.uri.toString());
}

export function detectSqlDialect(contents: readonly string[]): SqlDialect | undefined {
	const combined = contents.join('\n').toLowerCase();
	const explicitDialect = combined.match(/(?:spring\.jpa\.database-platform|spring\.jpa\.properties\.hibernate\.dialect|hibernate\.dialect|database-platform|dialect)\s*[:=]\s*([^\s,]+)/)?.[1];
	if (explicitDialect) {
		const dialect = dialectFromName(explicitDialect);
		if (dialect) {
			return dialect;
		}
	}

	const jdbcVendor = combined.match(/jdbc:(postgresql|mysql|mariadb|sqlserver|oracle|h2):/)?.[1];
	return jdbcVendor ? dialectFromName(jdbcVendor) : undefined;
}

export async function resolveSqlDialect(document: vscode.TextDocument, waitForDetection = true): Promise<SqlDialect> {
	const documentOverride = documentDialectOverrides.get(document.uri.toString());
	if (documentOverride && documentOverride !== 'auto') {
		return documentOverride;
	}

	const configured = vscode.workspace.getConfiguration('springJpa').get<SqlDialectSetting>('sqlDialect', 'auto');
	if (configured !== 'auto') {
		return configured;
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
	if (!workspaceFolder) {
		return 'generic';
	}

	const cacheKey = workspaceFolder.uri.toString();
	const cached = detectionCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		if (!waitForDetection) {
			return 'resolved' in cached ? cached.resolved ?? 'generic' : 'generic';
		}
		return (await cached.result) ?? 'generic';
	}

	const result = detectWorkspaceDialect(workspaceFolder);
	const entry: { expiresAt: number; result: Promise<SqlDialect | undefined>; resolved?: SqlDialect } = {
		expiresAt: Date.now() + DETECTION_CACHE_MS,
		result,
	};
	detectionCache.set(cacheKey, entry);
	if (!waitForDetection) {
		void result.then((dialect) => {
			entry.resolved = dialect ?? 'generic';
		});
		return 'generic';
	}
	return (await result) ?? 'generic';
}

function dialectFromName(name: string): SqlDialect | undefined {
	if (/postgres|pgsql/.test(name)) return 'postgresql';
	if (/mariadb/.test(name)) return 'mariadb';
	if (/mysql/.test(name)) return 'mysql';
	if (/sqlserver|sql_server|mssql/.test(name)) return 'sqlserver';
	if (/oracle/.test(name)) return 'oracle';
	if (/\bh2\b/.test(name)) return 'h2';
	if (/\bgeneric\b/.test(name)) return 'generic';
	return undefined;
}

async function detectWorkspaceDialect(folder: vscode.WorkspaceFolder): Promise<SqlDialect | undefined> {
	try {
		const files = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, DIALECT_FILES),
			DIALECT_FILES_EXCLUDE,
			100,
		);
		const contents = await Promise.all(files.map(async (uri) => (await vscode.workspace.openTextDocument(uri)).getText()));
		return detectSqlDialect(contents);
	} catch {
		return undefined;
	}
}