import * as vscode from 'vscode';

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

			if (code === 'INVALID_RETURN_TYPE') {
				const match = diagnostic.message.match(/must return (boolean|long)/i);
				if (match) {
					const expectedType = match[1];
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
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					actions.push(action);
				}
			} else if (code === 'MISSING_PARAMETER') {
				// Extract suggested parameter from message
				const match = diagnostic.message.match(/expects at least \d+ parameter\(s\) \(([^)]+)\)/);
				if (match) {
					const expectedList = match[1].split(',').map((s) => s.trim());
					const lineText = document.lineAt(diagnostic.range.start.line).text;
					const closeParen = lineText.indexOf(')', diagnostic.range.end.character);
					if (closeParen >= 0) {
						const parenPos = new vscode.Position(diagnostic.range.start.line, closeParen);
						const hasParamsBefore = lineText.slice(0, closeParen).trim().slice(-1) !== '(';
						const nextParam = expectedList[expectedList.length - 1];
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
			}
		}

		return actions;
	}
}
