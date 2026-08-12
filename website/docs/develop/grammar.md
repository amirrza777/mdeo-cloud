# The grammar DSL

Languages are not written in `.langium` files. They are built with a TypeScript DSL in
`@mdeo/language-common` that produces the same Langium grammar AST at runtime.

## Why not `.langium`?

Not because of the workbench. The workbench imports each language plugin's `language.js` as an ES
module, so a parser generated from a `.langium` file at build time would work there without any
trouble.

The reason is **composition**. A grammar in this platform is not always a whole language:

- a contribution plugin hands its rules to a language another plugin owns, as data inside a
  [manifest](/develop/manifest);
- the receiving language assembles its grammar **per project**, from whichever contribution plugins
  are enabled, so the rule set does not exist until runtime;
- the contributed rules reference types and terminals that belong to the host, which only the host can
  supply.

Generated parser code cannot cross that boundary. Rules created with `createRule` can: serialise them
to JSON with `GrammarSerializer`, ship them anywhere, and reconstruct them with `GrammarDeserializer`
in a context that supplies the external types and rules they reference.

Because that machinery has to exist for the composable case, every language is written with the same
DSL. A rule then behaves identically whether it forms a language of its own or is embedded into
someone else's — which is what lets `config-optimization` be both a standalone language and a set of
sections inside `config`.

## Declaring AST types

Types come first, because rules declare what they return.

```ts
import { createInterface, Optional, Ref, Union } from "@mdeo/language-common";
import type { ASTType } from "@mdeo/language-common";

export const Property = createInterface("Property").attrs({
    name: String,
    type: PropertyTypeValue,
    multiplicity: Optional(Multiplicity)
});
export type PropertyType = ASTType<typeof Property>;
```

| Declaration | Meaning |
| --- | --- |
| `String`, `Number`, `Boolean` | Primitive attribute |
| `SomeInterface` | Containment of another node |
| `[SomeInterface]` | An array of nodes |
| `Optional(T)` | The attribute may be absent |
| `Ref(T)` | A cross-reference, resolved by the scope provider |
| `Union("a", "b")` | One of a fixed set of string literals |
| `Resolve(() => T)` | Break a circular dependency between declarations |

Inheritance uses `.extends()` before `.attrs()`:

```ts
export const Task = createInterface("Task").extends(WorkItem).attrs({
    priority: Priority
});
```

`ASTType<typeof X>` gives you the TypeScript type of the resulting AST node, so everything downstream —
validation, serializers, handlers — is fully typed.

## Terminals

```ts
export const ID = createTerminal("ID")
    .returns(String)
    .as(/`[^`\n\r]+`|[\p{ID_Start}][\p{ID_Continue}]*/u);

export const WS = createTerminal("WS").hidden().as(/[^\S\n]+/);
```

`@mdeo/language-common` already provides the shared ones: `ID`, `INT`, `FLOAT`, `STRING`, `WS`,
`NEWLINE`, `HIDDEN_NEWLINE`, `ML_COMMENT`, `SL_COMMENT`.

Note that `NEWLINE` is **not** hidden. The MDEO languages are newline-separated rather than
semicolon-separated, so newlines are part of the grammar. Hide them selectively inside brackets with
`NewlineAwareTokenBuilder`.

## Parser rules

```ts
export const PropertyRule = createRule("PropertyRule")
    .returns(Property)
    .as(({ set }) => [
        set("name", ID),
        ":",
        set("type", PropertyTypeValueRule),
        optional(set("multiplicity", MultiplicityRule))
    ]);
