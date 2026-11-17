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

const IRREGULAR: Record<string, string> = {
    children: "child", people: "person", men: "man", women: "woman", mice: "mouse",
    geese: "goose", feet: "foot", teeth: "tooth", indices: "index", matrices: "matrix",
    vertices: "vertex", analyses: "analysis", criteria: "criterion", phenomena: "phenomenon",
};
// Words that look plural/singular but aren't handled by the suffix rules below.
const IE_WORDS = /(movie|cookie|zombie|selfie|calorie|rookie|hoodie|genie|pie|tie|lie)s$/i;
const US_ES = /(status|virus|bonus|campus|bus|focus|census|corpus|prospectus|alias|canvas)es$/i;
const NO_PLURAL = /(news|series|species|status|address|analysis|class|data|info|metadata)$/i;

function singularize(word: string): string {
    // Only the last camelCase / snake_case segment is plural: "userAddresses" → "userAddress".
    const m = /^(.*?)([A-Z]?[a-z]+|[A-Z]+)$/.exec(word);
    const head = m ? m[1] : "";
    const tail = m ? m[2] : word;
    const lower = tail.toLowerCase();
    const keepCase = (sing: string) => (tail[0] === tail[0].toUpperCase() ? sing.charAt(0).toUpperCase() + sing.slice(1) : sing);

    let sing: string | null = null;
    if (IRREGULAR[lower]) sing = IRREGULAR[lower];
    else if (IE_WORDS.test(lower)) sing = lower.slice(0, -1);
    else if (US_ES.test(lower)) sing = lower.slice(0, -2);
    else if (NO_PLURAL.test(lower)) sing = null;
    else if (lower.endsWith("ies") && lower.length > 4) sing = lower.slice(0, -3) + "y";
    else if (/(ss|x|z|ch|sh)es$/.test(lower) && !/(cach|nich|ach)es$/.test(lower)) sing = lower.slice(0, -2);
    else if (lower.endsWith("s") && !lower.endsWith("ss") && !lower.endsWith("us") && !lower.endsWith("is")) sing = lower.slice(0, -1);

    return sing === null ? word + "Item" : head + keepCase(sing);
}

// Class names that would shadow a type the generated code (or most C# code) relies on.
const RESERVED_TYPES = new Set([
    "System", "Object", "String", "DateTime", "DateTimeOffset", "TimeSpan", "Guid", "Uri", "Type", "Task",
    "Exception", "Attribute", "Math", "Console", "Convert", "Enum", "Nullable", "Action", "Func", "Version",
    "JsonPropertyName", "JsonProperty", "JsonConvert", "JsonSerializer", "Newtonsoft",
]);

function csString(s: string): string {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

type Obj = { [k: string]: JsonVal };
type ClassInfo = { base: string; signature: string; fields: CsField[] };
type Ctx = Map<string, ClassInfo>;

function isObject(v: JsonVal): v is Obj {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

function primitiveType(v: boolean | number | string): string {
    if (typeof v === "boolean") return "bool";
    if (typeof v === "number") {
        if (!Number.isInteger(v)) return "double";
        return v >= -2147483648 && v <= 2147483647 ? "int" : "long";
    }
    return ISO_DATE.test(v) ? "DateTime" : "string";
}

// Combine the types seen at one position: int + long → long, any number + double → double,
// DateTime + string → string. Anything else that disagrees becomes object.
function widen(types: Set<string>): string {
    if (types.size === 1) return [...types][0];
    const all = (allowed: string[]) => [...types].every(t => allowed.includes(t));
    if (all(["int", "long"])) return "long";
    if (all(["int", "long", "double"])) return "double";
    if (all(["string", "DateTime"])) return "string";
    return "object";
}

/**
 * Infer one C# type for every (non-null) value seen at the same position, e.g. the values of
 * `author` across all elements of `posts`. Objects are merged into one class; arrays are
 * flattened so their elements are merged too.
 */
function inferType(values: JsonVal[], hint: string, parent: string, ctx: Ctx, nrt: boolean): string {
    if (values.length === 0) return "object";

    if (values.every(isObject)) return buildClass(values as Obj[], toPascalCase(hint), parent, ctx, nrt);

    if (values.every(Array.isArray)) {
        const elems = (values as JsonVal[][]).flat();
        const nonNull = elems.filter(v => v !== null);
        if (nonNull.length === 0) return "List<object>";
        // Nested arrays keep the hint so names don't pile up suffixes ("GridItemItem").
        const itemHint = nonNull.every(Array.isArray) ? hint : singularize(hint);
        const item = inferType(nonNull, itemHint, parent, ctx, nrt);
        const hasNull = nonNull.length < elems.length && item !== "object";
        return `List<${hasNull && (VALUE_TYPES.has(item) || nrt) ? item + "?" : item}>`;
    }

    if (values.some(v => typeof v === "object")) return "object"; // mix of objects, arrays, primitives
    return widen(new Set(values.map(v => primitiveType(v as boolean | number | string))));
}

/** Build (or reuse) a class for these object samples and return its name. */
function buildClass(samples: Obj[], base: string, parent: string, ctx: Ctx, nrt: boolean): string {
    if (RESERVED_TYPES.has(base)) base += "Model";

    // Reserve a unique name first so it's ordered before its nested classes and
    // nested classes can't take it.
    let name = base;
    if (ctx.has(name)) name = parent && !parent.endsWith(base) ? parent + base : base;
    for (let i = 2; ctx.has(name); i++) name = `${base}${i}`;
    ctx.set(name, { base, signature: "", fields: [] });

    const keys = [...new Set(samples.flatMap(s => Object.keys(s)))];
    const raw = keys.map(key => {
        const defined = samples.filter(s => key in s).map(s => s[key]);
        const nonNull = defined.filter(v => v !== null);
        const type = inferType(nonNull, key, name, ctx, nrt);
        const nullable = defined.length < samples.length || nonNull.length < defined.length || type === "object";
        return { jsonKey: key, type, nullable };
    });
    const signature = JSON.stringify(raw);

    // The same shape at another position (e.g. billing / shipping address) reuses one class.
    for (const [other, info] of ctx) {
        if (other !== name && info.base === base && info.signature === signature) {
            ctx.delete(name);
            return other;
        }
    }

    // C# forbids a member named like its enclosing type (CS0542), and names must be unique.
    const used = new Set<string>();
    const fields = raw.map(f => {
        let prop = toPascalCase(f.jsonKey);
        if (prop === name) prop += "Value";
        let unique = prop;
        for (let i = 2; used.has(unique); i++) unique = `${prop}${i}`;
        used.add(unique);
        return { ...f, name: unique };
    });

    ctx.set(name, { base, signature, fields });
    return name;
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
    const ctx: Ctx = new Map();
    const root = toPascalCase(rootName) || "Root";

    if (isObject(parsed)) {
        buildClass([parsed], root, "", ctx, nullable);
    } else if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isObject)) {
        buildClass(parsed as Obj[], root, "", ctx, nullable);
    } else {
        throw new TypeError("Input must be a JSON object or a non-empty array of objects.");
    }

    const body = [...ctx]
        .map(([name, { fields }]) => (style === "record" ? renderRecord(name, fields, attributes, nullable) : renderClass(name, fields, attributes, nullable)))
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
