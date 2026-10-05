# Spring Data JPA Tools

**Version 1.0.0** · [Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=houssam-ouatmani.spring-jpa-autocomplete)

Write Spring Data JPA repositories with context-aware completion, live query diagnostics, one-step fixes, and navigation between repository code and entity models.

## See It in Action

### Build derived queries from entity properties

```java
@Entity
class User {
  String email;
  boolean active;
  Instant createdAt;
}

interface UserRepository extends JpaRepository<User, Long> {
  List<User> findByEmailAndActiveOrderByCreatedAtDesc(String email, boolean active);
}
```

Complete after `findBy` to browse entity properties, then continue with operators, `And` / `Or`, or `OrderBy`. The extension checks property names, argument count and types, return types, and pagination parameters as you edit.

Return types are also checked against the repository entity when the declared result is another indexed JPA entity. Projection and DTO types that are not known JPA entities remain valid.

```java
interface UserRepository extends JpaRepository<User, Long> {
  List<Order> findByEmail(String email); // diagnostic: this repository manages User
  List<UserSummary> findByActive(boolean active); // allowed as a projection
}
```

### Catch JPQL mistakes before running the application

```java
@Query("""
  SELECT o
  FROM Order o
  JOIN o.customer c
  WHERE c.emial = :email
""")
List<Order> findByCustomerEmail(@Param("email") String email);
```

The unknown `emial` property gets a diagnostic and, when a close match exists, a rename fix. Complete after `c.` to see `Customer` properties; use `F12` on a property or parameter to navigate to its declaration.

### Fix every missing argument in one action

```java
Boolean existsByCreatedAtOrTitleOrContent();
```

The Quick Fix infers the three property types and adds all required parameters together, instead of making you apply the same fix repeatedly.

### Work with native SQL too

```java
@Query(value = """
  SELECT u.user_id, u.email
  FROM app_user u
  WHERE u.email = :email
""", nativeQuery = true)
List<User> searchByEmail(@Param("email") String email);
```

Native query strings receive SQL syntax highlighting and mapped table / column suggestions from `@Table`, `@Column`, and `@JoinColumn`. `@NativeQuery` is supported as well. The extension also recognizes common SQL dialect keywords for PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, and H2, with auto-detection from Spring/Hibernate settings or JDBC URLs and an override at workspace or file level.

## Feature Reference

- **Derived query completions**: `findBy`, `countBy`, `existsBy`, `deleteBy`, etc. with modifiers (`Distinct`, `Top`, `First`), predicates, operators, connectors, and `OrderBy`.
- **Completion ordering**: entity properties are displayed before operators and keywords.
- **Entity & Property model**:
  - Grammar-based Java syntax-tree parsing for entity declarations, fields, annotations, records, and projections, with the existing parser retained as a fallback for incomplete source while typing.
  - Indexes multiple top-level JPA types declared in the same Java source file.
  - Support for `@Entity`, `@MappedSuperclass` inheritance, `@Embeddable`, and Java records.
  - JPA entity names (`@Entity(name = ...)`), physical table names (`@Table`), and physical column names (`@Column` / `@JoinColumn`).
  - Support for Spring Data projection interfaces based on `getX()`, `isX()`, and `hasX()` accessors.
  - Automatic property detection for Lombok `@Data`, `@Getter`, `@Value`.
  - Exclusion of `@Transient` fields and `transient` keyword.
  - Nested property suggestions with both camelCase (`AddressCity`) and underscore (`Address_City`) navigation.
  - Inherited and nested property resolution across related entities.
  - URI-aware workspace indexing so same-named entities do not overwrite each other.
  - JPA relation metadata for `@OneToOne`, `@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@Embedded`, and `@EmbeddedId`.
- **Derived query validation**:
  - Validates property existence against the repository's entity.
  - Return type validation (`existsBy` must return `boolean`, `countBy` must return numeric `long`/`int`).
  - Parameter validation: flags missing or extra method parameters and missing `Pageable` on `Page` return types.
  - `OrderBy` property validation.
  - Parameter type validation, including collection parameters for `In` / `NotIn`.
  - Return-type validation catches a method returning a different indexed JPA entity than the repository manages, while allowing DTO/projection return types.
  - Typo suggestions for unknown entity properties.
