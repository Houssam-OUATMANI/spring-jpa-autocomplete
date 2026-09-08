import * as assert from 'assert';
import * as vscode from 'vscode';
import { extractRepositoryEntityNames, findEntityProperties, parseEntity, resolveEntityHierarchy, resolveEntityPropertyPath, WorkspaceEntityIndex } from '../entityDiscovery';
import { parseEntityModel } from '../entityModel';
import { createQueryMethodSuggestions, extractPropertyNames, isJpaPrefix, isRepositoryMethodContext, JPA_KEYWORDS, validateDerivedMethod } from '../jpaKeywords';
import { extractJpqlEntityNames, extractJpqlNamedParameters, validateJpqlQuery } from '../jpql';
import { createKeywordItem, extractMethodParameterNames } from '../extension';
import { parseDerivedMethodName } from '../derivedQuery/queryParser';
import { validateDerivedMethodSignature } from '../derivedQuery/queryValidator';
import { extractAllJpqlQueries } from '../jpql/jpqlParser';
import { validateJpql } from '../jpql/jpqlValidator';
import { SpringJpaCodeActionProvider } from '../actions/codeActionProvider';
import { SpringJpaDefinitionProvider } from '../navigation/definitionProvider';
import { createDerivedQueryCompletions } from '../derivedQuery/queryCompletion';

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

	test('supports Java Records as JPA / projection models', () => {
		const text = 'public record UserSummary(Long id, String username, String email) {}';
		const entity = parseEntityModel(text, vscode.Uri.parse('file:///UserSummary.java'));
		assert.ok(entity);
		assert.strictEqual(entity.name, 'UserSummary');
		assert.deepStrictEqual(entity.properties.map((p) => p.name), ['id', 'username', 'email']);
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

	test('parses derived method with underscore property navigation', () => {
		const parsed = parseDerivedMethodName('findByAddress_CityContaining');
		assert.ok(parsed);
		assert.strictEqual(parsed.predicates.length, 1);
		assert.strictEqual(parsed.predicates[0].propertyName, 'Address_City');
		assert.strictEqual(parsed.predicates[0].operator, 'Containing');
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

	test('keeps same-named entities from different URIs indexed independently', () => {
		const index = WorkspaceEntityIndex.getInstance();
		index.clear();
		index.updateDocument({ languageId: 'java', uri: vscode.Uri.parse('file:///one/User.java'), getText: () => '@Entity class User { String first; }' } as any);
		index.updateDocument({ languageId: 'java', uri: vscode.Uri.parse('file:///two/User.java'), getText: () => '@Entity class User { String second; }' } as any);
		assert.strictEqual(index.getAllEntities().length, 2);
		index.removeUri(vscode.Uri.parse('file:///two/User.java'));
		assert.strictEqual(index.getAllEntities().length, 1);
		assert.strictEqual(index.getAllEntities()[0].properties[0].name, 'first');
		index.clear();
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
