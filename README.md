# json-to-csharp

Generate C# classes or records from JSON — with `System.Text.Json` or `Newtonsoft.Json` attributes, nullable reference types, nested types and `List<T>`.

**Try it online:** [jsonbite.com/json-to-csharp](https://jsonbite.com/json-to-csharp) — paste JSON, get C# instantly, runs entirely in your browser.

```bash
npm install json-to-csharp
```

## Usage

```js
import { jsonToCSharp } from "json-to-csharp";

const json = `{
  "id": 1,
  "name": "Alice",
  "created_at": "2024-05-01T10:30:00Z",
  "address": { "city": "Springfield", "zip_code": "12345" },
  "posts": [{ "id": 101, "title": "Hello World" }],
  "avatar": null
}`;

console.log(jsonToCSharp(json, { rootName: "User", attributes: "stj" }));
```

```csharp
using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

public class User
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonPropertyName("address")]
    public Address Address { get; set; } = new();

    [JsonPropertyName("posts")]
    public List<Post> Posts { get; set; } = new();

    [JsonPropertyName("avatar")]
    public object? Avatar { get; set; }
}

public class Address
{
    [JsonPropertyName("city")]
    public string City { get; set; } = string.Empty;

    [JsonPropertyName("zip_code")]
    public string ZipCode { get; set; } = string.Empty;
}

public class Post
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;
}
```

`jsonToCSharp` accepts JSON text or an already-parsed object, and throws if the input isn't valid JSON or isn't an object / array of objects.

## Options

| Option       | Type                              | Default  | Description |
|--------------|-----------------------------------|----------|-------------|
| `rootName`   | `string`                          | `"Root"` | Name of the root type. |
| `style`      | `"class"` \| `"record"`           | `"class"`| `{ get; set; }` classes, or positional records (C# 9+). |
| `attributes` | `"none"` \| `"stj"` \| `"newtonsoft"` | `"none"` | `[JsonPropertyName]` (System.Text.Json) or `[JsonProperty]` (Newtonsoft) on every property. On records they use the `property:` target. |
| `nullable`   | `boolean`                         | `true`   | Nullable reference types: null/missing fields become `string?`, `Address?`; required reference properties get `= string.Empty;` / `= new();` to avoid CS8618. Value types like `int?` are nullable either way. |
| `namespace`  | `string`                          | —        | Adds a file-scoped namespace, e.g. `namespace MyApp.Models;`. |

## Type inference

| JSON | C# |
|------|----|
| whole number | `int` (or `long` beyond 32-bit) |
| decimal | `double` |
| `true` / `false` | `bool` |
| ISO 8601 string (`2024-05-01T10:30:00Z`) | `DateTime` |
| other string | `string` |
| object | its own class, named after the key |
| array of objects | `List<T>`, with `T` named after the singularized key (`posts` → `Post`, `categories` → `Category`, `children` → `Child`) |
| array of primitives | `List<int>`, `List<string>`, … (`List<int?>` if it contains `null`) |
| `null` only, or incompatible types | `object?` |

All values seen at the same position are merged before a type is picked:

- **Objects** — every element of an array, and objects nested inside them, are merged into one class. A field missing from some samples or `null` in any becomes nullable.
- **Numbers** widen: `int` + `long` → `long`, any number + decimal → `double`. A date in one sample and plain text in another → `string`.
- **Names** stay unique: the same key with a different shape elsewhere gets a prefixed class (`Data`, `BData`), while an identical shape reuses one class. Names that would shadow .NET types get a `Model` suffix (`SystemModel`).

Property names are PascalCased (`zip_code` → `ZipCode`), de-duplicated, and never clash with their enclosing type's name.

## CLI

```bash
npx json-to-csharp response.json --name User --attributes stj
curl -s https://api.example.com/user | npx json-to-csharp -n User --record
```

```
-n, --name <Name>        Root type name (default: Root)
-r, --record             Generate positional records instead of classes
-a, --attributes <kind>  none | stj | newtonsoft (default: none)
    --no-nullable        Disable nullable reference types
    --namespace <Name>   Add a file-scoped namespace
```

## More tools

This library powers the [JSON to C# converter on JSONbite](https://jsonbite.com/json-to-csharp). JSONbite also has free in-browser tools for [JSON → TypeScript](https://jsonbite.com/json-to-typescript), [Java](https://jsonbite.com/json-to-java), [Dart](https://jsonbite.com/json-to-dart), [Go](https://jsonbite.com/json-to-go) and [Python](https://jsonbite.com/json-to-python), plus a [JSON viewer](https://jsonbite.com/json-viewer), [formatter](https://jsonbite.com/json-formatter) and [diff](https://jsonbite.com/json-diff).

## License

[MIT](LICENSE)
