import { EntityProperty } from '../entityModel';
import { parseDerivedMethodName, ParsedDerivedMethod, ParsedPredicate } from './queryParser';
import { findClosestProperty } from '../propertySuggestions';

export interface MethodSignatureInfo {
	readonly rawText: string;
	readonly returnType: string;
	readonly methodName: string;
	readonly parameters: readonly { name: string; type: string }[];
	readonly startOffset: number;
	readonly endOffset: number;
}

export interface DerivedMethodValidationDiagnostic {
	readonly message: string;
	readonly severity: 'error' | 'warning';
	readonly startOffset: number;
	readonly endOffset: number;
	readonly code?: 'INVALID_RETURN_TYPE' | 'MISSING_PARAMETER' | 'EXTRA_PARAMETER' | 'UNKNOWN_PROPERTY' | 'MISSING_PAGEABLE' | 'INVALID_PARAMETER_TYPE';
	readonly expectedReturnType?: string;
	readonly missingParam?: { name: string; type: string };
}

const PARAMETERLESS_OPERATORS = new Set([
	'IsNull', 'IsNotNull', 'NotNull', 'Null',
	'True', 'IsTrue', 'False', 'IsFalse',
	'IsEmpty', 'IsNotEmpty',
]);

const TWO_PARAMETER_OPERATORS = new Set(['Between']);

export function validateDerivedMethodSignature(
	signature: MethodSignatureInfo,
	properties: readonly EntityProperty[],
): readonly DerivedMethodValidationDiagnostic[] {
	const parsed = parseDerivedMethodName(signature.methodName);
	if (!parsed) {
		return [];
	}

	const diagnostics: DerivedMethodValidationDiagnostic[] = [];
	const propMap = buildPropertyLookupMap(properties);

	// 1. Validate property existence
	for (const predicate of parsed.predicates) {
		const prop = findProperty(predicate.propertyName, propMap);
		if (!prop) {
			const start = signature.startOffset + signature.rawText.indexOf(signature.methodName) + predicate.startOffset;
			const end = start + predicate.propertyName.length;
			const suggestion = findClosestProperty(predicate.propertyName, properties.map((property) => property.name));
			diagnostics.push({
				message: `Unknown entity property '${predicate.propertyName}' in derived query method.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
				severity: 'error',
				startOffset: start,
				endOffset: end,
				code: 'UNKNOWN_PROPERTY',
			});
		}
	}
	for (const order of parsed.orderBy) {
		if (!findProperty(order.propertyName, propMap)) {
			const start = signature.startOffset + signature.rawText.indexOf(signature.methodName) + signature.methodName.indexOf(order.propertyName);
			const suggestion = findClosestProperty(order.propertyName, properties.map((property) => property.name));
			diagnostics.push({
				message: `Unknown entity property '${order.propertyName}' in OrderBy clause.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
				severity: 'error',
				startOffset: start,
				endOffset: start + order.propertyName.length,
				code: 'UNKNOWN_PROPERTY',
			});
		}
	}

	// 2. Validate return type
	const returnTypeDiag = validateReturnType(signature, parsed);
	if (returnTypeDiag) {
		diagnostics.push(returnTypeDiag);
	}

	// 3. Validate method parameters
	const paramDiags = validateParameters(signature, parsed, propMap);
	diagnostics.push(...paramDiags);

	return diagnostics;
}

function validateReturnType(
	signature: MethodSignatureInfo,
	parsed: ParsedDerivedMethod,
): DerivedMethodValidationDiagnostic | undefined {
	const ret = signature.returnType.trim();
	const methodOffsetInSig = signature.rawText.indexOf(signature.methodName);
	const retStart = signature.startOffset + signature.rawText.indexOf(ret);
	const retEnd = retStart + ret.length;

	if (parsed.isExists) {
		if (ret !== 'boolean' && ret !== 'Boolean') {
			return {
				message: `'${parsed.rawMethodName}' must return boolean or Boolean, but returns '${ret}'.`,
				severity: 'error',
				startOffset: retStart,
				endOffset: retEnd,
				code: 'INVALID_RETURN_TYPE',
				expectedReturnType: 'boolean',
			};
		}
	} else if (parsed.isCount) {
		if (!['long', 'Long', 'int', 'Integer'].includes(ret)) {
			return {
				message: `'${parsed.rawMethodName}' must return a numeric count type (long or Long), but returns '${ret}'.`,
				severity: 'error',
				startOffset: retStart,
				endOffset: retEnd,
				code: 'INVALID_RETURN_TYPE',
				expectedReturnType: 'long',
			};
		}
	}

	// Check if return type is Page<T> but method lacks Pageable
	if (ret.startsWith('Page<') || ret.startsWith('Page ')) {
		const hasPageable = signature.parameters.some((p) => p.type.includes('Pageable'));
		if (!hasPageable) {
			return {
				message: `Repository method returning '${ret}' must declare a 'Pageable' parameter.`,
				severity: 'warning',
				startOffset: signature.startOffset + methodOffsetInSig,
				endOffset: signature.startOffset + methodOffsetInSig + signature.methodName.length,
				code: 'MISSING_PAGEABLE',
			};
		}
	}

	return undefined;
}

