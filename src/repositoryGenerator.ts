export type RepositoryMethodKind = 'find' | 'read' | 'get' | 'query' | 'search' | 'stream' | 'count' | 'exists' | 'delete' | 'remove';
export type RepositoryQueryOperator = 'Equals' | 'Containing' | 'StartingWith' | 'EndingWith' | 'In' | 'NotIn' | 'Between' | 'GreaterThan' | 'LessThan' | 'IsNull' | 'IsNotNull' | 'True' | 'False';

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
	const parameterType = input.operator === 'In' || input.operator === 'NotIn' ? `Collection<${input.propertyType}>` : input.propertyType;
	const parameter = ['IsNull', 'IsNotNull', 'True', 'False'].includes(input.operator ?? '')
		? ''
		: input.operator === 'Between'
		? `${input.propertyType} ${input.propertyName}Start, ${input.propertyType} ${input.propertyName}End`
		: `${parameterType} ${input.propertyName}`;
	const pageableParameter = /^(?:Page|Slice)</.test(input.returnType ?? '')
		? `${parameter ? ', ' : ''}Pageable pageable`
		: '';
	const parameters = `${parameter}${pageableParameter}`;

	switch (input.kind) {
		case 'exists':
			return `boolean existsBy${methodSuffix}(${parameter});`;
		case 'count':
			return `long countBy${methodSuffix}(${parameter});`;
		case 'delete':
			return `void deleteBy${methodSuffix}(${parameter});`;
		case 'remove':
			return `void removeBy${methodSuffix}(${parameter});`;
		case 'stream':
			return `Stream<${input.entityName}> streamBy${methodSuffix}(${parameter});`;
		case 'read':
			return `${input.returnType ?? `Optional<${input.entityName}>`} readBy${methodSuffix}(${parameters});`;
		case 'get':
			return `${input.returnType ?? `Optional<${input.entityName}>`} getBy${methodSuffix}(${parameters});`;
		case 'query':
			return `${input.returnType ?? `Optional<${input.entityName}>`} queryBy${methodSuffix}(${parameters});`;
		case 'search':
			return `${input.returnType ?? `Optional<${input.entityName}>`} searchBy${methodSuffix}(${parameters});`;
		default:
			return `${input.returnType ?? `Optional<${input.entityName}>`} findBy${methodSuffix}(${parameters});`;
	}
}

function capitalize(value: string): string {
	return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
