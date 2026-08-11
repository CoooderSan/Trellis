# Repository Analysis

The goal is to compare the loaded team spec baseline with the project's real
architecture. Do not start from generic templates and fill blanks. First learn
what the registry/template already covers, then investigate only potential
project-specific differences.

## Analysis Order

1. Inspect `.trellis/config.yaml` for the spec registry/template source, then
   read the existing `.trellis/spec/` indexes and applicable guidance.
2. Inspect package manifests, build scripts, workspace config, and top-level
   documentation to identify concrete project differences.
3. Build a short fit/gap list for stack, commands, module boundaries, domain
   patterns, verification, and local exceptions. Stop if everything fits.
4. For suspected gaps, use GitNexus for execution flows and dependency hubs,
   and ABCoder or language-native tooling for exact code shapes.
5. Read representative source and tests before turning any finding into a spec
   rule. Preserve applicable loaded guidance.

## What To Capture

| Area               | Questions                                                                             |
| ------------------ | ------------------------------------------------------------------------------------- |
| Package boundaries | What does each package own? What imports cross boundaries?                            |
| Runtime layers     | Which code is CLI, backend, frontend, worker, shared library, test-only, or tooling?  |
| Core abstractions  | Which types, services, stores, commands, routes, or adapters define the system shape? |
| Data flow          | Where does user input enter, how is it validated, and where does state persist?       |
| Error handling     | How are failures represented, logged, surfaced, and tested?                           |
| Configuration      | Where do defaults, environment config, generated files, and templates live?           |
| Tests              | Which test styles are trusted examples for new work?                                  |

## GitNexus Usage

Start broad, then inspect specific symbols:

```text
gitnexus_query({query: "CLI command execution flow"})
gitnexus_query({query: "template generation and migration"})
gitnexus_context({name: "SymbolName"})
gitnexus_cypher({query: "MATCH (n)-[r]->(m) RETURN n.name, type(r), m.name LIMIT 30"})
```

Use GitNexus results to find important files and flows. Do not quote graph output as the final authority until you have checked the relevant source files.

## ABCoder Usage

Use ABCoder when the spec needs exact code shapes:

```text
list_repos()
get_repo_structure({repo_name: "package-name"})
get_file_structure({repo_name: "package-name", file_path: "src/example.ts"})
get_ast_node({repo_name: "package-name", node_ids: [{mod_path: "...", pkg_path: "...", name: "SymbolName"}]})
```

ABCoder is most valuable for documenting constructor patterns, function signatures, type contracts, and reference chains.

## Analysis Notes

Keep short notes while analyzing. The notes should include:

- Package or layer name.
- Files that define the local pattern.
- Rules the spec should teach.
- Anti-patterns found in old code, comments, tests, or migration paths.
- Spec files that should be created, deleted, renamed, or merged.
- An explicit no-gap conclusion when the loaded baseline already fits.
