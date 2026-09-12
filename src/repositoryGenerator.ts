export type RepositoryMethodKind = 'find' | 'exists' | 'delete';
export type RepositoryQueryOperator = 'Equals' | 'Containing' | 'StartingWith' | 'EndingWith' | 'In' | 'Between' | 'GreaterThan' | 'LessThan';

export interface RepositoryMethodGenerationInput {
	readonly entityName: string;
	readonly propertyName: string;
	readonly propertyType: string;
	readonly kind: RepositoryMethodKind;
	readonly operator?: RepositoryQueryOperator;
	readonly returnType?: string;
}

export function generateRepositoryMethod(input: RepositoryMethodGenerationInput): string {
	const suffix = capitalize(input.propertyName);
	const operator = input.operator && input.operator !== 'Equals' ? input.operator : '';
	const methodSuffix = `${suffix}${operator}`;
	const parameterType = input.operator === 'In' ? `Collection<${input.propertyType}>` : input.propertyType;
	const parameter = input.operator === 'Between'
		? `${input.propertyType} ${input.propertyName}Start, ${input.propertyType} ${input.propertyName}End`
		: `${parameterType} ${input.propertyName}`;

	switch (input.kind) {
		case 'exists':
			return `boolean existsBy${methodSuffix}(${parameter});`;
		case 'delete':
			return `void deleteBy${methodSuffix}(${parameter});`;
		default:
			return `${input.returnType ?? `Optional<${input.entityName}>`} findBy${methodSuffix}(${parameter});`;
	}
}

function capitalize(value: string): string {
	return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
