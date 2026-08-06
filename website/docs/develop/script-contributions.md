# Extending the Script language

The [Script language](/plugins/script) accepts two kinds of contribution: **functions**, which appear
in the global scope, and **expressions**, which add new syntax. Both are described by one payload,
following the general [contribution mechanism](/develop/contribution-plugins).

This is how you grow the standard library, or give a domain its own notation, without changing the
script language itself.

::: info Not yet used by a bundled plugin
None of the bundled plugins contributes to the script language today. The mechanism is
implemented and resolved on every service start; this page documents the payload it expects.
:::

## The payload

```ts
import { ScriptContributionPlugin } from "@mdeo/language-script";

export interface ScriptContributionPlugin extends ServerContributionPlugin {
    type: typeof ScriptContributionPlugin.TYPE;   // "script-language-contribution"
    types: ReturnType[];
    grammar: SerializedGrammar | undefined;
    functions: Record<string, ContributedFunction>;
    expressions: Record<string, ContributedExpression>;
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique id of the contribution |
| `types` | The type table every implementation in this plugin indexes into |
| `grammar` | Serialised grammar holding the rules of the contributed expressions; may be omitted when there are none |
| `functions` | Contributed global functions, keyed by name |
| `expressions` | Contributed expression syntax, keyed by name |

## The type table

`types` is a flat array of `ReturnType`, shared by every signature and implementation the plugin
contributes. Implementations refer to a type by its **index** in that array rather than by embedding
it, which keeps a typed AST compact and lets several signatures share the same types.

Generics are erased: a type parameter becomes `Any?` in the table, and generic behaviour is expressed
through the signature's `generics` list instead.

A `ReturnType` is either a `ValueType` — a class type reference, a generic type reference, or a lambda
type — or the void marker `{ kind: "void" }`.

## Contributed functions

A function is a named set of **signatures**, so one name can be overloaded:

```ts
functions: {
    clamp: {
        signatures: {
            [FunctionSignature.DEFAULT_SIGNATURE]: {
                signature: {
                    parameters: [
                        { name: "value", type: intRef },
                        { name: "low", type: intRef },
                        { name: "high", type: intRef }
                    ],
                    returnType: intRef
                },
                implementation: clampBody
            }
        }
    }
}
```

`FunctionSignature.DEFAULT_SIGNATURE` is the empty string, used for a function with a single
signature. Additional signatures get names of your choosing.

### `FunctionSignature`

| Field | Meaning |
| --- | --- |
| `parameters` | Ordered `{ name, type }` list |
| `returnType` | A `ValueType`, or the void marker for a function returning nothing |
| `generics` | Optional list of type parameter names, e.g. `["T"]` |
| `isVarArgs` | Optional; the last parameter accepts any number of arguments |

### Implementations are data, not code

`implementation` is a `TypedCallableBody` — a **typed AST**, the same representation the script
language produces when it compiles a `.fn` file for execution. It is not JavaScript.

That is deliberate. The payload travels through a plugin manifest to a service that a different team
operates, so a contribution can add behaviour to the language without shipping executable code into
someone else's process. The execution service interprets the typed AST exactly as it interprets a
user-written function.

The practical consequence: write the function in the script language first, let the language produce
its typed AST, and ship that.

## Contributed expressions

An expression is syntactic sugar over a function. You supply a grammar rule, the interface it returns,
and the function that implements it:

```ts
grammar: createMyExpressionGrammar(),
expressions: {
    percentOf: {
        ruleName: "PercentOfExpressionRule",
        interfaceName: "PercentOfExpression",
        function: {
            signature: { parameters: [/* … */], returnType: doubleRef },
            implementation: percentOfBody
        }
    }
}
```

| Field | Meaning |
| --- | --- |
| `ruleName` | A parser rule in `grammar` |
| `interfaceName` | The AST interface that rule returns |
| `function` | The signature and implementation backing the syntax |

### Writing the rule

Contributed rules are deserialised inside the script language, so they cannot import its terminals or
its expression types directly. The script language supplies, through its deserialisation context:

| Kind | Available |
| --- | --- |
| Types | `BaseExpression`, `BaseExtension` |
| Rules | Every generated expression rule, plus the lambda expression rule |
| Terminals | `ID`, `NEWLINE`, `HIDDEN_NEWLINE`, `INT`, `FLOAT`, `STRING` |

Declare terminals with `createExternalTerminalRule` and reference the expression rule to recurse into
ordinary expressions — see [external rules](/develop/grammar#external-rules).

Your interface should extend `BaseExtension`, so the resulting node fits where the script language
expects an extension expression.

### How the rule reaches the parser

All contributed rules are collected into one alternation:

```ts
const ExtensionExpressionRule = createRule("ScriptExtensionExpressionRule")
    .returns(ExtensionExpression)
    .as(({ set }) => [or(...resolvedPlugins.rules.map((rule) => set("extension", rule)))]);

additionalExpressionRules.push(ExtensionExpressionRule);
```

`additionalExpressionRules` is read lazily, when the expression rule is finally resolved, which is why
a contribution can be pushed in after `generateExpressionRules` has already been called. The
alternation is one alternative of the primary expression rule, so contributed syntax is usable
anywhere an expression is.

### Expressions are also functions

Every contributed expression is additionally registered in the global scope under its name, with a
single default signature. Callers can therefore use either the notation or the plain call, and the
type system only has to know about one thing.

## Resolution and errors

At service creation the script language filters the contributions with
`ScriptContributionPlugin.is`, then resolves them. Three conditions are rejected outright:

| Error | Cause |
| --- | --- |
| `Plugin with expression contributions must define a grammar.` | `expressions` is non-empty but `grammar` is `undefined` |
| `Expression rule '…' not found in plugin grammar.` | `ruleName` is not in the serialised grammar |
| `Expression interface '…' not found in plugin grammar.` | `interfaceName` is not in the serialised grammar |
| `Duplicate function or expression name '…' contributed by plugins.` | Two contributions claim the same global name |

The last one is worth planning for: the global namespace is shared across every contribution enabled
in a project, and you do not control which other plugins a user enables. Prefix names that are not
obviously yours.

## What you get back

Resolution produces a `ResolvedScriptContributionPlugins`:

| Field | Contents |
| --- | --- |
| `functions` | Every contributed name — functions *and* expressions — with its `FunctionType`, the original contribution, and the type table its implementations index into |
| `expressions` | The resolved expressions, each with its signature, its deserialised interface, and its name |
| `rules` | The deserialised parser rules, ready to be combined into the extension alternation |

The script language uses `functions` to populate the global scope for the type system, `expressions`
for inference and validation rules on the contributed node types, and `rules` for the grammar.

## Checklist

- [ ] `type` set to `ScriptContributionPlugin.TYPE`
- [ ] `types` contains every type the signatures and implementations index into
- [ ] `grammar` provided whenever `expressions` is non-empty
- [ ] Every `ruleName` and `interfaceName` present in `grammar`
- [ ] Contributed interfaces extend `BaseExtension`
- [ ] Terminals declared with `createExternalTerminalRule`
- [ ] Implementations supplied as typed ASTs, not as code
- [ ] Global names unlikely to collide with another plugin's

## See also

- [Contribution plugins](/develop/contribution-plugins) — the general mechanism
- [The grammar DSL](/develop/grammar) — writing and serialising the rules
- [Script plugin](/plugins/script) — the language being extended
