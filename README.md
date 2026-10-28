# Spring Data JPA Tools

**Version 1.0.7** · 

[Install from Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=houssam-ouatmani.spring-jpa-autocomplete)
<br>
[Install from Open VSX Registry](https://open-vsx.org/extension/houssam-ouatmani/spring-jpa-autocomplete)

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

For constructor projections, completion after `SELECT NEW` finds DTO classes, records, and interfaces in the workspace and inserts the fully qualified type name:

```java
@Query("SELECT NEW com.example.dto.BookResponse(b.title) FROM Book b")
List<BookResponse> findBookResponses();
```

Start typing the DTO's simple name after `NEW`, then accept the suggestion to insert its package-qualified name.

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
  - Indexes multiple top-level JPA types declared in the same Java source file and discovers Java classes, records, and interfaces for JPQL DTO projection completion.
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
  - Constructor DTO projections via `SELECT NEW`, with workspace-wide class, record, and interface completions that insert fully qualified names, plus return-type validation.
  - Return-type validation between the JPQL `SELECT` entity and the repository method, including collection, optional, page, and slice results.
  - JPQL vocabulary and completion for clauses, operators, aggregates, string, numeric, temporal, collection, type, and custom functions.
  - **Conditional expressions** — `CASE WHEN … THEN … ELSE … END` with a ready-to-use snippet (tabstops for condition, result, and default), dedicated syntax highlighting scope (`keyword.control.conditional.jpql`), and full hover documentation that highlights the complete CASE block.
  - **`COALESCE(…)` and `NULLIF(…)`** — JPQL conditional functions with snippet completion, hover docs, and syntax highlighting.
  - **`NEW`** (DTO constructor projection) and **`ESCAPE`** (LIKE escape character) highlighted and documented.
  - Rich inline documentation in the completion popup for every keyword, function, and conditional keyword (syntax + practical example shown directly in the completion list).
  - Syntax highlighting inside `@Query` strings and text blocks for clauses, entities, aliases, properties, parameters, operators, functions, literals, and numbers.
  - Entity, alias-property, and named-parameter completions use context from earlier lines in JPQL text blocks.
  - Short English hover documentation for JPQL keywords and functions, including syntax and a practical use case for `SELECT`, `LEFT JOIN`, `LIKE`, `LOWER`, `UPPER`, `COUNT`, `CASE`, `COALESCE`, and more.
  - Hover documentation recognizes compound join keywords such as `LEFT JOIN`, `LEFT OUTER JOIN`, and `INNER JOIN` as a single JPQL construct.
- **Native SQL support**: recognizes Spring Data `@NativeQuery` and `@Query(nativeQuery = true)`, with SQL syntax highlighting and table / mapped-column suggestions based on `@Table`, `@Column`, and `@JoinColumn`.
  - SQL dialect awareness for PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, and H2.
  - Auto-detection from Spring/Hibernate settings and JDBC URLs, with a workspace-level override and a per-file override for active native queries.
- **IDE Navigation & Refactoring (`F12`, `F2`, `Shift+F12`)**:
  - **Go to Definition (`F12`)**:
    - Click on derived query property segment $\to$ jumps directly to the field definition in the entity.
    - Click on `:param` or `u.prop` in JPQL $\to$ jumps to parameter or entity field.
    - Click on repository generic entity `JpaRepository<User, Long>` $\to$ opens `User.java`.
  - **Global Rename Provider (`F2`)**:
    - Renaming an entity field (`F2`) updates both derived repository method names (e.g. `findByEmail` $\to$ `findByContactEmail`) and JPQL `@Query` property paths (`u.email` $\to$ `u.contactEmail`) across the workspace.
  - **Find All References (`Shift+F12`)**:
    - Finds all usages of an entity property across Spring Data repositories and JPQL `@Query` expressions.
  - **Bidirectional CodeLens**:
    - CodeLens above Spring Data repositories linking directly to the managed Entity (`Open Managed Entity`).
    - CodeLens above JPA entities linking directly to the corresponding Spring Data Repositories (`Open Spring Data Repository`).
- **Quick-Fixes & Refactorings (`Alt+Enter` / Lightbulb)**:
  - **Create field in Entity**: when typing a derived query method with an unmapped property (e.g. `findByPhoneNumber(String phone)`), generates the private field and accessors directly into the entity class.
  - **Convert to @Query (JPQL)**: converts any derived query method into its equivalent JPQL `@Query` annotation with mapped operators, `ORDER BY`, `@Param`, and `@Modifying` if needed.
  - Add every missing derived-query parameter in one action.
  - Fix incompatible return type (`boolean`, `long`, `int`, `void`).
  - Add missing `@Modifying` annotation to `UPDATE` / `DELETE` queries with automatic import.
  - Rename unknown properties to the closest known entity property when a suggestion is available.
  - Add `@Param` annotation to a single method parameter (quick-fix now inserts before the type, not inside it).
  - **Add all missing `@Param` annotations in one action** — when multiple parameters are missing `@Param`, a single "Add all N missing '@Param' annotations" quick-fix fixes them all at once.
  - Add `Pageable` parameter and its import when returning `Page<T>`.
- **JPA Entity & Relationship Diagnostics**:
  - Validates that every `@Entity` defines an identifier (`@Id` or `@EmbeddedId`), including inherited superclass IDs.
  - Bidirectional relation validation: checks that `mappedBy` in `@OneToMany` and `@OneToOne` points to a valid property on the target entity, with typo correction suggestions.
  - Hibernate proxy inspection: warns if an `@Entity` class is declared `final`.
  - JPA performance linter: warns when `FetchType.EAGER` is declared on collection relationships (`@OneToMany`, `@ManyToMany`), mitigating the N+1 query problem.
- **Modifying query inspection**:
  - Enforces `@Modifying` on `UPDATE` and `DELETE` JPQL queries.
  - Validates modifying query return types (`int`, `Integer`, `void`, or `boolean`).
- **Autoboxing and type flexibility**:
  - Full autoboxing support (`long` $\leftrightarrow$ `Long`, `int` $\leftrightarrow$ `Integer`, `boolean` $\leftrightarrow$ `Boolean`, etc.) and numeric family compatibility for JPQL parameters.
- **Index and performance controls**:
  - Run `Spring JPA: Rebuild Entity Index` after changing project structure.
  - Configure `springJpa.diagnosticDebounceMs`, `springJpa.enablePerformanceDiagnostics`, `springJpa.includeTestSources`, and `springJpa.enableCodeLens` in VS Code settings.
  - Entity-model indexing excludes Java files without JPA entity annotations, records, or projection interfaces. A separate workspace type index discovers declarations for DTO projection completion; both indexes exclude generated build and VS Code test-cache directories consistently. Set `springJpa.includeTestSources` to `false` to exclude `src/test`.
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

The latest release is `1.0.7`; see [CHANGELOG.md](CHANGELOG.md) for full release notes.

## Requirements

- VS Code `1.136.0` or later.
- A Java project containing Spring Data JPA repositories and entity classes.

## License

MIT
