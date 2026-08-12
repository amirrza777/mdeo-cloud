# Projects and plugins

Which languages a project understands is a property of the project, not of the installation. A
project sees exactly the languages contributed by the plugins enabled for it.

## Registering a plugin

Plugin registration is instance-wide and restricted to administrators, under **Settings → Plugins**.

A plugin is registered by **URL** — the address of a plugin service. The backend fetches
`GET <url>/` and expects a [plugin manifest](/develop/manifest) in return. Everything else about the
plugin is derived from that manifest: its id, name, description, icon, the languages it provides and
the contributions it makes to other languages.

Registered plugins can be marked **default**. Default plugins are added automatically to every newly
created project.

At startup the backend also registers the plugins listed in the `DEFAULT_PLUGIN_URLS` environment
variable, which is how the bundled deployments come up with the standard plugins already
available.

::: warning Refresh after an upgrade
Manifests are stored, not fetched on every request. After upgrading the platform, administrators must
refresh plugins so that the stored manifests point at the static assets the new services actually
serve. There is a refresh action per plugin and one for all plugins at once.
:::

## Enabling plugins for a project

Project administrators manage the project's plugin set from the project details view. Adding a plugin
makes its languages available in that project; removing it hides them again.

Plugins are rarely independent of each other, so a useful selection is a coherent one:

- The [Model](/plugins/model) language needs the [Metamodel](/plugins/metamodel) language, because
  every model imports a metamodel.
- The [Model Transformation](/plugins/model-transformation) language needs the metamodel language for
  the same reason.
- The [Config](/plugins/config) language is empty on its own. Without
  [Config Optimization](/plugins/config-optimization) and [Config MDEO](/plugins/config-mdeo) there
  are no sections to write.
- Config Optimization declares grammar dependencies on the contributions of the metamodel and script
  plugins, and Config MDEO depends on Config Optimization.

The overview at [Plugins](/plugins/) lists these relationships.

## How the workbench uses them

When you open a project the workbench asks the backend for the project's plugins and receives their
manifests. For each language plugin it then imports the plugin's `language.js`, and for languages with
a diagram editor it imports `editor.js` and the accompanying stylesheet when the editor is first
opened. All language servers end up in a single Langium environment inside one web worker.

The consequence is worth stating plainly: a plugin's code is fetched from the plugin service and
executed in your browser. Only register plugins you trust.

## Permissions

Access is per project. Members have a permission level — read, write or admin — that governs whether
they can view files, edit them, or manage the project's members and plugins. Instance administrators
additionally manage users and the plugin registry.
