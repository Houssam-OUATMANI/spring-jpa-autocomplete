import { EntityInfo, EntityProperty, JpaRelation, PropertyLocation } from './entityModel';

interface CstNode {
	readonly name: string;
	readonly children: Record<string, AstElement[]>;
	readonly location: { readonly startOffset: number; readonly endOffset: number };
}

interface IToken {
	readonly image: string;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly tokenType: { readonly name: string };
}

type AstElement = CstNode | IToken;

const { parse } = require('java-parser') as { parse: (source: string) => CstNode };

export function parseEntityModelAst(text: string, uri: EntityInfo['uri']): EntityInfo | undefined {
	const root = parse(text);
	const unit = childNodes(root, 'ordinaryCompilationUnit')[0];
	if (!unit) {
		return undefined;
	}
	const packageDeclaration = childNodes(unit, 'packageDeclaration')[0];
	const packageIdentifiers = childTokens(packageDeclaration, 'Identifier');
	const packageName = packageIdentifiers.length > 0
		? text.slice(packageIdentifiers[0].startOffset, packageIdentifiers.at(-1)!.endOffset + 1)
		: undefined;

	for (const typeDeclaration of childNodes(unit, 'typeDeclaration')) {
		const classDeclaration = childNodes(typeDeclaration, 'classDeclaration')[0];
		const interfaceDeclaration = childNodes(typeDeclaration, 'interfaceDeclaration')[0];
		const declaration = classDeclaration ?? interfaceDeclaration;
		if (!declaration) {
			continue;
		}

		const typeAnnotations = annotationDetails(
			[...childNodes(declaration, 'classModifier'), ...childNodes(declaration, 'interfaceModifier')],
			text,
		);
		const annotations = new Set(typeAnnotations.map((annotation) => annotation.name));
		const record = descendant(classDeclaration, 'recordDeclaration');
		const normalClass = descendant(classDeclaration, 'normalClassDeclaration');
		const normalInterface = descendant(interfaceDeclaration, 'normalInterfaceDeclaration');
		const declarationBody = record
			? childNodes(record, 'recordBody')[0]
			: normalClass
				? childNodes(normalClass, 'classBody')[0]
				: normalInterface
					? childNodes(normalInterface, 'interfaceBody')[0]
					: undefined;
		const namedDeclaration = normalClass ?? normalInterface ?? record;
		const identifier = childTokens(childNodes(namedDeclaration, 'typeIdentifier')[0], 'Identifier')[0];
		if (!identifier) {
			continue;
		}

		const properties = new Map<string, EntityProperty>();
		if (record) {
			for (const component of descendants(record, 'recordComponent')) {
				const nameToken = childTokens(component, 'Identifier').at(-1);
				const componentType = childNodes(component, 'unannType')[0];
				if (nameToken && componentType) {
					const property = createProperty(
						nameToken.image,
						textOf(componentType, text),
						[],
						[],
						nameToken,
						text,
					);
					if (property) {
						properties.set(property.name, property);
					}
				}
			}
		} else if (normalClass) {
			for (const bodyDeclaration of childNodes(declarationBody!, 'classBodyDeclaration')) {
				const member = childNodes(bodyDeclaration, 'classMemberDeclaration')[0];
				if (!member) {
					continue;
				}
				const field = childNodes(member, 'fieldDeclaration')[0];
				if (field) {
					addFields(field, text, properties);
				}
				const method = childNodes(member, 'methodDeclaration')[0];
				if (method) {
					addGetter(method, text, properties);
				}
			}
		} else if (normalInterface) {
			for (const member of childNodes(declarationBody!, 'interfaceMemberDeclaration')) {
				const method = childNodes(member, 'interfaceMethodDeclaration')[0];
				if (method) {
					addGetter(method, text, properties);
				}
			}
		}

		const isEntity = annotations.has('Entity');
		const isMappedSuperclass = annotations.has('MappedSuperclass');
		const isEmbeddable = annotations.has('Embeddable');
		const isProjection = Boolean(normalInterface && properties.size > 0);
		if (!isEntity && !isMappedSuperclass && !isEmbeddable && !record && !isProjection) {
			continue;
		}

		const superType = childNodes(normalClass!, 'classExtends')[0];
		const superClassType = childNodes(superType, 'classType')[0];
		const superclassName = superClassType ? allTokens(superClassType).find((token) => token.tokenType.name === 'Identifier')?.image : undefined;
		return {
			name: identifier.image,
			entityName: annotationValue(typeAnnotations, 'Entity', 'name'),
			tableName: annotationValue(typeAnnotations, 'Table', 'name'),
			packageName,
			uri,
			isProjection: isProjection || undefined,
			superclassName,
			isMappedSuperclass,
			isEmbeddable,
			properties: record
				? [...properties.values()]
				: [...properties.values()].sort((left, right) => left.name.localeCompare(right.name)),
			location: location(text, identifier.startOffset, identifier.endOffset - identifier.startOffset + 1),
		};
	}

	return undefined;
}

