# Add a plugin

This page builds a plugin end to end. The example is a `todo` language with the extension `.todo` — a
deliberately small language, so the plugin machinery stays visible.

Follow [Add a language](/develop/add-a-language) for the grammar work in more depth, and
[The grammar DSL](/develop/grammar) for the rule syntax.

## 1. Create the packages

Inside `app/packages`, create `language-todo` and `service-todo`. Both are workspace packages, so they
are picked up by `app/package.json` automatically.

```json
// app/packages/language-todo/package.json
{
    "name": "@mdeo/language-todo",
    "version": "0.1.0",
    "type": "module",
    "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
    "files": ["dist", "src"],
    "dependencies": {
        "@mdeo/language-common": "^0.1.0",
        "@mdeo/language-shared": "^0.1.0",
        "@mdeo/plugin": "^0.1.0"
    }
}
```

```json
// app/packages/service-todo/package.json
{
    "name": "@mdeo/service-todo",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "files": ["dist", "src"],
    "scripts": {
        "build:static": "vite build",
        "watch:static": "vite build --watch",
        "start": "node dist/index.js",
        "watch": "tsx watch src/index.ts"
    },
    "dependencies": {
        "@mdeo/language-common": "^0.1.0",
        "@mdeo/language-todo": "^0.1.0",
        "@mdeo/plugin": "^0.1.0",
        "@mdeo/service-common": "^0.1.0",
        "lucide": "^0.575.0"
    },
    "devDependencies": {
        "@types/node": "^25.3.1",
        "tsx": "^4.21.0",
        "vite": "^7.3.1"
    }
}
```

Add both to `app/tsconfig.build.json` so `npm run build:packages` compiles them.

## 2. Define the grammar

```ts
// app/packages/language-todo/src/grammar/todoTypes.ts
import { createInterface, Optional } from "@mdeo/language-common";
import type { ASTType } from "@mdeo/language-common";

export const TodoItem = createInterface("TodoItem").attrs({
    name: String,
    priority: Optional(Number),
    text: String
});
export type TodoItemType = ASTType<typeof TodoItem>;

export const TodoList = createInterface("TodoList").attrs({
    items: [TodoItem]
});
export type TodoListType = ASTType<typeof TodoList>;
```

```ts
// app/packages/language-todo/src/grammar/todoRules.ts
import { createRule, ID, INT, NEWLINE, STRING, many, optional, or } from "@mdeo/language-common";
import { TodoItem, TodoList } from "./todoTypes.js";

export const TodoItemRule = createRule("TodoItemRule")
    .returns(TodoItem)
    .as(({ set }) => [
        "todo",
        set("name", ID),
        optional("(", set("priority", INT), ")"),
        ":",
        set("text", STRING)
    ]);

export const TodoListRule = createRule("TodoListRule")
    .returns(TodoList)
    .as(({ add }) => [many(or(add("items", TodoItemRule), NEWLINE))]);
```

## 3. Build the Langium language plugin

```ts
// app/packages/language-todo/src/plugin.ts
import {
    HIDDEN_NEWLINE,
    ML_COMMENT,
    SL_COMMENT,
    WS,
    type LangiumLanguagePlugin,
    type LangiumLanguagePluginProvider
} from "@mdeo/language-common";
import {
    DefaultAstSerializer,
    IdValueConverter,
    NewlineAwareTokenBuilder,
    SerializerFormatter,
    registerDefaultTokenSerializers
} from "@mdeo/language-shared";
import { TodoListRule } from "./grammar/todoRules.js";
import { registerTodoValidationChecks } from "./validation/todoValidator.js";

const todoPlugin: LangiumLanguagePlugin<object> = {
    rootRule: TodoListRule,
    additionalTerminals: [WS, HIDDEN_NEWLINE, ML_COMMENT, SL_COMMENT],
    module: {
        parser: {
            TokenBuilder: () => new NewlineAwareTokenBuilder(new Set(["{"]), new Set(["("]), new Set(["}", ")"])),
            ValueConverter: () => new IdValueConverter()
        },
        lsp: {
            Formatter: (services) => new SerializerFormatter(services)
        },
        AstSerializer: (services) => new DefaultAstSerializer(services)
    },
    postCreate(services) {
        registerDefaultTokenSerializers(services);
        registerTodoValidationChecks(services);
    }
};

export const todoPluginProvider: LangiumLanguagePluginProvider<object> = {
    create: () => todoPlugin
};
```

