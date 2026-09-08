import { EntityInfo } from '../entityModel';
import { JpqlQueryInfo } from './jpqlParser';
import { resolveEntityPropertyPath } from '../entityDiscovery';
import { findClosestProperty } from '../propertySuggestions';

export interface JpqlDiagnostic {
	readonly message: string;
	readonly severity: 'error' | 'warning';
	readonly startOffset: number;
	readonly endOffset: number;
	readonly code: 'UNKNOWN_ENTITY' | 'UNKNOWN_PROPERTY' | 'MISSING_METHOD_PARAM' | 'UNUSED_METHOD_PARAM' | 'MISSING_PARAM_ANNOTATION';
	readonly paramName?: string;
}

export function validateJpql(
	queryInfo: JpqlQueryInfo,
	knownEntities: readonly EntityInfo[],
): readonly JpqlDiagnostic[] {
	const diagnostics: JpqlDiagnostic[] = [];
	const entityMap = new Map(knownEntities.map((e) => [e.name.toLowerCase(), e]));

	// 1. Validate entities (skip if native SQL)
	if (!queryInfo.isNative && knownEntities.length > 0) {
		for (const ref of queryInfo.referencedEntities) {
			if (!entityMap.has(ref.name.toLowerCase())) {
				diagnostics.push({
					message: `Unknown JPA entity '${ref.name}'.`,
					severity: 'error',
					startOffset: ref.startOffset,
					endOffset: ref.endOffset,
					code: 'UNKNOWN_ENTITY',
				});
			}
		}
	}

	// 2. Validate property accesses on aliases: alias.property
	if (!queryInfo.isNative) {
		for (const propAccess of queryInfo.propertyAccesses) {
			const targetEntityName = queryInfo.aliases.get(propAccess.alias);
			if (targetEntityName) {
				const entity = entityMap.get(targetEntityName.toLowerCase());
				if (entity) {
					const hasProp = resolveEntityPropertyPath(entity, propAccess.property, entityMap) !== undefined;
					if (!hasProp) {
						const suggestion = findClosestProperty(propAccess.property.split('.').pop() ?? propAccess.property, entity.properties.map((property) => property.name));
						diagnostics.push({
							message: `Unknown property '${propAccess.property}' on entity '${entity.name}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
							severity: 'error',
							startOffset: propAccess.startOffset,
							endOffset: propAccess.endOffset,
							code: 'UNKNOWN_PROPERTY',
						});
					}
				}
			}
		}
	}

	// 3. Validate named parameters vs method parameters
	if (queryInfo.methodSignature) {
		const methodParams = queryInfo.methodSignature.parameters;
		const methodParamNames = new Set(
			methodParams.map((p) => (p.paramName ?? p.name).toLowerCase()),
		);

		const queryParamNames = new Set<string>();

		for (const namedParam of queryInfo.namedParameters) {
			queryParamNames.add(namedParam.name.toLowerCase());
			if (methodParams.length > 0 && !methodParamNames.has(namedParam.name.toLowerCase())) {
				diagnostics.push({
					message: `Named parameter ':${namedParam.name}' is not declared by method '${queryInfo.methodSignature.methodName}'.`,
					severity: 'error',
					startOffset: namedParam.startOffset,
					endOffset: namedParam.endOffset,
					code: 'MISSING_METHOD_PARAM',
					paramName: namedParam.name,
				});
			}
		}

		// Also check if any named parameter is missing @Param annotation when there are multiple parameters
		if (methodParams.length > 1) {
			for (const p of methodParams) {
				if (!p.isParamAnnotated && queryParamNames.has(p.name.toLowerCase())) {
					diagnostics.push({
						message: `Method parameter '${p.name}' is used in @Query but missing '@Param(\"${p.name}\")' annotation.`,
						severity: 'warning',
						startOffset: p.startOffset,
						endOffset: p.endOffset,
						code: 'MISSING_PARAM_ANNOTATION',
						paramName: p.name,
					});
				}
			}
		}

		// Check unused parameters (ignoring Pageable / Sort)
		if (queryInfo.namedParameters.length > 0) {
			for (const p of methodParams) {
				if (['Pageable', 'Sort', 'Limit'].some((t) => p.type.includes(t))) {
					continue;
				}
				const effectiveName = (p.paramName ?? p.name).toLowerCase();
				if (!queryParamNames.has(effectiveName)) {
					diagnostics.push({
						message: `Method parameter '${p.name}' is not used in the query.`,
						severity: 'warning',
						startOffset: p.startOffset,
						endOffset: p.endOffset,
						code: 'UNUSED_METHOD_PARAM',
						paramName: p.name,
					});
				}
			}
		}
	}

	return diagnostics;
}
