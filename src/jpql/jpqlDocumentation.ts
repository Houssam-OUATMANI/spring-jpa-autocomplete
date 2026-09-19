import { JPQL_CLAUSES, JPQL_FUNCTIONS, JPQL_OPERATORS } from './jpqlLanguage';

export interface JpqlDocumentation {
	readonly title: string;
	readonly kind: 'Clause' | 'Operator' | 'Function';
	readonly description: string;
	readonly syntax: string;
	readonly useCase: string;
}

const documentation: Readonly<Record<string, JpqlDocumentation>> = {
	SELECT: {
		title: 'SELECT', kind: 'Clause',
		description: 'Chooses the values returned by the query: an entity, property, aggregate, or projection.',
		syntax: 'SELECT [DISTINCT] expression',
		useCase: 'SELECT u FROM User u',
	},
	FROM: {
		title: 'FROM', kind: 'Clause',
		description: 'Declares the entity type being queried and its JPQL alias.',
		syntax: 'FROM Entity alias',
		useCase: 'FROM User u',
	},
	WHERE: {
		title: 'WHERE', kind: 'Clause',
		description: 'Filters rows using a predicate that must evaluate to true.',
		syntax: 'WHERE condition',
		useCase: 'WHERE u.active = true',
	},
	JOIN: {
		title: 'JOIN', kind: 'Clause',
		description: 'Traverses an entity association to filter or select related entities.',
		syntax: 'JOIN alias.relation joinedAlias',
		useCase: 'JOIN u.orders o WHERE o.status = :status',
	},
	'LEFT JOIN': {
		title: 'LEFT JOIN', kind: 'Clause',
		description: 'Keeps the parent entity even when the related association has no matching row.',
		syntax: 'LEFT JOIN alias.relation joinedAlias',
		useCase: 'LEFT JOIN u.orders o WHERE o.status = :status',
	},
	'LEFT OUTER JOIN': {
		title: 'LEFT OUTER JOIN', kind: 'Clause',
		description: 'Outer-join variant of LEFT JOIN that preserves the parent entity.',
		syntax: 'LEFT OUTER JOIN alias.relation joinedAlias',
		useCase: 'LEFT OUTER JOIN u.orders o',
	},
	'INNER JOIN': {
		title: 'INNER JOIN', kind: 'Clause',
		description: 'Returns only parent entities with a matching related entity.',
		syntax: 'INNER JOIN alias.relation joinedAlias',
		useCase: 'INNER JOIN u.orders o WHERE o.status = :status',
	},
	'RIGHT JOIN': {
		title: 'RIGHT JOIN', kind: 'Clause',
		description: 'Preserves the joined side when the provider supports right outer joins.',
		syntax: 'RIGHT JOIN alias.relation joinedAlias',
		useCase: 'RIGHT JOIN u.orders o',
	},
	'FULL JOIN': {
		title: 'FULL JOIN', kind: 'Clause',
		description: 'Preserves unmatched rows from both sides when supported by the provider.',
		syntax: 'FULL JOIN alias.relation joinedAlias',
		useCase: 'FULL JOIN u.orders o',
	},
	'CROSS JOIN': {
		title: 'CROSS JOIN', kind: 'Clause',
		description: 'Produces a Cartesian product between two entity types.',
		syntax: 'CROSS JOIN Entity alias',
		useCase: 'CROSS JOIN Product p',
	},
	'ORDER BY': {
		title: 'ORDER BY', kind: 'Clause',
		description: 'Sorts the result by one or more expressions.',
		syntax: 'ORDER BY expression [ASC|DESC]',
		useCase: 'ORDER BY u.createdAt DESC',
	},
	'GROUP BY': {
		title: 'GROUP BY', kind: 'Clause',
		description: 'Groups rows before applying an aggregate or HAVING condition.',
		syntax: 'GROUP BY expression',
		useCase: 'GROUP BY u.department',
	},
	LIKE: {
		title: 'LIKE', kind: 'Operator',
		description: 'Compares a string with a pattern; `%` matches multiple characters and `_` matches one character.',
		syntax: 'expression LIKE pattern [ESCAPE character]',
		useCase: "WHERE LOWER(u.name) LIKE LOWER(CONCAT('%', :term, '%'))",
	},
	IN: {
		title: 'IN', kind: 'Operator',
		description: 'Tests whether a value belongs to a list or a subquery result.',
		syntax: 'expression IN (value1, value2, ...)',
		useCase: 'WHERE u.status IN :statuses',
	},
	BETWEEN: {
		title: 'BETWEEN', kind: 'Operator',
		description: 'Tests whether a value falls between two inclusive bounds.',
		syntax: 'expression BETWEEN lower AND upper',
		useCase: 'WHERE u.age BETWEEN :min AND :max',
	},
	AND: {
		title: 'AND', kind: 'Operator',
		description: 'Combines two predicates; both must be true.',
		syntax: 'condition1 AND condition2',
		useCase: 'WHERE u.active = true AND u.role = :role',
	},
	OR: {
		title: 'OR', kind: 'Operator',
		description: 'Combines two predicates; at least one must be true.',
		syntax: 'condition1 OR condition2',
		useCase: 'WHERE u.email = :value OR u.name = :value',
	},
	COUNT: {
		title: 'COUNT', kind: 'Function',
	description: 'Counts values or rows in a group.',
		syntax: 'COUNT([DISTINCT] expression)',
		useCase: 'SELECT COUNT(u) FROM User u',
	},
	AVG: {
		title: 'AVG', kind: 'Function',
		description: 'Calculates the average of a numeric expression.',
		syntax: 'AVG(expression)',
		useCase: 'SELECT AVG(p.price) FROM Product p',
	},
	SUM: {
		title: 'SUM', kind: 'Function',
		description: 'Adds the numeric values in a group.',
		syntax: 'SUM(expression)',
		useCase: 'SELECT SUM(i.amount) FROM Invoice i',
	},
	MIN: {
		title: 'MIN', kind: 'Function',
		description: 'Returns the smallest value of a comparable expression.',
		syntax: 'MIN(expression)',
		useCase: 'SELECT MIN(p.price) FROM Product p',
	},
	MAX: {
		title: 'MAX', kind: 'Function',
		description: 'Returns the largest value of a comparable expression.',
		syntax: 'MAX(expression)',
		useCase: 'SELECT MAX(p.price) FROM Product p',
	},
	LOWER: {
		title: 'LOWER', kind: 'Function',
		description: 'Converts a string to lowercase.',
		syntax: 'LOWER(string_expression)',
		useCase: "WHERE LOWER(u.email) = LOWER(:email)",
	},
	UPPER: {
		title: 'UPPER', kind: 'Function',
		description: 'Converts a string to uppercase.',
		syntax: 'UPPER(string_expression)',
		useCase: "WHERE UPPER(u.code) = 'ACTIVE'",
	},
	CONCAT: {
		title: 'CONCAT', kind: 'Function',
		description: 'Combines two strings into one.',
		syntax: 'CONCAT(string1, string2)',
		useCase: "SELECT CONCAT(u.firstName, ' ', u.lastName) FROM User u",
	},
	SUBSTRING: {
		title: 'SUBSTRING', kind: 'Function',
		description: 'Extracts part of a string starting at a given position.',
		syntax: 'SUBSTRING(string, start [, length])',
		useCase: 'SELECT SUBSTRING(u.code, 1, 3) FROM User u',
	},
	LENGTH: {
		title: 'LENGTH', kind: 'Function',
		description: 'Returns the number of characters in a string.',
		syntax: 'LENGTH(string_expression)',
		useCase: 'WHERE LENGTH(u.username) > 5',
	},
	TRIM: {
		title: 'TRIM', kind: 'Function',
		description: 'Removes whitespace or selected characters around a string.',
		syntax: 'TRIM([character FROM] string_expression)',
		useCase: 'WHERE TRIM(u.name) <> \'\'',
	},
	ABS: {
		title: 'ABS', kind: 'Function',
		description: 'Returns the absolute value of a number.',
		syntax: 'ABS(numeric_expression)',
		useCase: 'ORDER BY ABS(p.balance) DESC',
	},
	MOD: {
		title: 'MOD', kind: 'Function',
		description: 'Returns the remainder of an integer division.',
		syntax: 'MOD(dividend, divisor)',
		useCase: 'WHERE MOD(u.id, 2) = 0',
	},
	SIZE: {
		title: 'SIZE', kind: 'Function',
		description: 'Counts the elements in a related collection.',
		syntax: 'SIZE(collection_valued_path)',
		useCase: 'WHERE SIZE(u.orders) > 0',
	},
	TYPE: {
		title: 'TYPE', kind: 'Function',
		description: 'Returns the concrete entity type of a polymorphic expression.',
		syntax: 'TYPE(entity_expression)',
		useCase: "WHERE TYPE(p) = SpecialProduct",
	},
	TREAT: {
		title: 'TREAT', kind: 'Function',
		description: 'Treats an entity expression as a subtype to access its attributes.',
		syntax: 'TREAT(expression AS subtype)',
		useCase: 'WHERE TREAT(p AS SpecialProduct).discount > 0',
	},
	FUNCTION: {
		title: 'FUNCTION', kind: 'Function',
		description: 'Calls a database or provider-specific function by name.',
		syntax: "FUNCTION('name', arg1, arg2, ...)",
		useCase: "SELECT FUNCTION('YEAR', u.createdAt) FROM User u",
	},
};