## 4. Serve the language module

```ts
// app/packages/service-todo/src/served/language.ts
import { todoPluginProvider } from "@mdeo/language-todo";
export default todoPluginProvider;
```

```ts
// app/packages/service-todo/vite.config.ts
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    build: {
        lib: {
            entry: { language: resolve(__dirname, "src/served/language.ts") },
            formats: ["es"],
            cssFileName: "styles"
        },
        outDir: "static",
        emptyOutDir: true,
        sourcemap: true
    }
});
```

## 5. Declare the manifest and start the service

```ts
// app/packages/service-todo/src/index.ts
import { ListTodo } from "lucide";
import {
    convertIcon,
    defaultLanguageConfiguration,
    defaultMonarchTokenProvider,
    serializeMonarchTokensProvider
} from "@mdeo/language-common";
import {
    AST_HANDLER_KEY,
    astHandler,
    initializePluginContext,
    parseServiceConfigFromEnv,
    startLanguageService,
    type LanguageServiceConfig,
    type ServiceConfig,
    type ServicePluginDefinition
} from "@mdeo/service-common";
import type { LanguagePlugin } from "@mdeo/plugin";

const todoLanguagePlugin: LanguagePlugin = {
    id: "todo",
    name: "Todo",
    extension: ".todo",
    icon: convertIcon(ListTodo),
    serverPlugin: { import: "language.js" },
    graphicalEditorPlugin: undefined,
    textualEditorPlugin: {
        languageConfiguration: defaultLanguageConfiguration,
        monarchTokensProvider: serializeMonarchTokensProvider({
            ...defaultMonarchTokenProvider,
            keywords: ["todo"]
        })
    },
    isGenerated: false
};

// Must run before the language package is imported.
initializePluginContext();

const { todoPluginProvider } = await import("@mdeo/language-todo");

const todoServicePlugin: ServicePluginDefinition = {
    id: "todo-service",
    name: "Todo",
    description: "Language support for todo lists (.todo files)",
    icon: convertIcon(ListTodo),
    languagePlugins: [todoLanguagePlugin],
    contributionPlugins: []
};

const todoLanguageConfig: LanguageServiceConfig = {
    languagePlugin: todoLanguagePlugin,
    languagePluginProvider: todoPluginProvider,
    fileDataHandlers: { [AST_HANDLER_KEY]: astHandler }
};

const config: ServiceConfig = {
    ...parseServiceConfigFromEnv(),
    plugin: todoServicePlugin,
    languages: [todoLanguageConfig]
};

await startLanguageService(config);
```

## 6. Run and register it

```bash
cd app
npm run build:packages
npm run -w @mdeo/service-todo build:static
PORT=3010 BACKEND_API_URL=http://localhost:8080/api npm run -w @mdeo/service-todo start
```

Check the manifest:

```bash
curl http://localhost:3010/ | jq
```

Then register the plugin in the workbench as an administrator, under **Settings → Plugins**, with the
URL `http://localhost:3010`. Add it to a project, create a `.todo` file, and the language is live.

When developing against the Vite dev server, add a proxy entry to
`app/packages/workbench/vite.config.ts` so the plugin is reachable under the same origin:

```ts
"/plugin/todo": {
    target: "http://localhost:3010",
    changeOrigin: true,
    secure: false,
    ws: true,
    rewrite: (path) => path.replace(/^\/plugin\/todo/, ""),
    configure: addCoopCoepHeaders
}
```

## 7. Package it for deployment

Add a Dockerfile under `infra/docker/todo/`, a service entry to the compose files, and the plugin URL
to `DEFAULT_PLUGIN_URLS` so fresh installations pick it up automatically.

## Checklist

- [ ] `initializePluginContext()` runs before any language package is imported
- [ ] Language packages are imported with `await import(...)`, not statically
- [ ] `serverPlugin.import` is a **relative** path, so versioning works
- [ ] The language id is unique across the plugins a project may enable
- [ ] The file extension includes the leading dot
- [ ] `GET /` returns the manifest
- [ ] Static assets are reachable under `/static/`
