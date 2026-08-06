# Model Transformation plugin

Rewrites models. A transformation matches a fragment of a model and changes it; during an
optimisation, transformations are the mutation operators — the only moves the search may make.

## At a glance

| | |
| --- | --- |
| **Plugin id** | `model-transformation-service` |
| **Display name** | Model Transformation |
| **Description** | Language support for model transformation definitions (`.mt` files) |
| **Default URL** | `/plugin/model-transformation` |
| **Source** | `app/packages/service-model-transformation`, `app/packages/language-model-transformation`, `app/packages/editor-model-transformation` |
| **Depends on** | The [Metamodel plugin](/plugins/metamodel); executions go to `model-transformation-execution` |

## Languages contributed

| Language id | Name | Extension | Textual editor | Graphical editor | Generated |
| --- | --- | --- | --- | --- | --- |
| `model-transformation` | Model Transformation | `.mt` | ✅ | ✅ | ❌ |
| `model-transformation_gen` | Generated Model Transformation | `.mt_gen` | ❌ | ✅ | ✅ |

### The model transformation language

A `.mt` file names its metamodel and then contains a sequence of statements.

<<< @/../samples/language-tour/match.mt{mt}

#### Patterns

A `match { ... }` block is a pattern. Every element of the pattern has to be found in the model before
any of the marked changes are applied. Elements can be:

| Element | Syntax | Meaning |
| --- | --- | --- |
| Object | `name: Class { ... }` | An object of that class must exist |
| Link | `source[.property] -- target[.property]` | A link must exist between two matched objects |
| Reference | `name { ... }` | Constrain or update an object matched in an *enclosing* scope |
| Delete | `delete name` | Remove an object matched earlier |
| Variable | `var name[: type] = expression` | Bind a value for later use in the pattern |
| Condition | `where expression` | An arbitrary boolean condition on the match |

Objects and links can carry a modifier:

| Modifier | Effect |
| --- | --- |
| *(none)* | The element must exist and is left untouched |
| `create` | The element is added |
| `delete` | The element is removed |
| `forbid` | The match is rejected if the element exists |
| `require` | The element must exist but is not bound to the rewrite |

Inside an object's braces, `=` assigns a property while `==`, `!=`, `<`, `>`, `<=` and `>=` constrain
the match:

```mt
rectangle: Rectangle {
    visible == true
}
```

::: tip Names are file-global
Object names must be unique across the whole `.mt` file, not just within one pattern. An object
matched in an outer scope is referred to by name — `rectangle { visible = true }` — rather than
matched again.
:::

#### Statements

<<< @/../samples/language-tour/control-flow.mt{mt}

| Statement | Meaning |
| --- | --- |
| `match { … }` | Apply the rewrite once |
| `if match { … } then { … } else { … }` | Apply the second block only if the pattern matches |
| `for match { … } do { … }` | Run the body once per match |
| `while match { … } do { … }` | Repeat while the pattern still matches |
| `until match { … } do { … }` | Repeat until the pattern matches |
| `if (expr) { … } else if (expr) { … } else { … }` | Ordinary conditional on an expression |
| `while (expr) { … }` | Ordinary loop on an expression |
| `stop` | End the transformation successfully |
| `kill` | Abort the transformation and discard the result |

Expressions use the same syntax as the [Script language](/plugins/script) — the two share an
expression and type system.

### The generated model transformation language

`.mt_gen` files are transformations the platform produced itself. An optimisation run can generate
mutation rules from the `create` / `delete` / `mutate` entries of a `search` block, and writes them
into the result tree so you can see exactly which rewrites the search was allowed to perform.

## Contribution plugins contributed

None.

## Server-side capabilities

| File data key | Contents |
| --- | --- |
| `ast` | The serialised AST |
| `typed-ast` | The type-annotated AST the execution service interprets |
| `model-transformation-text` | The textual rendering of a generated `.mt_gen` file |

**Execution.** A transformation can be run against a model. The plugin forwards the request to the
`model-transformation-execution` service, configured through
`MODEL_TRANSFORMATION_EXECUTION_SERVICE_URL`.

## Graphical editor

Transformations have a diagram editor too. Pattern objects and links appear as nodes and edges, with
their modifier reflected in the styling, so the effect of a rule can be read at a glance.
