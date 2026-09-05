import * as vscode from 'vscode';
import { EntityProperty } from '../entityModel';
import { KNOWN_OPERATORS, parseDerivedMethodName } from './queryParser';
import { JPA_KEYWORDS } from '../jpaKeywords';

export interface MethodSuggestion {
	readonly label: string;
	readonly detail: string;
	readonly parameters: readonly string[];
	readonly insertTextSnippet?: string;
}

const CONNECTORS = ['And', 'Or'];

export function createDerivedQueryCompletions(
	linePrefix: string,
	properties: readonly EntityProperty[],
	position: vscode.Position,
): vscode.CompletionItem[] {
	const methodMatch = linePrefix.match(/\b(?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By\w*$/);
	if (!methodMatch) {
		return [];
	}

	const fullMethodText = methodMatch[0];
	const byIndex = fullMethodText.indexOf('By');
	const queryPrefix = fullMethodText.slice(0, byIndex + 2);
	const queryBody = fullMethodText.slice(byIndex + 2);

	const items: vscode.CompletionItem[] = [];
	const orderByIndex = queryBody.indexOf('OrderBy');

	if (orderByIndex >= 0) {
		const partialOrderBy = queryBody.slice(orderByIndex + 'OrderBy'.length);
		const matchingProps = properties.filter((p) =>
			toPascalCase(p.name).toLowerCase().startsWith(partialOrderBy.toLowerCase()),
		);
		const startPos = new vscode.Position(position.line, position.character - partialOrderBy.length);
		const range = new vscode.Range(startPos, position);

		for (const prop of matchingProps) {
			for (const dir of ['Asc', 'Desc']) {
				const label = `${toPascalCase(prop.name)}${dir}`;
				const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);
				item.detail = `Sort by ${prop.name} (${dir === 'Asc' ? 'Ascending' : 'Descending'})`;
				item.range = range;
				items.push(item);
			}
		}
		return items;
	}

	// Not in OrderBy yet. Check if after a complete property or operator
	const lastConnector = Math.max(...CONNECTORS.map((c) => queryBody.lastIndexOf(c)));
	const lastPredicatePart = lastConnector >= 0
		? queryBody.slice(lastConnector + (queryBody.slice(lastConnector).startsWith('And') ? 3 : 2))
		: queryBody;

	// Check if user is typing an operator or connector after a valid property
	const matchingProp = properties.find((p) =>
		lastPredicatePart.toLowerCase().startsWith(toPascalCase(p.name).toLowerCase()),
	);

	if (matchingProp) {
		const propPascal = toPascalCase(matchingProp.name);
		const afterProp = lastPredicatePart.slice(propPascal.length);

		// Suggest connectors 'And', 'Or', 'OrderBy'
		for (const conn of ['And', 'Or', 'OrderBy']) {
			if (conn.toLowerCase().startsWith(afterProp.toLowerCase())) {
				const item = new vscode.CompletionItem(conn, vscode.CompletionItemKind.Keyword);
				item.detail = `Spring Data JPA ${conn}`;
				item.range = new vscode.Range(new vscode.Position(position.line, position.character - afterProp.length), position);
				items.push(item);
			}
		}

		// Suggest operators
		for (const op of KNOWN_OPERATORS) {
			if (op.toLowerCase().startsWith(afterProp.toLowerCase())) {
				const item = new vscode.CompletionItem(op, vscode.CompletionItemKind.Operator);
				item.detail = `Spring Data JPA Operator: ${op}`;
				item.range = new vscode.Range(new vscode.Position(position.line, position.character - afterProp.length), position);
				items.push(item);
			}
		}
	}

	// Suggest properties for partial word
	const partial = lastPredicatePart;
	const propRange = new vscode.Range(new vscode.Position(position.line, position.character - partial.length), position);
	for (const prop of properties) {
		const pascal = toPascalCase(prop.name);
		if (partial.length === 0 || pascal.toLowerCase().startsWith(partial.toLowerCase())) {
			const item = new vscode.CompletionItem(pascal, vscode.CompletionItemKind.Field);
			item.detail = `Entity property: ${prop.type}`;
			item.range = propRange;
			items.push(item);
		}
	}

	return items;
}

function toPascalCase(str: string): string {
	if (!str) return str;
	// handle underscore like address_city -> Address_City or AddressCity
	return str[0].toUpperCase() + str.slice(1);
}
