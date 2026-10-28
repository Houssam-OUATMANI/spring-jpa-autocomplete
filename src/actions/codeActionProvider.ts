import * as vscode from 'vscode';
import { extractRepositoryEntityNameAt, WorkspaceEntityIndex } from '../entityDiscovery';
import { convertDerivedQueryToJpql } from '../derivedQuery/queryToJpql';
import { parseJavaParameters } from '../javaParsing';

interface SpringJpaDiagnostic extends vscode.Diagnostic {
	missingParam?: { name: string; type: string };
	missingParams?: readonly { name: string; type: string }[];
	suggestedProperty?: string;
	suggestedAlias?: string;
	unknownAlias?: string;
	expectedReturnType?: string;
	unknownProperty?: { name: string; targetEntityName?: string; inferredType?: string };
}

export class SpringJpaCodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix,
		vscode.CodeActionKind.Refactor,
	];

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		_token: vscode.CancellationToken,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

		// 1. Diagnostics-driven Quick-Fixes
		for (const diagnostic of context.diagnostics) {
			if (diagnostic.source !== 'spring-jpa') {
				continue;
			}

			const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
			const springDiagnostic = diagnostic as SpringJpaDiagnostic;

			if (code === 'INVALID_RETURN_TYPE') {
				const expectedType = springDiagnostic.expectedReturnType ?? diagnostic.message.match(/must return (boolean|Boolean|long|Long|int|Integer)/i)?.[1];
				if (expectedType) {
					const action = new vscode.CodeAction(
						`Change return type to '${expectedType}'`,
						vscode.CodeActionKind.QuickFix,
					);
					action.edit = new vscode.WorkspaceEdit();
					action.edit.replace(document.uri, diagnostic.range, expectedType);
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					actions.push(action);
				}
			} else if (code === 'MISSING_MODIFYING_ANNOTATION') {
				const action = new vscode.CodeAction(
					"Add '@Modifying' annotation",
					vscode.CodeActionKind.QuickFix,
				);
				action.edit = new vscode.WorkspaceEdit();
				action.edit.insert(document.uri, diagnostic.range.start, '@Modifying\n\t');
				addImportIfMissing(action.edit, document, 'org.springframework.data.jpa.repository.Modifying');
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				actions.push(action);
			} else if (code === 'MISSING_ENTITY_ANNOTATION') {
				const entityName = diagnostic.message.match(/Class '([^']+)'/)?.[1] ?? 'class';
				const action = new vscode.CodeAction(
					`Add '@Entity' annotation to class '${entityName}'`,
					vscode.CodeActionKind.QuickFix,
				);
				action.edit = new vscode.WorkspaceEdit();
				const line = typeof document.lineAt === 'function' ? document.lineAt(diagnostic.range.start.line) : { text: '' };
				const indent = line.text.match(/^\s*/)?.[0] ?? '';
				action.edit.insert(document.uri, new vscode.Position(diagnostic.range.start.line, 0), `${indent}@Entity\n`);
				const hasJakarta = /\bjakarta\.persistence\b/.test(document.getText());
				const entityImport = hasJakarta ? 'jakarta.persistence.Entity' : 'javax.persistence.Entity';
				addImportIfMissing(action.edit, document, entityImport);
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				actions.push(action);
			} else if (code === 'MISSING_PARAM_ANNOTATION') {
				const match = diagnostic.message.match(/missing '@Param\("([^"]+)"\)'/);
				if (match) {
					const paramName = match[1];
					// Individual fix: diagnostic.range.start is now the typeStartOffset
					// (beginning of the parameter, before the type keyword) so the
					// annotation is inserted in the correct position.
					const action = new vscode.CodeAction(
						`Add '@Param("${paramName}")' annotation`,
						vscode.CodeActionKind.QuickFix,
					);
					action.edit = new vscode.WorkspaceEdit();
					action.edit.insert(document.uri, diagnostic.range.start, `@Param("${paramName}") `);
					addImportIfMissing(action.edit, document, 'org.springframework.data.repository.query.Param');
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					actions.push(action);
				}

				// "Fix all" action: fix every MISSING_PARAM_ANNOTATION on the same
				// method line in a single edit. Only generated once (for the first
				// diagnostic on the line) when more than one parameter is missing the
				// annotation.
				const sameLineDiags = context.diagnostics.filter(
					(d) =>
						d.source === 'spring-jpa'
						&& (typeof d.code === 'object' ? d.code.value : d.code) === 'MISSING_PARAM_ANNOTATION'
						&& d.range.start.line === diagnostic.range.start.line,
				);
				if (sameLineDiags.length > 1 && sameLineDiags[0] === diagnostic) {
					const allNames = sameLineDiags
						.map((d) => d.message.match(/missing '@Param\("([^"]+)"\)'/)?.[1])
						.filter((name): name is string => name !== undefined);
					if (allNames.length === sameLineDiags.length) {
						const fixAll = new vscode.CodeAction(
							`Add all ${allNames.length} missing '@Param' annotations`,
							vscode.CodeActionKind.QuickFix,
						);
						fixAll.edit = new vscode.WorkspaceEdit();
						// Apply insertions in reverse position order so earlier offsets
						// are not invalidated by preceding insertions.
						const sorted = [...sameLineDiags].sort((a, b) => b.range.start.compareTo(a.range.start));
						for (const d of sorted) {
							const name = d.message.match(/missing '@Param\("([^"]+)"\)'/)?.[1];
							if (name) {
								fixAll.edit.insert(document.uri, d.range.start, `@Param("${name}") `);
							}
						}
						addImportIfMissing(fixAll.edit, document, 'org.springframework.data.repository.query.Param');
						fixAll.diagnostics = [...sameLineDiags];
						actions.push(fixAll);
					}
				}
			} else if (code === 'MISSING_PAGEABLE') {
				const lineText = document.lineAt(diagnostic.range.start.line).text;
				const closeParen = lineText.lastIndexOf(')');
				if (closeParen >= 0) {
					const parenPos = new vscode.Position(diagnostic.range.start.line, closeParen);
					const hasParamsBefore = lineText.slice(0, closeParen).trim().slice(-1) !== '(';
					const insertion = hasParamsBefore ? ', Pageable pageable' : 'Pageable pageable';

					const action = new vscode.CodeAction(
						`Add 'Pageable pageable' parameter`,
						vscode.CodeActionKind.QuickFix,
					);
					action.edit = new vscode.WorkspaceEdit();
					action.edit.insert(document.uri, parenPos, insertion);
					addImportIfMissing(action.edit, document, 'org.springframework.data.domain.Pageable');
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					actions.push(action);
				}
			} else if (code === 'MISSING_PARAMETER') {
				const missingParams = springDiagnostic.missingParams
					?? (springDiagnostic.missingParam ? [springDiagnostic.missingParam] : parseMissingParameters(diagnostic.message));
				if (missingParams.length > 0) {
					const lineText = document.lineAt(diagnostic.range.start.line).text;
					const closeParen = lineText.indexOf(')', diagnostic.range.end.character);
					if (closeParen >= 0) {
						const parenPos = new vscode.Position(diagnostic.range.start.line, closeParen);
						const hasParamsBefore = lineText.slice(0, closeParen).trim().slice(-1) !== '(';
						const parameters = missingParams.map(({ type, name }) => `${type} ${name}`).join(', ');
						const insertion = hasParamsBefore ? `, ${parameters}` : parameters;

						const action = new vscode.CodeAction(
							missingParams.length === 1
								? `Add parameter '${parameters}' to method signature`
								: `Add ${missingParams.length} missing parameters to method signature`,
							vscode.CodeActionKind.QuickFix,
						);
						action.edit = new vscode.WorkspaceEdit();
						action.edit.insert(document.uri, parenPos, insertion);
						action.diagnostics = [diagnostic];
						action.isPreferred = true;
						actions.push(action);
					}
				}
			} else if (code === 'UNKNOWN_ALIAS') {
				const suggestedAlias = springDiagnostic.suggestedAlias ?? diagnostic.message.match(/Did you mean '([^']+)'\?/)?.[1];
				if (suggestedAlias) {
					const action = new vscode.CodeAction(
						`Change alias to '${suggestedAlias}'`,
						vscode.CodeActionKind.QuickFix,
					);
					action.edit = new vscode.WorkspaceEdit();
					action.edit.replace(document.uri, diagnostic.range, suggestedAlias);
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					actions.push(action);

					// "Fix all" action: fix all UNKNOWN_ALIAS diagnostics on this line or sharing the same suggestedAlias
					const sameAliasDiags = context.diagnostics.filter(
						(d) =>
							d.source === 'spring-jpa'
							&& (typeof d.code === 'object' ? d.code.value : d.code) === 'UNKNOWN_ALIAS'
							&& ((d as SpringJpaDiagnostic).suggestedAlias === suggestedAlias
								|| d.message.includes(`Did you mean '${suggestedAlias}'?`)),
					);
					if (sameAliasDiags.length > 1 && sameAliasDiags[0] === diagnostic) {
						const fixAll = new vscode.CodeAction(
							`Change all ${sameAliasDiags.length} occurrences of alias to '${suggestedAlias}'`,
							vscode.CodeActionKind.QuickFix,
						);
						fixAll.edit = new vscode.WorkspaceEdit();
						const sorted = [...sameAliasDiags].sort((a, b) => b.range.start.compareTo(a.range.start));
						for (const d of sorted) {
							fixAll.edit.replace(document.uri, d.range, suggestedAlias);
						}
						fixAll.diagnostics = [...sameAliasDiags];
						actions.push(fixAll);
					}
				}
			} else if (code === 'UNKNOWN_PROPERTY') {
				const suggestedProperty = springDiagnostic.suggestedProperty ?? diagnostic.message.match(/Did you mean '([^']+)'\?/)?.[1];
				if (suggestedProperty) {
					const action = new vscode.CodeAction(
						`Rename property to '${suggestedProperty}'`,
						vscode.CodeActionKind.QuickFix,
					);
					action.edit = new vscode.WorkspaceEdit();
					action.edit.replace(document.uri, diagnostic.range, suggestedProperty);
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					actions.push(action);
				}

				if (springDiagnostic.unknownProperty?.targetEntityName) {
					const targetEntity = WorkspaceEntityIndex.getInstance().getEntity(springDiagnostic.unknownProperty.targetEntityName);
					if (targetEntity) {
						const propName = springDiagnostic.unknownProperty.name;
						const propType = springDiagnostic.unknownProperty.inferredType ?? 'String';
						const createAction = new vscode.CodeAction(
							`Create field '${propName}' in '${targetEntity.name}.java'`,
							vscode.CodeActionKind.QuickFix,
						);
						createAction.diagnostics = [diagnostic];
						createAction.edit = new vscode.WorkspaceEdit();
						createFieldInEntity(createAction.edit, targetEntity, propName, propType);
						actions.push(createAction);
					}
				}
			} else if (code === 'UNKNOWN_ATTRIBUTE_PATH') {
				const suggestedProperty = springDiagnostic.suggestedProperty ?? diagnostic.message.match(/Did you mean '([^']+)'\?/)?.[1];
				if (suggestedProperty) {
					const action = new vscode.CodeAction(
						`Change attribute path to '${suggestedProperty}'`,
						vscode.CodeActionKind.QuickFix,
					);
					action.edit = new vscode.WorkspaceEdit();
					action.edit.replace(document.uri, diagnostic.range, suggestedProperty);
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					actions.push(action);
				}
			} else if (code === 'POTENTIAL_N_PLUS_ONE') {
				const action = new vscode.CodeAction(
					"Convert to 'JOIN FETCH'",
					vscode.CodeActionKind.QuickFix,
				);
				action.edit = new vscode.WorkspaceEdit();
				const diagText = typeof document.getText === 'function' ? document.getText(diagnostic.range) : '';
				const replaced = diagText.replace(/\bJOIN\s+/i, 'JOIN FETCH ');
				action.edit.replace(document.uri, diagnostic.range, replaced.length > 0 ? replaced : 'JOIN FETCH');
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				actions.push(action);
			}
		}

		// 2. Refactoring Code Action: Convert Derived Query Method to @Query JPQL
		if (typeof document.lineAt === 'function' && typeof document.getText === 'function') {
			const lineText = document.lineAt(range.start.line).text;
			const methodMatch = lineText.match(/\b([\w$<>?[\]\s]+?)\s+((?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)/);
			if (methodMatch) {
				const returnType = methodMatch[1].trim();
				const methodName = methodMatch[2];
				const paramsText = methodMatch[3];
				const docText = document.getText();
				const offset = typeof document.offsetAt === 'function' ? document.offsetAt(range.start) : 0;
				const repoEntityName = extractRepositoryEntityNameAt(docText, offset);
				if (repoEntityName) {
					const converted = convertDerivedQueryToJpql({
						rawText: methodMatch[0],
						returnType,
						methodName,
						entityName: repoEntityName,
						parameters: parseJavaParameters(paramsText),
						startOffset: 0,
						endOffset: methodMatch[0].length,
					}, repoEntityName);

					if (converted) {
						const action = new vscode.CodeAction(
							`Convert '${methodName}' to @Query (JPQL)`,
							vscode.CodeActionKind.Refactor,
						);
						action.edit = new vscode.WorkspaceEdit();
						const indent = lineText.match(/^\s*/)?.[0] ?? '\t';
						const modifyingAnnotation = converted.isModifying ? `${indent}@Modifying\n` : '';
						const queryAnnotation = `${modifyingAnnotation}${indent}@Query("${converted.jpqlQuery}")\n`;
						action.edit.insert(document.uri, new vscode.Position(range.start.line, 0), queryAnnotation);

						for (const imp of converted.requiredImports) {
							addImportIfMissing(action.edit, document, imp);
						}
						actions.push(action);
					}
				}
			}
		}

		return actions;
	}
}

