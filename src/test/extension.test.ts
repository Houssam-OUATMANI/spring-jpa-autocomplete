import * as assert from 'assert';
import * as vscode from 'vscode';
import { extractRepositoryEntityNames, findEntityProperties, parseEntity } from '../entityDiscovery';
import { createQueryMethodSuggestions, extractPropertyNames, isJpaPrefix, isRepositoryMethodContext, JPA_KEYWORDS, validateDerivedMethod } from '../jpaKeywords';
import { extractJpqlEntityNames, extractJpqlNamedParameters, validateJpqlQuery } from '../jpql';
import { createKeywordItem, extractMethodParameterNames } from '../extension';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// The helpers are kept independent from the VS Code runtime for fast unit tests.

suite('Extension Test Suite', () => {
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

	test('discovers an entity and its properties', () => {
		const entity = parseEntity('@Entity class User { private String email; public boolean isActive() { return true; } }', vscode.Uri.parse('file:///User.java'));
		assert.deepStrictEqual(entity?.name, 'User');
		assert.deepStrictEqual(entity?.properties, [
			{ name: 'active', type: 'boolean' },
			{ name: 'email', type: 'String' },
		]);
	});

	test('selects properties from the repository entity generic', () => {
		const user = { name: 'User', properties: [{ name: 'email', type: 'String' }, { name: 'active', type: 'boolean' }], uri: vscode.Uri.parse('file:///User.java') };
		const order = { name: 'Order', properties: [{ name: 'createdAt', type: 'Instant' }], uri: vscode.Uri.parse('file:///Order.java') };
		assert.deepStrictEqual(extractRepositoryEntityNames('interface UserRepository extends JpaRepository<User, Long> {}'), ['User']);
		assert.deepStrictEqual(findEntityProperties('interface UserRepository extends JpaRepository<User, Long> {}', [user, order]), [
			{ name: 'active', type: 'boolean' },
			{ name: 'email', type: 'String' },
		]);
	});

	test('expands properties from related entities', () => {
		const address = { name: 'Address', properties: [{ name: 'city', type: 'String' }], uri: vscode.Uri.parse('file:///Address.java') };
		const user = { name: 'User', properties: [{ name: 'address', type: 'Address' }], uri: vscode.Uri.parse('file:///User.java') };
		assert.deepStrictEqual(findEntityProperties('interface UserRepository extends JpaRepository<User, Long> {}', [user, address]), [
			{ name: 'address', type: 'Address' },
			{ name: 'addressCity', type: 'String' },
		]);
	});

	test('generates a typed multi-property method suggestion', () => {
		const properties = [
			{ name: 'email', type: 'String' },
			{ name: 'active', type: 'boolean' },
		];
		const suggestion = createQueryMethodSuggestions('findByEmailAndA', properties)[0];
		assert.strictEqual(suggestion.label, 'findByEmailAndActive');
		assert.deepStrictEqual(suggestion.parameters, ['String email', 'boolean active']);
	});

	test('generates Between and OrderBy suggestions', () => {
		const properties = [
			{ name: 'createdAt', type: 'Instant' },
			{ name: 'email', type: 'String' },
		];
		const between = createQueryMethodSuggestions('findByCreatedAtBetween', properties)[0];
		assert.deepStrictEqual(between.parameters, ['Instant createdAtStart, Instant createdAtEnd']);
		const orderBy = createQueryMethodSuggestions('findByEmailOrderBy', properties);
		assert.strictEqual(orderBy.some((suggestion) => suggestion.label === 'findByEmailOrderByCreatedAtDesc'), true);
	});

	test('completes a partial OrderBy property', () => {
		const suggestions = createQueryMethodSuggestions('findByEmailOrderByC', [
			{ name: 'createdAt', type: 'Instant' },
			{ name: 'email', type: 'String' },
		]);
		assert.deepStrictEqual(suggestions.map((suggestion) => suggestion.label), [
			'findByEmailOrderByCreatedAtAsc',
			'findByEmailOrderByCreatedAtDesc',
		]);
	});

	test('validates unknown derived-query properties', () => {
		const properties = [{ name: 'email', type: 'String' }];
		assert.strictEqual(validateDerivedMethod('findByEmail', properties), undefined);
		assert.match(validateDerivedMethod('findByUnknown', properties) ?? '', /Unknown entity property/);
		assert.match(validateDerivedMethod('findByEmailAndUnknown', properties) ?? '', /Unknown entity property/);
	});

	test('validates JPQL entities, properties, and named parameters', () => {
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
