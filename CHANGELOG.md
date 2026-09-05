# Change Log

All notable changes to the "spring-jpa-autocomplete" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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