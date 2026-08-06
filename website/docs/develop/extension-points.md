# Extension points

Everything a plugin can hook into, grouped by where it takes effect.

## Manifest level

| Extension point | Declared as | Effect |
| --- | --- | --- |
| New language | `languagePlugins[]` | A file extension, an icon, editors and a language server |
| Textual editor | `languagePlugin.textualEditorPlugin` | Monaco language configuration and Monarch tokenizer |
| Graphical editor | `languagePlugin.graphicalEditorPlugin` | A GLSP/Sprotty diagram editor |
| New-file dialog | `languagePlugin.newFileAction` | Prompt for extra information when a file is created |
| Generated language | `languagePlugin.isGenerated` | A language for machine-produced files, without a textual editor |
| Extension of another language | `contributionPlugins[]` | See [Contribution plugins](/develop/contribution-plugins) |

## Langium service level

The `module` of a `LangiumLanguagePlugin` is an ordinary Langium module, so any Langium service can be
replaced. The ones plugins actually override:

### Parsing

| Service | Typical override |
| --- | --- |
| `parser.TokenBuilder` | `NewlineAwareTokenBuilder`, which makes newlines significant except inside the listed bracket pairs |
| `parser.ValueConverter` | `IdValueConverter`, which strips the backticks from quoted identifiers |
| `parser.ParserConfig` | Raising `maxLookahead` for grammars with ambiguous prefixes |

### References and scoping

| Service | Purpose |
| --- | --- |
| `references.ScopeProvider` | What names are visible where. Every language has one |
| `references.ScopeComputation` | What a document exports to other documents |
| `references.NameProvider` | How a node's name is derived |
| `references.ExternalReferenceCollector` | Which other documents this one needs before it can be linked |

`ExternalReferenceCollector` is specific to this platform. It returns two lists: `local` URIs, whose
files should be loaded outright, and `external` URIs, for which the exported symbols are enough. The
server-side resolver fetches them from the backend; in the workbench, everything is local already.

### Validation

Registered in `postCreate`, not in the module:

```ts
postCreate(services) {
    registerMetamodelValidationChecks(services);
}
```

Validation is where language rules that a grammar cannot express live — an association operator
requiring a property name on the other end, an objective function with the wrong signature, an object
name that is not unique across a transformation file.

### Type system

Languages with expressions build on `@mdeo/language-expression`, which uses
[Typir](https://typir.org). A language supplies a `TypeSystemConfig` naming its primitive types and
adds *partial type systems* that describe how its own AST nodes are typed. The metamodel partial type
system is what turns metamodel classes into script types with an `all()` accessor.

### LSP features

| Service | Purpose |
| --- | --- |
| `lsp.CompletionProvider` | Language-aware completion beyond what the grammar gives |
| `lsp.Formatter` | `SerializerFormatter` formats by re-serialising the AST with Prettier |
| `lsp.HoverProvider` | Hover text, typically rendering inferred types |
| `lsp.CodeActionProvider` | Quick fixes, usually paired with issue codes emitted by validation |

Validation emits issue codes in the `data` field of a diagnostic; the code action provider matches on
them. The metamodel plugin uses this to offer "change the operator to `<--`" when an association has
its property name on the wrong side.

### Serialization

| Service | Purpose |
| --- | --- |
| `AstSerializer` | Turns an AST back into text; the basis of formatting and of graphical edits |
| Token serializers | Registered with `registerDefaultTokenSerializers` plus language-specific ones |

Graphical editing works by mutating the AST and re-serialising it, so a language with a diagram editor
needs a complete serializer.

### Actions

| Service | Purpose |
| --- | --- |
| `action.ActionHandlerRegistry` | Named actions a file can offer, such as `run` |
| `action.ActionProvider` | Decides which actions are available for a given file |

This is how a `.config` file with a `solver` section gets a run entry while one without does not.

## Service level

| Extension point | Declared in | Purpose |
| --- | --- | --- |
| File data handler | `fileDataHandlers` | Compute a derived artefact for a file, keyed by data key |
| Request handler | `requestHandlers` | Answer an arbitrary language-specific request |
| Execution handler | `executionHandlers` | Start, monitor and cancel executions |
| Service-only module | `serviceModule` | Langium overrides that apply server-side but not in the browser |

`serviceModule` exists because the two environments differ: in the workbench every project file is
already loaded, while the service has to fetch what it needs from the backend. The config service, for
instance, installs a different `ScopeProvider` and `ExternalReferenceCollector` server-side.

### File data handlers

```ts
const metamodelAstDataHandler: FileDataHandler<MetamodelData, MetamodelServices> = async (context) => {
    const document = await context.instance.buildDocument(context.fileInfo!.uri);
    return { data: computeSomething(document), fileDependencies: [], dataDependencies: [] };
};
```

Anything read through `context.serverApi` is tracked automatically and merged into the returned
dependencies, so the backend can invalidate the cache when an input changes.

## Contribution level

| Target language | Extension point |
| --- | --- |
| `config` | Sections, with their grammar, AST types and executability |
| `script` | Global functions and new expression syntax |

Any language you write can define its own extension point the same way: accept a
`ServerContributionPlugin[]` in `create`, type-guard on your own `type` discriminator, and build the
grammar accordingly. See [Contribution plugins](/develop/contribution-plugins).
