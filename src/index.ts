/**
 * json-to-csharp — generate C# classes or records from a JSON sample.
 *
 * Try it online: https://jsonbite.com/json-to-csharp
 */

export type Style = "class" | "record";
export type Attributes = "none" | "stj" | "newtonsoft";

export interface Options {
    /** Name of the root type. Default: "Root". */
    rootName?: string;
    /** `class` (`{ get; set; }` properties) or positional `record` (C# 9+). Default: "class". */
    style?: Style;
    /**
     * Serializer attributes mapping each property to its original JSON key:
     * `stj` → `[JsonPropertyName]` (System.Text.Json), `newtonsoft` → `[JsonProperty]`. Default: "none".
     */
    attributes?: Attributes;
    /**
     * Nullable reference types (on by default in .NET 6+ projects): null/missing fields become
     * `string?`, `Address?`, and required reference properties get an initializer. Default: true.
     */
    nullable?: boolean;
    /** Wrap the output in a file-scoped namespace, e.g. "MyApp.Models". Default: none. */
    namespace?: string;
}

type JsonVal = null | boolean | number | string | JsonVal[] | { [k: string]: JsonVal };
type CsField = { jsonKey: string; name: string; type: string; nullable: boolean };

// Value types: `T?` means Nullable<T> and is valid with or without nullable reference types.
const VALUE_TYPES = new Set(["int", "long", "double", "bool", "DateTime"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function toPascalCase(key: string): string {
    let s = key.replace(/[-_\s.]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""));
    s = s.replace(/[^a-zA-Z0-9_]/g, "");
    if (!s) s = "Field";
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (/^[0-9]/.test(s)) s = "_" + s;
    return s;
}

function singularize(s: string): string {
    if (s.endsWith("ies")) return s.slice(0, -3) + "y";
    if (s.endsWith("s") && !s.endsWith("ss")) return s.slice(0, -1);
    return s + "Item";
}

function csString(s: string): string {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isObject(v: JsonVal): v is { [k: string]: JsonVal } {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

function getType(val: JsonVal, hint: string, out: Map<string, CsField[]>): string {
    if (typeof val === "boolean") return "bool";
    if (typeof val === "number") {
        if (Number.isInteger(val)) return val >= -2147483648 && val <= 2147483647 ? "int" : "long";
        return "double";
    }
    if (typeof val === "string") return ISO_DATE.test(val) ? "DateTime" : "string";

    if (Array.isArray(val)) {
        if (val.length === 0) return "List<object>";
        if (val.every(isObject)) {
            const itemName = toPascalCase(singularize(hint));
            buildClass(val as { [k: string]: JsonVal }[], itemName, out);
            return `List<${itemName}>`;
        }
        const types = [...new Set(val.filter(v => v !== null).map(v => getType(v, hint + "Item", out)))];
        return types.length === 1 ? `List<${types[0]}>` : "List<object>";
    }

    const className = toPascalCase(hint);
    buildClass([val as { [k: string]: JsonVal }], className, out);
    return className;
}

function buildClass(samples: { [k: string]: JsonVal }[], name: string, out: Map<string, CsField[]>): void {
    if (out.has(name)) return;
    out.set(name, []); // placeholder to prevent infinite recursion

    const allKeys = [...new Set(samples.flatMap(s => Object.keys(s)))];
    const used = new Set<string>();
    const fields: CsField[] = [];

    for (const key of allKeys) {
        const vals = samples.map(s => (key in s ? s[key] : undefined));
        const defined = vals.filter(v => v !== undefined) as JsonVal[];
        const nonNull = defined.filter(v => v !== null);
        const nullable = defined.length < vals.length || defined.length !== nonNull.length;

        const types = [...new Set(nonNull.map(v => getType(v, key, out)))];
        const type = types.length === 1 ? types[0] : "object";

        // C# forbids a member named like its enclosing type (CS0542), and names must be unique.
        let prop = toPascalCase(key);
        if (prop === name) prop += "Value";
        let unique = prop;
        for (let i = 2; used.has(unique); i++) unique = `${prop}${i}`;
        used.add(unique);

        fields.push({ jsonKey: key, name: unique, type, nullable: nullable || type === "object" });
    }

    out.set(name, fields);
}

function attrFor(f: CsField, attrs: Attributes): string {
    if (attrs === "stj") return `[JsonPropertyName(${csString(f.jsonKey)})]`;
    if (attrs === "newtonsoft") return `[JsonProperty(${csString(f.jsonKey)})]`;
    return "";
}

function typeFor(f: CsField, nrt: boolean): string {
    if (!f.nullable) return f.type;
    return VALUE_TYPES.has(f.type) || nrt ? `${f.type}?` : f.type;
}

// With nullable reference types on, non-nullable reference properties need a value,
// otherwise the compiler warns (CS8618).
function initializerFor(f: CsField, nrt: boolean): string {
    if (!nrt || f.nullable || VALUE_TYPES.has(f.type)) return "";
    if (f.type === "string") return " = string.Empty;";
    return " = new();";
}

function renderClass(name: string, fields: CsField[], attrs: Attributes, nrt: boolean): string {
    const lines = [`public class ${name}`, "{"];
    fields.forEach((f, i) => {
        const attr = attrFor(f, attrs);
        if (attr) lines.push(`    ${attr}`);
        lines.push(`    public ${typeFor(f, nrt)} ${f.name} { get; set; }${initializerFor(f, nrt)}`);
        if (i < fields.length - 1) lines.push("");
    });
    lines.push("}");
    return lines.join("\n");
}

function renderRecord(name: string, fields: CsField[], attrs: Attributes, nrt: boolean): string {
    if (fields.length === 0) return `public record ${name}();`;
    const params = fields.map(f => {
        const attr = attrFor(f, attrs);
        // On positional records the attribute must target the generated property.
        const prefix = attr ? `[property: ${attr.slice(1, -1)}] ` : "";
        return `    ${prefix}${typeFor(f, nrt)} ${f.name}`;
    });
    return `public record ${name}(\n${params.join(",\n")}\n);`;
}

/**
 * Generate C# types from a JSON sample.
 *
 * @param json  JSON text, or an already-parsed value. Must be an object or an array of objects.
 * @returns     C# source code (usings + one type per JSON object shape).
 * @throws      If the JSON is invalid or isn't an object / array of objects.
 *
 * @example
 * jsonToCSharp('{"id": 1, "name": "Alice"}', { attributes: "stj" });
 */
export function jsonToCSharp(json: string | unknown, options: Options = {}): string {
    const { rootName = "Root", style = "class", attributes = "none", nullable = true, namespace } = options;

    const parsed = (typeof json === "string" ? JSON.parse(json) : json) as JsonVal;
    const out = new Map<string, CsField[]>();
    const root = toPascalCase(rootName) || "Root";

    if (Array.isArray(parsed)) {
        if (parsed.length === 0 || !parsed.every(isObject)) {
            throw new TypeError("Input must be a JSON object or a non-empty array of objects.");
        }
        buildClass(parsed as { [k: string]: JsonVal }[], root, out);
    } else if (isObject(parsed)) {
        buildClass([parsed], root, out);
    } else {
        throw new TypeError("Input must be a JSON object or a non-empty array of objects.");
    }

    const body = [...out]
        .map(([name, fields]) => (style === "record" ? renderRecord(name, fields, attributes, nullable) : renderClass(name, fields, attributes, nullable)))
        .join("\n\n");

    const usings: string[] = [];
    if (/\bDateTime\b/.test(body)) usings.push("using System;");
    if (body.includes("List<")) usings.push("using System.Collections.Generic;");
    if (attributes === "stj") usings.push("using System.Text.Json.Serialization;");
    if (attributes === "newtonsoft") usings.push("using Newtonsoft.Json;");

    const parts: string[] = [];
    if (usings.length) parts.push(usings.join("\n"));
    if (namespace) parts.push(`namespace ${namespace};`);
    parts.push(body);
    return parts.join("\n\n") + "\n";
}

export default jsonToCSharp;