function addFields(field: CstNode, text: string, properties: Map<string, EntityProperty>): void {
	const modifiers = childNodes(field, 'fieldModifier');
	const annotations = annotationDetails(modifiers, text);
	const modifierTokens = modifiers.flatMap((modifier) => allTokens(modifier).map((token) => token.image));
	const type = childNodes(field, 'unannType')[0];
	const declaratorList = childNodes(field, 'variableDeclaratorList')[0];
	if (!type || !declaratorList) {
		return;
	}
	for (const declarator of childNodes(declaratorList, 'variableDeclarator')) {
		const nameToken = childTokens(childNodes(declarator, 'variableDeclaratorId')[0], 'Identifier')[0];
		if (!nameToken) {
			continue;
		}
		const property = createProperty(nameToken.image, textOf(type, text), annotations, modifierTokens, nameToken, text);
		if (property) {
			properties.set(property.name, property);
		}
	}
}

function addGetter(method: CstNode, text: string, properties: Map<string, EntityProperty>): void {
	const header = childNodes(method, 'methodHeader')[0];
	const declarator = childNodes(header, 'methodDeclarator')[0];
	const nameToken = childTokens(declarator, 'Identifier')[0];
	const result = childNodes(header, 'result')[0];
	if (!nameToken || !result || childNodes(declarator, 'formalParameterList').length > 0) {
		return;
	}
	const match = nameToken.image.match(/^(?:get|is|has)([A-Z]\w*)$/);
	if (!match) {
		return;
	}
	const name = match[1][0].toLowerCase() + match[1].slice(1);
	if (!properties.has(name)) {
		properties.set(name, {
			name,
			type: textOf(result, text),
			location: location(text, nameToken.startOffset, nameToken.endOffset - nameToken.startOffset + 1),
		});
	}
}

function createProperty(
	name: string,
	type: string,
	annotations: readonly { name: string; text: string }[],
	modifiers: readonly string[],
	nameToken: IToken,
	text: string,
): EntityProperty | undefined {
	if (modifiers.includes('static') || modifiers.includes('transient') || annotations.some((annotation) => annotation.name === 'Transient')) {
		return undefined;
	}
	const relationNames: readonly JpaRelation[] = ['OneToOne', 'OneToMany', 'ManyToOne', 'ManyToMany', 'ElementCollection', 'EmbeddedId', 'Embedded'];
	const relation = annotations.map((annotation) => relationNames.find((relationName) => annotation.name === relationName)).find(Boolean);
	const targetEntity = annotations.map((annotation) => annotation.text.match(/\btargetEntity\s*=\s*([\w$.]+)\.class/)?.[1]).find(Boolean);
	const columnName = annotationValue(annotations, 'Column', 'name') ?? annotationValue(annotations, 'JoinColumn', 'name');
	return {
		name,
		type,
		isId: annotations.some((annotation) => annotation.name === 'Id' || annotation.name === 'EmbeddedId'),
		relation,
		targetEntity,
		columnName,
		isCollection: /\b(?:Collection|List|Set|Iterable|Map)\s*</.test(type) || /\[\]/.test(type),
		location: location(text, nameToken.startOffset, nameToken.endOffset - nameToken.startOffset + 1),
	};
}

function annotationDetails(modifiers: readonly CstNode[], text: string): { name: string; text: string }[] {
	return modifiers.flatMap((modifier) => descendants(modifier, 'annotation').map((annotation) => {
		const typeName = childNodes(annotation, 'typeName')[0];
		const qualifiedName = typeName ? textOf(typeName, text).replace(/^@/, '') : '';
		return { name: qualifiedName.split('.').at(-1) ?? '', text: textOf(annotation, text) };
	}));
}

function textOf(node: CstNode | undefined, text: string): string {
	return node ? text.slice(node.location.startOffset, node.location.endOffset + 1).trim() : '';
}

function childNodes(node: CstNode | undefined, key: string): CstNode[] {
	return (node?.children[key] ?? []).filter((element): element is CstNode => isNode(element));
}

function childTokens(node: CstNode | undefined, key: string): IToken[] {
	return (node?.children[key] ?? []).filter((element): element is IToken => !isNode(element));
}

function isNode(element: AstElement): element is CstNode {
	return 'children' in element;
}

function descendant(node: CstNode | undefined, name: string): CstNode | undefined {
	return descendants(node, name)[0];
}

function descendants(node: CstNode | undefined, name: string): CstNode[] {
	const results: CstNode[] = [];
	if (!node) {
		return results;
	}
	const visit = (current: CstNode) => {
		for (const elements of Object.values(current.children)) {
			for (const element of elements) {
				if (!isNode(element)) {
					continue;
				}
				if (element.name === name) {
					results.push(element);
				}
				visit(element);
			}
		}
	};
	visit(node);
	return results;
}

function allTokens(node: CstNode): IToken[] {
	const tokens: IToken[] = [];
	for (const elements of Object.values(node.children)) {
		for (const element of elements) {
			if (isNode(element)) {
				tokens.push(...allTokens(element));
			} else {
				tokens.push(element);
			}
		}
	}
	return tokens;
}

function location(text: string, offset: number, length: number): PropertyLocation {
	const before = text.slice(0, offset);
	const lines = before.split(/\r?\n/);
	return { line: lines.length - 1, character: lines.at(-1)!.length, length };
}

function annotationValue(annotations: readonly { name: string; text: string }[], annotationName: string, propertyName: string): string | undefined {
	return annotations.find((annotation) => annotation.name === annotationName)?.text
		.match(new RegExp(`\\b${propertyName}\\s*=\\s*"([^"]+)"`))?.[1];
}