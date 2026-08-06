# Add a language

A language is one entry in a plugin's `languagePlugins`. A plugin may provide several — the model
plugin provides `model` and `model_gen`, the model transformation plugin the same pair.

This page covers what a language needs beyond the plugin skeleton in
[Add a plugin](/develop/add-a-plugin).

## 1. Grammar

Declare AST types, then rules, then a root rule. See [The grammar DSL](/develop/grammar).

The root rule is the entry point:

```ts
export const TodoListRule = createRule("TodoListRule")
    .returns(TodoList)
    .as(({ add }) => [many(or(add("items", TodoItemRule), NEWLINE))]);
```

Decide early whether newlines are significant. All bundled languages treat them as separators and hide
them inside brackets with `NewlineAwareTokenBuilder`:

```ts
TokenBuilder: () => new NewlineAwareTokenBuilder(
    new Set(["{"]),          // opening tokens after which newlines stay significant
    new Set(["("]),          // opening tokens after which newlines are hidden
    new Set(["}", ")"])      // closing tokens
)
```

## 2. Scoping

The scope provider decides which names are visible where. For a single-file language the Langium
default is enough:

```ts
references: {
    ScopeProvider: (services) => new DefaultScopeProvider(services)
}
```

For a language that references other files, two more pieces are needed.

### Scope computation

What a document exports to other documents:

```ts
export class MetamodelScopeComputation extends DefaultScopeComputation {
    override async computeExports(document: LangiumDocument): Promise<AstNodeDescription[]> {
        // export classes and enums under their names
    }
}
```

### External reference collection

Which other documents must be available before this one can be linked:

```ts
references: {
    ExternalReferenceCollector: () => new DefaultExternalReferenceCollector()
}
```

The collector returns `local` URIs — files to load in full — and `external` URIs, for which the
exported symbols suffice. In the workbench everything is already loaded; server-side, the resolver
fetches them from the backend. Register the phase in `postCreate`:

```ts
postCreate(services) {
    addExternalReferenceCollectionPhase(services);
}
```

### File-scoped imports

For the common `import { a, b as c } from "./file"` shape, do not write rules by hand. Declare a
`FileScopingConfig` and generate them:

```ts
const { importRule, fileImportRule } = generateImportRules(
    todoFileScopingConfig,
    TodoImport,
    TodoFileImport,
    ID
);
```

The matching scope provider from `@mdeo/language-shared` then resolves the imported names, and
completion inside the braces offers what the target file actually exports.

## 3. Validation

Validation is where the rules a grammar cannot express live.

```ts
export function registerTodoValidationChecks(services: LanguageServices): void {
    const registry = services.validation.ValidationRegistry;
    const validator = new TodoValidator();
    registry.register({ TodoItem: validator.checkPriority.bind(validator) }, validator);
}
```

Emit an issue code in `data` when you want a quick fix to attach to the diagnostic:

```ts
accept("error", "Priority must be between 1 and 5.", {
    node: item,
    property: "priority",
    data: { code: TodoIssueCodes.PriorityOutOfRange }
});
```

Then match on that code in a `CodeActionProvider`. The metamodel plugin uses exactly this to offer
"use `<--` instead" when an association has its property name on the wrong side.

## 4. Serialization

A language needs a serializer if it should be formattable or have a graphical editor, because both
work by rewriting the AST and printing it again.

```ts
AstSerializer: (services) => new DefaultAstSerializer(services),
lsp: {
    Formatter: (services) => new SerializerFormatter(services)
},
postCreate(services) {
    registerDefaultTokenSerializers(services);
    registerTodoSerializers(services);
}
```

Serializers are registered per AST type and build a Prettier document. `registerDefaultTokenSerializers`
handles the primitives; you write one per interface you declared.

## 5. Types, if the language has expressions

Languages with expressions build on `@mdeo/language-expression`, which uses Typir. Provide a
`TypeSystemConfig` naming your primitive types, and partial type systems describing how your AST nodes
are typed. Reuse `metamodelPartialTypeSystem` if your language should see metamodel classes as types —
that is what gives scripts their `Task.all()` accessors.

## 6. Editor support

### Textual

```ts
textualEditorPlugin: {
    languageConfiguration: defaultLanguageConfiguration,
    monarchTokensProvider: serializeMonarchTokensProvider({
        ...defaultMonarchTokenProvider,
        keywords: ["todo"]
    })
}
```

`defaultMonarchTokenProvider` already handles numbers, strings, comments, backtick-quoted identifiers,
member access and calls. In practice you only replace `keywords`.

Set `textualEditorPlugin: undefined` for a generated language.

### Graphical

See [Graphical editors](/develop/graphical-editors).

### New-file dialog

Set `newFileAction: true` for a language whose files cannot be created without extra information — the
model and model transformation languages use it to ask which metamodel the new file belongs to.

## 7. Actions

To give files of your language a run entry, register an action handler:

```ts
action: {
    ActionHandlerRegistry: (services) => {
        const registry = new ActionHandlerRegistry();
        registry.register("run", new RunTodoActionHandler(services.shared));
        return registry;
    },
    ActionProvider: () => new DefaultActionProvider()
}
```

The action provider decides which actions a given file offers, so an action can be conditional on the
file's content.

## 8. Register it with the service

Add a `LanguageServiceConfig` for the language and list it in `ServiceConfig.languages`, and add the
`LanguagePlugin` to `ServicePluginDefinition.languagePlugins`. Both refer to the *same*
`LanguagePlugin` object, so the manifest and the runtime configuration cannot drift apart.

## Generated languages

A generated language is for files the platform produces:

```ts
const generatedModelLanguagePlugin: LanguagePlugin = {
    id: "model_gen",
    name: "Generated Model",
    extension: ".m_gen",
    newFileAction: false,
    icon,
    serverPlugin: { import: "generatedLanguage.js" },
    graphicalEditorPlugin: { import: "editor.js", stylesUrl: "styles.css", stylesCls: "editor-model" },
    textualEditorPlugin: undefined,
    isGenerated: true
};
```

Such a language usually has a trivial grammar — the generated model language captures the whole file
in a single terminal — but reuses the *editor* of its hand-written counterpart, so generated artefacts
are inspected with the same tools.

## Checklist

- [ ] Root rule set, and terminals listed in `additionalTerminals`
- [ ] A token builder chosen if newlines matter
- [ ] Scope provider, and an external reference collector if the language spans files
- [ ] Validation registered in `postCreate`
- [ ] Serializers registered if the language is formattable or has a diagram editor
- [ ] Monarch keywords listed in the manifest
- [ ] `LanguageServiceConfig` added to the service