function validateParameters(
	signature: MethodSignatureInfo,
	parsed: ParsedDerivedMethod,
	propMap: Map<string, EntityProperty>,
): DerivedMethodValidationDiagnostic[] {
	const diagnostics: DerivedMethodValidationDiagnostic[] = [];

	// Filter out pagination & sorting parameters
	const normalParams = signature.parameters.filter(
		(p) => !['Pageable', 'Sort', 'Limit', 'ScrollPosition'].some((t) => p.type.includes(t)),
	);

	// Compute expected parameter count and types
	interface ExpectedParam {
		name: string;
		type: string;
		predicateText: string;
	}
	const expected: ExpectedParam[] = [];

	for (const predicate of parsed.predicates) {
		if (predicate.operator && PARAMETERLESS_OPERATORS.has(predicate.operator)) {
			continue;
		}

		const prop = findProperty(predicate.propertyName, propMap);
		const propType = prop?.type ?? 'Object';
		const baseParamName = prop?.name ?? uncapitalize(predicate.propertyName);

		if (predicate.operator && TWO_PARAMETER_OPERATORS.has(predicate.operator)) {
			expected.push({ name: `${baseParamName}Start`, type: propType, predicateText: predicate.rawText });
			expected.push({ name: `${baseParamName}End`, type: propType, predicateText: predicate.rawText });
		} else if (predicate.operator === 'In' || predicate.operator === 'NotIn') {
			expected.push({ name: `${baseParamName}s`, type: `Collection<${propType}>`, predicateText: predicate.rawText });
		} else {
			expected.push({ name: baseParamName, type: propType, predicateText: predicate.rawText });
		}
	}

	if (normalParams.length < expected.length) {
		const missingCount = expected.length - normalParams.length;
		const nextExpected = expected[normalParams.length];
		const methodOffsetInSig = signature.rawText.indexOf(signature.methodName);
		const start = signature.startOffset + methodOffsetInSig;
		const end = start + signature.methodName.length;

		diagnostics.push({
			message: `Derived query method '${signature.methodName}' expects at least ${expected.length} parameter(s) (${expected.map((e) => `${e.type} ${e.name}`).join(', ')}), but found ${normalParams.length}.`,
			severity: 'error',
			startOffset: start,
			endOffset: end,
			code: 'MISSING_PARAMETER',
			missingParam: nextExpected ? { name: nextExpected.name, type: nextExpected.type } : undefined,
		});
	} else if (normalParams.length > expected.length) {
		const methodOffsetInSig = signature.rawText.indexOf(signature.methodName);
		const start = signature.startOffset + methodOffsetInSig;
		diagnostics.push({
			message: `Derived query method '${signature.methodName}' expects ${expected.length} parameter(s), but found ${normalParams.length}.`,
			severity: 'error',
			startOffset: start,
			endOffset: start + signature.methodName.length,
			code: 'EXTRA_PARAMETER',
		});
	}

	const comparableCount = Math.min(normalParams.length, expected.length);
	for (let index = 0; index < comparableCount; index++) {
		const actual = normalizeType(normalParams[index].type);
		const expectedType = normalizeType(expected[index].type);
		if (!areCompatibleTypes(actual, expectedType)) {
			const methodOffsetInSig = signature.rawText.indexOf(signature.methodName);
			const parameterOffset = signature.rawText.indexOf(normalParams[index].name, methodOffsetInSig);
			const start = signature.startOffset + Math.max(parameterOffset, methodOffsetInSig);
			diagnostics.push({
				message: `Parameter '${normalParams[index].name}' has type '${normalParams[index].type}', but property '${expected[index].name}' expects '${expected[index].type}'.`,
				severity: 'error',
				startOffset: start,
				endOffset: start + normalParams[index].name.length,
				code: 'INVALID_PARAMETER_TYPE',
			});
		}
	}

	return diagnostics;
}

function normalizeType(type: string): string {
	return type.replace(/\s+/g, '').replace(/java\.lang\./g, '').replace(/java\.util\./g, '').toLowerCase();
}

function areCompatibleTypes(actual: string, expected: string): boolean {
	if (actual === expected || actual === 'object' || expected === 'object') {
		return true;
	}
	if (expected.startsWith('collection<') && /^(collection|list|set|iterable)<.+>$/.test(actual)) {
		const actualElement = actual.slice(actual.indexOf('<') + 1, -1);
		const expectedElement = expected.slice(expected.indexOf('<') + 1, -1);
		return areCompatibleTypes(actualElement, expectedElement);
	}
	const numeric = new Set(['byte', 'short', 'int', 'long', 'float', 'double', 'integer', 'bigdecimal', 'biginteger']);
	if (numeric.has(actual) && numeric.has(expected)) {
		return true;
	}
	return false;
}

function buildPropertyLookupMap(properties: readonly EntityProperty[]): Map<string, EntityProperty> {
	const map = new Map<string, EntityProperty>();
	for (const prop of properties) {
		map.set(prop.name.toLowerCase(), prop);
		// also support without underscores or lowercased
		map.set(prop.name.replace(/_/g, '').toLowerCase(), prop);
	}
	return map;
}

function findProperty(name: string, map: Map<string, EntityProperty>): EntityProperty | undefined {
	const cleaned = name.replace(/_/g, '').toLowerCase();
	return map.get(cleaned) ?? map.get(name.toLowerCase());
}

function uncapitalize(val: string): string {
	if (!val) return val;
	return val[0].toLowerCase() + val.slice(1);
}
