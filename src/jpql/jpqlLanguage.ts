export const JPQL_CLAUSES = [
	'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'LEFT OUTER JOIN', 'INNER JOIN',
	'RIGHT JOIN', 'RIGHT OUTER JOIN', 'FULL JOIN', 'CROSS JOIN', 'FETCH', 'AS',
	'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'UPDATE', 'DELETE', 'SET',
] as const;

export const JPQL_OPERATORS = [
	'AND', 'OR', 'NOT', 'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN', 'LIKE', 'NOT LIKE',
	'IS NULL', 'IS NOT NULL', 'IS EMPTY', 'IS NOT EMPTY', 'MEMBER OF', 'NOT MEMBER OF',
	'EXISTS', 'ALL', 'ANY', 'SOME', '=', '<>', '<', '<=', '>', '>=', '+', '-', '*', '/',
] as const;

export const JPQL_FUNCTIONS = [
	'AVG', 'COUNT', 'MAX', 'MIN', 'SUM',
	'CONCAT', 'SUBSTRING', 'LOWER', 'UPPER', 'TRIM', 'LENGTH', 'LOCATE', 'REPLACE', 'LEFT', 'RIGHT',
	'ABS', 'MOD', 'SQRT', 'CEILING', 'EXP', 'FLOOR', 'LN', 'POWER', 'ROUND', 'SIGN',
	'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'LOCAL DATE', 'LOCAL TIME', 'LOCAL DATETIME', 'EXTRACT',
	'SIZE', 'INDEX', 'KEY', 'VALUE', 'ENTRY',
	'TYPE', 'TREAT', 'FUNCTION',
	// Conditional functions
	'COALESCE', 'NULLIF',
] as const;

/**
 * JPQL conditional-expression keywords (CASE expression and related).
 * These are standalone keywords, not functions, and cannot appear as identifiers.
 */
export const JPQL_CONDITIONAL = [
	'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
	// DTO constructor expression
	'NEW',
	// LIKE escape clause
	'ESCAPE',
] as const;

export const JPQL_KEYWORDS = [
	...JPQL_CLAUSES,
	...JPQL_OPERATORS,
	'DISTINCT',
	...JPQL_FUNCTIONS,
	...JPQL_CONDITIONAL,
] as const;

export type JpqlFunctionName = typeof JPQL_FUNCTIONS[number];
export type JpqlConditionalKeyword = typeof JPQL_CONDITIONAL[number];