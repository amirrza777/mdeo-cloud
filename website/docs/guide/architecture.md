# Architecture

MDEO Cloud is a set of services around one backend. The workbench in the browser talks only to the
backend and to the plugins; the plugins talk to the backend and to their execution services.

## The components

| Component | Runs as | Responsibility |
| --- | --- | --- |
| Workbench | Vue app in the browser | The entire user interface, including a language server in a web worker |
| Backend | Ktor service | Projects, files, users, the plugin registry, file data and executions |
| Plugin services | One Node service per plugin | Manifest, static assets, server-side language services, execution routing |
| Execution services | `script-execution`, `model-transformation-execution`, `optimizer-execution` | The actual long-running work |
| PostgreSQL | One database per domain | Persistence for the backend and for each execution service |

## Who talks to whom

| From | To | Over | For |
| --- | --- | --- | --- |
| Workbench | Backend | REST and WebSocket | Projects, files, plugin manifests, executions and their progress |
| Workbench | Plugin services | ES module imports over HTTP | `language.js`, `editor.js` and their styles |
| Backend | Plugin services | REST | Manifest fetching, file data computation, language requests, starting executions |
| Plugin services | Backend | REST, with a scoped JWT | Reading project files while computing file data |
| Plugin services | Execution services | REST and WebSocket | Dispatching a run and receiving its progress |
| Execution services | Backend | REST, with a scoped JWT | Reporting status and storing results |
| Execution nodes | Each other | REST | Distributing an optimisation across peers |

The workbench never talks to an execution service directly, and an execution service never talks to
the workbench. Everything users see flows back through the backend.

## The workbench

A Vue application. It renders the project tree, the editors and the execution views. Editing support
comes from a Langium language server that runs in a web worker: the workbench fetches the manifests
of the project's plugins, imports each language plugin's `language.js` as an ES module, and creates
one shared Langium environment containing all of them.

Because every language lives in the same environment, cross-language references resolve locally,
without a server round trip. Files the worker has not seen yet are fetched from the backend through
the LSP file-system bridge.

Graphical editors are separate ES modules (`editor.js`) loaded on demand, built on GLSP and Sprotty.
A diagram and the corresponding text are two views of the same file.

## The backend

A Ktor service, and the only component that owns state that users care about:

- **Projects, users and permissions.** Membership, roles, and per-project plugin selection.
- **Files.** The project tree and file contents, with versions, plus zip import and export.
- **Plugins.** The registry of plugin URLs and their fetched manifests.
- **File data.** The dependency-tracked cache of derived artefacts.
- **Executions.** Records, status, and routing metadata for every run.

It also issues the JWTs that plugin services and execution services use to call back into it, so a
service token is bound to the work it was issued for.

## Plugin services

One Node service per plugin. Each one:

- serves its **manifest** at `GET /`, so the backend can discover what it contributes;
- serves its **static assets** — `language.js`, `editor.js`, `styles.css` — for the workbench to
  import;
- runs the same Langium language server **server-side** to answer *file data* requests, using a pool
  of Langium instances keyed by the active contribution plugins;
- forwards **execution requests** to the execution service that can carry them out.

All of that behaviour comes from `@mdeo/service-common`; a plugin's own `index.ts` is mostly a
declaration of what it provides. See [Anatomy of a plugin](/develop/plugin-anatomy).

## Execution services

Long-running work never happens in the plugin service.

- **script-execution** runs `.fn` functions against a model, in a sandboxed subprocess with a
  timeout.
- **model-transformation-execution** applies a `.mt` transformation to a model.
- **optimizer-execution** runs the search. It is the component that scales: several nodes can join a
  run, each contributing worker threads, coordinated through a peer list. A single configuration can
  also be run as several independent *batches* to gauge the variance of the search.

Each of these owns its own PostgreSQL database, which keeps a heavy optimisation run from competing
with ordinary workbench traffic.

## Graph backends

Optimisation manipulates models as graphs. Two backends are available and can be chosen per run in
the `runtime` section of a config file: `MDEO`, the default in-house graph, and `Tinker`, a
TinkerGraph-based one.

## Where the code lives

| Path | Contents |
| --- | --- |
| `app/packages/language-*` | Grammars, scoping, validation and type systems, shared by client and server |
| `app/packages/editor-*` | Graphical editors (GLSP/Sprotty) |
| `app/packages/service-*` | The deployable plugin services |
| `app/packages/protocol-*` | Shared protocol types between editor and language server |
| `app/packages/plugin` | The plugin manifest interfaces |
| `app/packages/workbench` | The Vue application and the in-browser language server |
| `platform/` | Backend and execution services (Kotlin) |
| `infra/` | Docker Compose and Kubernetes manifests |
| `website/` | This documentation |
