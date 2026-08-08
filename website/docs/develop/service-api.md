# Language service HTTP API

Every plugin service exposes the same endpoints, implemented by `startLanguageService` in
`@mdeo/service-common`. A plugin author normally never touches them — this page documents the contract
for debugging, and for anyone implementing a plugin service in another stack.

All endpoints except `GET /` and the static assets require a JWT issued by the backend, presented as
`Authorization: Bearer <token>`, and are checked against a scope.

## `GET /`

Returns the [plugin manifest](/develop/manifest). This is the only endpoint the backend needs to
register a plugin.

Static asset paths in the response are rewritten to `static/` or `static/<SERVICE_VERSION>/`.

```bash
curl http://localhost:3000/ | jq
```

## `GET /static/*`

The built ES modules and stylesheets referenced by the manifest — `language.js`, `editor.js`,
`styles.css`, and any workers. Served with CORS enabled and with the COOP/COEP headers the workbench
requires.

## `POST /data/:languageId/:key`

Computes [file data](/guide/concepts#file-data). Called by the backend when a cached entry is missing
or has been invalidated.

**Scope:** `file-data:read`

```json
{
  "project": "0a2f…",
  "source": {
    "path": "/models/plan.m",
    "content": "using \"./tasks.mm\"\n…",
    "version": 7
  },
  "contributionPlugins": []
}
```

`source` is omitted for directory-level computations. `contributionPlugins` carries the payloads of
the contribution plugins active for the project, and is part of the key under which the service pools
its Langium instances.

```json
{
  "data": { },
  "fileDependencies": [{ "path": "/models/tasks.mm", "version": 3 }],
  "dataDependencies": [{ "path": "/models/tasks.mm", "key": "ast" }]
}
```

The dependency lists are what let the backend invalidate correctly. Anything a handler reads through
`context.serverApi` is tracked automatically and merged into whatever the handler returns.

Responses: `404` for an unknown language or an unregistered data key, `403` for a missing scope.

## `POST /request/:languageId/:key`

An arbitrary language-specific request. Registered only if the service has `requestHandlers`.

**Scope:** `file-data:read`

```json
{
  "project": "0a2f…",
  "body": { },
  "contributionPlugins": []
}
```

The response is `{ "data": … }`, or `{ "data": null }` when the handler produced nothing.

This is the channel the config language uses to talk to its contribution plugins: `config` to compute
section data, and the `config-execution-*` keys to manage runs.

## `POST /:languageId/executions`

Starts an execution. Registered only if the service has `executionHandlers`.

```json
{
  "executionId": "b71c…",
  "project": "0a2f…",
  "filePath": "/optimize.config",
  "fileContent": "problem {\n…",
  "fileVersion": 12,
  "data": { },
  "contributionPlugins": []
}
```

The `executionId` is created by the backend beforehand, so progress can be attributed to it from the
first moment. `data` is the payload the language's action handler produced when the user triggered the
action.

## Execution follow-ups

| Endpoint | Purpose |
| --- | --- |
| `GET /:languageId/executions/:executionId/summary` | Markdown summary of the run |
| `GET /:languageId/executions/:executionId/files` | The result file tree |
| `GET /:languageId/executions/:executionId/files/*` | One result file |
| `POST /:languageId/executions/:executionId/cancel` | Cancel a running execution |

## WebSocket

An execution WebSocket server is attached to the same HTTP server. It carries progress updates from
the execution service to the backend and on to the workbench, so a long-running optimisation reports
generations as it produces them rather than only at the end.

## Configuration

`parseServiceConfigFromEnv()` reads:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Listening port |
| `HOST` | `0.0.0.0` | Bind address |
| `BACKEND_API_URL` | `http://localhost:8080/api` | Backend base URL for the `ServerApi` |
| `JWT_ISSUER` | `mdeo-platform` | Expected issuer of incoming tokens |
| `MAX_LANGIUM_INSTANCES` | `5` | Size of the Langium instance pool |
| `MAX_REQUEST_BODY_BYTES` | 64 MiB | Upper bound on a request body; file contents travel in the body |
| `SERVICE_VERSION` | — | When set, static assets are served under `/static/<version>/` |

Language-specific variables are read by the plugin itself — for example
`SCRIPT_EXECUTION_SERVICE_URL` and `MODEL_TRANSFORMATION_EXECUTION_SERVICE_URL`.

## The Langium instance pool

Each language keeps a pool of Langium instances keyed by the set of active contribution plugins,
because two projects with different plugin sets need different grammars. Instances are reused when the
key matches, evicted least-recently-used when the pool is full, and reset after every request so that
no document survives into the next one.

This is why `MAX_LANGIUM_INSTANCES` is a memory-versus-concurrency trade-off rather than a
straightforward throughput setting.
