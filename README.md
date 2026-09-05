# Spring JPA Autocomplete

Focused Spring Data JPA assistance for Java repositories in VS Code. Get completions for derived queries, related entity properties, and JPQL `@Query` expressions, with diagnostics for common mistakes.

## Installation

Install **Spring JPA Autocomplete** from the VS Code Marketplace, then open a Java or Spring project. The extension activates automatically for Java files.

## Features

- Repository prefixes: `findBy`, `readBy`, `getBy`, `queryBy`, `searchBy`, `streamBy`, `countBy`, `existsBy`, `deleteBy`, and `removeBy`.
- Operators: `And`, `Or`, `Is`, `Equals`, `Not`, `IsNull`, `IsNotNull`, `LessThan`, `GreaterThan`, `Between`, `Before`, `After`, `Like`, `Containing`, `In`, `True`, and `False`.
- Modifiers: `Distinct`, `Top`, `First`, `IgnoreCase`, `AllIgnoreCase`, `OrderBy`, `Asc`, and `Desc`.
- Property suggestions inferred from fields and getters in `@Entity` classes across the workspace.
- Nested property suggestions for simple entity relations, such as `findByAddressCity`.
- Diagnostics for unknown properties in derived query methods.
- JPQL `@Query` diagnostics for unknown entities, properties, and named parameters.
- JPQL property completion after an alias, such as `u.`.

Property suggestions are sourced from `@Entity` classes in the current workspace and are filtered to the repository's entity when its generic type is available.

## Usage

Open a Java repository and type a method such as:

```java
Optional<User> findByEmailAndActiveOrderByCreatedAtDesc(String email, boolean active);
```

JPQL repository methods with named parameters are also validated:

```java
@Query("SELECT u FROM User u WHERE u.id = :id")
List<User> search(@Param("id") UUID id);
```

When a query contains an invalid entity, property, or named parameter, the extension marks the relevant token with a diagnostic in the editor.

The extension is activated automatically for Java files. Suggestions can also be opened with `Ctrl+Space` or `Cmd+Space`.

## Requirements

VS Code 1.136 or later.

The Java language support extension is recommended for the best Java editing experience, but is not required for basic completion.

## Known limitations

The parser currently uses source text and does not inspect compiled entities outside the current workspace. JPQL validation currently targets single-line `@Query("...")` annotations; text blocks and multi-line queries are not resolved yet. Complex Java syntax, Lombok-generated properties, custom attribute names, and advanced JPA mappings are not resolved yet. Save changed Java files to refresh the entity index.

## Development

```bash
npm install
npm test
vsce package
```

## Release Notes

### 0.0.2 - 2026-09-05

- Added completion for related entity properties such as `findByAddressCity`.
- Added diagnostics for unknown derived-query properties.
- Added JPQL `@Query` validation for entities, properties, and named parameters.
- Added JPQL property completion after an alias such as `u.`.
- Fixed completion replacement so a partial prefix such as `ex` becomes `existsBy` instead of being appended.
- Improved completion metadata and field/property icons.

### 0.0.1 - 2026-09-05

- Initial release with Spring Data JPA keyword and entity property completion.
