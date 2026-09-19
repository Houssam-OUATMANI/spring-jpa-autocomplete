# Change Log

All notable changes to the "Spring Data JPA Tools" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.7.0] - 2026-09-19

### Added

- Added nested JPQL property completion after association paths such as `p.category.`.
- Added dedicated hover documentation for compound join clauses including `LEFT JOIN`, `LEFT OUTER JOIN`, `INNER JOIN`, `RIGHT JOIN`, `FULL JOIN`, and `CROSS JOIN`.
- Added regression tests for nested association completion and compound JPQL keyword documentation.

### Fixed

- Fixed nested JPQL property hovers so `p.category.id` reports `Category.id` instead of attributing the property to `Product`.

## [0.6.0] - 2026-09-16

### Added

- Added JPQL syntax highlighting inside Java `@Query` strings and text blocks.
- Added concise JPQL hover documentation with syntax and a practical example for common clauses, operators, and functions.
- JPQL hover documentation is currently provided in English; multilingual support is planned for a later release.
- Added distinct highlighting for JPQL clauses, operators, entities, aliases, properties, parameters, functions, literals, and numeric values.
- Added a standard JPQL vocabulary covering joins, grouping, ordering, aggregate functions, string functions, numeric functions, temporal functions, collection functions, `TREAT`, `TYPE`, and `FUNCTION`.
- Added parsing of nested JPQL function calls such as `LOWER(CONCAT(...))` without corrupting the repository method return type.
- Added JPQL regression tests for nested functions and entity return types.

### Fixed

- Fixed `@Query` extraction stopping at the first closing parenthesis inside a JPQL function call.
- Fixed false diagnostics such as `JPQL query selects 'Post', but method returns 'LIKE'`.
- Fixed Ctrl+Click navigation for nested JPQL properties so `p.category.id` opens the property in `Category.java`.
- Added JPQL parameter type diagnostics when a named parameter type does not match the referenced property, for example `Category.id` declared as `Long` but passed as `UUID`.

## [0.5.0] - 2026-09-14

### Added

- Added generation for `readBy`, `getBy`, `queryBy`, `searchBy`, `streamBy`, `countBy`, and `removeBy` methods.
- Added generation for `NotIn`, null, and boolean predicates.
- Added quick fixes for close matches to unknown derived-query properties.
- Added regression coverage for three-predicate queries such as `findByEmailOrFirstnameOrLastname`.

### Fixed

- Fixed missing-parameter quick fixes so they add the first missing parameter instead of the last one.
- Fixed connector parsing around property names containing `And` or `Or` text.
- Fixed parameter extraction for nested generic types containing commas.
- Renamed the displayed extension to **Spring Data JPA Tools**.

## [0.4.0] - 2026-09-13

### Added

- Added configurable repository CodeLens entries and JPA entity/property hover information.
- Added configurable repository method generation for common operators, including `Containing`, `In`, and `Between`.
- Added regression tests for relation extraction, JPQL return validation, and generated operators.
- Added basic JPQL return-type diagnostics for entity, collection, `Optional`, `Page`, and `Slice` results.
- Added JPA relation metadata for common relationship annotations and explicit `targetEntity` support.

## [0.3.0] - 2026-09-08

### Added

- Added package-aware entity resolution for repositories and entities that share the same simple class name.
- Added Spring Data projection interface discovery through `getX()`, `isX()`, and `hasX()` accessors.
- Added derived-query parameter type validation, including collection parameters for `In` and `NotIn`.
- Added close-property suggestions for unknown derived-query and JPQL properties.
- Added the `Spring JPA: Generate Repository Method` command for `findBy`, `existsBy`, and `deleteBy` methods.
- Added the `Spring JPA: Rebuild Entity Index` command.
- Added automatic imports for generated `Optional`, `@Param`, and `Pageable` declarations.
- Added VS Code settings for diagnostic debounce, performance logging, and test-source indexing.

### Improved

- Improved `@Query` extraction for JPQL expressions containing parentheses, such as `COALESCE` and `CONCAT`.
- Improved generated repository method signatures and entity-property selection.
- Added regression tests covering package collisions, projections, type validation, typo suggestions, and method generation.

## [0.2.0] - 2026-09-08

### Added

- Added diagnostics for extra parameters in derived query methods.
- Added validation of properties used by `OrderBy` clauses.
- Added inherited and nested property resolution for JPQL aliases.
- Added chained `JOIN` alias resolution for JPQL queries.
- Added completion ordering with properties before operators and keywords.
- Added regression coverage for duplicate entity names, inherited properties, nested JPQL paths, and completion ordering.

### Improved

- Made the workspace entity index URI-aware so entities with the same class name do not overwrite each other.
- Added a 150 ms debounce to Java diagnostics during editing.
- Updated `F12` navigation to use inherited and nested property resolution.
- Improved incremental index updates when documents change or are deleted.

## [0.1.0] - 2026-09-05

- **Entity Model & Lombok**:
  - Full support for `@MappedSuperclass` inheritance and property merging.
  - Automatic property detection for Lombok `@Data`, `@Getter`, `@Value`.
  - Exclusion of `@Transient` fields and `transient` keyword.
  - Support for Java Records as projection / entity models.
- **Derived Query Grammar & Diagnostics**:
  - Formal grammar parser for method subject, modifiers (`Distinct`, `First\d*`, `Top\d*`), predicates, and `OrderBy`.
  - Support for underscore navigation (`Address_City`).
  - Validation of return types (`existsBy` $\to$ `boolean`, `countBy` $\to$ numeric).
  - Validation of method parameters count and types with missing parameter diagnostics.
  - Warning on `Page<T>` return type without `Pageable`.
- **Advanced JPQL & Text Blocks**:
  - Full support for Java 15+ Text Blocks (`"""..."""`) and multi-line `@Query`.
  - Resolution of table aliases across `JOIN` clauses.
  - Precise token offset calculation for diagnostics (eliminated `indexOf` collisions).
  - Alias property validation and parameter completion.
- **IDE Navigation & Quick-Fixes**:
  - Added `DefinitionProvider` (`Ctrl+Click` / `F12`) on derived query properties and JPQL elements.
  - Added `CodeActionProvider` (`Alt+Enter`) offering Quick-Fixes for missing parameters, `@Param` annotations, and return types.
  - Incremental `WorkspaceEntityIndex` synchronized with `FileSystemWatcher`.

## [0.0.2] - 2026-09-05

- Added Spring Data JPA method keyword and entity property completion.
- Added nested property completion for related entities.
- Added diagnostics for unknown derived-query properties.
- Added JPQL `@Query` validation and alias property completion.
- Fixed completion replacement so a partial prefix is replaced instead of appended.
- Improved Java property extraction for annotations, package-private fields, collections, and modifiers.
- Added support for generic repository return types and `@Param` method parameters.

## [0.0.1] - 2026-09-05

- Initial Marketplace-ready release.
