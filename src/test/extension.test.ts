import * as assert from 'assert';
import * as vscode from 'vscode';
import { extractRepositoryEntityNameAt, extractRepositoryEntityNames, findEntityProperties, parseEntity, resolveEntityHierarchy, resolveEntityPropertyPath, resolveEntityPropertyPathWithOwner, WorkspaceEntityIndex } from '../entityDiscovery';
import { parseEntityModel } from '../entityModel';
import { createQueryMethodSuggestions, extractPropertyNames, isJpaPrefix, isRepositoryMethodContext, JPA_KEYWORDS, validateDerivedMethod } from '../jpaKeywords';
import { extractJpqlEntityNames, extractJpqlNamedParameters, validateJpqlQuery } from '../jpql';
import { createKeywordItem, extractMethodParameterNames, shouldDisplayDiagnostic } from '../extension';
import { parseDerivedMethodName } from '../derivedQuery/queryParser';
import { validateDerivedMethodSignature } from '../derivedQuery/queryValidator';
import { extractAllJpqlQueries } from '../jpql/jpqlParser';
import { validateJpql } from '../jpql/jpqlValidator';
import { SpringJpaCodeActionProvider } from '../actions/codeActionProvider';
import { SpringJpaDefinitionProvider } from '../navigation/definitionProvider';
import { createDerivedQueryCompletions } from '../derivedQuery/queryCompletion';
import { findClosestProperty } from '../propertySuggestions';
import { generateRepositoryMethod } from '../repositoryGenerator';
import { JPQL_FUNCTIONS, JPQL_KEYWORDS } from '../jpql/jpqlLanguage';
import { getJpqlDocumentation } from '../jpql/jpqlDocumentation';
import { createJpqlCompletions } from '../jpql/jpqlCompletion';
import { maskJavaSource } from '../javaParsing';

