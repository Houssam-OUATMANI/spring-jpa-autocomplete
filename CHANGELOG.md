# Change Log

All notable changes to the "spring-jpa-autocomplete" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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