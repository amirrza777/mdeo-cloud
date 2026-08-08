# Packages and runtime dependencies

A language is not one package. It is split across three or four, because the same code has to run in
two very different places — the workbench's web worker in the browser, and the plugin service on a
server — and because only some of it may be loaded twice.

This page covers the split, the base packages the platform gives you, and the runtime dependency
mechanism that ties them together.

## The four packages of a language

| Package | Runs in | Contains |
| --- | --- | --- |
| `language-<name>` | Browser **and** service | Grammar, scoping, validation, type system, serializers, diagram server, action handlers |
| `editor-<name>` | Browser only | The GLSP/Sprotty diagram editor: views, palette, styling, client handlers |
| `protocol-<name>` | Both | Action and model types shared between editor and language server |
| `service-<name>` | Service only | The manifest, the served entry points, handlers, deployment |

Only `service-<name>` is deployed. The others are bundled into what it serves:

```
service-<name>/static/
├── language.js     ← language-<name>  (+ protocol-<name>)
├── editor.js       ← editor-<name>    (+ protocol-<name>)
├── styles.css      ← editor-<name>
└── gedWorker.js    ← language-<name>  (diagram diffing, optional)
```

A language without a diagram editor needs only `language-<name>` and `service-<name>` — the script and
config plugins are built that way.

### Why the split

`language-<name>` runs in the browser for editing *and* on the server for computing file data, so it
must not depend on anything Node-specific. `editor-<name>` only ever runs in the browser, so it may
depend on DOM APIs. `protocol-<name>` exists so the two halves of a diagram editor agree on the
actions they exchange without depending on each other.

## Base packages

Six packages carry the machinery so your plugin does not have to.

### `@mdeo/plugin`

The manifest interfaces — `Plugin`, `LanguagePlugin`, `LanguageContributionPlugin`,
`ServerContributionPlugin`. No runtime dependencies at all. Both your service and the backend speak
this vocabulary.

### `@mdeo/language-common`

The foundation for everything language-side:

| Area | What you get |
| --- | --- |
| Grammar DSL | `createRule`, `createInterface`, `createTerminal`, `createInfixRule`, and the combinators |
| Serialization | `GrammarSerializer`, `GrammarDeserializer`, `GrammarDeserializationContext` |
| Module assembly | `createModule`, `createGLSPModule`, `configureGLSPServer` |
| Default tokens | `ID`, `INT`, `FLOAT`, `STRING`, `WS`, `NEWLINE`, `HIDDEN_NEWLINE`, `ML_COMMENT`, `SL_COMMENT` |
| Editor defaults | `defaultLanguageConfiguration`, `defaultMonarchTokenProvider`, `serializeMonarchTokensProvider` |
| Protocol | Action, AST-serializer, external-reference and metadata interfaces |
| Plugin context | `PluginContext`, `initializePluginContext` |
| Utilities | `convertIcon`, graph edit distance, URI parsing |

### `@mdeo/language-shared`

Reusable *implementations* on top of that foundation. This is where most of the work you would
otherwise repeat already lives:

| Area | What you get |
| --- | --- |
| Parsing | `NewlineAwareTokenBuilder`, `IdValueConverter`, extended parser, multimode lexer |
| Scoping | Local scope providers, file-scoping (`generateImportRules` and its scope provider), path completion |
| Serialization | `DefaultAstSerializer`, `SerializerFormatter`, `registerDefaultTokenSerializers` |
| External references | `DefaultExternalReferenceCollector`, `addExternalReferenceCollectionPhase` |
| Diagram server | Base GModel factory, operation handlers, layout engine, model submission, clipboard |
| Actions | `ActionHandlerRegistry`, `DefaultActionProvider` |
| Workspace | Workspace edit service, context actions |
| Grammar helpers | `manySep`, `LeadingTrailing` |

### `@mdeo/editor-common`

The client-side foundation: `createContainer`, the editor `PluginContext`, and
`initializeEditorPluginContext`.

### `@mdeo/editor-shared`

The reusable editor: `DEFAULT_MODULES` bundles bounds and layout, move and resize, edge routing and
reconnection, label editing, the toolbox, marquee and hand tools, node and edge creation, grid,
selection, decorations, undo/redo shared with the text editor, reveal-source, copy/paste and the
editor settings panel. Plus base model classes, views and styles.

### `@mdeo/service-common`

The whole plugin service: `startLanguageService` implements every HTTP endpoint, JWT authentication,
static serving, the Langium instance pool, dependency tracking and the execution WebSocket bridge.
Also `parseServiceConfigFromEnv`, `astHandler`, and the service-side `initializePluginContext`.

And `@mdeo/protocol-common` carries the diagram actions and metadata types shared by every editor.

## Runtime dependency management

The rest of this page is the part that surprises people.

### The problem

The workbench loads several plugins' `language.js` modules into **one** Langium environment. If each
bundle brought its own copy of Langium, there would be several `AstNode` implementations, several
service registries and several `instanceof` universes in the same worker — and cross-language
references, which are the whole point, would not resolve.

