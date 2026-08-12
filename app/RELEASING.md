# Releasing

The reusable `@mdeo/*` packages are published to npm from
[`release-npm.yaml`](../.github/workflows/release-npm.yaml) whenever a GitHub release is published.

## What gets published

Everything in [`packages/`](packages) that is not marked `"private": true`:

- `@mdeo/plugin`
- `@mdeo/protocol-*` — the shared protocol types
- `@mdeo/language-*` — the Langium based languages
- `@mdeo/editor-*` — the GLSP based diagram editors
- `@mdeo/service-common`, `@mdeo/service-config-common`, `@mdeo/service-model-common` — the
  libraries the language services are built from

The deployable language services (`@mdeo/service-config`, `@mdeo/service-metamodel`, …) and
`@mdeo/workbench` are `private` and stay off the registry. `npm publish --workspaces` skips them.

All packages share one version, which is the version of the GitHub release they belong to, and is
kept in [`package.json`](package.json).

## Cutting a release

1. `npm run set-version -- 0.2.11`
2. Commit, then create a GitHub release with the tag `v0.2.11`.

The workflow refuses to publish if the tag and the manifests disagree, so the two cannot drift.

`set-version` is `npm version --workspaces` plus [syncpack](https://syncpack.dev), configured in
[`syncpack.config.mjs`](syncpack.config.mjs). `npm version` bumps the packages but leaves the ranges
they use for each other untouched, so syncpack rewrites those from the new local versions. It runs
twice because it fixes the version and the range in separate passes. The lockfile is refreshed at
the end via `npm install --package-lock-only`, which records the new versions without touching
`node_modules`; it is committed and CI installs with `npm ci`, so leaving it behind would break the
release.

`npm run lint:versions` checks the same invariant without writing anything, and runs in CI before
publishing.

Only `@mdeo/*` is managed. Third-party ranges are deliberately left alone — note that syncpack would
otherwise report pre-existing drift, e.g. `tsx` and `vite` are `~` in some packages and `^` in
others.

A prerelease version (`0.3.0-beta.1`) is published under the `beta` dist-tag instead of `latest`.

### If a release fails halfway

`npm publish --workspaces` stops at the first failure and has no way to skip packages that are
already on the registry, so re-running the workflow fails immediately on the ones that succeeded.
Publish the remainder by hand instead:

```sh
npm publish -w @mdeo/language-model --provenance --tag latest
```

## Trusted publishing

Publishing is authenticated with OIDC, so no npm token is stored in the repository. Each package
trusts exactly this repository and the `release-npm.yaml` workflow. This is already configured;
it only needs attention when

- **a new public package is added** — it has to exist on the registry before a trusted publisher can
  be configured, so publish it once manually, then
  `npm trust github @mdeo/<name> --file=release-npm.yaml --repository=mde-optimiser/mdeo-cloud --allow-publish`
- **the workflow is renamed or the repository moves** — the old claim no longer matches, so every
  package needs `npm trust revoke` followed by a new `npm trust github`

`npm trust` needs npm ≥ 11.15.0 and 2FA on the account. `npm trust list @mdeo/<name>` shows the
current configuration. When configuring many packages at once, the 2FA prompt on npmjs.com offers to
skip 2FA for five minutes, and npm recommends a two second pause between calls to avoid rate limits.

The `0.0.1` placeholder versions that were published to bootstrap this can be retired with
`npm deprecate '@mdeo/<name>@0.0.1' 'placeholder, use a released version'`.

## Licensing

Every package carries a copy of the repository [`LICENSE`](../LICENSE) (EPL-2.0). Packages that
contain third-party code also carry a `LICENSES` file listing it. Both are declared in the `files`
array of each manifest so they end up in the published tarball.
