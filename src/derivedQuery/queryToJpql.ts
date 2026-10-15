import { parseDerivedMethodName, ParsedPredicate } from './queryParser';
import { MethodSignatureInfo } from './queryValidator';

export interface ConvertedJpqlResult {
	readonly jpqlQuery: string;
	readonly isModifying: boolean;
	readonly requiredImports: readonly string[];
}

export function convertDerivedQueryToJpql(
	signature: MethodSignatureInfo,
	entityName: string,
): ConvertedJpqlResult | undefined {
	const parsed = parseDerivedMethodName(signature.methodName);
	if (!parsed) {
		return undefined;
	}

	const alias = entityName.length > 0 ? entityName[0].toLowerCase() : 'e';
	const requiredImports: string[] = ['org.springframework.data.jpa.repository.Query'];
	let selectClause: string;
	let isModifying = false;

	if (parsed.isCount) {
		selectClause = `SELECT COUNT(${alias}) FROM ${entityName} ${alias}`;
	} else if (parsed.isExists) {
		selectClause = `SELECT CASE WHEN COUNT(${alias}) > 0 THEN TRUE ELSE FALSE END FROM ${entityName} ${alias}`;
	} else if (parsed.isDelete) {
		selectClause = `DELETE FROM ${entityName} ${alias}`;
		isModifying = true;
		requiredImports.push('org.springframework.data.jpa.repository.Modifying');
	} else {
		const distinct = parsed.subjectModifiers.includes('Distinct') ? 'DISTINCT ' : '';
		selectClause = `SELECT ${distinct}${alias} FROM ${entityName} ${alias}`;
	}

	const normalParams = signature.parameters.filter(
		(p) => !['Pageable', 'Sort', 'Limit', 'ScrollPosition'].some((t) => p.type.includes(t)),
	);

	const whereConditions: string[] = [];
	let paramIndex = 0;

	for (let i = 0; i < parsed.predicates.length; i++) {
		const pred = parsed.predicates[i];
		const propPath = pred.propertyName.includes('_')
			? pred.propertyName.split('_').map((seg, idx) => idx === 0 ? uncapitalize(seg) : seg).join('.')
			: uncapitalize(pred.propertyName);
		const fullPath = `${alias}.${propPath}`;

		const condition = formatPredicateCondition(fullPath, pred, normalParams, paramIndex);
		if (condition.paramIncrement > 0) {
			paramIndex += condition.paramIncrement;
			requiredImports.push('org.springframework.data.repository.query.Param');
		}

		if (i > 0 && pred.connector) {
			whereConditions.push(`${pred.connector.toUpperCase()} ${condition.expression}`);
		} else {
			whereConditions.push(condition.expression);
		}
	}

	let query = selectClause;
	if (whereConditions.length > 0) {
		query += ` WHERE ${whereConditions.join(' ')}`;
	}

	if (parsed.orderBy.length > 0) {
		const orderClauses = parsed.orderBy.map((o) => `${alias}.${uncapitalize(o.propertyName)} ${o.direction.toUpperCase()}`);
		query += ` ORDER BY ${orderClauses.join(', ')}`;
	}

	return {
		jpqlQuery: query,
		isModifying,
		requiredImports: [...new Set(requiredImports)],
	};
}

function formatPredicateCondition(
	fullPath: string,
	predicate: ParsedPredicate,
	params: readonly { name: string; type: string }[],
	paramIndex: number,
): { expression: string; paramIncrement: number } {
	const op = predicate.operator;
	const param = params[paramIndex]?.name ?? uncapitalize(predicate.propertyName);
	const targetParam = `:${param}`;
	const pathExpr = predicate.ignoreCase ? `LOWER(${fullPath})` : fullPath;
	const paramExpr = predicate.ignoreCase ? `LOWER(${targetParam})` : targetParam;

	switch (op) {
		case 'Containing':
		case 'IsContaining':
		case 'Contains':
			return { expression: `${pathExpr} LIKE CONCAT('%', ${paramExpr}, '%')`, paramIncrement: 1 };
		case 'StartingWith':
		case 'IsStartingWith':
			return { expression: `${pathExpr} LIKE CONCAT(${paramExpr}, '%')`, paramIncrement: 1 };
		case 'EndingWith':
		case 'IsEndingWith':
			return { expression: `${pathExpr} LIKE CONCAT('%', ${paramExpr})`, paramIncrement: 1 };
		case 'GreaterThan':
			return { expression: `${pathExpr} > ${paramExpr}`, paramIncrement: 1 };
		case 'GreaterThanEqual':
			return { expression: `${pathExpr} >= ${paramExpr}`, paramIncrement: 1 };
		case 'LessThan':
			return { expression: `${pathExpr} < ${paramExpr}`, paramIncrement: 1 };
		case 'LessThanEqual':
			return { expression: `${pathExpr} <= ${paramExpr}`, paramIncrement: 1 };
		case 'Between': {
			const param2 = params[paramIndex + 1]?.name ?? `${param}End`;
			return { expression: `${pathExpr} BETWEEN ${targetParam} AND :${param2}`, paramIncrement: 2 };
		}
		case 'In':
			return { expression: `${pathExpr} IN (${targetParam})`, paramIncrement: 1 };
		case 'NotIn':
			return { expression: `${pathExpr} NOT IN (${targetParam})`, paramIncrement: 1 };
		case 'Like':
			return { expression: `${pathExpr} LIKE ${paramExpr}`, paramIncrement: 1 };
		case 'NotLike':
			return { expression: `${pathExpr} NOT LIKE ${paramExpr}`, paramIncrement: 1 };
		case 'IsNot':
		case 'Not':
			return { expression: `${pathExpr} <> ${paramExpr}`, paramIncrement: 1 };
		case 'IsNull':
		case 'Null':
			return { expression: `${fullPath} IS NULL`, paramIncrement: 0 };
		case 'IsNotNull':
		case 'NotNull':
			return { expression: `${fullPath} IS NOT NULL`, paramIncrement: 0 };
		case 'IsTrue':
		case 'True':
			return { expression: `${fullPath} = TRUE`, paramIncrement: 0 };
		case 'IsFalse':
		case 'False':
			return { expression: `${fullPath} = FALSE`, paramIncrement: 0 };
		default:
			return { expression: `${pathExpr} = ${paramExpr}`, paramIncrement: 1 };
	}
}

function uncapitalize(value: string): string {
	return value.length > 0 ? value[0].toLowerCase() + value.slice(1) : value;
}
