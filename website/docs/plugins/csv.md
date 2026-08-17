# CSV plugin

Editor support for plain `.csv` files, so tabular data can live in a project next to the models it
feeds. On its own it stores and displays data; the [Model CSV plugin](/plugins/model-csv) is what
turns that data into model objects.

## At a glance

| | |
| --- | --- |
| **Plugin id** | `csv-service` |
| **Display name** | CSV |
| **Description** | Language support for CSV data files (`.csv` files) |
| **Default URL** | `/plugin/csv` |
| **Source** | `app/packages/service-csv`, `app/packages/language-csv` |
| **Depends on** | Nothing. It parses no references and needs no other plugin |

Started and registered by every deployment — all three compose files and the Terraform stack — like
the other bundled plugins.

::: tip Pairs with Model CSV
On its own this plugin only gives `.csv` files an editor. Turning their rows into model objects is
the [Model CSV plugin](/plugins/model-csv), which reads the files a model's `import CSV` block names.

Enabling this one alone is fine — data files in a project without imports. The other direction is
not: Model CSV reads files through this plugin's language and
[reports an error](/plugins/model-csv#this-plugin-needs-the-csv-plugin) if it is missing.
:::

## Languages contributed

| Language id | Name | Extension | Textual editor | Graphical editor | Generated |
| --- | --- | --- | --- | --- | --- |
| `csv` | CSV | `.csv` | ✅ | ❌ | ❌ |

### The `csv` language

A CSV file is not parsed into a structure. The grammar matches the entire file as a single token:

```
CsvFileRule returns CsvFile:
    content=ANY_TEXT?
```

Two consequences follow from that shape:

- **No syntax errors.** Any byte sequence is a valid `.csv` file. Column counts, quoting and
  delimiters are only interpreted where the file is imported.
- **An empty file is valid.** `content` is optional, so a newly created `.csv` does not open in an
  error state.

Interpreting the text is deliberately left to the consumer, because what counts as correct depends on
the metamodel class the rows are mapped to.

### The expected shape of the data

Nothing enforces this, but the simplest file to import is one whose headers already match the
metamodel class the [Model CSV plugin](/plugins/model-csv) maps it to:

```csv
_id,name,effort,assignee
t1,Design,5,e1
t2,Build,8,e2
```

| Column | Meaning |
| --- | --- |
| `_id` | Optional row identifier, used as the target of references from other rows |
| any other | A property of the metamodel class the file is mapped to |

Headers that do not match are not a problem — the import can
[name the mapping explicitly](/plugins/model-csv#naming-columns-explicitly), which is what you want
for a file exported from somewhere you do not control.

The parser used on import accepts quoted fields, escaped quotes (`""`), embedded commas and newlines
inside quotes, and both `\n` and `\r\n` line endings. Blank lines are skipped.

## Contribution plugins contributed

None. The CSV plugin adds no syntax to any other language — the `import CSV` block in the model
language comes from the [Model CSV plugin](/plugins/model-csv).

## Server-side capabilities

| File data key | Contents |
| --- | --- |
| `ast` | The serialised AST, a single `CsvFile` node holding the file's text |

No execution handler: a CSV file is data, not something that runs.
