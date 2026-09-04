export type KeywordKind = 'prefix' | 'operator' | 'modifier';

export interface JpaKeyword {
	readonly label: string;
	readonly kind: KeywordKind;
	readonly detail: string;
	readonly documentation: string;
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

export function extractPropertyNames(text: string): string[] {
	const names = new Set<string>();
	const fieldPattern = /(?:private|protected|public)\s+(?:final\s+)?[\w<>?, ]+\s+(\w+)\s*(?:[=;])/g;
	const getterPattern = /\b(?:get|is|has)([A-Z]\w*)\s*\(/g;

	for (const match of text.matchAll(fieldPattern)) {
		names.add(match[1]);
	}
	for (const match of text.matchAll(getterPattern)) {
		names.add(match[1][0].toLowerCase() + match[1].slice(1));
	}

	return [...names].sort();
}

export function isRepositoryMethodContext(linePrefix: string): boolean {
	return /(?:interface|class)\s+\w*Repository\b/.test(linePrefix) ||
		/\b(?:find|read|get|query|search|stream|count|exists|delete|remove)\w*By\w*$/.test(linePrefix);
}

export function isJpaPrefix(value: string): boolean {
	return PREFIXES.some((prefix) => prefix.toLowerCase().startsWith(value.toLowerCase()));
}