export function getJpqlDocumentation(word: string): JpqlDocumentation | undefined {
	const normalized = word.toUpperCase();
	const documented = documentation[normalized];
	if (documented) {
		return documented;
	}

	if (JPQL_CLAUSES.includes(normalized as typeof JPQL_CLAUSES[number])) {
		return createFallbackDocumentation(normalized, 'Clause', `JPQL clause ${normalized}.`, normalized);
	}
	if (normalized === 'DISTINCT') {
		return createFallbackDocumentation(normalized, 'Clause', 'Removes duplicate values or entities from the result.', 'SELECT DISTINCT expression');
	}
	if (JPQL_OPERATORS.includes(normalized as typeof JPQL_OPERATORS[number])) {
		return createFallbackDocumentation(normalized, 'Operator', `JPQL operator ${normalized}.`, `expression ${normalized} value`);
	}
	if (JPQL_FUNCTIONS.includes(normalized as typeof JPQL_FUNCTIONS[number])) {
		return createFallbackDocumentation(normalized, 'Function', `JPQL function ${normalized}.`, `${normalized}(expression)`);
	}
	return undefined;
}

function createFallbackDocumentation(
	title: string,
	kind: JpqlDocumentation['kind'],
	description: string,
	syntax: string,
): JpqlDocumentation {
	return {
		title,
		kind,
		description,
		syntax,
		useCase: `${syntax} ...`,
	};
}