So heavy libraries must exist exactly once, provided by the **host** rather than bundled by each
plugin.

### The mechanism

A host — the workbench, or a plugin service — builds a `PluginContext` holding the real modules and
installs it on `globalThis` before any language code is imported:

```ts
// service side: @mdeo/service-common does this for you
import { initializePluginContext } from "@mdeo/service-common";
initializePluginContext();

// only now may language packages be imported
const { metamodelPluginProvider } = await import("@mdeo/language-metamodel");
```

Language code then reaches a managed dependency through `sharedImport`, and imports it statically
**only as a type**:

```ts
import type { ELK, ElkNode } from "elkjs";           // types: erased at build time
import { sharedImport } from "@mdeo/language-shared"; // values: from the host

const elkjs = sharedImport("elkjs");
```

::: warning Import order is load-bearing
`initializePluginContext()` must run before the first import of a language package, and language
packages must therefore be imported with `await import(...)` rather than a static `import`. A static
import is hoisted above the initialisation call and fails with *"Plugin context is not initialized."*
:::

### There are two contexts

Server-side and client-side dependencies are managed separately, because they are needed in different
places.

| | Language context | Editor context |
| --- | --- | --- |
| Global | `globalThis.pluginContext` | `globalThis.editorPluginContext` |
| Type declared in | `@mdeo/language-common` | `@mdeo/editor-common` |
| Installed by | `initializePluginContext` from `@mdeo/language-common` (workbench) or `@mdeo/service-common` (services) | `initializeEditorPluginContext` from `@mdeo/editor-common` |
| Accessor | `sharedImport` from `@mdeo/language-shared` | `sharedImport` from `@mdeo/editor-shared` |
| Used by | `language-*`, `service-*` | `editor-*` |

### Common versus shared

The naming is not decorative. It says which side of the mechanism a package sits on:

| | `*-common` | `*-shared` |
| --- | --- | --- |
| Role | Declares the contract | Implements against it |
| Owns | The `PluginContext` type and the initialiser | The `sharedImport` accessor |
| Depends on managed libraries | As **devDependencies** — types only | As **devDependencies** — types only |
| Who calls into it | Hosts, at startup | Your language and editor code |

So the rule of thumb when writing a language:

- import **types** from the managed library itself (`import type { AstNode } from "langium"`);
- import **values** with `sharedImport("langium")` from `@mdeo/language-shared`;
- never add a managed library to your package's `dependencies` — put it in `devDependencies`, so it
  is available for type checking and cannot be bundled.

`@mdeo/service-common` is the exception that proves the rule: it depends on the managed libraries for
real, because it is the host that supplies them.

### Managed dependencies

**Language context** — 15 entries, keyed by their import specifier:

| Key | Purpose |
| --- | --- |
| `langium` | Core Langium |
| `langium/lsp` | Langium's LSP layer |
| `langium/grammar` | Grammar AST helpers, used to build modules |
| `typir` | The type system framework |
| `typir-langium` | Its Langium binding |
| `prettier` | Formatting, used by the serializers |
| `@eclipse-glsp/server` | Diagram server |
| `@eclipse-glsp/server/browser.js` | Its browser entry point |
| `@eclipse-glsp/protocol` | GLSP actions and operations |
| `@eclipse-glsp/graph` | The GLSP graphical model |
| `inversify` | Dependency injection, used by GLSP |
| `vscode-jsonrpc` | JSON-RPC primitives |
| `vscode-languageserver-types` | LSP data types |
| `vscode-languageserver-protocol` | LSP protocol types |
| `elkjs` | Automatic diagram layout |

**Editor context** — 7 entries:

| Key | Purpose |
| --- | --- |
| `@eclipse-glsp/client` | The GLSP client |
| `@eclipse-glsp/sprotty` | Sprotty rendering |
| `@eclipse-glsp/protocol` | GLSP actions and operations |
| `inversify` | Dependency injection |
| `minisearch` | Search in the toolbox and palettes |
| `lucide` | Icons |
| `snabbdom` | The virtual DOM the views render into |

Anything not on these lists is an ordinary dependency of your package: declare it in `dependencies`
and bundle it normally.

## Putting it together

For a new language `todo`:

```
app/packages/
├── language-todo/     deps: @mdeo/language-common, @mdeo/language-shared, @mdeo/plugin
│                      devDeps: langium, typir, … (types only)
├── editor-todo/       deps: @mdeo/editor-shared          (only if it has a diagram editor)
│                      devDeps: @eclipse-glsp/client, inversify, snabbdom, …
├── protocol-todo/     deps: —                            (only if it has a diagram editor)
└── service-todo/      deps: @mdeo/service-common, @mdeo/language-todo, @mdeo/plugin, lucide
                       devDeps: vite, tsx, @types/node
```

Register each new package in `app/tsconfig.build.json` so the project-reference build picks it up.

See [Add a plugin](/develop/add-a-plugin) for the files that go inside, and
[Anatomy of a plugin](/develop/plugin-anatomy) for how a service is wired.
