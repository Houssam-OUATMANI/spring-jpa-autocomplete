# Spring JPA Autocomplete

Autocomplete Spring Data JPA derived-query keywords while writing Java repository methods.

## Features

- Repository prefixes: `findBy`, `readBy`, `getBy`, `queryBy`, `searchBy`, `streamBy`, `countBy`, `existsBy`, `deleteBy`, and `removeBy`.
- Operators: `And`, `Or`, `Is`, `Equals`, `Not`, `IsNull`, `IsNotNull`, `LessThan`, `GreaterThan`, `Between`, `Before`, `After`, `Like`, `Containing`, `In`, `True`, and `False`.
- Modifiers: `Distinct`, `Top`, `First`, `IgnoreCase`, `AllIgnoreCase`, `OrderBy`, `Asc`, and `Desc`.
- Property suggestions inferred from fields and getters in `@Entity` classes across the workspace.

## Usage

Open a Java repository and type a method such as:

```java
Optional<User> findByEmailAndActiveOrderByCreatedAtDesc(String email, boolean active);
```

The extension is activated automatically for Java files. Suggestions can also be opened with `Ctrl+Space` or `Cmd+Space`.

## Requirements

VS Code 1.136 or later.

## Known limitations

The first version does not inspect compiled entities outside the current workspace. Save changed Java files to refresh the entity index.

## Release Notes

### 0.0.1

Initial release with Spring Data JPA keyword and property completion.