function createFieldInEntity(
	edit: vscode.WorkspaceEdit,
	targetEntity: { uri: vscode.Uri; name: string },
	propName: string,
	propType: string,
): void {
	const targetDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetEntity.uri.toString());
	const text = targetDoc?.getText() ?? '';
	const lastBrace = text.lastIndexOf('}');
	if (lastBrace >= 0 && targetDoc) {
		const hasLombok = /@(Data|Getter|Value)\b/.test(text);
		const cap = propName[0].toUpperCase() + propName.slice(1);
		const fieldCode = hasLombok
			? `\n\tprivate ${propType} ${propName};\n`
			: `\n\tprivate ${propType} ${propName};\n\n\tpublic ${propType} get${cap}() {\n\t\treturn ${propName};\n\t}\n\n\tpublic void set${cap}(${propType} ${propName}) {\n\t\tthis.${propName} = ${propName};\n\t}\n`;
		edit.insert(targetEntity.uri, targetDoc.positionAt(lastBrace), fieldCode);
	} else {
		edit.insert(targetEntity.uri, new vscode.Position(0, 0), `\n\tprivate ${propType} ${propName};\n`);
	}
}

function parseMissingParameters(message: string): { name: string; type: string }[] {
	const match = message.match(/expects at least \d+ parameter\(s\) \(([^)]+)\)/);
	if (!match) {
		return [];
	}
	const foundCount = Number(message.match(/but found (\d+)/)?.[1] ?? 0);
	return match[1].split(',').slice(foundCount).flatMap((parameter) => {
		const parameterMatch = parameter.trim().match(/^(.+)\s+([A-Za-z_$]\w*)$/);
		return parameterMatch ? [{ type: parameterMatch[1], name: parameterMatch[2] }] : [];
	});
}

function addImportIfMissing(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, importName: string): void {
	const text = document.getText();
	if (new RegExp(`\\bimport\\s+${importName.replace(/\./g, '\\.')}\\s*;`).test(text)) {
		return;
	}
	const pkg = importName.slice(0, importName.lastIndexOf('.'));
	if (new RegExp(`\\bimport\\s+${pkg.replace(/\./g, '\\.')}\\.\\*;`).test(text)) {
		return;
	}

	const packageMatch = /\bpackage\s+[\w.]+\s*;/.exec(text);
	const offset = packageMatch ? packageMatch.index + packageMatch[0].length : 0;
	const pos = typeof document.positionAt === 'function'
		? document.positionAt(offset)
		: new vscode.Position(0, offset);
	edit.insert(document.uri, pos, `\n\nimport ${importName};`);
}
