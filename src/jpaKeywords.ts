export type KeywordKind = 'prefix' | 'operator' | 'modifier';

export interface JpaKeyword {
	readonly label: string;
	readonly kind: KeywordKind;
	readonly detail: string;
	readonly documentation: string;
}

export interface EntityProperty {
	readonly name: string;
	readonly type: string;
}

export interface DerivedMethodSuggestion {
	readonly label: string;
	readonly detail: string;
	readonly parameters: readonly string[];
}

export const JPA_KEYWORDS: readonly JpaKeyword[] = [
	...[
		['findBy', 'Find entities'], ['readBy', 'Read entities'], ['getBy', 'Get entities'], ['queryBy', 'Query entities'],
		['searchBy', 'Search entities'], ['streamBy', 'Stream entities'], ['countBy', 'Count entities'], ['existsBy', 'Check existence'],
		['deleteBy', 'Delete entities'], ['removeBy', 'Remove entities'],
	].map(([label, detail]) => ({ label, kind: 'prefix' as const, detail, documentation: `${detail} matching the following property expressions.` })),
	...[
		['Distinct', 'Distinct results'], ['Top', 'Limit results'], ['First', 'Limit results'], ['IgnoreCase', 'Ignore case'],
		['AllIgnoreCase', 'Ignore all case'], ['OrderBy', 'Sort results'], ['Asc', 'Ascending sort'], ['Desc', 'Descending sort'],
	].map(([label, detail]) => ({ label, kind: 'modifier' as const, detail, documentation: detail })),
	...[
		['And', 'Combine predicates'], ['Or', 'Combine predicates'], ['Is', 'Exact match'], ['Equals', 'Exact match'],
		['IsNot', 'Not equal'], ['Not', 'Not equal'], ['IsNull', 'Null check'], ['IsNotNull', 'Not-null check'],
		['NotNull', 'Not-null check'], ['Null', 'Null check'], ['LessThan', 'Less than'], ['LessThanEqual', 'Less than or equal'],
		['GreaterThan', 'Greater than'], ['GreaterThanEqual', 'Greater than or equal'], ['Between', 'Between two values'],
		['Before', 'Before a value'], ['After', 'After a value'], ['Like', 'Like pattern'], ['NotLike', 'Not like pattern'],
		['StartingWith', 'Starts with'], ['IsStartingWith', 'Starts with'], ['EndingWith', 'Ends with'], ['IsEndingWith', 'Ends with'],
		['Containing', 'Contains'], ['IsContaining', 'Contains'], ['Contains', 'Contains'], ['NotContaining', 'Does not contain'],
		['IsNotContaining', 'Does not contain'], ['In', 'In collection'], ['NotIn', 'Not in collection'], ['True', 'True check'],
		['IsTrue', 'True check'], ['False', 'False check'], ['IsFalse', 'False check'],
	].map(([label, detail]) => ({ label, kind: 'operator' as const, detail, documentation: detail })),
];

const PREFIXES = JPA_KEYWORDS.filter((keyword) => keyword.kind === 'prefix').map((keyword) => keyword.label);

