import { EntityProperty } from './jpaKeywords';

export interface JpqlValidationResult {
	readonly message: string;
	readonly token: string;
}

export function extractJpqlNamedParameters(query: string): readonly string[] {
	return [...new Set([...query.matchAll(/:([A-Za-z_]\w*)/g)].map((match) => match[1]))];
}

export function extractJpqlEntityNames(query: string): readonly string[] {
	return [...query.matchAll(/\b(?:from|join)\s+([A-Z]\w*)\b/g)].map((match) => match[1]);
}

export function validateJpqlQuery(
	query: string,
	methodParameters: readonly string[],
	properties: readonly EntityProperty[],
	entityNames: readonly string[] = [],
): readonly JpqlValidationResult[] {
	const results: JpqlValidationResult[] = [];
	const namedParameters = extractJpqlNamedParameters(query);
	const methodParameterSet = new Set(methodParameters);
	const propertyNames = new Set(properties.map((property) => property.name));
	const knownEntities = new Set(entityNames);

	for (const entityName of extractJpqlEntityNames(query)) {
		if (knownEntities.size > 0 && !knownEntities.has(entityName)) {
			results.push({ message: `Unknown JPA entity '${entityName}'.`, token: entityName });
		}
	}
	for (const parameter of namedParameters) {
		if (!methodParameterSet.has(parameter)) {
			results.push({ message: `Named parameter ':${parameter}' is not declared by the method.`, token: parameter });
		}
	}
	for (const parameter of methodParameters) {
		if (!namedParameters.includes(parameter) && namedParameters.length > 0) {
			results.push({ message: `Method parameter '${parameter}' is not used by the query.`, token: parameter });
		}
	}

	for (const match of query.matchAll(/\b[A-Za-z_]\w*\.([A-Za-z_]\w*)\b/g)) {
		const property = match[1];
		if (propertyNames.size > 0 && !propertyNames.has(property) && !propertyNames.has(property[0].toLowerCase() + property.slice(1))) {
			results.push({ message: `Unknown entity property '${property}'.`, token: property });
		}
	}

	return results;
}