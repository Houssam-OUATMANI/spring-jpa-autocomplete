import * as vscode from 'vscode';
import { normalizePath, resolveModuleInfo } from '../workspace/moduleResolver';

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

const DIALECT_FILES = '**/{application*,bootstrap*,persistence.xml,hibernate.properties}';
const DIALECT_FILES_EXCLUDE = '**/{target,build,out,.gradle,.vscode-test,node_modules}/**';
const DIALECT_EXTENSIONS = new Set(['.properties', '.yml', '.yaml', '.xml']);
const DETECTION_CACHE_MS = 15_000;
const detectionCache = new Map<string, { expiresAt: number; result: Promise<SqlDialect | undefined>; resolved?: SqlDialect }>();
const documentDialectOverrides = new Map<string, SqlDialectSetting>();

export function clearDialectCache(moduleId?: string): void {
	if (moduleId) {
		detectionCache.delete(moduleId.toLowerCase());
	} else {
		detectionCache.clear();
	}
}

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

export function isDialectConfigFile(filePath: string): boolean {
	const lastSlash = filePath.lastIndexOf('/');
	const fileName = (lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath).toLowerCase();
	const dotIndex = fileName.lastIndexOf('.');
	if (dotIndex === -1) {
		return false;
	}
	const ext = fileName.slice(dotIndex);
	if (!DIALECT_EXTENSIONS.has(ext)) {
		return false;
	}
	return fileName.startsWith('application')
		|| fileName.startsWith('bootstrap')
		|| fileName === 'persistence.xml'
		|| fileName === 'hibernate.properties';
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

	const jdbcVendor = combined.match(/(?:jdbc|r2dbc):(postgresql|mysql|mariadb|sqlserver|oracle|h2):/)?.[1];
	if (jdbcVendor) {
		return dialectFromName(jdbcVendor);
	}

	const driverMatch = combined.match(/(?:driver-class-name|driverclassname|driver)\s*[:=]\s*([^\s,]+)/)?.[1];
	if (driverMatch) {
		const dialect = dialectFromName(driverMatch);
		if (dialect) {
			return dialect;
		}
	}

	return undefined;
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

	const moduleInfo = resolveModuleInfo(document.uri);
	const cacheKey = moduleInfo.id || 'default';
	const cached = detectionCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		if (!waitForDetection) {
			return 'resolved' in cached ? cached.resolved ?? 'generic' : 'generic';
		}
		return (await cached.result) ?? 'generic';
	}

	const result = detectModuleOrWorkspaceDialect(moduleInfo, document);
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
	const lower = name.toLowerCase();
	if (/postgres|pgsql/.test(lower)) { return 'postgresql'; }
	if (/mariadb/.test(lower)) { return 'mariadb'; }
	if (/mysql/.test(lower)) { return 'mysql'; }
	if (/sqlserver|sql_server|mssql/.test(lower)) { return 'sqlserver'; }
	if (/oracle/.test(lower)) { return 'oracle'; }
	if (/\bh2\b/.test(lower)) { return 'h2'; }
	if (/\bgeneric\b/.test(lower)) { return 'generic'; }
	return undefined;
}

async function detectModuleOrWorkspaceDialect(moduleInfo: ReturnType<typeof resolveModuleInfo>, document: vscode.TextDocument): Promise<SqlDialect | undefined> {
	try {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder?.(document.uri);
		const pattern = workspaceFolder ? new vscode.RelativePattern(workspaceFolder, DIALECT_FILES) : DIALECT_FILES;
		const files = await vscode.workspace.findFiles(pattern, DIALECT_FILES_EXCLUDE, 100);

		const validFiles = files.filter((f) => isDialectConfigFile(normalizePath(f)));
		if (validFiles.length === 0) {
			return undefined;
		}

		// Priority 1: Configuration files located inside the document's microservice / module
		const modulePrefix = moduleInfo.rootPath.toLowerCase() + '/';
		const moduleFiles = validFiles.filter((f) => normalizePath(f).toLowerCase().startsWith(modulePrefix));
		const candidateFiles = moduleFiles.length > 0 ? moduleFiles : validFiles;

		const contents = await Promise.all(candidateFiles.map(async (uri) => (await vscode.workspace.openTextDocument(uri)).getText()));
		return detectSqlDialect(contents);
	} catch {
		return undefined;
	}
}