suite('Extension Test Suite', () => {
	// ==========================================
	// 1. Tests d'extraction de propriétés & rétrocompatibilité
	// ==========================================
	test('extracts entity properties and getter properties', () => {
		const properties = extractPropertyNames('private String email; private boolean active; boolean isVerified() { return true; }');
		assert.deepStrictEqual(properties, [
			{ name: 'active', type: 'boolean' },
			{ name: 'email', type: 'String' },
			{ name: 'verified', type: 'boolean' },
		]);
	});

	test('extracts package-private, annotated, and collection fields', () => {
		const properties = extractPropertyNames('@Column private String email; List<User> users; final Instant createdAt;');
		assert.deepStrictEqual(properties, [
			{ name: 'createdAt', type: 'Instant' },
			{ name: 'email', type: 'String' },
			{ name: 'users', type: 'List<User>' },
		]);
	});

	test('recognizes repository method contexts', () => {
		assert.strictEqual(isRepositoryMethodContext('interface UserRepository { Optional<User> findBy'), true);
		assert.strictEqual(isRepositoryMethodContext('class Service { String loadBy'), false);
	});

	test('recognizes Spring Data JPA prefixes', () => {
		assert.strictEqual(isJpaPrefix('find'), true);
		assert.strictEqual(isJpaPrefix('remove'), true);
		assert.strictEqual(isJpaPrefix('banana'), false);
	});

	test('filters diagnostics by category display mode', () => {
		assert.strictEqual(shouldDisplayDiagnostic('all', 'warning'), true);
		assert.strictEqual(shouldDisplayDiagnostic('errors', 'warning'), false);
		assert.strictEqual(shouldDisplayDiagnostic('warnings', 'warning'), true);
		assert.strictEqual(shouldDisplayDiagnostic('off', 'error'), false);
	});

	// ==========================================
	// 2. Modèle d'entités riche: MappedSuperclass, Lombok, Records, Transient
	// ==========================================
	test('discovers an entity and its properties with locations', () => {
		const entity = parseEntityModel('@Entity class User { private String email; public boolean isActive() { return true; } }', vscode.Uri.parse('file:///User.java'));
		assert.strictEqual(entity?.name, 'User');
		assert.strictEqual(entity?.properties.length, 2);
		const propNames = entity?.properties.map((p) => p.name);
		assert.deepStrictEqual(propNames, ['active', 'email']);
		assert.ok(entity?.properties[0].location !== undefined);
	});

	test('ignores @Transient fields and transient keyword', () => {
		const text = `
			@Entity
			public class User {
				private String email;
				@Transient
				private String secretToken;
				private transient int cacheCount;
			}
		`;
		const entity = parseEntityModel(text, vscode.Uri.parse('file:///User.java'));
		assert.ok(entity);
		const propNames = entity.properties.map((p) => p.name);
		assert.ok(propNames.includes('email'));
		assert.ok(!propNames.includes('secretToken'), 'secretToken should be excluded by @Transient');
		assert.ok(!propNames.includes('cacheCount'), 'cacheCount should be excluded by transient keyword');
	});

	test('supports Lombok @Data and @Getter without explicit getters', () => {
		const text = `
			@Entity
			@Data
			public class Customer {
				private Long id;
				private String companyName;
				private String taxNumber;
			}
		`;
		const entity = parseEntityModel(text, vscode.Uri.parse('file:///Customer.java'));
		assert.ok(entity);
		const propNames = entity.properties.map((p) => p.name);
		assert.deepStrictEqual(propNames, ['companyName', 'id', 'taxNumber']);
	});

	test('extracts JPA relation metadata and explicit target entities', () => {
		const entity = parseEntityModel(`
			@Entity
			class Order {
				@ManyToOne(targetEntity = User.class)
				private User user;
				@OneToMany
				private List<Item> items;
			}
		`, vscode.Uri.parse('file:///Order.java'))!;
		const user = entity.properties.find((property) => property.name === 'user');
		const items = entity.properties.find((property) => property.name === 'items');
		assert.strictEqual(user?.relation, 'ManyToOne');
		assert.strictEqual(user?.targetEntity, 'User');
		assert.strictEqual(items?.relation, 'OneToMany');
		assert.strictEqual(items?.isCollection, true);
	});

	test('supports Java Records as JPA / projection models', () => {
		const text = 'public record UserSummary(Long id, String username, String email) {}';
		const entity = parseEntityModel(text, vscode.Uri.parse('file:///UserSummary.java'));
		assert.ok(entity);
		assert.strictEqual(entity.name, 'UserSummary');
		assert.deepStrictEqual(entity.properties.map((p) => p.name), ['id', 'username', 'email']);
	});

	test('limits extracted entity properties to direct instance fields', () => {
		const entity = parseEntityModel('@EntityGraph class NotAnEntity {}', vscode.Uri.parse('file:///NotAnEntity.java'));
		assert.strictEqual(entity, undefined);

		const parsed = parseEntityModel(`
			package p;
			// @Entity class Fake {}
			@Entity
			class User {
				static String cache;
				String name;
				void work() { String localName = "x"; }
				class Nested { String nestedOnly; }
			}
		`, vscode.Uri.parse('file:///User.java'))!;
		assert.deepStrictEqual(parsed.properties.map((property) => property.name), ['name']);
	});

	test('associates JPA annotations with the following class declaration', () => {
		const parsed = parseEntityModel('class Helper { String helper; } @Entity class User { String email; }', vscode.Uri.parse('file:///User.java'))!;
		assert.strictEqual(parsed.name, 'User');
		assert.deepStrictEqual(parsed.properties.map((property) => property.name), ['email']);
	});

	test('parses record components with nested generic types', () => {
		const entity = parseEntityModel('record Result(Map<String, List<Long>> values, String name) {}', vscode.Uri.parse('file:///Result.java'))!;
		assert.deepStrictEqual(entity.properties.map((property) => [property.name, property.type]), [
			['values', 'Map<String, List<Long>>'],
			['name', 'String'],
		]);
	});

	test('inherits properties from @MappedSuperclass', () => {
		const baseEntity = parseEntityModel(`
			@MappedSuperclass
			public abstract class BaseEntity {
				private Long id;
				private Instant createdAt;
			}
		`, vscode.Uri.parse('file:///BaseEntity.java'))!;

		const userEntity = parseEntityModel(`
			@Entity
			public class User extends BaseEntity {
				private String email;
			}
		`, vscode.Uri.parse('file:///User.java'))!;

		const entityMap = new Map([
			[baseEntity.name, baseEntity],
			[userEntity.name, userEntity],
		]);

		const resolved = resolveEntityHierarchy(userEntity, entityMap);
		const propNames = resolved.properties.map((p) => p.name);
		assert.deepStrictEqual(propNames, ['createdAt', 'email', 'id']);
	});

	test('selects properties from the repository entity generic', () => {
		const user = { name: 'User', properties: [{ name: 'email', type: 'String' }, { name: 'active', type: 'boolean' }], uri: vscode.Uri.parse('file:///User.java') };
		const order = { name: 'Order', properties: [{ name: 'createdAt', type: 'Instant' }], uri: vscode.Uri.parse('file:///Order.java') };
		assert.deepStrictEqual(extractRepositoryEntityNames('interface UserRepository extends JpaRepository<User, Long> {}'), ['User']);
		assert.deepStrictEqual(findEntityProperties('interface UserRepository extends JpaRepository<User, Long> {}', [user, order]).map((p) => p.name), [
			'active', 'email',
		]);
	});

	test('prefers the repository package when entities share a simple name', () => {
		const first = parseEntityModel('package com.first; @Entity class User { String first; }', vscode.Uri.parse('file:///first/User.java'))!;
		const second = parseEntityModel('package com.second; @Entity class User { String second; }', vscode.Uri.parse('file:///second/User.java'))!;
		const properties = findEntityProperties('package com.second; interface UserRepository extends JpaRepository<User, Long> {}', [first, second]);
		assert.deepStrictEqual(properties.map((property) => property.name), ['second']);
	});

	test('prefers an explicit entity import when repository packages differ', () => {
		const first = parseEntityModel('package com.first; @Entity class User { String first; }', vscode.Uri.parse('file:///first/User.java'))!;
		const second = parseEntityModel('package com.second; @Entity class User { String second; }', vscode.Uri.parse('file:///second/User.java'))!;
		const repository = 'package com.repository; import com.second.User; interface UserRepository extends JpaRepository<User, Long> {}';
		assert.deepStrictEqual(findEntityProperties(repository, [first, second]).map((property) => property.name), ['second']);
	});

	test('recognizes projection interfaces and suggests close property names', () => {
		const projection = parseEntityModel('package com.example; public interface UserView { String getEmail(); }', vscode.Uri.parse('file:///UserView.java'))!;
		assert.strictEqual(projection.isProjection, true);
		assert.deepStrictEqual(projection.properties.map((property) => property.name), ['email']);
		assert.strictEqual(findClosestProperty('emali', ['id', 'email', 'name']), 'email');
	});

	test('expands properties from related entities with camelCase and underscore', () => {
		const address = { name: 'Address', properties: [{ name: 'city', type: 'String' }], uri: vscode.Uri.parse('file:///Address.java') };
		const user = { name: 'User', properties: [{ name: 'address', type: 'Address' }], uri: vscode.Uri.parse('file:///User.java') };
		const props = findEntityProperties('interface UserRepository extends JpaRepository<User, Long> {}', [user, address]);
		const names = props.map((p) => p.name);
		assert.ok(names.includes('address'));
		assert.ok(names.includes('addressCity'));
		assert.ok(names.includes('address_city'));
	});

	// ==========================================
	// 3. Moteur grammatical des requêtes dérivées (queryParser)
	// ==========================================
	test('parses derived method with modifiers, multiple predicates, and OrderBy', () => {
		const parsed = parseDerivedMethodName('findDistinctFirst5ByEmailAndAgeGreaterThanOrderByCreatedAtDesc');
		assert.ok(parsed);
		assert.strictEqual(parsed.prefix, 'find');
		assert.ok(parsed.subjectModifiers.includes('Distinct'));
		assert.ok(parsed.subjectModifiers.includes('First5'));
		assert.strictEqual(parsed.predicates.length, 2);
		assert.strictEqual(parsed.predicates[0].propertyName, 'Email');
		assert.strictEqual(parsed.predicates[1].propertyName, 'Age');
		assert.strictEqual(parsed.predicates[1].operator, 'GreaterThan');
		assert.strictEqual(parsed.predicates[1].connector, 'And');
		assert.strictEqual(parsed.orderBy.length, 1);
		assert.strictEqual(parsed.orderBy[0].propertyName, 'CreatedAt');
		assert.strictEqual(parsed.orderBy[0].direction, 'Desc');
	});

	test('parses OrderBy without an explicit direction as ascending', () => {
		assert.deepStrictEqual(parseDerivedMethodName('findByEmailOrderByCreatedAt')?.orderBy, [
			{ propertyName: 'CreatedAt', direction: 'Asc' },
		]);
	});

	test('parses derived method with underscore property navigation', () => {
		const parsed = parseDerivedMethodName('findByAddress_CityContaining');
		assert.ok(parsed);
		assert.strictEqual(parsed.predicates.length, 1);
		assert.strictEqual(parsed.predicates[0].propertyName, 'Address_City');
		assert.strictEqual(parsed.predicates[0].operator, 'Containing');
	});

	test('parses three predicates without splitting property names at connector-like text', () => {
		const parsed = parseDerivedMethodName('findByEmailOrFirstnameOrLastname');
		assert.ok(parsed);
		assert.deepStrictEqual(parsed.predicates.map((predicate) => predicate.propertyName), ['Email', 'Firstname', 'Lastname']);
		assert.deepStrictEqual(parsed.predicates.map((predicate) => predicate.connector), [undefined, 'Or', 'Or']);
		const orderParsed = parseDerivedMethodName('findByOrderNumberOrBrandName');
		assert.deepStrictEqual(orderParsed?.predicates.map((predicate) => predicate.propertyName), ['OrderNumber', 'BrandName']);
	});

	// ==========================================
	// 4. Validation des signatures de requêtes dérivées (queryValidator)
	// ==========================================
	test('validates return type of existsBy and countBy methods', () => {
		const properties = [{ name: 'email', type: 'String' }];

		// existsBy returning String instead of boolean
		const invalidExists = validateDerivedMethodSignature({
			rawText: 'String existsByEmail(String email);',
			returnType: 'String',
			methodName: 'existsByEmail',
			parameters: [{ name: 'email', type: 'String' }],
			startOffset: 0,
			endOffset: 35,
		}, properties);
		assert.strictEqual(invalidExists.length, 1);
		assert.strictEqual(invalidExists[0].code, 'INVALID_RETURN_TYPE');

		// countBy returning boolean instead of long
		const invalidCount = validateDerivedMethodSignature({
			rawText: 'boolean countByEmail(String email);',
			returnType: 'boolean',
			methodName: 'countByEmail',
			parameters: [{ name: 'email', type: 'String' }],
			startOffset: 0,
			endOffset: 35,
		}, properties);
		assert.strictEqual(invalidCount.length, 1);
		assert.strictEqual(invalidCount[0].code, 'INVALID_RETURN_TYPE');
	});

	test('flags missing method parameters in derived queries', () => {
		const properties = [
			{ name: 'email', type: 'String' },
			{ name: 'active', type: 'boolean' },
		];
		const diags = validateDerivedMethodSignature({
			rawText: 'List<User> findByEmailAndActive(String email);',
			returnType: 'List<User>',
			methodName: 'findByEmailAndActive',
			parameters: [{ name: 'email', type: 'String' }],
			startOffset: 0,
			endOffset: 46,
		}, properties);

		assert.strictEqual(diags.length, 1);
		assert.strictEqual(diags[0].code, 'MISSING_PARAMETER');
		assert.strictEqual(diags[0].missingParam?.name, 'active');
	});

	test('warns when Page return type lacks Pageable parameter', () => {
		const properties = [{ name: 'email', type: 'String' }];
		const diags = validateDerivedMethodSignature({
			rawText: 'Page<User> findByEmail(String email);',
			returnType: 'Page<User>',
			methodName: 'findByEmail',
			parameters: [{ name: 'email', type: 'String' }],
			startOffset: 0,
			endOffset: 37,
		}, properties);

		assert.strictEqual(diags.length, 1);
		assert.strictEqual(diags[0].code, 'MISSING_PAGEABLE');
	});

	test('flags extra parameters and unknown OrderBy properties', () => {
		const diags = validateDerivedMethodSignature({
			rawText: 'List<User> findByEmailOrderByUnknownAsc(String email, String extra);',
			returnType: 'List<User>',
			methodName: 'findByEmailOrderByUnknownAsc',
			parameters: [{ name: 'email', type: 'String' }, { name: 'extra', type: 'String' }],
			startOffset: 0,
			endOffset: 69,
		}, [{ name: 'email', type: 'String' }]);

		assert.ok(diags.some((diagnostic) => diagnostic.code === 'UNKNOWN_PROPERTY'));
		assert.ok(diags.some((diagnostic) => diagnostic.code === 'EXTRA_PARAMETER'));
	});

	test('flags an incompatible derived query parameter type', () => {
		const diags = validateDerivedMethodSignature({
			rawText: 'List<User> findByEmail(Long email);',
			returnType: 'List<User>',
			methodName: 'findByEmail',
			parameters: [{ name: 'email', type: 'Long' }],
			startOffset: 0,
			endOffset: 35,
		}, [{ name: 'email', type: 'String' }]);
		assert.ok(diags.some((diagnostic) => diagnostic.code === 'INVALID_PARAMETER_TYPE'));
	});

	// ==========================================
	// 5. Moteur JPQL avancé: Text Blocks, multi-lignes, alias JOIN, paramètres
	// ==========================================
	test('parses JPQL Text Block queries and resolves JOIN aliases', () => {
		const documentText = `
			interface OrderRepository extends JpaRepository<Order, Long> {
				@Query("""
					SELECT o
					FROM Order o
					JOIN o.user u
					WHERE u.email = :userEmail
				""")
				List<Order> findByUserEmail(@Param("userEmail") String email);
			}
		`;
		const userEntity = {
			name: 'User',
			uri: vscode.Uri.parse('file:///User.java'),
			properties: [{ name: 'email', type: 'String' }],
		};
		const orderEntity = {
			name: 'Order',
			uri: vscode.Uri.parse('file:///Order.java'),
			properties: [{ name: 'user', type: 'User' }],
		};

		const queries = extractAllJpqlQueries(documentText, [userEntity, orderEntity]);
		assert.strictEqual(queries.length, 1);
		const q = queries[0];
		assert.strictEqual(q.aliases.get('o'), 'Order');
		assert.strictEqual(q.aliases.get('u'), 'User');
		assert.deepStrictEqual(q.namedParameters.map((p) => p.name), ['userEmail']);
	});

	test('validates unknown properties on specific JPQL aliases with precise diagnostics', () => {
		const documentText = `
			@Query("SELECT u FROM User u WHERE u.nonExistentProp = :id")
			User findById(@Param("id") Long id);
		`;
		const userEntity = {
			name: 'User',
			uri: vscode.Uri.parse('file:///User.java'),
			properties: [{ name: 'id', type: 'Long' }, { name: 'email', type: 'String' }],
		};

		const queries = extractAllJpqlQueries(documentText, [userEntity]);
		assert.strictEqual(queries.length, 1);
		const diags = validateJpql(queries[0], [userEntity]);
		assert.ok(diags.some((d) => d.code === 'UNKNOWN_PROPERTY' && d.message.includes('nonExistentProp')));
	});

	test('validates JPQL named parameter types against nested property types', () => {
		const category = parseEntityModel('@Entity class Category { private Long id; }', vscode.Uri.parse('file:///Category.java'))!;
		const product = parseEntityModel('@Entity class Product { private Category category; }', vscode.Uri.parse('file:///Product.java'))!;
		const documentText = '@Query("SELECT p FROM Product p WHERE p.category.id = :id") List<Product> find(@Param("id") UUID id);';
		const query = extractAllJpqlQueries(documentText, [product, category])[0];
		const diagnostics = validateJpql(query, [product, category]);

		assert.ok(diagnostics.some((diagnostic) => diagnostic.code === 'INVALID_PARAMETER_TYPE'));
		assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes("expects type 'Long'")));
	});

	test('validates JPQL selected entity against repository return type', () => {
		const documentText = `
			@Query("SELECT u FROM User u")
			String findUser();
		`;
		const userEntity = {
			name: 'User',
			uri: vscode.Uri.parse('file:///User.java'),
			properties: [{ name: 'email', type: 'String' }],
		};
		const query = extractAllJpqlQueries(documentText, [userEntity])[0];
		const diagnostics = validateJpql(query, [userEntity]);
		assert.ok(diagnostics.some((diagnostic) => diagnostic.code === 'INVALID_RETURN_TYPE'));
	});

	test('checks JPQL collection element types and constructor DTO projections', () => {
		const userEntity = parseEntityModel('@Entity class User { Long id; }', vscode.Uri.parse('file:///User.java'))!;
		const wrongCollection = extractAllJpqlQueries('@Query("SELECT u FROM User u") List<String> find();', [userEntity])[0];
		assert.ok(validateJpql(wrongCollection, [userEntity]).some((diagnostic) => diagnostic.code === 'INVALID_RETURN_TYPE'));

		const dtoQuery = extractAllJpqlQueries(
			'@Query("SELECT NEW com.example.UserView(u.id) FROM User u") List<UserView> find();',
			[userEntity],
		)[0];
		assert.strictEqual(dtoQuery.dtoProjectionType, 'com.example.UserView');
		assert.strictEqual(validateJpql(dtoQuery, [userEntity]).some((diagnostic) => diagnostic.code === 'INVALID_RETURN_TYPE'), false);
	});

	test('validates indexed JPQL positional parameters and ignores question marks in literals', () => {
		const userEntity = parseEntityModel('@Entity class User { Long id; String name; }', vscode.Uri.parse('file:///User.java'))!;
		const query = extractAllJpqlQueries(
			'@Query("SELECT u FROM User u WHERE u.id = ?1 AND u.name = ?2 AND u.name <> \'?9:ignored\'") List<User> find(Long id, String name);',
			[userEntity],
		)[0];
		assert.deepStrictEqual(query.positionalParameters.map((parameter) => parameter.index), [1, 2]);
		assert.strictEqual(validateJpql(query, [userEntity]).length, 0);

		const mismatch = extractAllJpqlQueries(
			'@Query("SELECT u FROM User u WHERE u.id = ?1") User find(String id);',
			[userEntity],
		)[0];
		assert.ok(validateJpql(mismatch, [userEntity]).some((diagnostic) => diagnostic.code === 'INVALID_PARAMETER_TYPE'));

		const undeclared = extractAllJpqlQueries(
			'@Query("SELECT u FROM User u WHERE u.id = :id") User find();',
			[userEntity],
		)[0];
		assert.ok(validateJpql(undeclared, [userEntity]).some((diagnostic) => diagnostic.code === 'MISSING_METHOD_PARAM'));

		const sequential = extractAllJpqlQueries(
			'@Query("SELECT u FROM User u WHERE u.id = ? AND u.name = ?") List<User> find(Long id, String name);',
			[userEntity],
		)[0];
		assert.deepStrictEqual(sequential.positionalParameters.map((parameter) => parameter.index), [1, 2]);
		assert.strictEqual(validateJpql(sequential, [userEntity]).length, 0);
	});

	test('respects @Param aliases and rejects mixed JPQL parameter styles', () => {
		const userEntity = parseEntityModel('@Entity class User { Long id; String name; }', vscode.Uri.parse('file:///User.java'))!;
		const aliases = extractAllJpqlQueries(
			'@Query("SELECT u FROM User u WHERE u.id = :userId AND u.name = :displayName") User find(@Param("userId") Long id, @Param("displayName") String name);',
			[userEntity],
		)[0];
		assert.strictEqual(validateJpql(aliases, [userEntity]).length, 0);

		const mixed = extractAllJpqlQueries(
			'@Query("SELECT u FROM User u WHERE u.id = :id AND u.name = ?2") User find(@Param("id") Long id, String name);',
			[userEntity],
		)[0];
		assert.ok(validateJpql(mixed, [userEntity]).some((diagnostic) => diagnostic.code === 'MIXED_PARAMETER_STYLE'));
	});

	test('uses imported duplicate entity and accepts fully-qualified collection return types', () => {
		const first = parseEntityModel('package com.first; @Entity class User { String first; }', vscode.Uri.parse('file:///first/User.java'))!;
		const second = parseEntityModel('package com.second; @Entity class User { String second; }', vscode.Uri.parse('file:///second/User.java'))!;
		const text = 'package com.repository; import com.second.User; @Query("SELECT u FROM User u WHERE u.second = ?1") java.util.List<User> find(String second);';
		const query = extractAllJpqlQueries(text, [first, second])[0];
		assert.strictEqual(validateJpql(query, [first, second]).length, 0);
	});

	test('keeps nested JPQL functions inside @Query and preserves the entity return type', () => {
		const documentText = `
			@Query("""
				SELECT p
				FROM Post p
				WHERE LOWER(p.title) LIKE LOWER(CONCAT('%', :term, '%'))
				   OR LOWER(p.content) LIKE LOWER(CONCAT('%', :term, '%'))
			""")
			List<Post> search(@Param("term") String term);
		`;
		const postEntity = {
			name: 'Post',
			uri: vscode.Uri.parse('file:///Post.java'),
			properties: [{ name: 'title', type: 'String' }, { name: 'content', type: 'String' }],
		};

		const query = extractAllJpqlQueries(documentText, [postEntity])[0];
		assert.strictEqual(query.selectedExpression, 'p');
		assert.strictEqual(query.selectedAlias, 'p');
		assert.deepStrictEqual(query.functions.map((fn) => fn.name), ['LOWER', 'LOWER', 'CONCAT', 'LOWER', 'LOWER', 'CONCAT']);
		assert.strictEqual(validateJpql(query, [postEntity]).some((diagnostic) => diagnostic.code === 'INVALID_RETURN_TYPE'), false);
	});

	test('parses concatenated @Query values without adding source text and preserves offsets', () => {
		const text = '@Query("SELECT u FROM User u" + " WHERE u.id = :id") User find(@Param(value = "id") Long id);';
		const user = { name: 'User', uri: vscode.Uri.parse('file:///User.java'), properties: [{ name: 'id', type: 'Long' }] };
		const query = extractAllJpqlQueries(text, [user])[0];
		assert.strictEqual(query.queryContent, 'SELECT u FROM User u WHERE u.id = :id');
		assert.strictEqual(query.methodSignature?.parameters.length, 1);
		assert.strictEqual(query.methodSignature?.parameters[0].paramName, 'id');
		assert.strictEqual(query.namedParameters[0].startOffset, text.indexOf(':id'));
	});

	test('splits generic Java parameters at top level and ignores commented @Query annotations', () => {
		const text = '// @Query("SELECT broken FROM Broken broken") User ignored();\n'
			+ '@Query("SELECT u FROM User u WHERE u.id IN :ids") User find(Map<String, Object> filters, @Param("ids") List<Long> ids);';
		const user = { name: 'User', uri: vscode.Uri.parse('file:///User.java'), properties: [{ name: 'id', type: 'Long' }] };
		const queries = extractAllJpqlQueries(text, [user]);
		assert.strictEqual(queries.length, 1);
		assert.deepStrictEqual(queries[0].methodSignature?.parameters.map((parameter) => parameter.type), ['Map<String, Object>', 'List<Long>']);
		assert.strictEqual(queries[0].methodSignature?.parameters[1].paramName, 'ids');
	});

	test('preserves Java source offsets after supplementary Unicode characters', () => {
		const source = '// 😀 @Query("ignored")\n@Query("SELECT u FROM User u")';
		const masked = maskJavaSource(source);
		assert.strictEqual(masked.length, source.length);
		assert.ok(!masked.slice(0, masked.indexOf('\n')).includes('@Query'));
		assert.strictEqual(masked.indexOf('@Query'), source.lastIndexOf('@Query'));
	});

	test('extracts value instead of countQuery and respects repository package for duplicate entities', () => {
		const text = 'package com.second; @Query(countQuery = "SELECT COUNT(u) FROM User u", value = "SELECT u FROM User u") User find();';
		const first = parseEntityModel('package com.first; @Entity class User { String first; }', vscode.Uri.parse('file:///first/User.java'))!;
		const second = parseEntityModel('package com.second; @Entity class User { String second; }', vscode.Uri.parse('file:///second/User.java'))!;
		const query = extractAllJpqlQueries(text, [first, second])[0];
		assert.strictEqual(query.queryContent, 'SELECT u FROM User u');
		assert.strictEqual(validateJpql(query, [first, second]).length, 0);
	});

	test('exposes the standard JPQL function vocabulary', () => {
		assert.ok(JPQL_FUNCTIONS.includes('CONCAT'));
		assert.ok(JPQL_FUNCTIONS.includes('CURRENT_TIMESTAMP'));
		assert.ok(JPQL_FUNCTIONS.includes('TREAT'));
		assert.ok(JPQL_FUNCTIONS.includes('FUNCTION'));
	});

	test('provides concise JPQL hover documentation for clauses and functions', () => {
		const selectDocumentation = getJpqlDocumentation('select');
		assert.strictEqual(selectDocumentation?.kind, 'Clause');
		assert.ok(selectDocumentation?.description.includes('values returned'));
		assert.ok(selectDocumentation?.syntax.includes('SELECT'));
		assert.ok(selectDocumentation?.useCase.includes('FROM User'));

		const upperDocumentation = getJpqlDocumentation('UPPER');
		assert.strictEqual(upperDocumentation?.kind, 'Function');
		assert.ok(upperDocumentation?.description.includes('uppercase'));
		assert.ok(upperDocumentation?.useCase.includes('UPPER'));
		assert.strictEqual(getJpqlDocumentation('unknown'), undefined);
		assert.strictEqual(getJpqlDocumentation('LOCATE')?.kind, 'Function');
		assert.strictEqual(getJpqlDocumentation('LEFT JOIN')?.title, 'LEFT JOIN');
	});

	test('documents every single-token JPQL completion keyword', () => {
		for (const keyword of JPQL_KEYWORDS.filter((value) => !value.includes(' '))) {
			assert.ok(getJpqlDocumentation(keyword), `Missing documentation for ${keyword}`);
		}
	});

	test('completes properties after a nested JPQL association path', () => {
		const category = parseEntityModel('@Entity class Category { private String name; private UUID id; }', vscode.Uri.parse('file:///Category.java'))!;
		const product = parseEntityModel('@Entity class Product { private Category category; }', vscode.Uri.parse('file:///Product.java'))!;
		const text = '@Query("SELECT p FROM Product p WHERE p.category.na") List<Product> find();';
		const document = {
			getText: () => text,
			lineAt: () => ({ text }),
			offsetAt: (position: vscode.Position) => position.character,
		} as any;
		const completionOffset = text.indexOf('na"') + 2;
		const completions = createJpqlCompletions(document, new vscode.Position(0, completionOffset), [product, category]);

		assert.ok(completions?.some((item) => item.label === 'name'));
		assert.strictEqual(completions?.find((item) => item.label === 'name')?.detail, 'Category.name : String');
	});

	test('completes the next JPQL positional parameter index', () => {
		const user = parseEntityModel('@Entity class User { Long id; }', vscode.Uri.parse('file:///User.java'))!;
		const text = '@Query("SELECT u FROM User u WHERE u.id = ?") User find(Long id);';
		const document = {
			getText: () => text,
			lineAt: () => ({ text }),
			offsetAt: (position: vscode.Position) => position.character,
		} as any;
		const position = new vscode.Position(0, text.indexOf('?') + 1);
		const completions = createJpqlCompletions(document, position, [user]);
		assert.deepStrictEqual(completions?.map((item) => item.label), ['?1']);
	});

	test('completes discovered DTOs after JPQL SELECT NEW', () => {
		const user = parseEntityModel('@Entity class User { Long id; }', vscode.Uri.parse('file:///User.java'))!;
		const dto = parseEntityModel('package com.example; record UserView(Long id) {}', vscode.Uri.parse('file:///UserView.java'))!;
		const text = '@Query("SELECT NEW com.example.UserV(u.id) FROM User u") List<UserView> find();';
		const document = {
			getText: () => text,
			lineAt: () => ({ text }),
			offsetAt: (position: vscode.Position) => position.character,
		} as any;
		const position = new vscode.Position(0, text.indexOf('UserV') + 'UserV'.length);
		const completions = createJpqlCompletions(document, position, [user, dto]);
		const dtoCompletion = completions?.find((item) => item.label === 'UserView');
		assert.ok(dtoCompletion);
		assert.strictEqual(dtoCompletion?.insertText, 'com.example.UserView');
		assert.strictEqual((dtoCompletion?.range as vscode.Range | undefined)?.start.character, text.indexOf('com.example.UserV'));
	});

	test('resolves inherited and nested JPQL properties', () => {
		const base = parseEntityModel('@MappedSuperclass class Audited { private String tenantId; }', vscode.Uri.parse('file:///Audited.java'))!;
		const address = parseEntityModel('@Entity class Address { private String city; }', vscode.Uri.parse('file:///Address.java'))!;
		const user = parseEntityModel('@Entity class User extends Audited { private Address address; }', vscode.Uri.parse('file:///User.java'))!;
		const entities = [base, address, user];
		const entityMap = new Map(entities.map((entity) => [entity.name.toLowerCase(), entity]));
		const query = extractAllJpqlQueries('@Query("SELECT u FROM User u WHERE u.address.city = :city AND u.tenantId = :tenant") User find(@Param("city") String city, @Param("tenant") String tenant);', entities)[0];

		assert.ok(resolveEntityPropertyPath(user, 'address.city', entityMap));
		assert.ok(resolveEntityPropertyPath(user, 'tenantId', entityMap));
		assert.deepStrictEqual(validateJpql(query, entities), []);
	});

	test('keeps the nested property owner when resolving a JPQL path', () => {
		const category = parseEntityModel('@Entity class Category { private UUID id; }', vscode.Uri.parse('file:///Category.java'))!;
		const product = parseEntityModel('@Entity class Product { private Category category; }', vscode.Uri.parse('file:///Product.java'))!;
		const entities = [product, category];
		const entityMap = new Map(entities.map((entity) => [entity.name.toLowerCase(), entity]));
		const resolved = resolveEntityPropertyPathWithOwner(product, 'category.id', entityMap);

		assert.strictEqual(resolved?.property.type, 'UUID');
		assert.strictEqual(resolved?.owner.name, 'Category');
		assert.strictEqual(resolveEntityPropertyPath(product, 'category.id', entityMap)?.type, 'UUID');
	});

	test('keeps same-named entities from different URIs indexed independently', () => {
		const index = WorkspaceEntityIndex.getInstance();
		index.clear();
		index.updateDocument({ languageId: 'java', uri: vscode.Uri.parse('file:///one/User.java'), getText: () => 'package com.one; @Entity class User { String first; }' } as any);
		index.updateDocument({ languageId: 'java', uri: vscode.Uri.parse('file:///two/User.java'), getText: () => 'package com.two; @Entity class User { String second; }' } as any);
		assert.strictEqual(index.getAllEntities().length, 2);
		assert.strictEqual(index.getEntity('User', 'com.two')?.properties[0].name, 'second');
		index.removeUri(vscode.Uri.parse('file:///two/User.java'));
		assert.strictEqual(index.getAllEntities().length, 1);
		assert.strictEqual(index.getAllEntities()[0].properties[0].name, 'first');
		index.clear();
	});

	test('selects the repository entity nearest to the method in a multi-repository file', () => {
		const text = 'interface UserRepository extends JpaRepository<User, Long> { }\n'
			+ 'interface OrderRepository extends JpaRepository<Order, Long> { }';
		const user = { name: 'User', properties: [{ name: 'email', type: 'String' }], uri: vscode.Uri.parse('file:///User.java') };
		const order = { name: 'Order', properties: [{ name: 'number', type: 'String' }], uri: vscode.Uri.parse('file:///Order.java') };
		assert.strictEqual(extractRepositoryEntityNameAt(text, text.length), 'Order');
		assert.deepStrictEqual(findEntityProperties(text, [user, order], 'Order').map((property) => property.name), ['number']);
	});

	test('does not offer JPQL completion inside native queries', () => {
		const text = '@Query(value = "SELECT * FROM users", nativeQuery = true) List<User> findAll();';
		const document = {
			getText: () => text,
			lineAt: () => ({ text }),
			offsetAt: (position: vscode.Position) => position.character,
		} as any;
		const completions = createJpqlCompletions(document, new vscode.Position(0, text.indexOf('users') + 5), [{ name: 'User', properties: [], uri: vscode.Uri.parse('file:///User.java') }]);
		assert.strictEqual(completions, undefined);
	});

	test('prioritizes derived property suggestions over operators', () => {
		const items = createDerivedQueryCompletions('List<User> findByE', [{ name: 'email', type: 'String' }], new vscode.Position(0, 19));
		assert.ok(items.length > 0);
		assert.strictEqual(items[0].sortText, '0_Email');
	});

	// ==========================================
	// 6. Code Actions / Quick-Fixes
	// ==========================================
	test('generates Quick-Fix to change invalid return type to boolean', () => {
		const provider = new SpringJpaCodeActionProvider();
		const doc = {
			uri: vscode.Uri.parse('file:///UserRepository.java'),
			lineAt: () => ({ text: 'String existsByEmail(String email);' }),
		} as any;

		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 6)),
			"'existsByEmail' must return boolean or Boolean, but returns 'String'.",
			vscode.DiagnosticSeverity.Error,
		);
		diagnostic.source = 'spring-jpa';
		diagnostic.code = 'INVALID_RETURN_TYPE';

		const actions = provider.provideCodeActions(doc, diagnostic.range, { diagnostics: [diagnostic] } as any, {} as any);
		assert.strictEqual(actions.length, 1);
		assert.strictEqual(actions[0].title, "Change return type to 'boolean'");
	});

	test('generates Quick-Fix to add missing parameter to method signature', () => {
		const provider = new SpringJpaCodeActionProvider();
		const doc = {
			uri: vscode.Uri.parse('file:///UserRepository.java'),
			lineAt: () => ({ text: 'List<User> findByEmailAndActive(String email);' }),
		} as any;

		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(new vscode.Position(0, 11), new vscode.Position(0, 31)),
			"Derived query method 'findByEmailAndActive' expects at least 2 parameter(s) (String email, boolean active), but found 1.",
			vscode.DiagnosticSeverity.Error,
		);
		diagnostic.source = 'spring-jpa';
		diagnostic.code = 'MISSING_PARAMETER';

		const actions = provider.provideCodeActions(doc, diagnostic.range, { diagnostics: [diagnostic] } as any, {} as any);
		assert.strictEqual(actions.length, 1);
		assert.strictEqual(actions[0].title, "Add parameter 'boolean active' to method signature");
	});

	test('uses the structured first missing parameter for three-predicate queries', () => {
		const provider = new SpringJpaCodeActionProvider();
		const doc = {
			uri: vscode.Uri.parse('file:///UserRepository.java'),
			lineAt: () => ({ text: 'List<User> findByEmailOrFirstnameOrLastname(String email);' }),
		} as any;
		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(new vscode.Position(0, 11), new vscode.Position(0, 42)),
			"Derived query method 'findByEmailOrFirstnameOrLastname' expects at least 3 parameter(s), but found 1.",
			vscode.DiagnosticSeverity.Error,
		) as vscode.Diagnostic & { missingParam: { name: string; type: string } };
		diagnostic.source = 'spring-jpa';
		diagnostic.code = 'MISSING_PARAMETER';
		diagnostic.missingParam = { name: 'firstname', type: 'String' };

		const actions = provider.provideCodeActions(doc, diagnostic.range, { diagnostics: [diagnostic] } as any, {} as any);
		assert.strictEqual(actions[0].title, "Add parameter 'String firstname' to method signature");
	});

	test('generates repository methods with the expected Spring Data signature', () => {
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'email', propertyType: 'String', kind: 'find' }), 'Optional<User> findByEmail(String email);');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'active', propertyType: 'boolean', kind: 'exists' }), 'boolean existsByActive(boolean active);');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'email', propertyType: 'String', kind: 'find', operator: 'Containing' }), 'Optional<User> findByEmailContaining(String email);');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'age', propertyType: 'Integer', kind: 'find', operator: 'Between' }), 'Optional<User> findByAgeBetween(Integer ageStart, Integer ageEnd);');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'id', propertyType: 'Long', kind: 'exists', operator: 'In' }), 'boolean existsByIdIn(Collection<Long> id);');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'email', propertyType: 'String', kind: 'count' }), 'long countByEmail(String email);');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'active', propertyType: 'boolean', kind: 'remove' }), 'void removeByActive(boolean active);');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'email', propertyType: 'String', kind: 'stream' }), 'Stream<User> streamByEmail(String email);');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'email', propertyType: 'String', kind: 'find', operator: 'IsNull' }), 'Optional<User> findByEmailIsNull();');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'email', propertyType: 'String', kind: 'find', returnType: 'List<User>' }), 'List<User> findByEmail(String email);');
		assert.strictEqual(generateRepositoryMethod({ entityName: 'User', propertyName: 'email', propertyType: 'String', kind: 'find', returnType: 'Page<User>' }), 'Page<User> findByEmail(String email, Pageable pageable);');
	});

	// ==========================================
	// 7. Navigation (Go to Definition - Ctrl+Click)
	// ==========================================
	test('definition provider navigates to entity property from derived method', async () => {
		const userDoc = {
			languageId: 'java',
			uri: vscode.Uri.parse('file:///User.java'),
			getText: () => '@Entity public class User { private String email; }',
		} as any;
		WorkspaceEntityIndex.getInstance().updateDocument(userDoc);

		const repoDoc = {
			languageId: 'java',
			uri: vscode.Uri.parse('file:///UserRepository.java'),
			getText: () => 'interface UserRepository extends JpaRepository<User, Long> { List<User> findByEmail(String email); }',
			lineAt: () => ({ text: 'List<User> findByEmail(String email);' }),
			offsetAt: () => 65,
			getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 17), new vscode.Position(0, 22)),
		} as any;

		const provider = new SpringJpaDefinitionProvider();
		const location = await provider.provideDefinition(repoDoc, new vscode.Position(0, 18), {} as any) as vscode.Location;
		assert.ok(location);
		assert.strictEqual(location.uri.toString(), 'file:///User.java');
	});

	test('definition provider navigates nested JPQL properties to their owning entity', async () => {
		const categoryDoc = {
			languageId: 'java',
			uri: vscode.Uri.parse('file:///Category.java'),
			getText: () => '@Entity public class Category { private Long id; }',
		} as any;
		const productDoc = {
			languageId: 'java',
			uri: vscode.Uri.parse('file:///Product.java'),
			getText: () => '@Entity public class Product { private Category category; }',
		} as any;
		const index = WorkspaceEntityIndex.getInstance();
		index.updateDocument(categoryDoc);
		index.updateDocument(productDoc);

		const text = '@Query("SELECT p FROM Product p WHERE p.category.id = :id") List<Product> find(@Param("id") Long id);';
		const idOffset = text.indexOf('category.id') + 'category.'.length;
		const repoDoc = {
			languageId: 'java',
			uri: vscode.Uri.parse('file:///ProductRepository.java'),
			getText: () => text,
			lineAt: () => ({ text }),
			offsetAt: () => idOffset,
			positionAt: () => new vscode.Position(0, idOffset),
			getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, idOffset), new vscode.Position(0, idOffset + 2)),
		} as any;

		const location = await new SpringJpaDefinitionProvider().provideDefinition(repoDoc, new vscode.Position(0, idOffset), {} as any) as vscode.Location;
		assert.ok(location);
		assert.strictEqual(location.uri.toString(), 'file:///Category.java');
	});

	test('definition provider navigates positional JPQL parameters to method arguments', async () => {
		const index = WorkspaceEntityIndex.getInstance();
		index.clear();
		index.updateDocument({
			languageId: 'java',
			uri: vscode.Uri.parse('file:///User.java'),
			getText: () => '@Entity class User { Long id; }',
		} as any);
		const text = '@Query("SELECT u FROM User u WHERE u.id = ?1") User find(Long id);';
		const positionOffset = text.indexOf('?1') + 1;
		const document = {
			languageId: 'java',
			uri: vscode.Uri.parse('file:///UserRepository.java'),
			getText: () => text,
			lineAt: () => ({ text }),
			offsetAt: (position: vscode.Position) => position.character,
			positionAt: (offset: number) => new vscode.Position(0, offset),
			getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, positionOffset), new vscode.Position(0, positionOffset + 1)),
		} as any;
		const location = await new SpringJpaDefinitionProvider().provideDefinition(
			document,
			new vscode.Position(0, positionOffset),
			{} as any,
		) as vscode.Location;
		assert.ok(location);
		assert.strictEqual(location.range.start.character, text.indexOf('id);'));
		index.clear();
	});

	// ==========================================
	// 8. Rétrocompatibilité JPQL existante
	// ==========================================
	test('validates JPQL entities, properties, and named parameters (legacy helper)', () => {
		const properties = [{ name: 'email', type: 'String' }];
		const query = 'select u from User u where u.email = :email';
		assert.deepStrictEqual(extractJpqlEntityNames(query), ['User']);
		assert.deepStrictEqual(extractJpqlNamedParameters(query), ['email']);
		assert.deepStrictEqual(validateJpqlQuery(query, ['email'], properties, ['User']), []);
		assert.deepStrictEqual(validateJpqlQuery('select x from Account x where x.unknown = :missing', ['email'], properties, ['User']).map((result) => result.token), [
			'Account', 'missing', 'email', 'unknown',
		]);
	});

	test('extracts named parameters from generic repository signatures', () => {
		assert.deepStrictEqual(extractMethodParameterNames('@Param("id") UUID id'), ['id']);
		assert.deepStrictEqual(extractMethodParameterNames('@Param("id") UUID id, Pageable pageable'), ['id', 'pageable']);
	});

	test('replaces a typed keyword instead of appending it', () => {
		const item = createKeywordItem(JPA_KEYWORDS.find((keyword) => keyword.label === 'existsBy')!, 'ex', new vscode.Range(new vscode.Position(0, 3), new vscode.Position(0, 5)));
		const edit = item.textEdit as vscode.TextEdit;
		assert.strictEqual(edit.newText, 'existsBy');
		assert.strictEqual(edit.range.start.character, 3);
		assert.strictEqual(edit.range.end.character, 5);
	});
});
