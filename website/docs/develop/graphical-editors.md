# Graphical editors

A language can offer a diagram editor alongside its text editor. Both views edit the same file: the
diagram operates on the AST, and the serializer writes it back out as text.

Editors are built on [GLSP](https://eclipse.dev/glsp/) and [Sprotty](https://sprotty.org/). The
platform splits them across two packages, because the two halves run in different places.

| Package | Runs in | Contains |
| --- | --- | --- |
| `editor-<name>` | The browser, as an ES module loaded from the plugin | Views, tool palette, styling, client-side handlers |
| `language-<name>/features/diagram-server` | The Langium language server (a web worker) | The graphical model factory, operation handlers, layout |
| `protocol-<name>` | Both | Action and model types shared between them |

## The client side

`editor-<name>` exports a GLSP `ContainerConfiguration`:

```ts
import type { ContainerConfiguration } from "@eclipse-glsp/sprotty";
import { DEFAULT_MODULES } from "@mdeo/editor-shared";
import { metamodelDiagramModule } from "./module.js";
import { metamodelToolboxModule } from "./features/toolbox/featureModule.js";
import { metamodelIconRegistryModule } from "./features/icon-registry/featureModule.js";

export const metamodelEditorPlugin: ContainerConfiguration = [
    ...DEFAULT_MODULES,
    metamodelDiagramModule,
    metamodelToolboxModule,
    metamodelIconRegistryModule
];
```

`DEFAULT_MODULES` from `@mdeo/editor-shared` supplies everything a diagram editor needs regardless of
language: bounds and layout, move and resize, edge routing and reconnection, label editing, the
toolbox, marquee and hand tools, node and edge creation, grid, selection, decorations, undo/redo
shared with the text editor, reveal-source, and the editor settings panel.

Your own modules add the language-specific parts:

- **the diagram module** — the node and edge types of your language and the views that render them;
- **the toolbox module** — palette entries and, if relevant, a connection-type selector;
- **an icon registry module** — custom icons for palette entries and decorations.

The plugin also declares a stylesheet and a CSS class:

```ts
graphicalEditorPlugin: {
    import: "editor.js",
    stylesUrl: "styles.css",
    stylesCls: "editor-metamodel"
}
```

The class is applied to the editor container, so styles are scoped to your editor and cannot leak into
another plugin's.

Styles are built with Tailwind:

```json
"scripts": {
    "build:css": "npx @tailwindcss/cli -i ./src/styles/index.css -o ./dist/styles.css --minify"
}
```

## The server side

The diagram *server* lives in the language package and runs in the same web worker as the language
server, which is what lets a graphical edit and a textual edit share one document.

A typical `features/diagram-server` directory contains:

| File | Responsibility |
| --- | --- |
| `<name>DiagramConfiguration.ts` | Which element types exist and how they may be connected |
| `<name>GModelFactory.ts` | Builds the graphical model from the AST |
| `<name>DiagramModule.ts` | Wires the pieces into the GLSP server container |
| `<name>ToolPaletteItemProvider.ts` | The palette entries offered for the current document |
| `<name>LayoutEngine.ts` | Automatic layout, using ELK |
| `<name>ModelIdProvider.ts` | Stable ids linking graphical elements back to AST nodes |
| `<name>LabelEditValidator.ts` | Validates in-place label edits |
| `handler/*.ts` | Operation handlers: create, delete, reconnect, copy/paste |
| `model/*.ts` | The graphical element classes |

### From AST to diagram

The `GModelFactory` walks the AST and produces nodes, edges, compartments and labels. Ids come from
the `ModelIdProvider` so that every graphical element can be traced back to the AST node it came from —
that is what makes "reveal source" and diagnostics-on-diagram work.

### From diagram to AST

Operation handlers do the reverse. A handler mutates the AST and lets the serializer write the file
out again; it does not edit text directly. This is why a language needs a complete serializer before
it can have a diagram editor.

```ts
// simplified
export class MetamodelDeleteElementOperationHandler extends GLSPOperationHandler {
    override execute(operation: DeleteElementOperation) {
        // find the AST nodes for operation.elementIds, remove them,
        // and apply the resulting workspace edit
    }
}
```

### Layout

Layout is computed with [ELK](https://eclipse.dev/elk/). A `LayoutEngine` chooses the algorithm and
its options; the result is applied to the graphical model before it reaches the client.

### Diffing generated models

Generated languages reuse the editor of their hand-written counterpart. To show what changed between a
starting model and a solution, the platform computes a graph edit distance in a dedicated worker
(`gedWorker.js`), built as a third entry point of the service's Vite config. If your language has a
generated counterpart worth diffing, serve that worker too — the metadata manager derives its URL from
the `language.js` URL it was given at creation time.

## Sharing an editor between languages

Two languages can point at the same `editor.js`. The model plugin does this: `model` and `model_gen`
declare the same graphical editor plugin, so a generated solution opens in the editor you already know
from hand-written models.

## When not to build one

A diagram editor is a substantial amount of work, and it only pays off for languages whose structure is
genuinely graph-shaped. The script and config languages have none, and are better for it — they are
textual through and through. Set `graphicalEditorPlugin: undefined` and move on.
