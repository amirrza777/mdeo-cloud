# Extending the Config language

The [Config language](/plugins/config) accepts **sections**. It is the extreme case of the
[contribution mechanism](/develop/contribution-plugins): the config language has no syntax of its own,
so a `.config` file is nothing but sections, and every one of them comes from a contribution plugin.

This page documents the payload the config language expects and what it does with it.

## The payload

```ts
import { ConfigContributionPlugin } from "@mdeo/language-config";

export function createOptimizationContributionPlugin(): ConfigContributionPlugin {
    return {
        id: "config-optimization",
        type: ConfigContributionPlugin.TYPE,     // "config-language-contribution"
        name: "optimization",
        languageKey: "config-optimization",
        grammar: createOptimizationGrammar(),
        sections: [
            {
                name: "problem",
                ruleName: ProblemSectionContentRule.name,
                interfaceName: ProblemSection.name,
                executable: false
            },
            {
                name: "goal",
                ruleName: GoalSectionContentRule.name,
                interfaceName: GoalSection.name,
                executable: false
            }
        ],
        dependencies: ["config-metamodel", "config-script"],
        exportedTypes: [],
        sectionDependencies: []
    };
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique id, referenced by other plugins' `dependencies` |
| `name` | Short name used in qualified section names, `problem.optimization` |
| `languageKey` | The language id whose service answers requests for this plugin |
| `grammar` | Serialised grammar containing the rules for every section |
| `sections` | One entry per section |
| `dependencies` | Contribution plugin ids whose exported types this grammar needs |
| `exportedTypes` | Types this plugin makes available to plugins depending on it |
| `sectionDependencies` | Sections whose computed data must be ready before this plugin's handler runs |

### `ConfigSection`

| Field | Meaning |
| --- | --- |
| `name` | The keyword that opens the section |
| `ruleName` | A parser rule in `grammar` that parses the section body |
| `interfaceName` | The AST interface that rule returns |
| `executable` | Whether a config file containing this section can be run |

`ruleName` and `interfaceName` must exist in `grammar`, or grammar assembly fails with an error naming
your plugin.

## Writing the section grammar

A section rule parses the body **without** its keyword — braces included, keyword excluded. The config
language adds the keyword itself, together with the qualified alternative.

Section rules cannot import the config language's terminals, because they are deserialised inside it.
Declare them as [external rules](/develop/grammar#external-rules):

```ts
const ID = createExternalTerminalRule<string>("ID");
const INT = createExternalTerminalRule<number>("INT");
const STRING = createExternalTerminalRule<string>("STRING");
const NEWLINE = createExternalTerminalRule<string>("NEWLINE");

export const ProblemSectionContentRule = createRule("ProblemSectionContentRule")
    .returns(ProblemSection)
    .as(({ add }) => [
        "{",
        many(NEWLINE),
        many(
            or(group("metamodel", "=", add("metamodel", STRING)), group("model", "=", add("model", STRING))),
            many(NEWLINE)
        ),
        "}"
    ]);
