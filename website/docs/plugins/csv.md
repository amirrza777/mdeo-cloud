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

::: warning Only started by the development compose file
`infra/docker-compose-dev.yaml` builds this service and lists it in `DEFAULT_PLUGIN_URLS`.
`docker-compose.yaml` and `docker-compose-prod.yaml` do not, so a production deployment has to add
the service and register `/plugin/csv` itself.
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

Nothing enforces this, but a file only imports cleanly if it follows the convention the
[Model CSV plugin](/plugins/model-csv) reads:

```csv
_id,name,effort,assignee
t1,Design,5,e1
t2,Build,8,e2
```

| Column | Meaning |
| --- | --- |
| `_id` | Optional row identifier, used as the target of references from other rows |
| any other | A property of the metamodel class the file is mapped to |

The parser used on import accepts quoted fields, escaped quotes (`""`) and both `\n` and `\r\n` line
endings.

## Contribution plugins contributed

None. The CSV plugin adds no syntax to any other language — the `import CSV` block in the model
language comes from the [Model CSV plugin](/plugins/model-csv).

## Server-side capabilities

| File data key | Contents |
| --- | --- |
| `ast` | The serialised AST, a single `CsvFile` node holding the file's text |

No execution handler: a CSV file is data, not something that runs.
