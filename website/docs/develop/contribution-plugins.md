# Contribution plugins

A contribution plugin extends a language that **another** plugin owns. It is what makes the platform
extensible rather than merely configurable, because a contribution is not limited to configuration
data — it can change the **grammar** of the language it extends.

This page describes the mechanism. What a specific language accepts is that language's business:

- [Extending the Config language](/develop/config-contributions) — sections
- [Extending the Script language](/develop/script-contributions) — functions and expressions

## The manifest side

Whatever the target language, the manifest entry has the same shape:

```ts
contributionPlugins: [
    {
        languageId: "config",
        description: "Provides optimization section support for config language",
        additionalKeywords: ["problem", "goal", "metamodel", "model", "constraint", "maximize", "minimize"],
        serverContributionPlugins: [createOptimizationContributionPlugin()]
    }
]
```

| Field | Meaning |
| --- | --- |
| `languageId` | The id of the language being extended |
| `description` | Shown in the plugin details view |
| `additionalKeywords` | Keywords this contribution introduces |
| `serverContributionPlugins` | The payload, interpreted by the target language |

`additionalKeywords` is purely presentational: the target language's Monarch tokenizer picks it up so
the new syntax is highlighted in the editor. It has no effect on parsing.

## The payload is defined by the receiver

::: tip The central rule
The platform does **not** define what goes into `serverContributionPlugins`. The only thing it knows
is the base type:

```ts
export interface ServerContributionPlugin {
    id: string;
}
```

Everything beyond `id` is a contract between the contributing plugin and the **language that receives
the contribution**. That language publishes the interface, documents it, and is the only component
that interprets it.
:::

This matters in three ways.

**The payload is opaque in transit.** It is stored in the plugin manifest, kept by the backend, and
forwarded to the language service — none of which parses it. A contribution to a language your plugin
has never heard of passes through untouched.

**Discrimination is by convention, not by the platform.** A receiving language defines a `type`
discriminator and a type guard, and filters the payloads it is handed:

```ts
export namespace ConfigContributionPlugin {
    export const TYPE = "config-language-contribution";

    export function is(value: ServerContributionPlugin): value is ConfigContributionPlugin {
        return "type" in value && value.type === TYPE;
    }
}
```

A language receives every contribution addressed to it and ignores anything whose guard does not
match, so several unrelated kinds of contribution can coexist on one language.

**The payload must be JSON.** It travels through a manifest, so no functions, no class instances, no
`RegExp`. Anything executable has to be expressed as data — a serialised grammar, a typed AST — which
is also what keeps a plugin from smuggling code into another plugin's service.

## Contributions can change the grammar

This is the architectural point that separates contribution plugins from ordinary configuration.

A language builds its parser **when its services are created**, from the contribution plugins that are
active at that moment:

```ts
export const configPluginProvider: LangiumLanguagePluginProvider<ConfigAdditionalServices> = {
    create(contributionPlugins) {
        const configPlugins = contributionPlugins.filter(ConfigContributionPlugin.is);
        const resolved = resolveConfigPlugins(configPlugins, deserializationContext);
        return {
            rootRule: createConfigRule(resolved),
            // scoping, completion and serialization delegate to `resolved` as well
        };
    }
};
```

Consequences worth internalising before designing an extension point:

- **The grammar is per project.** Two projects with different plugin sets get genuinely different
  parsers for the same file extension. There is no single "the config grammar".
- **Contributed rules are deserialised into the host's context.** A contributed grammar references
  terminals and types it does not own; the host supplies them through a
  `GrammarDeserializationContext`. See [external rules](/develop/grammar#external-rules).
- **Contributions can depend on each other.** A plugin may need types another contribution exports, so
  the host resolves them in dependency order and fails on a cycle or a missing dependency.
- **Instances are pooled by plugin set.** `@mdeo/service-common` keys its Langium instance pool by the
  active contribution plugins, so a language producing different grammars for different plugin sets
  works server-side without extra effort.

## Defining your own extension point

Nothing above is special-cased for the config and script languages. To make a language you write
extensible:

**1. Publish a payload interface.** Extend `ServerContributionPlugin`, add a `type` discriminator and
a type guard. This interface is your public API — other plugin authors construct it.

```ts
export interface TodoContributionPlugin extends ServerContributionPlugin {
    type: typeof TodoContributionPlugin.TYPE;
    grammar: SerializedGrammar;
    categories: TodoCategory[];
}
```

**2. Accept contributions in `create`.** The provider receives every contribution addressed to your
language:

```ts
create(contributionPlugins) {
    const mine = contributionPlugins.filter(TodoContributionPlugin.is);
    // …
}
```

**3. Build your grammar from the payloads.** Deserialise each contributed grammar in a context you
control, then assemble a root rule. Fail loudly when a payload names a rule or interface that its own
grammar does not contain — that error surfaces to the plugin author, and it is the only feedback they
get.

**4. Decide what a contribution may reference.** Whatever you put into the deserialisation context
becomes part of your extension point's contract, so expose it deliberately rather than by accident.

**5. Document the payload.** It is JSON crossing a process boundary between two independently
developed plugins. Nothing type-checks it for you.

## Where to go next

| Extending | Read |
| --- | --- |
| The Config language, with new sections | [Config contributions](/develop/config-contributions) |
| The Script language, with functions and expressions | [Script contributions](/develop/script-contributions) |
| Writing the grammar rules themselves | [The grammar DSL](/develop/grammar) |
| The manifest fields around the payload | [Plugin manifest reference](/develop/manifest) |
