import * as vscode from 'vscode';
import { EntityInfo } from '../entityModel';
import { createEntityLookup, extractRepositoryEntityNameAt, resolveEntityHierarchy, resolveEntityPropertyPath } from '../entityDiscovery';
import { findClosestProperty } from '../propertySuggestions';
import { maskJavaSource } from '../javaParsing';

export interface EntityGraphDiagnosticInfo {
	readonly message: string;
	readonly severity: 'error' | 'warning';
	readonly startOffset: number;
	readonly endOffset: number;
	readonly code: 'UNKNOWN_ATTRIBUTE_PATH';
	readonly suggestedProperty?: string;
}

export function createEntityGraphCompletions(
	document: vscode.TextDocument,
	position: vscode.Position,
	knownEntities: readonly EntityInfo[],
): vscode.CompletionItem[] | undefined {
	const docText = document.getText();
	const offset = document.offsetAt(position);
	const lineText = document.lineAt(position.line).text;
	const prefixToCursor = lineText.slice(0, position.character);

	const windowText = docText.slice(Math.max(0, offset - 500), offset);
	if (!/@EntityGraph\b[\s\S]*?\battributePaths\s*=\s*(?:\{[^}]*|"[^"]*)?$/.test(windowText)) {
		return undefined;
	}

	const stringMatch = prefixToCursor.match(/"([^"]*)$/);
	if (!stringMatch) {
		return undefined;
	}

	const typedPath = stringMatch[1];
	const repoEntityName = extractRepositoryEntityNameAt(docText, offset);
	if (!repoEntityName) {
		return undefined;
	}

	const entityMap = createEntityLookup(knownEntities, undefined, docText);
	const rootEntity = entityMap.get(repoEntityName.toLowerCase());
	if (!rootEntity) {
		return undefined;
	}

	let targetEntity = rootEntity;
	let segmentPrefix = typedPath;
	const dotIndex = typedPath.lastIndexOf('.');

	if (dotIndex >= 0) {
		const parentPath = typedPath.slice(0, dotIndex);
		segmentPrefix = typedPath.slice(dotIndex + 1);
		const parentProp = resolveEntityPropertyPath(rootEntity, parentPath, entityMap);
		if (!parentProp) {
			return undefined;
		}
		const targetName = parentProp.targetEntity ?? parentProp.type.replace(/^.*<([\w$]+)>.*$/, '$1');
		const resolvedTarget = entityMap.get(targetName.toLowerCase());
		if (!resolvedTarget) {
			return undefined;
		}
		targetEntity = resolvedTarget;
	}

	const resolvedHierarchy = resolveEntityHierarchy(targetEntity, entityMap);
	const startPos = new vscode.Position(position.line, position.character - segmentPrefix.length);
	const replaceRange = new vscode.Range(startPos, position);

	const items: vscode.CompletionItem[] = [];
	for (const prop of resolvedHierarchy.properties) {
		if (segmentPrefix.length === 0 || prop.name.toLowerCase().startsWith(segmentPrefix.toLowerCase())) {
			const item = new vscode.CompletionItem(prop.name, prop.relation ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.Property);
			item.detail = prop.relation
				? `Entity relation: ${prop.relation} (${prop.type})`
				: `Property: ${prop.type}`;
			item.range = replaceRange;
			item.sortText = prop.relation ? `0_${prop.name}` : `1_${prop.name}`;
			items.push(item);
		}
	}

	return items;
}

export function validateEntityGraphs(
	docText: string,
	knownEntities: readonly EntityInfo[],
): EntityGraphDiagnosticInfo[] {
	const diagnostics: EntityGraphDiagnosticInfo[] = [];
	const masked = maskJavaSource(docText);
	const entityGraphRegex = /@EntityGraph\s*\(([\s\S]*?)\)/g;

	let match: RegExpExecArray | null;
	while ((match = entityGraphRegex.exec(masked)) !== null) {
		const annotationStartOffset = match.index;
		// Use the original (unmasked) docText at the same offset so string literals are preserved
		const originalAnnotationContent = docText.slice(annotationStartOffset, annotationStartOffset + match[0].length);
		const annotationContent = originalAnnotationContent.replace(/^@EntityGraph\s*\(/, '').replace(/\)$/, '');
		const repoEntityName = extractRepositoryEntityNameAt(docText, annotationStartOffset + match[0].length);
		if (!repoEntityName) {
			continue;
		}

		const entityMap = createEntityLookup(knownEntities, undefined, docText);
		const rootEntity = entityMap.get(repoEntityName.toLowerCase());
		if (!rootEntity) {
			continue;
		}

		const attrMatch = annotationContent.match(/\battributePaths\s*=\s*(?:\{([\s\S]*?)\}|"([^"]*)")/);
		if (!attrMatch) {
			continue;
		}

		const attrBlock = attrMatch[1] ?? attrMatch[2];
		// Compute the offset of attrBlock inside the *original* annotation text
		const attrBlockLocalOffset = originalAnnotationContent.indexOf(attrBlock);
		const attrBlockOffset = annotationStartOffset + (attrBlockLocalOffset >= 0 ? attrBlockLocalOffset : 0);

		const stringRegex = /"([^"]+)"/g;
		let strMatch: RegExpExecArray | null;
		while ((strMatch = stringRegex.exec(attrBlock)) !== null) {
			const fullPath = strMatch[1];
			const pathOffset = attrBlockOffset + strMatch.index + 1;
			const pathEndOffset = pathOffset + fullPath.length;

			const resolvedProp = resolveEntityPropertyPath(rootEntity, fullPath, entityMap);
			if (!resolvedProp) {
				const segments = fullPath.split('.');
				const parentPath = segments.slice(0, -1).join('.');
				const invalidSegment = segments[segments.length - 1];

				let candidateProps: string[] = [];
				if (parentPath.length > 0) {
					const parentProp = resolveEntityPropertyPath(rootEntity, parentPath, entityMap);
					const targetName = parentProp?.targetEntity ?? parentProp?.type.replace(/^.*<([\w$]+)>.*$/, '$1');
					const targetEntity = targetName ? entityMap.get(targetName.toLowerCase()) : undefined;
					if (targetEntity) {
						candidateProps = resolveEntityHierarchy(targetEntity, entityMap).properties.map((p) => p.name);
					}
				} else {
					candidateProps = resolveEntityHierarchy(rootEntity, entityMap).properties.map((p) => p.name);
				}

				const suggestion = findClosestProperty(invalidSegment, candidateProps);
				const suggestedFullPath = suggestion
					? (parentPath.length > 0 ? `${parentPath}.${suggestion}` : suggestion)
					: undefined;

				diagnostics.push({
					message: `Unknown attribute path '${fullPath}' for entity '${rootEntity.name}'.${suggestedFullPath ? ` Did you mean '${suggestedFullPath}'?` : ''}`,
					severity: 'error',
					startOffset: pathOffset,
					endOffset: pathEndOffset,
					code: 'UNKNOWN_ATTRIBUTE_PATH',
					suggestedProperty: suggestedFullPath,
				});
			}
		}
	}

	return diagnostics;
}

