#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { jsonToCSharp, type Options } from "./index.js";

const HELP = `Usage: json-to-csharp [file] [options]

Generate C# classes or records from JSON. Reads stdin when no file is given.

Options:
  -n, --name <Name>        Root type name (default: Root)
  -r, --record             Generate positional records instead of classes
  -a, --attributes <kind>  none | stj | newtonsoft (default: none)
      --no-nullable        Disable nullable reference types
      --namespace <Name>   Add a file-scoped namespace
  -h, --help               Show this help

Examples:
  json-to-csharp response.json --name User --attributes stj
  curl -s https://api.example.com/user | json-to-csharp -n User -r

Online version: https://jsonbite.com/json-to-csharp`;

function fail(msg: string): never {
    process.stderr.write(`json-to-csharp: ${msg}\n`);
    process.exit(1);
}

const args = process.argv.slice(2);
const options: Options = {};
let file: string | undefined;

for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = () => args[++i] ?? fail(`missing value for ${a}`);
    switch (a) {
        case "-h": case "--help":       process.stdout.write(HELP + "\n"); process.exit(0);
        case "-n": case "--name":       options.rootName = value(); break;
        case "-r": case "--record":     options.style = "record"; break;
        case "-a": case "--attributes": {
            const v = value();
            if (v !== "none" && v !== "stj" && v !== "newtonsoft") fail(`--attributes must be none, stj or newtonsoft`);
            options.attributes = v;
            break;
        }
        case "--no-nullable":           options.nullable = false; break;
        case "--namespace":             options.namespace = value(); break;
        default:
            if (a.startsWith("-")) fail(`unknown option ${a} (see --help)`);
            if (file) fail("only one input file is supported");
            file = a;
    }
}

if (!file && process.stdin.isTTY) {
    process.stdout.write(HELP + "\n");
    process.exit(0);
}

let input: string;
try {
    input = readFileSync(file ?? 0, "utf8");
} catch (e) {
    fail(`cannot read ${file ?? "stdin"}: ${(e as Error).message}`);
}

try {
    process.stdout.write(jsonToCSharp(input, options));
} catch (e) {
    fail((e as Error).message);
}
