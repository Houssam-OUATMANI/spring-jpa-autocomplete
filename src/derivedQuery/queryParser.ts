export interface ParsedPredicate {
	readonly rawText: string;
	readonly propertyName: string;
	readonly operator?: string;
	readonly ignoreCase: boolean;
	readonly connector?: 'And' | 'Or';
	readonly startOffset: number;
	readonly endOffset: number;
}

export interface ParsedOrderBy {
	readonly propertyName: string;
	readonly direction: 'Asc' | 'Desc';
}

export interface ParsedDerivedMethod {
	readonly rawMethodName: string;
	readonly prefix: string;
	readonly subjectModifiers: readonly string[];
	readonly isCount: boolean;
	readonly isExists: boolean;
	readonly isDelete: boolean;
	readonly predicates: readonly ParsedPredicate[];
	readonly orderBy: readonly ParsedOrderBy[];
	readonly byIndex: number;
}

const PREFIX_REGEX = /^(find|read|get|query|search|stream|count|exists|delete|remove)(Distinct|First\d*|Top\d*|All)*By/;
const CONNECTORS = ['And', 'Or'] as const;

export const KNOWN_OPERATORS = [
	'IsStartingWith', 'IsEndingWith', 'IsContaining', 'IsNotContaining',
	'StartingWith', 'EndingWith', 'Containing', 'NotContaining', 'Contains',
	'LessThanEqual', 'GreaterThanEqual', 'LessThan', 'GreaterThan',
	'Between', 'Before', 'After',
	'Like', 'NotLike',
	'IsNull', 'IsNotNull', 'NotNull', 'Null',
	'IsTrue', 'IsFalse', 'True', 'False',
	'NotIn', 'In',
	'IsNot', 'Not', 'Equals', 'Is',
	'IsEmpty', 'IsNotEmpty',
].sort((a, b) => b.length - a.length);

export function parseDerivedMethodName(methodName: string): ParsedDerivedMethod | undefined {
	const match = methodName.match(PREFIX_REGEX);
	if (!match) {
		return undefined;
	}

	const prefix = match[1];
	const fullSubject = match[0];
	const byIndex = fullSubject.length - 2;

	const isCount = prefix === 'count';
	const isExists = prefix === 'exists';
	const isDelete = prefix === 'delete' || prefix === 'remove';

	// Extract modifiers (Distinct, Top5, etc.)
	const subjectRemainder = fullSubject.slice(prefix.length, -2);
	const subjectModifiers: string[] = [];
	const modMatches = subjectRemainder.match(/(Distinct|First\d*|Top\d*|All)/g);
	if (modMatches) {
		subjectModifiers.push(...modMatches);
	}

	const afterBy = methodName.slice(fullSubject.length);
	const orderByIndex = afterBy.indexOf('OrderBy');

	const predicateString = orderByIndex >= 0 ? afterBy.slice(0, orderByIndex) : afterBy;
	const orderByString = orderByIndex >= 0 ? afterBy.slice(orderByIndex + 'OrderBy'.length) : '';

	const predicates = parsePredicates(predicateString, fullSubject.length);
	const orderBy = parseOrderBy(orderByString);

	return {
		rawMethodName: methodName,
		prefix,
		subjectModifiers,
		isCount,
		isExists,
		isDelete,
		predicates,
		orderBy,
		byIndex,
	};
}

function parsePredicates(predicateText: string, baseOffset: number): ParsedPredicate[] {
	if (!predicateText) {
		return [];
	}

	const predicates: ParsedPredicate[] = [];
	let cursor = 0;
	let currentConnector: 'And' | 'Or' | undefined = undefined;

	while (cursor < predicateText.length) {
		// Find next connector (And or Or)
		let nextConnectorIndex = -1;
		let foundConnector: 'And' | 'Or' | undefined = undefined;

		const andIndex = findConnectorIndex(predicateText, 'And', cursor);
		const orIndex = findConnectorIndex(predicateText, 'Or', cursor);

		if (andIndex >= 0 && (orIndex < 0 || andIndex < orIndex)) {
			nextConnectorIndex = andIndex;
			foundConnector = 'And';
		} else if (orIndex >= 0) {
			nextConnectorIndex = orIndex;
			foundConnector = 'Or';
		}

		const segmentEnd = nextConnectorIndex >= 0 ? nextConnectorIndex : predicateText.length;
		const rawSegment = predicateText.slice(cursor, segmentEnd);

		if (rawSegment.length > 0) {
			const parsed = parsePredicateSegment(rawSegment, baseOffset + cursor, currentConnector);
			predicates.push(parsed);
		}

		if (nextConnectorIndex >= 0 && foundConnector) {
			cursor = nextConnectorIndex + foundConnector.length;
			currentConnector = foundConnector;
		} else {
			break;
		}
	}

	return predicates;
}

function findConnectorIndex(text: string, connector: 'And' | 'Or', start: number): number {
	let index = text.indexOf(connector, start);
	while (index >= 0) {
		const next = text[index + connector.length];
		if (next === undefined || /[A-Z0-9_]/.test(next)) {
			return index;
		}
		index = text.indexOf(connector, index + connector.length);
	}
	return -1;
}

function parsePredicateSegment(
	segment: string,
	startOffset: number,
	connector?: 'And' | 'Or',
): ParsedPredicate {
	let working = segment;
	let ignoreCase = false;

	if (working.endsWith('AllIgnoreCase')) {
		ignoreCase = true;
		working = working.slice(0, -'AllIgnoreCase'.length);
	} else if (working.endsWith('IgnoreCase')) {
		ignoreCase = true;
		working = working.slice(0, -'IgnoreCase'.length);
	}

	let operator: string | undefined = undefined;
	for (const op of KNOWN_OPERATORS) {
		if (working.endsWith(op)) {
			operator = op;
			working = working.slice(0, -op.length);
			break;
		}
	}

	return {
		rawText: segment,
		propertyName: working,
		operator,
		ignoreCase,
		connector,
		startOffset,
		endOffset: startOffset + segment.length,
	};
}

function parseOrderBy(orderByText: string): ParsedOrderBy[] {
	if (!orderByText) {
		return [];
	}

	const results: ParsedOrderBy[] = [];
	const regex = /([A-Za-z0-9_]+?)(Asc|Desc)(?=[A-Z0-9_]|(?:\b|$))/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(orderByText)) !== null) {
		results.push({
			propertyName: match[1],
			direction: match[2] as 'Asc' | 'Desc',
		});
	}
	if (results.length === 0 && /^[A-Za-z0-9_]+$/.test(orderByText)) {
		results.push({ propertyName: orderByText, direction: 'Asc' });
	}

	return results;
}
