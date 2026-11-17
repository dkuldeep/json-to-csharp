import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { jsonToCSharp } from "../dist/index.js";

const sample = {
    user: {
        id: 1,
        name: "Alice",
        score: 9.5,
        created_at: "2024-05-01T10:30:00Z",
        address: { city: "Springfield", zip_code: "12345" },
        tags: ["admin"],
        posts: [{ id: 101, title: "Hi" }],
        avatar: null,
    },
};

test("classes with nullable reference types (default)", () => {
    const cs = jsonToCSharp(sample);
    assert.match(cs, /^using System;\nusing System\.Collections\.Generic;/);
    assert.match(cs, /public class Root\n\{\n    public User User \{ get; set; \} = new\(\);/);
    assert.match(cs, /public int Id \{ get; set; \}/);
    assert.match(cs, /public string Name \{ get; set; \} = string\.Empty;/);
    assert.match(cs, /public double Score \{ get; set; \}/);
    assert.match(cs, /public DateTime CreatedAt \{ get; set; \}/);
    assert.match(cs, /public List<string> Tags \{ get; set; \} = new\(\);/);
    assert.match(cs, /public List<Post> Posts \{ get; set; \} = new\(\);/);
    assert.match(cs, /public object\? Avatar \{ get; set; \}/);
    assert.match(cs, /public class Address/);
    assert.match(cs, /public string ZipCode/);
});

test("System.Text.Json attributes", () => {
    const cs = jsonToCSharp(sample, { attributes: "stj" });
    assert.match(cs, /using System\.Text\.Json\.Serialization;/);
    assert.match(cs, /\[JsonPropertyName\("created_at"\)\]\n    public DateTime CreatedAt/);
});

test("records with Newtonsoft attributes use the property: target", () => {
    const cs = jsonToCSharp(sample, { style: "record", attributes: "newtonsoft" });
    assert.match(cs, /using Newtonsoft\.Json;/);
    assert.match(cs, /public record Post\(\n    \[property: JsonProperty\("id"\)\] int Id,\n    \[property: JsonProperty\("title"\)\] string Title\n\);/);
});

test("nullable: false keeps reference types bare and value types nullable", () => {
    const cs = jsonToCSharp([{ a: 1, s: "x" }, { a: null }], { nullable: false });
    assert.match(cs, /public int\? A \{ get; set; \}\n/);
    assert.match(cs, /public string S \{ get; set; \}\n/);
    assert.doesNotMatch(cs, /= string\.Empty/);
});

test("arrays of objects merge keys; optional fields become nullable", () => {
    const cs = jsonToCSharp([{ id: 1 }, { id: 2, note: "x" }], { rootName: "item" });
    assert.match(cs, /public class Item/);
    assert.match(cs, /public int Id \{ get; set; \}/);
    assert.match(cs, /public string\? Note \{ get; set; \}/);
});

test("naming edge cases", () => {
    const cs = jsonToCSharp({ item: 1, user_id: 1, userId: 2, "9lives": true, big: 9999999999 }, { rootName: "item" });
    assert.match(cs, /public int ItemValue/);     // member can't share its class's name
    assert.match(cs, /public int UserId \{/);
    assert.match(cs, /public int UserId2 \{/);    // deduplicated
    assert.match(cs, /public bool _9lives/);      // can't start with a digit
    assert.match(cs, /public long Big/);          // beyond int32
});

test("escapes quotes and backslashes in attribute names", () => {
    const cs = jsonToCSharp({ 'a"b\\c': 1 }, { attributes: "stj" });
    assert.match(cs, /\[JsonPropertyName\("a\\"b\\\\c"\)\]/);
});

test("namespace option adds a file-scoped namespace", () => {
    const cs = jsonToCSharp({ id: 1 }, { namespace: "MyApp.Models" });
    assert.match(cs, /^namespace MyApp\.Models;\n\npublic class Root/);
});

test("rejects non-object input", () => {
    assert.throws(() => jsonToCSharp("42"), /JSON object/);
    assert.throws(() => jsonToCSharp("[]"), /JSON object/);
    assert.throws(() => jsonToCSharp("{oops"), SyntaxError);
});

test("CLI reads stdin and applies options", () => {
    const out = execFileSync("node", ["dist/cli.js", "-n", "User", "-r", "-a", "stj"], { input: '{"id":1,"first_name":"A"}' }).toString();
    assert.match(out, /public record User\(\n    \[property: JsonPropertyName\("id"\)\] int Id,/);
});

test("same key with different shapes gets distinct classes; same shape is reused", () => {
    const cs = jsonToCSharp({ a: { data: { x: 1 } }, b: { data: { y: "s" } }, c: { data: { x: 2 } } });
    assert.match(cs, /public class A\n\{\n    public Data Data/);
    assert.match(cs, /public class B\n\{\n    public BData Data/);
    assert.match(cs, /public class C\n\{\n    public Data Data/);
    assert.match(cs, /public class BData\n\{\n    public string Y/);
    assert.equal(cs.match(/public class Data\b/g).length, 1);
});

test("nested objects inside array elements are merged", () => {
    const cs = jsonToCSharp({ posts: [{ author: { name: "a" } }, { author: { id: 1 } }] });
    assert.match(cs, /public class Author\n\{\n    public string\? Name \{ get; set; \}\n\n    public int\? Id/);
});

test("numbers widen across samples", () => {
    const cs = jsonToCSharp([{ d: 1, l: 1, s: "2024-05-01T10:30:00Z", n: [1, 2.5] }, { d: 1.5, l: 9999999999, s: "x", n: [3] }]);
    assert.match(cs, /public double D/);
    assert.match(cs, /public long L/);
    assert.match(cs, /public string S/);
    assert.match(cs, /public List<double> N/);
});

test("nested key matching the root name doesn't make the root recursive", () => {
    assert.match(jsonToCSharp({ root: { x: 1 } }), /public Root2 RootValue[\s\S]*public class Root2\n\{\n    public int X/);
});

test("singularizes list item names", () => {
    const keys = { statuses: "Status", addresses: "Address", categories: "Category", children: "Child", people: "Person",
        movies: "Movie", caches: "Cache", lineItems: "LineItem", news: "NewsItem", status: "StatusItem" };
    const cs = jsonToCSharp(Object.fromEntries(Object.keys(keys).map(k => [k, [{ a: 1 }]])));
    for (const [k, item] of Object.entries(keys)) assert.ok(cs.includes(`List<${item}> `), `${k} → ${item}`);
});

test("avoids class names that shadow .NET types", () => {
    const cs = jsonToCSharp({ system: { a: 1 }, dateTime: { b: 1 }, when: "2024-05-01T10:30:00Z" });
    assert.match(cs, /public SystemModel System/);
    assert.match(cs, /public DateTimeModel DateTime/);
    assert.match(cs, /public DateTime When/);
});

test("arrays of arrays and nulls inside lists", () => {
    const cs = jsonToCSharp({ grid: [[{ a: 1 }], [{ b: 2 }]], ids: [1, null], names: ["a", null] });
    assert.match(cs, /public List<List<GridItem>> Grid/);
    assert.match(cs, /public class GridItem\n\{\n    public int\? A \{ get; set; \}\n\n    public int\? B/);
    assert.match(cs, /public List<int\?> Ids/);
    assert.match(cs, /public List<string\?> Names/);
});
