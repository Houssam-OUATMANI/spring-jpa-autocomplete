import { createEntityLookup, resolveEntityHierarchy } from '../entityDiscovery';
import { EntityInfo, EntityProperty } from '../entityModel';
import { MethodSignatureInfo } from './queryValidator';
import { parseDerivedMethodName, ParsedPredicate } from './queryParser';

export interface ConvertedMongoQueryResult {
	readonly mongoQuery: string;
	readonly annotationOptions: readonly string[];
	readonly requiredImports: readonly string[];
}

export function convertDerivedQueryToMongoQuery(
	signature: MethodSignatureInfo,
	entityName: string,
	entities: readonly EntityInfo[] = [],
	repositoryText?: string,
): ConvertedMongoQueryResult | undefined {
	const parsed = parseDerivedMethodName(signature.methodName);
	if (!parsed
		|| parsed.subjectModifiers.length > 0
		|| parsed.predicates.length === 0) {
		return undefined;
	}

	const predicates: string[] = [];
	const bindableParameters = signature.parameters.filter(
		(parameter) => !['Pageable', 'Sort', 'Limit', 'ScrollPosition'].some((type) => parameter.type.includes(type)),
	);
	let parameterIndex = 0;
	for (const predicate of parsed.predicates) {
		if (predicate.ignoreCase && !isRegexPredicate(predicate.operator)) {
			return undefined;
		}
		const fieldPath = resolveMongoPropertyPath(entityName, predicate.propertyName, entities, repositoryText);
		if (!fieldPath) {
			return undefined;
		}
		const formatted = formatMongoPredicate(fieldPath, predicate, parameterIndex);
		if (!formatted) {
			return undefined;
		}
		predicates.push(formatted.query);
		parameterIndex += formatted.parameterCount;
	}
	if (parameterIndex !== bindableParameters.length) {
		return undefined;
	}

	const query = groupPredicates(predicates, parsed.predicates);
	const annotationOptions: string[] = [];
	if (parsed.isCount) {
		annotationOptions.push('count = true');
	} else if (parsed.isExists) {
		annotationOptions.push('exists = true');
	} else if (parsed.isDelete) {
		annotationOptions.push('delete = true');
	}

	if (parsed.orderBy.length > 0) {
		const sortEntries = parsed.orderBy.map((order) => {
			const path = resolveMongoPropertyPath(entityName, order.propertyName, entities, repositoryText);
			return path ? `'${path}': ${order.direction === 'Asc' ? 1 : -1}` : undefined;
		});
		if (sortEntries.some((entry) => entry === undefined)) {
			return undefined;
		}
		annotationOptions.push(`sort = "{ ${sortEntries.join(', ')} }"`);
	}

	return {
		mongoQuery: query,
		annotationOptions,
		requiredImports: ['org.springframework.data.mongodb.repository.Query'],
	};
}

function formatMongoPredicate(
	fieldPath: string,
	predicate: ParsedPredicate,
	parameterIndex: number,
): { query: string; parameterCount: number } | undefined {
	const field = `'${fieldPath}'`;
	const parameter = `?${parameterIndex}`;
	const operator = predicate.operator;

	if (!operator || ['Is', 'Equals'].includes(operator)) {
		return { query: `${field}: ${parameter}`, parameterCount: 1 };
	}
	const comparisonOperators: Readonly<Record<string, string>> = {
		GreaterThan: '$gt',
		GreaterThanEqual: '$gte',
		LessThan: '$lt',
		LessThanEqual: '$lte',
		Before: '$lt',
		After: '$gt',
		Not: '$ne',
		IsNot: '$ne',
		In: '$in',
		NotIn: '$nin',
	};
	const comparisonOperator = comparisonOperators[operator];
	if (comparisonOperator) {
		return { query: `${field}: { '${comparisonOperator}': ${parameter} }`, parameterCount: 1 };
	}

	if (operator === 'Between') {
		return {
			query: `${field}: { '$gte': ${parameter}, '$lte': ?${parameterIndex + 1} }`,
			parameterCount: 2,
		};
	}
	if (['IsNull', 'Null'].includes(operator)) {
		return { query: `${field}: null`, parameterCount: 0 };
	}
	if (['IsNotNull', 'NotNull'].includes(operator)) {
		return { query: `${field}: { '$ne': null }`, parameterCount: 0 };
	}
	if (['IsTrue', 'True'].includes(operator)) {
		return { query: `${field}: true`, parameterCount: 0 };
	}
	if (['IsFalse', 'False'].includes(operator)) {
		return { query: `${field}: false`, parameterCount: 0 };
	}
	if (operator === 'IsEmpty') {
		return { query: `${field}: { '$size': 0 }`, parameterCount: 0 };
	}
	if (operator === 'IsNotEmpty') {
		return { query: `${field}: { '$not': { '$size': 0 } }`, parameterCount: 0 };
	}
	if (isRegexPredicate(operator)) {
		const options = predicate.ignoreCase ? `, '$options': 'i'` : '';
		const regex = `${field}: { '$regex': ${parameter}${options} }`;
		return {
			query: ['NotContaining', 'IsNotContaining', 'NotLike'].includes(operator)
				? `${field}: { '$not': { '$regex': ${parameter}${options} } }`
				: regex,
			parameterCount: 1,
		};
	}
	return undefined;
}