- **Advanced JPQL support**:
  - Single-line and multi-line Java 15+ Text Blocks (`""" SELECT ... """`).
  - Table and alias resolution for `FROM ... JOIN ...` clauses, including chained joins.
  - Alias property completion (`u.` and `r.`), nested path completion (`p.category.` suggests `Category` properties), nested paths (`u.address.city`), and parameter completion (`:`).
  - Inherited property resolution in JPQL aliases.
  - Java-aware `@Query` extraction that ignores comments and Java strings, supports concatenated values, and preserves source offsets.
  - Support for `@Query(value = ..., countQuery = ...)` without mixing the two queries.
  - Native SQL detection: JPQL diagnostics and completion are disabled for `nativeQuery = true`.
  - Package-aware entity resolution when classes share the same simple name.
  - Accurate diagnostics for unknown entities, properties under aliases, and named parameters.
  - Positional query parameters (`?1` and legacy `?`) with signature/type validation, completion, and navigation.
  - Constructor DTO projections via `SELECT NEW`, with DTO completion and return-type validation.
  - Return-type validation between the JPQL `SELECT` entity and the repository method, including collection, optional, page, and slice results.
  - JPQL vocabulary and completion for clauses, operators, aggregates, string, numeric, temporal, collection, type, and custom functions.
  - Syntax highlighting inside `@Query` strings and text blocks for clauses, entities, aliases, properties, parameters, operators, functions, literals, and numbers.
  - Entity, alias-property, and named-parameter completions use context from earlier lines in JPQL text blocks.
  - Short English hover documentation for JPQL keywords and functions, including syntax and a practical use case for `SELECT`, `LEFT JOIN`, `LIKE`, `LOWER`, `UPPER`, `COUNT`, and more.
  - Hover documentation recognizes compound join keywords such as `LEFT JOIN`, `LEFT OUTER JOIN`, and `INNER JOIN` as a single JPQL construct.
- **Native SQL support**: recognizes Spring Data `@NativeQuery` and `@Query(nativeQuery = true)`, with SQL syntax highlighting and table / mapped-column suggestions based on `@Table`, `@Column`, and `@JoinColumn`.
  - SQL dialect awareness for PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, and H2.
  - Auto-detection from Spring/Hibernate settings and JDBC URLs, with a workspace-level override and a per-file override for active native queries.
- **IDE Navigation (Go to Definition - `Ctrl+Click` / `F12`)**:
  - Click on derived query property segment $\to$ jumps directly to the field definition in the entity.
  - Click on `:param` or `u.prop` in JPQL $\to$ jumps to parameter or entity field.
  - Click on repository generic entity `JpaRepository<User, Long>` $\to$ opens `User.java`.
- **Quick-Fixes (`Alt+Enter` / Lightbulb)**:
  - Add every missing derived-query parameter in one action.
  - Fix incompatible return type (`boolean`, `long`).
  - Rename unknown properties to the closest known entity property when a suggestion is available.
  - Add `@Param` annotation and its import to method parameters.
  - Add `Pageable` parameter and its import when returning `Page<T>`.
- **Repository generation**:
  - Run `Spring JPA: Generate Repository Method` with the cursor on a property to generate `findBy`, `readBy`, `getBy`, `queryBy`, `searchBy`, `streamBy`, `existsBy`, `countBy`, `deleteBy`, or `removeBy` methods.
  - Choose operators such as `Containing`, `In`, `NotIn`, `Between`, `GreaterThan`, `LessThan`, and null/boolean predicates.
  - Choose `Optional`, `List`, `Page`, `Slice`, or the entity return type; paged signatures include `Pageable`.
- **IDE assistance**:
  - Hover information for JPA entities, properties, and relations.
  - Contextual JPQL hover documentation for clauses, operators, and functions.
  - CodeLens above repositories showing their managed entity and property count.
- **Index and performance controls**:
  - Run `Spring JPA: Rebuild Entity Index` after changing project structure.
  - Configure `springJpa.diagnosticDebounceMs`, `springJpa.enablePerformanceDiagnostics`, `springJpa.includeTestSources`, and `springJpa.enableCodeLens` in VS Code settings.
  - Indexing skips Java files without JPA entity annotations, records, or projection interfaces, and excludes generated build and VS Code test-cache directories consistently across initial scans, file changes, and diagnostics. Set `springJpa.includeTestSources` to `false` to exclude `src/test`.
  - Completion requests use the entities already indexed instead of waiting for the full workspace scan; the scan runs in small batches and yields between batches so it does not monopolize the extension host.
  - Configure `springJpa.diagnostics.derivedQueries` and `springJpa.diagnostics.jpql` independently with `all`, `errors`, `warnings`, or `off`.
- **Incremental Indexing**: Fast in-memory cache synchronized with `vscode.workspace.createFileSystemWatcher`.
- **Debounced diagnostics**: Java diagnostics are delayed briefly while typing to avoid repeated analysis.
- **Repository context**: diagnostics and derived-query completion use the repository entity nearest to the current method, including files containing multiple repositories.

## Get Started

Install the extension, open a Java project, and start editing a Spring Data repository. Completion and diagnostics activate automatically. Use `F12` to navigate to a property, `Alt+Enter` to apply a Quick Fix, or run `Spring JPA: Generate Repository Method` from the Command Palette with the cursor on an entity property.

On first activation after installation, the extension displays a one-time English welcome message with a button to visit and star the project on GitHub.

## Development

```bash
npm install
npm run compile
npm run lint
npm run test:unit
```

Run `npm run package:check` to execute the release checks without creating a VSIX package.

The latest release is `1.0.0`; see [CHANGELOG.md](CHANGELOG.md) for release notes.

## Requirements

- VS Code `1.136.0` or later.
- A Java project containing Spring Data JPA repositories and entity classes.

## License

MIT
