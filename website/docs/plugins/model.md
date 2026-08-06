# Model plugin

Instantiates a metamodel: named objects with property values, linked together. A model is the starting
point of an optimisation and the form every solution comes back in.

## At a glance

| | |
| --- | --- |
| **Plugin id** | `model-service` |
| **Display name** | Model |
| **Description** | Language support for model definitions (`.m` and `.m_gen` files) |
| **Default URL** | `/plugin/model` |
| **Source** | `app/packages/service-model`, `app/packages/language-model`, `app/packages/editor-model` |
| **Depends on** | The [Metamodel plugin](/plugins/metamodel), since every model imports a metamodel |

## Languages contributed

| Language id | Name | Extension | Textual editor | Graphical editor | Generated |
| --- | --- | --- | --- | --- | --- |
| `model` | Model | `.m` | ✅ | ✅ | ❌ |
| `model_gen` | Generated Model | `.m_gen` | ❌ | ✅ | ✅ |

### The model language

A `.m` file starts by naming its metamodel, then declares objects and the links between them.

<<< @/../samples/language-tour/shapes.m{mdeo-model}

Creating a `.m` file in the workbench opens a dialog first, because the file cannot be written until
its metamodel is known.

#### Objects

```mdeo-model
frame : Rectangle {
    name = "Frame"
    visible = true
    colour = Colour.BLUE
    tags = ["decoration", "border"]
    width = 210.0
}
```

An object is `name : Class { ... }`. The name is unique within the file and is what links refer to.
Inside the braces, each line assigns a property declared by the class or one of its supertypes.

Values may be:

| Kind | Example |
| --- | --- |
| String | `"Frame"` |
| Number | `3`, `210.0` |
| Boolean | `true`, `false` |
| Enum entry | `Colour.BLUE` |
| List | `["a", "b"]`, `[]` |

#### Links

```mdeo-model
board.layers -- background
frame.annotations -- note
```

A link connects two objects. Naming the property on an end says which association is meant; for an
association that is navigable from only one side, that is the side you name. Both ends may be named
when the association is bidirectional and the file benefits from being explicit.

### The generated model language

`.m_gen` files are produced by the platform, not written by hand — an optimisation run emits one per
solution on its Pareto front. They carry a serialised model rather than the textual syntax above,
which is why the language has no textual editor.

They do open in the **same diagram editor** as hand-written models, so a solution can be inspected
exactly like the model it came from.

## Contribution plugins contributed

None. The model plugin does not extend any other language.

## Server-side capabilities

| File data key | Contents |
| --- | --- |
| `ast` | The serialised AST, for both `model` and `model_gen` |
| `model-data` | The model in the form the execution services consume |

The plugin has no execution handler of its own: models are executed *by* transformations and
optimisations, not on their own.

## Graphical editor

The model diagram editor shows objects as nodes and links as edges, with the palette populated from
the metamodel the file imports — only classes that are not abstract can be created, and only
associations declared between the relevant classes can be drawn. Copy and paste work within and
between model diagrams.