```

The callback receives an assignment context and returns an array of grammar elements. Bare strings are
keywords.

### Assignments

| Helper | Meaning |
| --- | --- |
| `set("prop", X)` | Assign the result of `X` to `prop` |
| `set("prop", "a", "b")` | Assign whichever keyword matched |
| `add("prop", X)` | Append to the array property `prop` |
| `flag("prop", "keyword")` | Set `prop` to `true` if the keyword is present |

### Structure

| Helper | Meaning |
| --- | --- |
| `or(a, b, …)` | Alternatives |
| `many(a, b, …)` | Zero or more repetitions of the sequence |
| `optional(a, b, …)` | Zero or one |
| `group(a, b, …)` | Group elements without introducing a rule |
| `ref(Type, TERMINAL)` | A cross-reference to a node of `Type`, parsed with `TERMINAL` |
| `manySep(x, ",", …)` | From `@mdeo/language-shared`: a separated list |

### Actions and tree rewriting

`action` constructs a node without consuming a rule; `treeRewriteAction` rebuilds the current result
as a new node with the previous value assigned to a property. Together they express left recursion
without left recursion:

```ts
const memberAccessPostfixFragment = createFragmentRule("MemberAccess")
    .returns(types.baseExpressionType)
    .as(() => [
        treeRewriteAction(types.memberAccessExpressionType, "expression", "=", ({ set, flag }) => [
            or(flag("isNullChaining", "?."), "."),
            set("member", ID)
        ])
    ]);
```

Reading `a.b.c`: the first `.b` rewrites `a` into a `MemberAccess` with `expression = a`, the second
rewrites that node again. This is how the expression language builds a left-associative chain.

### Infix rules

Binary operator precedence has its own builder:

```ts
const binaryExpressionUpperRule = createInfixRule("BinaryUpper")
    .on(typeCastExpressionRule)
    .returns(types.binaryExpressionType)
    .operators("*", "/", "%")
    .operators("+", "-")
    .operators("??")
    .build();
```

Each `.operators(...)` call is one precedence level, loosest last.

### Circular references

Rules that refer to each other are passed as thunks:

```ts
const statementsScopeRule = createRule("StatementsScope")
    .returns(types.statementsScopeType)
    .as(({ add }) => ["{", many(or(add("statements", () => statementRule), NEWLINE)), "}"]);
```

## Generated grammars

A grammar does not have to be a set of constants. `generateStatementRules`, `generateExpressionRules`
and `generateTypeRules` in `@mdeo/language-expression` build a complete statement, expression and type
grammar from a configuration object, so a new language with expressions gets them for free:

```ts
const { typeRule, returnTypeRule } = generateTypeRules(typeConfig, typeTypes);
const expressionRules = generateExpressionRules(expressionConfig, expressionTypes, typeRule, extraRules);
const { statementsScopeRule } = generateStatementRules(
    statementConfig, statementTypes, expressionRules.expressionRule, typeRule, [returnStatementRule]
);
```

The `*Config` objects only carry naming, so two languages can each have their own copy of the
expression grammar without their rule names colliding — which is exactly why the script and model
transformation languages can share an expression syntax while remaining separate languages.

`additionalExpressionRules` is deliberately read late, when the rule is resolved rather than when it
is created. That lets a language push extra expression alternatives into the array *after* calling
`generateExpressionRules`, which is how contributed expressions and lambdas get in.

## External rules

A grammar that will be embedded in another language cannot import that language's terminals directly.
It declares them as external instead:

```ts
const ID = createExternalTerminalRule<string>("ID");
const INT = createExternalTerminalRule<number>("INT");
```

At deserialisation time the host supplies the real terminals through a
`GrammarDeserializationContext`. The `config-optimization` and `config-mdeo` grammars are written this
way, because their rules end up inside the config language's parser.

## Serialising and deserialising

```ts
const serializer = new GrammarSerializer({
    rules: [ProblemSectionContentRule, GoalSectionContentRule],
    additionalTerminals: []
});
const grammar: SerializedGrammar = serializer.grammar;
```

```ts
const context = GrammarDeserializationContext.create(
    [Class, Function, Property],            // external types this grammar references
    [],                                     // external parser rules
    [ID, NEWLINE, HIDDEN_NEWLINE, INT, FLOAT, STRING]
);
const grammar = new GrammarDeserializer(serialized, context).deserializeGrammar();
```

The serialised form is what goes into a contribution plugin's `grammar` field and therefore into the
plugin manifest.

## Assembling a module

Finally, `createModule` turns one or more language plugins into a Langium module with a runtime AST
reflection:

```ts
const languageModule = createModule([plugin], pluginContext);
```

The workbench calls this once with *all* enabled language plugins, which is what puts them in a single
shared environment and lets references cross language boundaries.
