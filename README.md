# Spring Data JPA & MongoDB Tools

**Version 2.1.0**

[Install from Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=houssam-ouatmani.spring-jpa-autocomplete)
<br>
[Install from Open VSX Registry](https://open-vsx.org/extension/houssam-ouatmani/spring-jpa-autocomplete)

Write Spring Data JPA and MongoDB repositories with context-aware completion, live query diagnostics, one-step fixes, and navigation between repository code and data models.

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

### Work with Spring Data MongoDB

```java
@Document("users")
class UserDocument {
  @Id String id;
  @Field("display_name") String displayName;
  String email;
}

interface UserRepository extends MongoRepository<UserDocument, String> {
  List<UserDocument> findByDisplayNameStartingWith(String prefix);

  @Query("""
      {
        '$and': [
          { 'title': { '$regex': ?0, '$options': 'i' } },
          { 'content': { '$regex': ?1, '$options': 'i' } }
        ]
      }
      """)
  List<UserDocument> search(String title, String content);
}
```

Mongo document fields power derived-query completion. Inside Mongo `@Query` and `@Aggregation` strings, completion suggests mapped field paths, logical operators, and operators such as `$regex`, `$options`, `$gte`, `$in`, and `$elemMatch`; entries include syntax and examples. Hover an operator for its MongoDB documentation. Diagnostics check unknown fields and operators, offer typo fixes, and catch unmatched quotes or braces. `@Field` names and nested paths are respected.

The **Convert to @Query (MongoDB)** refactoring converts supported derived repository methods into Mongo JSON queries with positional parameters, mapped `@Field` names, regex flags for case-insensitive substring matching, sort metadata, and `count` / `exists` / `delete` options. It resolves paths through embedded POJOs and collection elements too, so `List<Post> findByTagsName(String tagsName)` can target `tags.name`. It is not offered when modifiers or predicates cannot be represented without changing the method's behavior.

`MongoTemplate` and `ReactiveMongoTemplate` Criteria fields are completed and validated when the method's template operation identifies its document type. Mongo query diagnostics can be configured independently with `springJpa.diagnostics.mongoQueries`.

### Multi-Module & Microservice Workspaces (Maven / Gradle / Multi-Root)

In complex monorepos, multi-project builds, or microservice wrappers:
- **Bounded Context Isolation**: Entities, repositories, and DTOs with identical names across distinct microservices (e.g. `auth-service`'s `User` vs. `order-service`'s `User`) are strictly scoped. Autocompletion and diagnostics never confuse or cross-pollinate models between services.
- **Shared Libraries & Common Modules**: Base entities and `@MappedSuperclass` models defined in shared libraries (e.g. `common-lib`, `core-domain`) are inherited seamlessly across all dependent microservices.
- **Localized SQL Dialect & Profiles**: Each microservice automatically detects its own database dialect from its local `src/main/resources/application*.yml` or `application*.properties`, supporting Spring profiles (e.g. `application-dev.yml`), R2DBC URLs, and database driver classes.
- **Dynamic Multi-Root Support**: VS Code multi-root workspaces (`.code-workspace`) and build descriptor updates (`pom.xml`, `build.gradle`, `settings.gradle`) are dynamically tracked without needing to restart the editor.

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
- **Spring Data MongoDB**: indexes `@Document` types separately from JPA entities, supports synchronous and reactive Mongo repositories, suggests derived-query operators and mapped fields in `@Query` / `@Aggregation` and MongoTemplate Criteria operations, documents Mongo operators inline and on hover, and diagnoses unknown fields/operators and malformed query structure.
  - Supports mapped and dotted nested field paths, `F12`, references, rename edits for unmapped keys, and a typo Quick Fix.
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
  - **Convert to @Query (JPQL)**: converts supported JPA derived methods into their equivalent JPQL `@Query` annotation with mapped operators, `ORDER BY`, `@Param`, and `@Modifying` if needed.
  - **Convert to @Query (MongoDB)**: converts representable Mongo derived methods into a Mongo JSON query with positional parameters, mapped `@Field` names, regex options, sorting, and count / exists / delete annotation options.
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

The latest release is `2.1.0`; see [CHANGELOG.md](CHANGELOG.md) for full release notes.

## Requirements

- VS Code `1.136.0` or later.
- A Java project containing Spring Data JPA repositories and entity classes.

## License

MIT
