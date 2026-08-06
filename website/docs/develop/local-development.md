# Local development

Two ways to run the platform while working on it: everything in Docker, or the frontend and plugin
services on the host with the backend in Docker.

## Everything in Docker

```bash
docker compose -f infra/docker-compose-dev.yaml up --build
```

Builds every image from the checkout and exposes the internal ports:

| Port | Service |
| --- | --- |
| 4242 | Workbench |
| 8080 | Backend API |
| 3001 | `service-metamodel` |
| 3002 | `service-model` |
| 3003 | `service-script` |
| 3004 | `service-model-transformation` |
| 3005 | `service-config` |
| 3006 | `service-config-optimization` |
| 3007 | `service-model-csv` |
| 3008 | `service-config-mdeo` |
| — | `service-csv`, reachable only from inside the compose network |
| 5432–5435 | PostgreSQL (backend, script, model-transformation, optimizer) |

Three `optimizer-execution` nodes are started and wired as peers, so distributed search can be
exercised locally.

Slow to iterate on, but the closest thing to production.

## Frontend and plugins on the host

Faster for language and editor work. Start the backend, the databases and the execution services in
Docker, and run the rest with npm.

```bash
cd app
npm install
npm run build          # packages, editor CSS, workbench
```

Then, in parallel:

```bash
# TypeScript project references, in watch mode
npm run watch

# the workbench dev server on http://localhost:4242
npm run dev

# one per plugin service
npm run -w @mdeo/service-metamodel watch
npm run -w @mdeo/service-metamodel watch:static
```

The workbench's Vite config already proxies the plugin services, so the same-origin plugin URLs work
without further configuration:

| Path | Target |
| --- | --- |
| `/plugin/metamodel` | `http://localhost:3000` |
| `/plugin/model` | `http://localhost:3001` |
| `/plugin/script` | `http://localhost:3002` |
| `/plugin/model-transformation` | `http://localhost:3003` |
| `/plugin/config` | `http://localhost:3004` |
| `/plugin/config-optimization` | `http://localhost:3005` |
| `/plugin/config-mdeo` | `http://localhost:3006` |
| `/plugin/model-csv` | `http://localhost:3007` |
| `/plugin/csv` | `http://localhost:3008` |
| `/api` | `http://localhost:8080` |

Set `PORT` accordingly when starting each service. Adding a new plugin means adding a proxy entry —
see the end of [Add a plugin](/develop/add-a-plugin).

The proxy also injects the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers the
workbench needs, which is why plugin services should be reached through it rather than directly.

There is a tmux helper in `tools/run-dev.sh` that starts the whole set of watchers in one session, and
`tools/stop-dev.sh` to tear it down.

## Which watcher does what

| Command | Rebuilds |
| --- | --- |
| `npm run watch` (root) | All packages, through TypeScript project references |
| `npm run -w @mdeo/service-x watch` | Restarts the service process on change |
| `npm run -w @mdeo/service-x watch:static` | The served ES modules in `static/` |
| `npm run -w @mdeo/editor-x watch:css` | The editor stylesheet |

Changes to a served module require a page reload, because the workbench imports it once per session.

## Backend and execution services

The Kotlin side is a Gradle build:

```bash
cd platform
./gradlew build
./gradlew :backend:run
```

Modules: `backend`, `common`, `expression`, `metamodel`, `model-transformation`, `script`,
`optimizer`, and the execution services `script-execution`, `model-transformation-execution`,
`optimizer-execution` with their shared `execution-common`.

## Linting and formatting

```bash
cd app
npm run format          # prettier
npm run lint            # eslint --fix
npm run format:check    # check only, as CI does
npm run lint:check
```

## The documentation site

```bash
cd website
npm install
npm run validate        # parse and validate every DSL sample
npm run dev             # http://localhost:5173/mdeo-cloud/
npm run build           # validates, then builds the static site
```

`npm run validate` loads the built language packages from `app/packages/*/dist` and parses every file
under `website/samples` in one shared Langium environment, exactly as the workbench does. It reports
parser errors, lexer errors and validation diagnostics, and fails the build on any error — so a sample
in the docs cannot drift away from the languages it documents.

Run `npm run build:packages` in `app/` first if the language packages have changed.
