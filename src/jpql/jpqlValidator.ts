import { EntityInfo } from '../entityModel';
import { JpqlQueryInfo } from './jpqlParser';
import { createEntityLookup, resolveEntityPropertyPath } from '../entityDiscovery';
import { findClosestProperty } from '../propertySuggestions';

export interface JpqlDiagnostic {
	readonly message: string;
	readonly severity: 'error' | 'warning';
	readonly startOffset: number;
	readonly endOffset: number;
	readonly code: 'UNKNOWN_ENTITY' | 'UNKNOWN_PROPERTY' | 'MISSING_METHOD_PARAM' | 'UNUSED_METHOD_PARAM' | 'MISSING_PARAM_ANNOTATION' | 'INVALID_RETURN_TYPE' | 'INVALID_PARAMETER_TYPE';
	readonly paramName?: string;
}

export function validateJpql(
	queryInfo: JpqlQueryInfo,
	knownEntities: readonly EntityInfo[],
): readonly JpqlDiagnostic[] {
	const diagnostics: JpqlDiagnostic[] = [];
	const entityMap = createEntityLookup(knownEntities, queryInfo.repositoryPackage);

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
		validateReturnType(queryInfo, entityMap, diagnostics);
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
			const methodParam = methodParams.find((parameter) =>
				(parameter.paramName ?? parameter.name).toLowerCase() === namedParam.name.toLowerCase(),
			);
			if (methodParams.length > 0 && !methodParam) {
				diagnostics.push({
					message: `Named parameter ':${namedParam.name}' is not declared by method '${queryInfo.methodSignature.methodName}'.`,
					severity: 'error',
					startOffset: namedParam.startOffset,
					endOffset: namedParam.endOffset,
					code: 'MISSING_METHOD_PARAM',
					paramName: namedParam.name,
				});
			} else if (methodParam) {
				const propertyType = findParameterPropertyType(queryInfo, namedParam, entityMap);
				if (propertyType && !areJpqlParameterTypesCompatible(propertyType, methodParam.type)) {
					diagnostics.push({
						message: `Parameter ':${namedParam.name}' expects type '${propertyType}', but method parameter '${methodParam.name}' has type '${methodParam.type}'.`,
						severity: 'error',
						startOffset: methodParam.startOffset,
						endOffset: methodParam.endOffset,
						code: 'INVALID_PARAMETER_TYPE',
						paramName: namedParam.name,
					});
				}
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

function findParameterPropertyType(
	queryInfo: JpqlQueryInfo,
	namedParameter: JpqlQueryInfo['namedParameters'][number],
	entityMap: Map<string, EntityInfo>,
): string | undefined {
	const precedingAccesses = queryInfo.propertyAccesses
		.filter((access) => access.endOffset <= namedParameter.startOffset)
		.filter((access) => /^[\s=<>!+*/-]*$/.test(queryInfo.queryContent.slice(access.contentEnd, namedParameter.contentStart)));
	const access = precedingAccesses[precedingAccesses.length - 1];
	if (!access) {
		return undefined;
	}
	const entityName = queryInfo.aliases.get(access.alias);
	const entity = entityName ? entityMap.get(entityName.toLowerCase()) : undefined;
	return entity ? resolveEntityPropertyPath(entity, access.property, entityMap)?.type : undefined;
}

function areJpqlParameterTypesCompatible(propertyType: string, parameterType: string): boolean {
	const property = normalizeJavaType(propertyType);
	const parameter = normalizeJavaType(parameterType);
	if (property === parameter) {
		return true;
	}
	const parameterElement = parameter.match(/^(?:Collection|List|Set|Iterable|Stream)<(.+)>$/)?.[1];
	return parameterElement === property;
}

function normalizeJavaType(type: string): string {
	return type
		.replace(/^\?\s*(?:extends|super)\s+/, '')
		.replace(/^.*\./, '')
		.replace(/\s+/g, '');
}

function validateReturnType(
	queryInfo: JpqlQueryInfo,
	entityMap: Map<string, EntityInfo>,
	diagnostics: JpqlDiagnostic[],
): void {
	if (!queryInfo.methodSignature || !queryInfo.selectedAlias) {
		return;
	}
	if (!/^[A-Za-z_$][\w$]*(?:\s*<.*>)?(?:\[\])?$/.test(queryInfo.methodSignature.returnType.trim())) {
		return;
	}

	const selectedEntityName = queryInfo.aliases.get(queryInfo.selectedAlias);
	if (!selectedEntityName || !entityMap.has(selectedEntityName.toLowerCase())) {
		return;
	}

	const returnType = queryInfo.methodSignature.returnType.replace(/\s+/g, '');
	const entityName = selectedEntityName;
	const isCollection = /^(?:List|Set|Collection|Iterable|Stream)<.+>$/.test(returnType);
	const isOptional = returnType === `Optional<${entityName}>`;
	const isPage = returnType === `Page<${entityName}>` || returnType === `Slice<${entityName}>`;
	const isEntity = returnType === entityName;
	if (isCollection || isOptional || isPage || isEntity) {
		return;
	}

	const returnStart = queryInfo.methodSignature.startOffset + queryInfo.rawQuery.indexOf(queryInfo.methodSignature.returnType);
	diagnostics.push({
		message: `JPQL query selects '${entityName}', but method returns '${queryInfo.methodSignature.returnType}'.`,
		severity: 'error',
		startOffset: returnStart,
		endOffset: returnStart + queryInfo.methodSignature.returnType.length,
		code: 'INVALID_RETURN_TYPE',
	});
}