function isRegexPredicate(operator?: string): boolean {
	return operator !== undefined && [
		'Like',
		'NotLike',
		'Containing',
		'IsContaining',
		'Contains',
		'NotContaining',
		'IsNotContaining',
	].includes(operator);
}

function groupPredicates(predicates: readonly string[], parsed: readonly ParsedPredicate[]): string {
	const orGroups: string[][] = [[]];
	predicates.forEach((predicate, index) => {
		if (index > 0 && parsed[index].connector === 'Or') {
			orGroups.push([]);
		}
		orGroups[orGroups.length - 1].push(predicate);
	});

	const groups = orGroups.map((group) => group.length === 1
		? `{ ${group[0]} }`
		: `{ '$and': [ ${group.map((item) => `{ ${item} }`).join(', ')} ] }`);
	return groups.length === 1 ? groups[0] : `{ '$or': [ ${groups.join(', ')} ] }`;
}

function resolveMongoPropertyPath(
	entityName: string,
	derivedPropertyName: string,
	entities: readonly EntityInfo[],
	repositoryText?: string,
): string | undefined {
	const packageName = repositoryText?.match(/\bpackage\s+([\w.]+)\s*;/)?.[1];
	const lookup = createEntityLookup(entities, packageName, repositoryText);
	let currentEntity = lookup.get(entityName.toLowerCase());
	const javaPath = currentEntity
		? resolveJavaPropertyPath(currentEntity, derivedPropertyName, lookup)
		: undefined;
	if (!javaPath) {
		return undefined;
	}
	const mappedSegments: string[] = [];
	for (const segment of javaPath.split('.')) {
		const property = currentEntity
			? resolveEntityHierarchy(currentEntity, lookup).properties.find((candidate) => candidate.name.toLowerCase() === segment.toLowerCase())
			: undefined;
		if (!property) {
			return undefined;
		}
		mappedSegments.push(property.mongoFieldName ?? property.name);
		currentEntity = resolveMongoPropertyTarget(property, lookup);
	}
	return mappedSegments.join('.');
}

function resolveJavaPropertyPath(
	root: EntityInfo,
	derivedName: string,
	lookup: ReadonlyMap<string, EntityInfo>,
): string | undefined {
	if (derivedName.includes('_')) {
		const segments = derivedName.split('_');
		let currentEntity = root;
		const path: string[] = [];
		for (const [index, segment] of segments.entries()) {
			const property = resolveEntityHierarchy(currentEntity, lookup).properties.find(
				(candidate) => candidate.name.toLowerCase() === uncapitalize(segment).toLowerCase(),
			);
			if (!property) {
				return undefined;
			}
			path.push(property.name);
			const target = resolveMongoPropertyTarget(property, lookup);
			if (index < segments.length - 1 && !target) {
				return undefined;
			}
			if (target) {
				currentEntity = target;
			}
		}
		return path.join('.');
	}

	const resolveCamelPath = (
		entity: EntityInfo,
		remaining: string,
		visited: ReadonlySet<string>,
	): string | undefined => {
		const properties = resolveEntityHierarchy(entity, lookup).properties;
		const direct = properties.find((property) => capitalize(property.name) === remaining);
		if (direct) {
			return direct.name;
		}
		for (const property of properties) {
			const prefix = capitalize(property.name);
			if (!remaining.startsWith(prefix) || remaining.length === prefix.length) {
				continue;
			}
			const target = resolveMongoPropertyTarget(property, lookup);
			if (!target) {
				continue;
			}
			const key = `${target.uri.toString()}:${target.name}`;
			if (visited.has(key)) {
				continue;
			}
			const nested = resolveCamelPath(target, remaining.slice(prefix.length), new Set(visited).add(key));
			if (nested) {
				return `${property.name}.${nested}`;
			}
		}
		return undefined;
	};
	return resolveCamelPath(root, derivedName, new Set([`${root.uri.toString()}:${root.name}`]));
}

function resolveMongoPropertyTarget(
	property: EntityProperty,
	lookup: ReadonlyMap<string, EntityInfo>,
): EntityInfo | undefined {
	const candidates = property.targetEntity
		? [property.targetEntity.split('.').at(-1)!]
		: [...property.type.matchAll(/[A-Z]\w*/g)].map((match) => match[0]);
	return candidates
		.map((name) => lookup.get(name.toLowerCase()))
		.find((entity): entity is EntityInfo => entity !== undefined);
}

function uncapitalize(value: string): string {
	return value.length > 0 ? value[0].toLowerCase() + value.slice(1) : value;
}

function capitalize(value: string): string {
	return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
