# The workbench

The workbench is the whole user interface. It runs entirely in the browser and is where you create
projects, edit files and start runs.

## Layout

A rail on the left switches between four panels:

| Panel | Contents |
| --- | --- |
| **Projects** | Every project you can see, and the actions to create, rename and delete them |
| **Files** | The file tree of the current project |
| **Search** | Full-text search across the project's files |
| **Executions** | Runs started from this project, with their status and results |

Administrators also get a **Settings** entry for user and plugin management. Below the rail are the
account menu and the light/dark toggle.

The main area holds tabs. Each tab is one open file.

## Editing files

New files are created from the file tree. The extension decides the language, and therefore the
editor, the validation and the actions available on the file. Languages whose plugin marks them with
a *new file action* — models and model transformations — open a short dialog on creation, because
they need to know which metamodel they belong to.

### Textual editing

Text editing uses Monaco, driven by the language server running in a web worker. You get the usual
things: syntax highlighting, completion, hover information, diagnostics as you type, go-to-definition
across files, rename, and formatting.

Diagnostics are not just parse errors. Each language brings its own validation — an association
operator that requires a property name on the other end, an objective function with the wrong
signature, a composition that would give an object two parents. Those checks are the same ones the
server applies before an execution starts, so an editor without red squiggles means a file that will
run.

### Graphical editing

Metamodels, models and model transformations also have a diagram editor. It is not a preview: nodes,
edges, labels and the tool palette all edit the underlying file, and the text updates accordingly.
Switch between the two views from the editor's toolbar.

Copy and paste work inside a diagram and between diagrams of the same language.

## Cross-file references

References across files are written as relative paths:

```mm
import "./shapes.mm"
```

```fn
using "./tasks.mm"
import { unassignedEffort } from "./objectives.fn"
```

The language server resolves them inside the project, so completion in a config file offers the
functions actually defined in the script file it imports, and renaming a metamodel class updates the
models that instantiate it.

## Running things

Files whose language declares an action get a run entry. What that means depends on the language:

- a **script** function can be executed against a model;
- a **model transformation** can be applied to a model;
- a **config** file with an executable section — `solver` — starts an optimisation.

Runs appear in the **Executions** panel immediately and update live over a WebSocket. Open one to see
its status and, once it finishes, its result files. See [Reading the results](/guide/results).

## Import and export

A whole project can be exported as a zip and imported again, folders included. This is the easiest
way to move an experiment between instances or to hand one to a colleague.
