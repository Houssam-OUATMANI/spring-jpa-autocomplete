import * as assert from 'assert';
import * as vscode from 'vscode';
import { extractRepositoryEntityNames, findEntityProperties, parseEntity } from '../entityDiscovery';
import { extractPropertyNames, isJpaPrefix, isRepositoryMethodContext } from '../jpaKeywords';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// The helpers are kept independent from the VS Code runtime for fast unit tests.

suite('Extension Test Suite', () => {
	test('extracts entity properties and getter properties', () => {
		const properties = extractPropertyNames('private String email; private boolean active; boolean isVerified() { return true; }');
		assert.deepStrictEqual(properties, ['active', 'email', 'verified']);
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
		assert.deepStrictEqual(entity?.properties, ['active', 'email']);
	});

	test('selects properties from the repository entity generic', () => {
		const user = { name: 'User', properties: ['email', 'active'], uri: vscode.Uri.parse('file:///User.java') };
		const order = { name: 'Order', properties: ['createdAt'], uri: vscode.Uri.parse('file:///Order.java') };
		assert.deepStrictEqual(extractRepositoryEntityNames('interface UserRepository extends JpaRepository<User, Long> {}'), ['User']);
		assert.deepStrictEqual(findEntityProperties('interface UserRepository extends JpaRepository<User, Long> {}', [user, order]), ['active', 'email']);
	});
});