export function extractPropertyNames(text: string): EntityProperty[] {
	const properties = new Map<string, EntityProperty>();
	const fieldPattern = /(?:@\w+(?:\s*\([^)]*\))?\s*)*(?:(?:private|protected|public|static|final|transient|volatile)\s+)*(?<![a-zA-Z_$])(?!(?:return|if|for|while|switch|throw|new)\b)([\w$.[\],<>?]+(?:\s+[\w$.[\],<>?]+)*)\s+([a-zA-Z_$]\w*)\s*(?:[=;])/g;
	const getterPattern = /\b(?:public|protected|private)?\s*(?:static\s+)?([\w<>?,\[\]. ]+)\s+(?:get|is|has)([A-Z]\w*)\s*\(/g;

	for (const match of text.matchAll(fieldPattern)) {
		properties.set(match[2], { name: match[2], type: normalizeType(match[1]) });
	}
	for (const match of text.matchAll(getterPattern)) {
		const name = match[2][0].toLowerCase() + match[2].slice(1);
		if (!properties.has(name)) {
			properties.set(name, { name, type: normalizeType(match[1]) });
		}
	}

	return [...properties.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeType(type: string): string {
	return type.trim().replace(/\s+/g, ' ');
}

export function createDerivedMethodSuggestions(properties: readonly EntityProperty[]): readonly {
	readonly label: string;
	readonly detail: string;
	readonly parameter: string;
	}[] {
	return properties.flatMap((property) => [
		{
			label: `findBy${capitalize(property.name)}`,
			detail: `Find entities by ${property.name}`,
			parameter: `${property.type} ${property.name}`,
		},
		{
			label: `existsBy${capitalize(property.name)}`,
			detail: `Check existence by ${property.name}`,
			parameter: `${property.type} ${property.name}`,
		},
		{
			label: `deleteBy${capitalize(property.name)}`,
			detail: `Delete entities by ${property.name}`,
			parameter: `${property.type} ${property.name}`,
		},
	]);
}

const PARAMETERLESS_OPERATORS = new Set(['IsNull', 'IsNotNull', 'NotNull', 'Null', 'True', 'IsTrue', 'False', 'IsFalse']);
const TWO_PARAMETER_OPERATORS = new Set(['Between']);
const CONNECTORS = ['And', 'Or'];
const OPERATORS = JPA_KEYWORDS
	.filter((keyword) => keyword.kind === 'operator' && !CONNECTORS.includes(keyword.label))
	.map((keyword) => keyword.label)
	.sort((left, right) => right.length - left.length);

export function createQueryMethodSuggestions(
	methodPrefix: string,
	properties: readonly EntityProperty[],
): readonly DerivedMethodSuggestion[] {
	const byIndex = methodPrefix.indexOf('By');
	if (byIndex < 0) {
		return [];
	}

	const queryPrefix = methodPrefix.slice(0, byIndex + 2);
	const queryBody = methodPrefix.slice(byIndex + 2);
	const orderByIndex = queryBody.indexOf('OrderBy');
	const predicate = orderByIndex >= 0 ? queryBody.slice(0, orderByIndex) : queryBody;
	const orderBy = orderByIndex >= 0 ? queryBody.slice(orderByIndex + 'OrderBy'.length) : '';
	if (orderByIndex >= 0) {
		return createOrderBySuggestions(queryPrefix, predicate, orderBy, properties);
	}
	const lastConnector = Math.max(...CONNECTORS.map((connector) => predicate.lastIndexOf(connector)));
	const partial = predicate.slice(lastConnector < 0 ? 0 : lastConnector + Math.max(...CONNECTORS.filter((connector) => predicate.lastIndexOf(connector) === lastConnector).map((connector) => connector.length)));
	const completedPredicate = predicate.slice(0, predicate.length - partial.length);
	const matchingProperties = properties.filter((property) =>
		capitalize(property.name).toLowerCase().startsWith(partial.toLowerCase()),
	);
	const suggestions: DerivedMethodSuggestion[] = [];

	for (const property of matchingProperties) {
		const candidatePredicate = `${completedPredicate}${propertyName(property)}`;
		const candidate = `${queryPrefix}${candidatePredicate}`;
		const parameters = parseMethodParameters(candidate, properties);
		suggestions.push({
			label: candidate,
			detail: parameters.length > 0 ? `Derived query (${parameters.join(', ')})` : 'Derived query without parameters',
			parameters,
		});
	}

	if (matchingProperties.length === 0 && isCompletePredicate(predicate, properties)) {
		const parameters = parseMethodParameters(methodPrefix, properties);
		suggestions.push({
			label: methodPrefix,
			detail: parameters.length > 0 ? `Derived query (${parameters.join(', ')})` : 'Derived query without parameters',
			parameters,
		});
	}

	return deduplicateSuggestions(suggestions);
}

export function validateDerivedMethod(
	methodName: string,
	properties: readonly EntityProperty[],
): string | undefined {
	const byIndex = methodName.indexOf('By');
	if (byIndex < 0) {
		return undefined;
	}

	const body = methodName.slice(byIndex + 2).split('OrderBy')[0];
	const propertyNames = new Set(properties.map(propertyName));
	let cursor = 0;
	while (cursor < body.length) {
		const property = [...propertyNames]
			.sort((left, right) => right.length - left.length)
			.find((name) => body.startsWith(name, cursor));
		if (!property) {
			return `Unknown entity property near '${body.slice(cursor)}'.`;
		}
		cursor += property.length;
		const operator = OPERATORS.find((candidate) => body.startsWith(candidate, cursor)) ?? '';
		cursor += operator.length;
		if (cursor === body.length) {
			return undefined;
		}
		const connector = CONNECTORS.find((candidate) => body.startsWith(candidate, cursor));
		if (!connector) {
			return `Expected And or Or near '${body.slice(cursor)}'.`;
		}
		cursor += connector.length;
	}
	return undefined;
}

function createOrderBySuggestions(
	queryPrefix: string,
	predicate: string,
	partialOrderBy: string,
	properties: readonly EntityProperty[],
): readonly DerivedMethodSuggestion[] {
	const matchingProperties = properties.filter((property) =>
		propertyName(property).toLowerCase().startsWith(partialOrderBy.toLowerCase()),
	);
	const suggestions: DerivedMethodSuggestion[] = [];
	for (const property of matchingProperties) {
		for (const direction of ['Asc', 'Desc']) {
			const candidate = `${queryPrefix}${predicate}OrderBy${propertyName(property)}${direction}`;
			suggestions.push({
				label: candidate,
				detail: `Sort by ${property.name} (${direction === 'Asc' ? 'ascending' : 'descending'})`,
				parameters: parseMethodParameters(candidate, properties),
			});
		}
	}
	return deduplicateSuggestions(suggestions);
}

function parseMethodParameters(methodName: string, properties: readonly EntityProperty[]): string[] {
	const byIndex = methodName.indexOf('By');
	if (byIndex < 0) {
		return [];
	}

	const body = methodName.slice(byIndex + 2).split('OrderBy')[0];
	const parameters: string[] = [];
	let cursor = 0;
	const sortedProperties = [...properties].sort((left, right) => propertyName(right).length - propertyName(left).length);

	while (cursor < body.length) {
		const property = sortedProperties.find((candidate) => body.startsWith(propertyName(candidate), cursor));
		if (!property) {
			break;
		}
		cursor += propertyName(property).length;
		const operator = OPERATORS.find((candidate) => body.startsWith(candidate, cursor)) ?? '';
		cursor += operator.length;
		if (!PARAMETERLESS_OPERATORS.has(operator)) {
			const parameterName = property.name;
			const parameterType = TWO_PARAMETER_OPERATORS.has(operator)
				? `${property.type} ${parameterName}Start, ${property.type} ${parameterName}End`
				: operator === 'In' || operator === 'NotIn' ? `Collection<${property.type}> ${parameterName}s` : `${property.type} ${parameterName}`;
			parameters.push(parameterType);
		}
		const connector = CONNECTORS.find((candidate) => body.startsWith(candidate, cursor));
		if (!connector) {
			break;
		}
		cursor += connector.length;
	}

	return parameters;
}

function isCompletePredicate(predicate: string, properties: readonly EntityProperty[]): boolean {
	return properties.some((property) => {
		const name = propertyName(property);
		if (!predicate.startsWith(name)) {
			return false;
		}
		const remainder = predicate.slice(name.length);
		return remainder.length === 0 || OPERATORS.includes(remainder);
	});
}

function propertyName(property: EntityProperty): string {
	return capitalize(property.name);
}

function deduplicateSuggestions(suggestions: readonly DerivedMethodSuggestion[]): readonly DerivedMethodSuggestion[] {
	return [...new Map(suggestions.map((suggestion) => [suggestion.label, suggestion])).values()];
}

function capitalize(value: string): string {
	return value[0].toUpperCase() + value.slice(1);
}

export function isRepositoryMethodContext(linePrefix: string): boolean {
	return /(?:interface|class)\s+\w*Repository\b/.test(linePrefix) ||
		/\b(?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By\w*$/.test(linePrefix);
}

export function isJpaPrefix(value: string): boolean {
	return PREFIXES.some((prefix) => prefix.toLowerCase().startsWith(value.toLowerCase()));
}