```

Then serialise every rule the sections need, transitively:

```ts
function createOptimizationGrammar(): SerializedGrammar {
    return new GrammarSerializer({
        rules: [ProblemSectionContentRule, GoalSectionContentRule, MultiplicityRule, ObjectiveRule, /* … */],
        additionalTerminals: []
    }).grammar;
}
```

The config language supplies `ID`, `NEWLINE`, `HIDDEN_NEWLINE`, `INT`, `FLOAT` and `STRING` in its
deserialisation context.

::: tip Unordered keys
Config sections conventionally allow their keys in any order, expressed as `many(or(…))` rather than a
fixed sequence, with duplicates rejected by validation instead of by the grammar. That gives a much
better editing experience than a grammar error on a reordered file.
:::

## Type exports and grammar dependencies

A section grammar usually references things it does not own — metamodel classes, script functions.
Those come from other contribution plugins, which contribute **types only** and no syntax:

```ts
// the metamodel plugin's contribution to config
return {
    id: "config-metamodel",
    type: ConfigContributionPlugin.TYPE,
    name: "metamodel",
    languageKey: "metamodel",
    grammar: new GrammarSerializer({ rules: [], additionalTerminals: [], interfaces }).grammar,
    sections: [],
    dependencies: [],
    exportedTypes: interfaces.map((i) => i.name),
    sectionDependencies: []
};
```

A plugin listing `config-metamodel` in `dependencies` receives those types in its deserialisation
context and can write `ref(MetamodelClass, ID)` — which is how `refine Canvas.layers[1..4]` resolves
against your metamodel.

Dependencies are resolved by topological sort. A cycle, or a dependency on a plugin that is not
enabled in the project, is an error at grammar assembly time.

## Section dependencies

`dependencies` is about grammar. `sectionDependencies` is about **computation order**:

```ts
sectionDependencies: [{ pluginName: "optimization", sectionName: "problem" }]
```

Config MDEO declares this because it cannot resolve `create Annotation` inside a `mutations` block
before it knows which metamodel the `problem` section named. When the config service computes file
data, it runs the contribution plugins in dependency order and passes each one the already-computed
results of the sections it declared.

## What the config language builds from it

At service creation, the config language:

1. filters the contributions to those passing `ConfigContributionPlugin.is`;
2. sorts them topologically by `dependencies`;
3. deserialises each grammar in a context containing the base terminals plus the types exported by its
   dependencies;
4. wraps every section in a rule prefixing it with its keyword;
5. assembles a root rule alternating between all section wrappers.

### Keywords and qualified names

For each section it generates a wrapper rule and interface:

| Section | Plugin | Wrapper rule | Wrapper interface |
| --- | --- | --- | --- |
| `problem` | `optimization` | `ConfigProblemSectionWrapper_optimization` | `ConfigProblemSection_optimization` |
| `solver` | `mdeo` | `ConfigSolverSectionWrapper_mdeo` | `ConfigSolverSection_mdeo` |

The qualified keyword `<section>.<plugin>` is **always** accepted. The plain `<section>` keyword is
added only when no other enabled plugin contributes a section of the same name — if two do, the plain
form is ambiguous and is left out of the grammar entirely, so both plugins' sections must be written
qualified.

Design accordingly: pick section names that read well qualified, because you do not control which
other plugins a project enables.

## The standalone language

`languageKey` names a language that must exist, and it is not the config language — it is a language of
your own whose only job is parsing the fragment of a `.config` file containing your sections.

Build its root rule from the very same contribution plugin definition:

```ts
const optimizationRootRule = generateContributionPluginGrammar(
    createOptimizationContributionPlugin(),
    optimizationDeserializationContext
);
```

`generateContributionPluginGrammar` creates the section wrappers with plain, unqualified keywords and
a root rule alternating between them — a `Config` document containing only your sections. Register it
as a [generated language](/develop/add-a-language#generated-languages) with no extension and no
editors:

```ts
const configOptimizationLanguagePlugin: LanguagePlugin = {
    id: "config-optimization",
    name: "Config Optimization",
    extension: undefined,
    newFileAction: false,
    icon,
    serverPlugin: { import: "language.js" },
    graphicalEditorPlugin: undefined,
    textualEditorPlugin: undefined,
    isGenerated: true
};
```

Two grammars, one definition: the section rules are the same objects in both, so the standalone
language and the embedded sections cannot drift apart.

## Computing section data

When the backend asks the config service for a config file's data, the config service splits the file
by section, sends each plugin its own fragment, and merges the answers. Your plugin receives that
fragment through a request handler under the `config` key:

```ts
requestHandlers: {
    [CONFIG_PLUGIN_REQUEST_KEY]: optimizationRequestHandler
}
```

The request body is a `ConfigPluginRequestBody`:

| Field | Meaning |
| --- | --- |
| `text` | The partial config text containing only your sections, with plain keywords |
| `configFileUri` | URI of the originating `.config` file, for resolving relative paths |
| `dependencyData` | Results of the sections named in `sectionDependencies`, keyed by plugin then section |

Return a `ConfigPluginRequestResponse`:

```ts
{
    data: computed,        // or null if parsing or validation failed
    fileDependencies,      // files read while computing
    dataDependencies       // other file-data computations consulted
}
```

::: warning Always return dependencies
Return `fileDependencies` and `dataDependencies` **even when `data` is `null`**. The config file-data
handler propagates them to the cache; omitting them on the error path means the entry is never
invalidated when the broken input is fixed.
:::

## Executable sections

Marking a section `executable: true` gives config files containing it a run action. The config plugin
does not know what running means — it looks up which contribution plugin owns the executable section
and forwards the execution, and every follow-up, to that plugin's language service.

Implement these as `requestHandlers`, using the keys from `@mdeo/service-config-common`:

| Constant | Key | Purpose |
| --- | --- | --- |
| `CONFIG_EXECUTION_REQUEST_KEY` | `config-execution` | Start the run |
| `CONFIG_EXECUTION_GET_SUMMARY_REQUEST_KEY` | `config-execution-get-summary` | Markdown summary |
| `CONFIG_EXECUTION_GET_FILE_TREE_REQUEST_KEY` | `config-execution-get-file-tree` | Result file tree |
| `CONFIG_EXECUTION_GET_FILE_REQUEST_KEY` | `config-execution-get-file` | One result file |
| `CONFIG_EXECUTION_GET_FILES_REQUEST_KEY` | `config-execution-get-files` | Several result files at once |
| `CONFIG_EXECUTION_CANCEL_REQUEST_KEY` | `config-execution-cancel` | Cancel a running execution |
| `CONFIG_EXECUTION_DELETE_REQUEST_KEY` | `config-execution-delete` | Delete a finished execution |

The routing is recorded on the execution as `ConfigExecutionRoutingMetadata` — language id, section
name and plugin short name — so follow-ups reach the same place even after a restart.

## Validation, scoping and completion

The config language delegates these to the contributing plugins rather than implementing them:
`ConfigDelegatingScopeProvider`, `ConfigDelegatingCompletionProvider` and
`ConfigDelegatingExternalReferenceCollector` dispatch on which plugin owns the section a node sits in.

In practice this means you implement scoping, completion and validation on your **standalone
language**, and get them inside `.config` files for free.

## Checklist

- [ ] `type` set to `ConfigContributionPlugin.TYPE`
- [ ] `name` short and readable as a qualified suffix
- [ ] Every `ruleName` and `interfaceName` present in `grammar`
- [ ] Terminals declared with `createExternalTerminalRule`
- [ ] `dependencies` list every plugin whose exported types the grammar references
- [ ] `sectionDependencies` list every section whose computed data the handler needs
- [ ] A generated language registered under `languageKey`
- [ ] A `config` request handler returning dependencies on both the success and the failure path
- [ ] Execution handlers registered if any section is `executable`

## A worked example

The two bundled config contribution plugins are the reference implementations:

- [Config Optimization](/plugins/config-optimization) — two non-executable sections, dependencies on
  two type-only contributions.
- [Config MDEO](/plugins/config-mdeo) — three sections, one executable, plus a section dependency on
  another plugin's `problem` section.
