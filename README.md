# Spring JPA Autocomplete

Focused Spring Data JPA assistance for Java repositories in VS Code. Get completions for derived queries, related entity properties, and JPQL `@Query` expressions, with diagnostics for common mistakes.

## Installation

Install **Spring JPA Autocomplete** from the VS Code Marketplace, then open a Java or Spring project. The extension activates automatically for Java files.

## Features

- **Derived query completions**: `findBy`, `countBy`, `existsBy`, `deleteBy`, etc. with modifiers (`Distinct`, `Top`, `First`).
- **Entity & Property model**:
  - Support for `@Entity`, `@MappedSuperclass` inheritance, `@Embeddable`, and Java records.
  - Automatic property detection for Lombok `@Data`, `@Getter`, `@Value`.
  - Exclusion of `@Transient` fields and `transient` keyword.
  - Nested property suggestions with both camelCase (`AddressCity`) and underscore (`Address_City`) navigation.
- **Derived query validation**:
  - Validates property existence against the repository's entity.
  - Return type validation (`existsBy` must return `boolean`, `countBy` must return numeric `long`/`int`).
  - Parameter validation: flags missing or extra method parameters and missing `Pageable` on `Page` return types.
- **Advanced JPQL support**:
  - Single-line and multi-line Java 15+ Text Blocks (`""" SELECT ... """`).
  - Table and alias resolution for `FROM ... JOIN ...` clauses (e.g. `JOIN u.roles r`).
  - Alias property completion (`u.` and `r.`) and parameter completion (`:`).
  - Accurate diagnostics for unknown entities, properties under aliases, and named parameters.
- **IDE Navigation (Go to Definition - `Ctrl+Click` / `F12`)**:
  - Click on derived query property segment $\to$ jumps directly to the field definition in the entity.
  - Click on `:param` or `u.prop` in JPQL $\to$ jumps to parameter or entity field.
  - Click on repository generic entity `JpaRepository<User, Long>` $\to$ opens `User.java`.
- **Quick-Fixes (`Alt+Enter` / Lightbulb)**:
  - Add missing parameter to repository method signature.
  - Fix incompatible return type (`boolean`, `long`).
  - Add `@Param` annotation to method parameter.
  - Add `Pageable` parameter when returning `Page<T>`.
- **Incremental Indexing**: Fast in-memory cache synchronized with `vscode.workspace.createFileSystemWatcher`.

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

### 0.0.2 - 2026-09-05

- Added completion for related entity properties such as `findByAddressCity`.
- Added diagnostics for unknown derived-query properties.
- Added JPQL `@Query` validation for entities, properties, and named parameters.
- Added JPQL property completion after an alias such as `u.`.
- Fixed completion replacement so a partial prefix such as `ex` becomes `existsBy` instead of being appended.
- Improved completion metadata and field/property icons.

### 0.0.1 - 2026-09-05

- Initial release with Spring Data JPA keyword and entity property completion.
