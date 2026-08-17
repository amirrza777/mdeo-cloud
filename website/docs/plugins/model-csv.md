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

Started and registered by every deployment — all three compose files and the Terraform stack — like
the other bundled plugins.

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

### Naming columns explicitly

By default a column is used when its name matches a property of the class. When the CSV's headers do
not match — a spreadsheet you do not control, a column named `Due Date`, a file whose columns you
want to use only some of — an entry can name the mapping itself, in a nested block.

This is the [walkthrough's](/guide/walkthrough) plan, taken from CSV instead of written by hand:

<<< @/../samples/task-allocation/plan-from-csv.m{mdeo-model}

against these two files:

<<< @/../samples/task-allocation/developers.csv{csv}

<<< @/../samples/task-allocation/tasks.csv{csv}

`Developer`'s headers already match its properties, so it needs no block. `Task`'s do not, so each
column is named — including `Estimated effort`, which maps onto a property `Task` inherits from
`WorkItem`, and `Assigned to`, which maps onto an association end and so becomes a link.

The left side is the CSV column, quoted because it is arbitrary text; the right side is the property
name, a bare identifier.

::: warning Property names here are not cross-references
Unlike the class name on the line above it, the property name is plain text: it gets no completion,
and a typo is not underlined in the editor. It is checked when the import is computed, and a name
that is not a property of the class becomes one of the warnings below — which nothing surfaces yet.
Until it does, a mistyped property silently produces objects with that value missing.
:::

An explicit mapping is a complete list, not an override: when one is given, **only** the columns it
names are read. That is also how a column is deliberately left out — omit it, and it is ignored
rather than warned about. Leave the block off entirely to go back to matching by name.

| | Columns read | Unlisted columns |
| --- | --- | --- |
| No mapping block | Every column whose name matches a property | Ignored, with a warning |
| Mapping block | Only the columns the block names | Ignored, silently |

## How rows become objects

**One row, one object.** The header row names properties of the class; each following row becomes one
object. Objects are named `<Class>_<n>`, numbered from zero across all files importing that class.

**Inherited properties count.** A column may name a property the class inherits from a superclass,
not only one declared on the class itself. The whole `extends` chain is flattened before columns are
matched, and a property redeclared further down the chain wins.

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

**References use the `_id` column.** A column named after an association end becomes a link rather
than a value. It holds the `_id` of the target row, and several targets are separated by `;`:

```csv
_id,name,assignee
t1,Design,e1
t2,Build,e1;e2
```

`_id` is only a lookup key for the import — it does not become a property of the object. The target
`_id` is looked up among the rows imported for the class the association points at, so both ends have
to be imported for the link to resolve.

Association ends are read from the metamodel's `Association` declarations, on the class and on
everything it extends — the same view of a class the [Metamodel plugin](/plugins/metamodel) gives the
rest of the platform, so a column resolves here exactly when the property exists there.

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

## On the diagram

Imported objects are drawn in the model's diagram editor alongside the hand-written ones, using the
same node shape and showing the same properties. Two things distinguish them:

- **Their properties are read-only.** A hand-written object's labels can be edited in place and the
  edit is written back to the `.m` file. An imported object has no text to write back to, so its
  labels are not editable — change the CSV instead.
- **Their positions are remembered anyway.** Dragging an imported node persists its position across
  reloads, even though it has no AST node of its own to attach layout metadata to.

Node ids are derived from the object's name, so a node keeps its position as long as its row keeps
its position in the file. Inserting a row above it renumbers the objects after it, and their layout
follows the name rather than the row.

This rendering happens in the workbench, in the plugin's own diagram service — the model language
does not know CSV exists. See [The extension model](/develop/) for how a contribution plugin supplies
its own diagram nodes.

### This plugin needs the CSV plugin

Files are read through the workspace, which resolves them by extension — so reading a `.csv` needs a
plugin that registers a language for `.csv`, and that is the [CSV plugin](/plugins/csv). This plugin
does not pull it in, so a project can end up with `import CSV` available and nothing able to open
what it points at.

When that happens the import reports it as an ordinary error on the file reference:

> No enabled plugin can read '.csv' files, so this import cannot be resolved. Enable the CSV plugin
> for this project to import '.csv' data.

Enable the CSV plugin under **Settings → Plugins** and it resolves. With both enabled, editing a CSV
re-renders the diagram immediately.

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
