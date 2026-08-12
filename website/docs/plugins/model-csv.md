# Model CSV plugin

Adds an `import CSV { … }` block to the model language, so a model can take its objects from `.csv`
files instead of listing them one by one. A spreadsheet of two hundred tasks becomes a model without
two hundred hand-written objects.

## At a glance

| | |
| --- | --- |
| **Plugin id** | `model-csv-service` |
| **Display name** | Model CSV |
| **Description** | Language support for the CSV import contribution to the model language |
| **Default URL** | `/plugin/model-csv` |
| **Source** | `app/packages/service-model-csv`, `app/packages/language-model-csv` |
| **Depends on** | The [Model](/plugins/model) and [Metamodel](/plugins/metamodel) plugins; the data files are usually [CSV](/plugins/csv) files |

::: warning Only started by the development compose file
`infra/docker-compose-dev.yaml` builds this service and lists it in `DEFAULT_PLUGIN_URLS`.
`docker-compose.yaml` and `docker-compose-prod.yaml` do not, so a production deployment has to add
the service and register `/plugin/model-csv` itself.
:::

## Languages contributed

| Language id | Name | Extension | Textual editor | Graphical editor | Generated |
| --- | --- | --- | --- | --- | --- |
| `model-csv` | Model CSV | — | ❌ | ❌ | ✅ |

### The `model-csv` language

A generated language with no file extension and no editor, following the same pattern as the config
contribution plugins: it exists so the import block can be parsed as a language in its own right when
the model service asks for the imported data to be computed.

## Contribution plugins contributed

| Target language | What it adds |
| --- | --- |
| `model` | The `import CSV { … }` block |

| | |
| --- | --- |
| **Contribution plugin id** | `model-csv` |
| **Short name** | `csv` |
| **Additional keywords** | `import`, `CSV`, `from` |
| **Exported types** | none |

### The import block

```mdeo-model
using "./tasks.mm"

import CSV {
    Task from "./tasks.csv"
    Employee from "./employees.csv"
}
```

Each entry maps one metamodel class to one CSV file. The class is a cross-reference into the
metamodel named by `using`, so it is completed and validated in the editor like any other class name.

The same class may be imported from several files; the rows are appended.

## How rows become objects

The rules below are applied by the plugin's request handler when the model service computes the
model's data.

**One row, one object.** The header row names properties of the class; each following row becomes one
object. Objects are named `<Class>_<n>`, numbered from zero across all files importing that class.

**Values are converted to the declared type.** A cell is read according to the property's type in the
metamodel:

| Property type | Cell |
| --- | --- |
| `int`, `long` | Parsed as an integer; a value that does not parse is kept as text |
| `float`, `double` | Parsed as a decimal; a value that does not parse is kept as text |
| `boolean` | `true` (case-insensitive) is true, everything else is false |
| enum | The cell is the entry name, e.g. `BLUE` |
| Everything else | Text |

An empty cell becomes `null`.

**References use the `_id` column.** A reference column holds the `_id` value of the target row, and
several targets are separated by `;`:

```csv
_id,name,assignee
t1,Design,e1
t2,Build,e1;e2
```

`_id` is only a lookup key for the import — it does not become a property of the object.

**Problems are warnings, not errors.** The import never fails, it records what it could not do:

| Situation | Result |
| --- | --- |
| Class not in the metamodel | The entry is skipped |
| File with only a header | The entry is skipped |
| Column matching no property | The column is ignored |
| Row shorter than the header | Missing cells treated as blank |
| Row longer than the header | Extra cells ignored |
| Reference to an unknown `_id` | The link is dropped |

The warnings travel back to the model service in the `warnings` field of the response, but nothing
surfaces them yet — a malformed row currently shows up as a missing or oddly-valued object rather
than as a message in the editor.

## Server-side capabilities

| Key | Contents |
| --- | --- |
| `ast` | The serialised AST of the import block |

The plugin answers the model plugin's request for imported objects. The model service hands over the
text of the `import CSV` block together with a description of the metamodel's classes; this plugin
parses that text, reads the referenced `.csv` files itself, and returns instances and links which the
model service merges into the model data the execution services consume.

Class names arrive as plain reference text rather than as resolved references, because the metamodel
document is not loaded in this service — the model service has already validated them.
