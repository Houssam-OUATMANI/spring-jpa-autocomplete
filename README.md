# Spring JPA Autocomplete

VS Code assistance for Spring Data JPA repositories: derived-query completion, JPQL completion, diagnostics, quick-fixes, and navigation for Java projects.

## Installation

Install **Spring JPA Autocomplete** from the VS Code Marketplace, then open a Java or Spring project. The extension activates automatically for Java files.

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
  - Alias property completion (`u.` and `r.`), nested paths (`u.address.city`), and parameter completion (`:`).
  - Inherited property resolution in JPQL aliases.
  - Accurate diagnostics for unknown entities, properties under aliases, and named parameters.
- **IDE Navigation (Go to Definition - `Ctrl+Click` / `F12`)**:
  - Click on derived query property segment $\to$ jumps directly to the field definition in the entity.
  - Click on `:param` or `u.prop` in JPQL $\to$ jumps to parameter or entity field.
  - Click on repository generic entity `JpaRepository<User, Long>` $\to$ opens `User.java`.
- **Quick-Fixes (`Alt+Enter` / Lightbulb)**:
  - Add missing parameter to repository method signature.
  - Fix incompatible return type (`boolean`, `long`).
  - Add `@Param` annotation and its import to method parameters.
  - Add `Pageable` parameter and its import when returning `Page<T>`.
- **Repository generation**:
  - Run `Spring JPA: Generate Repository Method` with the cursor on a property to generate `findBy`, `existsBy`, or `deleteBy` methods.
- **Index and performance controls**:
  - Run `Spring JPA: Rebuild Entity Index` after changing project structure.
  - Configure `springJpa.diagnosticDebounceMs`, `springJpa.enablePerformanceDiagnostics`, and `springJpa.includeTestSources` in VS Code settings.
- **Incremental Indexing**: Fast in-memory cache synchronized with `vscode.workspace.createFileSystemWatcher`.
- **Debounced diagnostics**: Java diagnostics are delayed briefly while typing to avoid repeated analysis.

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

To generate a repository method, place the cursor on an entity property in a repository file and run `Spring JPA: Generate Repository Method` from the Command Palette. Choose `find`, `exists`, or `delete`.

## Development

```bash
npm install
npm run compile
npm run lint
npm run test:unit
```

Run `npm run package:check` to execute the release checks without creating a VSIX package.

The extension version is maintained in `package.json`. The `0.3.0` release includes the features listed in the changelog above.

## Requirements

- VS Code `1.136.0` or later.
- A Java project containing Spring Data JPA repositories and entity classes.

## License

MIT
