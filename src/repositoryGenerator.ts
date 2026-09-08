export type RepositoryMethodKind = 'find' | 'exists' | 'delete';

export interface RepositoryMethodGenerationInput {
	readonly entityName: string;
	readonly propertyName: string;
	readonly propertyType: string;
	readonly kind: RepositoryMethodKind;
}

export function generateRepositoryMethod(input: RepositoryMethodGenerationInput): string {
	const suffix = capitalize(input.propertyName);
	const parameter = `${input.propertyType} ${input.propertyName}`;

	switch (input.kind) {
		case 'exists':
			return `boolean existsBy${suffix}(${parameter});`;
		case 'delete':
			return `void deleteBy${suffix}(${parameter});`;
		default:
			return `Optional<${input.entityName}> findBy${suffix}(${parameter});`;
	}
}

function capitalize(value: string): string {
	return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
