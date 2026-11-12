import * as vscode from 'vscode';

export interface ModuleInfo {
	readonly id: string;
	readonly name: string;
	readonly rootPath: string;
	readonly rootUri?: vscode.Uri;
	readonly buildSystem: 'maven' | 'gradle' | 'generic';
	readonly isShared: boolean;
	readonly isRootWrapper?: boolean;
}

const SHARED_NAME_PATTERN = /(?:^|[._-])(?:common|core|shared|domain|lib|util|utils|kernel|model|models|entity|entities|dto)(?:[._-]|$)/i;
const BUILD_FILE_EXCLUDES = '**/{node_modules,target,build,out,.gradle,.vscode-test,.git,.idea,.settings,.vscode,bin,dist}/**';

export function normalizePath(input: string | vscode.Uri): string {
	let pathStr = typeof input === 'string' ? input : ((input as any).fsPath ?? input.path ?? '');
	if (pathStr.startsWith('file:///')) {
		pathStr = pathStr.slice(7);
	} else if (pathStr.startsWith('file://')) {
		pathStr = pathStr.slice(7);
	}
	pathStr = pathStr.replace(/\\/g, '/');
	if (/^\/[a-zA-Z]:\//.test(pathStr)) {
		pathStr = pathStr.slice(1);
	}
	if (pathStr.length > 1 && pathStr.endsWith('/')) {
		pathStr = pathStr.slice(0, -1);
	}
	return pathStr;
}

const directoryModuleCache = new Map<string, ModuleInfo>();
const registeredModules = new Map<string, ModuleInfo>();

export function clearModuleCache(): void {
	directoryModuleCache.clear();
	registeredModules.clear();
}

export function registerModuleRoot(
	root: string | vscode.Uri,
	options?: {
		name?: string;
		isShared?: boolean;
		buildSystem?: 'maven' | 'gradle' | 'generic';
		isRootWrapper?: boolean;
	},
): ModuleInfo {
	const rootPath = normalizePath(root);
	const name = options?.name || rootPath.split('/').filter(Boolean).pop() || 'root';
	const isShared = options?.isShared ?? SHARED_NAME_PATTERN.test(name);
	const buildSystem = options?.buildSystem ?? 'generic';
	const rootUri = typeof root === 'object' && 'path' in root ? root : vscode.Uri.file(rootPath);
	const moduleInfo: ModuleInfo = {
		id: rootPath.toLowerCase(),
		name,
		rootPath,
		rootUri,
		buildSystem,
		isShared,
		isRootWrapper: options?.isRootWrapper,
	};
	registeredModules.set(rootPath.toLowerCase(), moduleInfo);
	directoryModuleCache.clear();
	return moduleInfo;
}

export async function discoverWorkspaceModules(): Promise<readonly ModuleInfo[]> {
	if (typeof vscode.workspace?.findFiles !== 'function') {
		return [...registeredModules.values()];
	}
	try {
		const buildFiles = await vscode.workspace.findFiles(
			'**/{pom.xml,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts}',
			BUILD_FILE_EXCLUDES,
			200,
		);
		for (const file of buildFiles) {
			const normalized = normalizePath(file);
			const lastSlash = normalized.lastIndexOf('/');
			if (lastSlash === -1) {
				continue;
			}
			const dirPath = normalized.slice(0, lastSlash);
			const fileName = normalized.slice(lastSlash + 1);
			const buildSystem = fileName.startsWith('pom.xml')
				? 'maven'
				: fileName.includes('gradle')
					? 'gradle'
					: 'generic';
			const isRootWrapper = fileName.startsWith('settings.gradle');
			registerModuleRoot(dirPath, { buildSystem, isRootWrapper });
		}
	} catch {
		// ignore
	}
	return [...registeredModules.values()];
}

export function resolveModuleInfo(uriOrPath: vscode.Uri | string): ModuleInfo {
	const filePath = normalizePath(uriOrPath);
	const lastSlash = filePath.lastIndexOf('/');
	const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '/';
	const dirKey = dir.toLowerCase();

	const cached = directoryModuleCache.get(dirKey);
	if (cached) {
		return cached;
	}

	// 1. Check if matches any registered/discovered module root (longest prefix match)
	let bestMatch: ModuleInfo | undefined;
	for (const [modPathKey, info] of registeredModules) {
		if (filePath.toLowerCase().startsWith(modPathKey + '/') || filePath.toLowerCase() === modPathKey) {
			if (!bestMatch || info.rootPath.length > bestMatch.rootPath.length) {
				bestMatch = info;
			}
		}
	}
	if (bestMatch) {
		directoryModuleCache.set(dirKey, bestMatch);
		return bestMatch;
	}

	// 2. Standard Java source root heuristic: e.g. <module>/src/main/java or <module>/src/
	const srcIndex = filePath.indexOf('/src/');
	if (srcIndex > 0) {
		const rootPath = filePath.slice(0, srcIndex);
		const name = rootPath.split('/').filter(Boolean).pop() || 'root';
		const isShared = SHARED_NAME_PATTERN.test(name);
		const moduleInfo: ModuleInfo = {
			id: rootPath.toLowerCase(),
			name,
			rootPath,
			buildSystem: 'generic',
			isShared,
		};
		directoryModuleCache.set(dirKey, moduleInfo);
		return moduleInfo;
	}

	// 3. Fallback: parent directory or root
	const name = dir.split('/').filter(Boolean).pop() || 'root';
	const isShared = SHARED_NAME_PATTERN.test(name);
	const moduleInfo: ModuleInfo = {
		id: dir.toLowerCase(),
		name,
		rootPath: dir,
		buildSystem: 'generic',
		isShared,
	};
	directoryModuleCache.set(dirKey, moduleInfo);
	return moduleInfo;
}

export function isSameModule(uriA: vscode.Uri | string, uriB: vscode.Uri | string): boolean {
	const modA = resolveModuleInfo(uriA);
	const modB = resolveModuleInfo(uriB);
	return modA.id === modB.id;
}

export function isSameOrSharedModule(targetUri: vscode.Uri | string, contextUri: vscode.Uri | string): boolean {
	const targetMod = resolveModuleInfo(targetUri);
	const contextMod = resolveModuleInfo(contextUri);
	return targetMod.id === contextMod.id || targetMod.isShared;
}
