# Spring Data JPA Tools

VS Code assistance for Spring Data JPA repositories: derived-query completion, JPQL completion, diagnostics, quick-fixes, and navigation for Java projects.

## Marketplace

Marketplace link
<a href="https://marketplace.visualstudio.com/items?itemName=houssam-ouatmani.spring-jpa-autocomplete" target="_blank">Spring Data JPA Tools
</a>

## Installation

Install **Spring Data JPA Tools** from the VS Code Marketplace, then open a Java or Spring project. The extension activates automatically for Java files.

## Features

- **Derived query completions**: `findBy`, `countBy`, `existsBy`, `deleteBy`, etc. with modifiers (`Distinct`, `Top`, `First`), predicates, operators, connectors, and `OrderBy`.
- **Completion ordering**: entity properties are displayed before operators and keywords.
- **Entity & Property model**:
  - Support for `@Entity`, `@MappedSuperclass` inheritance, `@Embeddable`, and Java records.
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
  - Short English hover documentation for JPQL keywords and functions, including syntax and a practical use case for `SELECT`, `LEFT JOIN`, `LIKE`, `LOWER`, `UPPER`, `COUNT`, and more.
  - Hover documentation recognizes compound join keywords such as `LEFT JOIN`, `LEFT OUTER JOIN`, and `INNER JOIN` as a single JPQL construct.
- **IDE Navigation (Go to Definition - `Ctrl+Click` / `F12`)**:
  - Click on derived query property segment $\to$ jumps directly to the field definition in the entity.
  - Click on `:param` or `u.prop` in JPQL $\to$ jumps to parameter or entity field.
  - Click on repository generic entity `JpaRepository<User, Long>` $\to$ opens `User.java`.
- **Quick-Fixes (`Alt+Enter` / Lightbulb)**:
  - Add missing parameter to repository method signature.
  - Add the first missing parameter when several derived-query predicates are present.
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
  - Configure `springJpa.diagnostics.derivedQueries` and `springJpa.diagnostics.jpql` independently with `all`, `errors`, `warnings`, or `off`.
- **Incremental Indexing**: Fast in-memory cache synchronized with `vscode.workspace.createFileSystemWatcher`.
- **Debounced diagnostics**: Java diagnostics are delayed briefly while typing to avoid repeated analysis.
- **Repository context**: diagnostics and derived-query completion use the repository entity nearest to the current method, including files containing multiple repositories.

## Usage

Open a Java repository and type a method such as:

```java
Optional<User> findByEmailAndActiveOrderByCreatedAtDesc(String email, boolean active);
```

Multi-line JPQL Text Blocks with aliases and named parameters are also validated:

```java
@Query("""
    SELECT o
    FROM Order o
    JOIN o.user u
    WHERE u.email = :userEmail
""")
List<Order> findByUserEmail(@Param("userEmail") String userEmail);
```

Press `Ctrl+Click` on any property to navigate directly to its definition in the entity, or `Alt+Enter` on warnings/errors to apply Quick-Fixes.

To generate a repository method, place the cursor on an entity property in a repository file and run `Spring JPA: Generate Repository Method` from the Command Palette. Choose the method kind and query operator.

## Development

```bash
npm install
npm run compile
npm run lint
npm run test:unit
```

Run `npm run package:check` to execute the release checks without creating a VSIX package.

The extension version is maintained in `package.json`. The `0.8.0` release includes the parser, entity-resolution, native-query, and repository-context fixes listed in the changelog above.

## Requirements

- VS Code `1.136.0` or later.
- A Java project containing Spring Data JPA repositories and entity classes.

## License

MIT
