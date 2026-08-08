# Metamodel plugin

Defines the structure of a domain: classes, properties, enums, inheritance and associations. Every
other modelling language in the platform is written against a metamodel, which makes this the plugin
you enable first.

## At a glance

| | |
| --- | --- |
| **Plugin id** | `metamodel-service` |
| **Display name** | Metamodel |
| **Description** | Language support for metamodel definitions (`.mm` files) |
| **Default URL** | `/plugin/metamodel` |
| **Source** | `app/packages/service-metamodel`, `app/packages/language-metamodel`, `app/packages/editor-metamodel` |
| **Depends on** | Nothing |

## Languages contributed

| Language id | Name | Extension | Textual editor | Graphical editor | Generated |
| --- | --- | --- | --- | --- | --- |
| `metamodel` | Metamodel | `.mm` | ✅ | ✅ | ❌ |

### The metamodel language

A `.mm` file declares enums, classes and associations at the top level, in any order.

<<< @/../samples/language-tour/shapes.mm{mm}

#### Classes and properties

```mm
abstract class Shape {
    name: string
    tags: string[*]
}

class Circle extends Shape {
    radius: double
}
```

- `abstract` marks a class that cannot be instantiated.
- `extends` takes a comma-separated list, so multiple inheritance is allowed.
- A property is `name: type` with an optional multiplicity in brackets.

The primitive types are `int`, `long`, `float`, `double`, `string` and `boolean`. A property may also
have an enum type.

#### Multiplicities

| Form | Meaning |
| --- | --- |
| *(omitted)* | Exactly one |
| `[*]` | Any number |
| `[+]` | At least one |
| `[?]` | Zero or one |
| `[n]` | Exactly `n` |
| `[n..m]` | Between `n` and `m` |
| `[n..*]` | At least `n` |

#### Enums

```mm
enum Colour {
    RED
    GREEN
    BLUE
}
```

#### Associations

Associations are declared at the top level, not inside a class. An end is a class, optionally followed
by a property name and a multiplicity. **A class only gets a property for an end that carries a
name**, and which ends may carry a name is determined by the operator:

| Operator | Meaning | Property on the left | Property on the right |
| --- | --- | --- | --- |
| `-->` | Navigable from left to right | required | forbidden |
| `<--` | Navigable from right to left | forbidden | required |
| `<-->` | Navigable in both directions | required | required |
| `*-->` | Composition, whole on the left, navigable both ways | required | required |
| `*--` | Composition, whole on the left, navigable from the part | forbidden | required |
| `<--*` | Composition, whole on the right, navigable both ways | required | required |
| `--*` | Composition, whole on the right, navigable from the part | required | forbidden |

One example of each:

<<< @/../samples/language-tour/associations.mm{mm}

Composition means containment: an object may have at most one container, so the multiplicity on the
end that points at the whole cannot be `*` or `+`, and must be optional when several compositions can
contain the same class.

#### Splitting a metamodel across files

```mm
import "./shapes.mm"
```

`import` makes every class and enum of the imported file — and of the files it imports — visible.
Association ends may only carry a property name for classes declared in the current file:

<<< @/../samples/language-tour/imports.mm{mm}

### Graphical editor

`.mm` files open in a class-diagram editor as well as in the text editor. The palette creates classes,
enums and associations; the connection type is chosen before drawing an edge, and labels are edited
in place. Layout is computed with ELK.

## Contribution plugins contributed

| Target language | What it adds |
| --- | --- |
| `config` | Metamodel type exports |

### Metamodel types for the config language

The metamodel plugin contributes **no syntax** to the config language. What it contributes is its AST
types — `Class`, `Property`, `Enum`, `Association`, `AssociationEnd`, the multiplicity types,
`PrimitiveType`, `EnumTypeReference`, `EnumEntry`, `ClassExtension`, `ClassExtensions` and
`FileImport`.

Contribution plugins that *do* add syntax can then declare a dependency on this one and write grammar
rules that reference metamodel classes. That is how
[Config Optimization](/plugins/config-optimization) can resolve `refine Canvas.layers[1..4]` against
your metamodel, and how [Config MDEO](/plugins/config-mdeo) can resolve `create Annotation` inside a
`mutations` block.

| | |
| --- | --- |
| **Contribution plugin id** | `config-metamodel` |
| **Short name** | `metamodel` |
| **Sections** | none |
| **Exported types** | 13 metamodel AST interfaces |

## Server-side capabilities

| File data key | Contents |
| --- | --- |
| `ast` | The serialised AST of the metamodel |
| `metamodel` | Metamodel-specific derived data used by dependent languages |

The plugin has no execution handler: metamodels are not run, they are referenced.
