import * as vscode from 'vscode';

interface SpringJpaDiagnostic extends vscode.Diagnostic {
	missingParam?: { name: string; type: string };
	suggestedProperty?: string;
	expectedReturnType?: string;
}

export class SpringJpaCodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix,
	];

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

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
			} else if (code === 'MISSING_PARAM_ANNOTATION') {
				const match = diagnostic.message.match(/missing '@Param\("([^"]+)"\)'/);
				if (match) {
					const paramName = match[1];
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
			} else if (code === 'MISSING_PAGEABLE') {
				// Find closing parenthesis of method parameters on current line
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
				const missingParam = springDiagnostic.missingParam ?? parseMissingParameter(diagnostic.message);
				if (missingParam) {
					const lineText = document.lineAt(diagnostic.range.start.line).text;
					const closeParen = lineText.indexOf(')', diagnostic.range.end.character);
					if (closeParen >= 0) {
						const parenPos = new vscode.Position(diagnostic.range.start.line, closeParen);
						const hasParamsBefore = lineText.slice(0, closeParen).trim().slice(-1) !== '(';
						const nextParam = `${missingParam.type} ${missingParam.name}`;
						const insertion = hasParamsBefore ? `, ${nextParam}` : nextParam;

						const action = new vscode.CodeAction(
							`Add parameter '${nextParam}' to method signature`,
							vscode.CodeActionKind.QuickFix,
						);
						action.edit = new vscode.WorkspaceEdit();
						action.edit.insert(document.uri, parenPos, insertion);
						action.diagnostics = [diagnostic];
						action.isPreferred = true;
						actions.push(action);
					}
				}
			} else if (code === 'UNKNOWN_PROPERTY' && springDiagnostic.suggestedProperty) {
				const action = new vscode.CodeAction(
					`Rename property to '${springDiagnostic.suggestedProperty}'`,
					vscode.CodeActionKind.QuickFix,
				);
				action.edit = new vscode.WorkspaceEdit();
				action.edit.replace(document.uri, diagnostic.range, springDiagnostic.suggestedProperty);
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				actions.push(action);
			}
		}

		return actions;
	}
}

function parseMissingParameter(message: string): { name: string; type: string } | undefined {
	const match = message.match(/expects at least \d+ parameter\(s\) \(([^)]+)\)/);
	if (!match) {
		return undefined;
	}
	const foundCount = Number(message.match(/but found (\d+)/)?.[1] ?? 0);
	const lastParameter = match[1].split(',')[foundCount]?.trim();
	const parameterMatch = lastParameter?.match(/^(.+)\s+([A-Za-z_$]\w*)$/);
	return parameterMatch ? { type: parameterMatch[1], name: parameterMatch[2] } : undefined;
}

function addImportIfMissing(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, importName: string): void {
	const text = document.getText();
	if (new RegExp(`\\bimport\\s+${importName.replace(/\./g, '\\.')}\\s*;`).test(text)) {
		return;
	}

	const packageMatch = /\bpackage\s+[\w.]+\s*;/.exec(text);
	const offset = packageMatch ? packageMatch.index + packageMatch[0].length : 0;
	edit.insert(document.uri, document.positionAt(offset), `\n\nimport ${importName};`);
}
