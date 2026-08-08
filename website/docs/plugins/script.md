# Script plugin

A small imperative language for computing over models. Its main job is supplying the objective and
constraint functions of an optimisation, but scripts can also be run on their own.

## At a glance

| | |
| --- | --- |
| **Plugin id** | `script-service` |
| **Display name** | Script |
| **Description** | Language support for script definitions (the manifest string still says `.s files`; the extension is `.fn`) |
| **Default URL** | `/plugin/script` |
| **Source** | `app/packages/service-script`, `app/packages/language-script`, `app/packages/language-expression` |
| **Depends on** | The [Metamodel plugin](/plugins/metamodel); executions go to `script-execution` |

## Languages contributed

| Language id | Name | Extension | Textual editor | Graphical editor | Generated |
| --- | --- | --- | --- | --- | --- |
| `script` | Script | `.fn` | ✅ | ❌ | ❌ |

### The script language

A `.fn` file optionally names a metamodel, may import functions from other script files, and defines
functions.

<<< @/../samples/task-allocation/objectives.fn{fn}

#### Functions

```fn
fun name(parameter: Type, other: Type): ReturnType {
    return value
}
```

The return type may be omitted for a function that returns nothing, or written as `void`.

Functions from another file are imported by name, optionally renamed:

```fn
import { unassignedEffort, maxOverload as overload } from "./objectives.fn"
```

#### Reaching the model

A script that declares `using "./tasks.mm"` gets one accessor per class in that metamodel:
`Task.all()` returns every `Task` in the model being evaluated. From there you navigate through the
properties and associations the metamodel declares.

```fn
for (task in Task.all()) {
    if (task.assignee == null) { }
}
```

#### Types

| Category | Types |
| --- | --- |
| Numbers | `int`, `long`, `float`, `double` |
| Other primitives | `string`, `boolean` |
| Collections | `Collection<T>`, `List<T>`, `Set<T>`, `Bag<T>`, `OrderedSet<T>`, `Iterable<T>` |
| Domain | Every class and enum of the imported metamodel |
| Lambdas | `(A, B) => R` |
| Top type | `Any` |

A `?` suffix makes a type nullable: `Shape?`, `(Int) => Int?`.

#### Statements and expressions

<<< @/../samples/language-tour/expressions.fn{fn}

Statements are `var` declarations, assignments, `if` / `else if` / `else`, `while`, `for … in`,
`break`, `continue` and `return`. Statements are separated by line breaks, not semicolons.

Operators, from tightest to loosest binding:

| Group | Operators |
| --- | --- |
| Postfix | `.`, `?.`, `!!`, calls |
| Unary | `!`, `-` |
| Cast | `as`, `as?` |
| Multiplicative | `*`, `/`, `%` |
| Additive | `+`, `-` |
| Elvis | `??` |
| Type check | `is`, `!is` |
| Relational | `<`, `>`, `<=`, `>=` |
| Equality | `==`, `!=`, `===`, `!==` |
| Conjunction | `&&` |
| Disjunction | `\|\|` |
| Conditional | `? :` |

Lambdas are written `(a, b) => expression` or `(a, b) => { … }` and are ordinary expressions.

The standard library provides `println`, the collection constructors `listOf`, `setOf`, `bagOf`,
`orderedSetOf`, and their empty counterparts `emptyList`, `emptySet`, `emptyBag`, `emptyOrderedSet`.

#### Objective and constraint functions

A function used as an objective or a constraint in a `.config` file has to satisfy two rules,
enforced by validation in the editor:

- it takes **no parameters** — it reads the model through the `all()` accessors;
- it returns a **numeric** type (`int`, `long`, `float` or `double`).

For a constraint, `0` means satisfied and any larger value is the magnitude of the violation.

## Contribution plugins contributed

| Target language | What it adds |
| --- | --- |
| `config` | The script `Function` type export |

### Script functions for the config language

Like the metamodel plugin, the script plugin contributes no syntax to the config language. It exports
its `Function` AST type so that contribution plugins which do add syntax can write rules referencing
script functions — which is how `minimize unassignedEffort` in a `goal` section resolves to the
function in your `.fn` file.

| | |
| --- | --- |
| **Contribution plugin id** | `config-script` |
| **Short name** | `script` |
| **Sections** | none |
| **Exported types** | `Function` |

### Contributions the script language accepts

The script language is itself extensible. A plugin can register a
[script contribution plugin](/develop/script-contributions) that adds:

- **functions** — extra entries in the global scope, with signatures and an implementation given as a
  typed AST;
- **expressions** — new syntax, backed by a grammar rule and implemented by a function.

Nothing in the bundled set uses this yet, but it is the supported way to grow the standard library
without changing the script language.

## Server-side capabilities

| File data key | Contents |
| --- | --- |
| `ast` | The serialised AST |
| `typed-ast` | The type-annotated AST the execution service interprets |

**Execution.** A script function can be run against a model. The plugin forwards the request to the
`script-execution` service, configured through `SCRIPT_EXECUTION_SERVICE_URL`, which runs it in a
sandboxed subprocess under a timeout.
