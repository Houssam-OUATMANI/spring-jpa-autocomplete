import { EntityInfo } from './entityModel';
import { createEntityLookup, findEntityByName, referencedEntityNames, resolveEntityHierarchy } from './entityDiscovery';
import { findClosestProperty } from './propertySuggestions';

export interface EntityDiagnostic {
	readonly message: string;
	readonly severity: 'error' | 'warning';
	readonly line: number;
	readonly character: number;
	readonly length: number;
	readonly code: 'MISSING_ID_ANNOTATION' | 'INVALID_MAPPED_BY' | 'FINAL_ENTITY_CLASS' | 'EAGER_COLLECTION_FETCH' | 'MISSING_ENTITY_ANNOTATION';
	readonly suggestedProperty?: string;
}

export function validateJpaEntities(
	entities: readonly EntityInfo[],
	allEntities: readonly EntityInfo[],
	documentText: string,
): readonly EntityDiagnostic[] {
	const diagnostics: EntityDiagnostic[] = [];
	const entityLookup = createEntityLookup(allEntities);

	for (const entity of entities) {
		// 0. Missing @Entity annotation check (when JPA mapping annotations are present on a class missing @Entity)
		if (entity.isEntity && entity.hasEntityAnnotation === false && !entity.isMappedSuperclass && !entity.isEmbeddable && !entity.isProjection) {
			const loc = entity.location ?? { line: 0, character: 0, length: entity.name.length };
			diagnostics.push({
				message: `Class '${entity.name}' has JPA mappings but is missing the '@Entity' annotation required by JPA.`,
				severity: 'error',
				line: loc.line,
				character: loc.character,
				length: loc.length,
				code: 'MISSING_ENTITY_ANNOTATION',
			});
		}

		// 1. Missing @Id check (only for genuine JPA entities)
		if (entity.isEntity && !entity.isMappedSuperclass && !entity.isEmbeddable && !entity.isProjection) {
			const resolved = resolveEntityHierarchy(entity, entityLookup);
			const hasId = resolved.properties.some((p) => p.isId);
			const hasIdClass = new RegExp(`@IdClass\\s*\\([\\s\\S]*?\\)\\s*(?:class|record)\\s+${entity.name}\\b`).test(documentText);

			if (!hasId && !hasIdClass) {
				const loc = entity.location ?? { line: 0, character: 0, length: entity.name.length };
				diagnostics.push({
					message: `JPA entity '${entity.name}' must define an identifier property (@Id or @EmbeddedId).`,
					severity: 'error',
					line: loc.line,
					character: loc.character,
					length: loc.length,
					code: 'MISSING_ID_ANNOTATION',
				});
			}
		}

		// 2. Final class inspection
		if (entity.isEntity && entity.isFinal) {
			const loc = entity.location ?? { line: 0, character: 0, length: entity.name.length };
			diagnostics.push({
				message: `JPA entity '${entity.name}' should not be declared 'final' as it prevents Hibernate lazy-loading proxy generation.`,
				severity: 'warning',
				line: loc.line,
				character: loc.character,
				length: loc.length,
				code: 'FINAL_ENTITY_CLASS',
			});
		}

		// 3. Property-level inspections: mappedBy consistency & EAGER collection fetch
		for (const prop of entity.properties) {
			if (prop.mappedBy) {
				const targetEntityName = prop.targetEntity
					?? referencedEntityNames(prop.type).find((name) => findEntityByName(entityLookup, name) !== undefined);
				const targetEntity = targetEntityName ? findEntityByName(entityLookup, targetEntityName) : undefined;

				if (targetEntity) {
					const resolvedTarget = resolveEntityHierarchy(targetEntity, entityLookup);
					const hasMappedProp = resolvedTarget.properties.some(
						(p) => p.name.toLowerCase() === prop.mappedBy!.toLowerCase(),
					);

					if (!hasMappedProp) {
						const suggestion = findClosestProperty(
							prop.mappedBy,
							resolvedTarget.properties.map((p) => p.name),
						);
						const loc = prop.location ?? { line: 0, character: 0, length: prop.name.length };
						diagnostics.push({
							message: `Target attribute '${prop.mappedBy}' does not exist in entity '${targetEntity.name}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
							severity: 'error',
							line: loc.line,
							character: loc.character,
							length: loc.length,
							code: 'INVALID_MAPPED_BY',
							suggestedProperty: suggestion,
						});
					}
				}
			}

			// Eager collection fetch inspection
			if (prop.fetchType === 'EAGER' && (prop.relation === 'OneToMany' || prop.relation === 'ManyToMany')) {
				const loc = prop.location ?? { line: 0, character: 0, length: prop.name.length };
				diagnostics.push({
					message: `Using 'FetchType.EAGER' on collection relation '${prop.name}' can cause N+1 query performance degradation. Consider using FetchType.LAZY.`,
					severity: 'warning',
					line: loc.line,
					character: loc.character,
					length: loc.length,
					code: 'EAGER_COLLECTION_FETCH',
				});
			}
		}
	}

	return diagnostics;
}
