# Config plugin

The host language for configuration files. On its own it has **no syntax at all** — a `.config` file
is a sequence of sections, and every section comes from a contribution plugin.

That makes this plugin the clearest demonstration of the extension model: it defines the shape of an
extension point and nothing else.

## At a glance

| | |
| --- | --- |
| **Plugin id** | `config-service` |
| **Display name** | Config |
| **Description** | Language support for configuration files (`.config`) |
| **Default URL** | `/plugin/config` |
| **Source** | `app/packages/service-config`, `app/packages/language-config` |
| **Depends on** | Nothing directly, but it is useless without plugins contributing sections |

## Languages contributed

| Language id | Name | Extension | Textual editor | Graphical editor | Generated |
| --- | --- | --- | --- | --- | --- |
| `config` | Config | `.config` | ✅ | ❌ | ❌ |

### The config language

The complete grammar of the config language without contributions is: *zero or more sections*. With
the two bundled contribution plugins enabled, a config file looks like this:

<<< @/../samples/language-tour/full.config{mdeo-config}

Each block is provided by a plugin:

| Section | Contributed by |
| --- | --- |
| `problem`, `goal` | [Config Optimization](/plugins/config-optimization) |
| `search`, `solver`, `runtime` | [Config MDEO](/plugins/config-mdeo) |

#### Qualified section names

Every section can also be written as `<section>.<plugin>`:

<<< @/../samples/language-tour/qualified.config{mdeo-config}

The qualified form is always accepted. It becomes **required** when two enabled plugins contribute a
section with the same name — in that case the plain name is ambiguous and is not part of the grammar
at all.

#### Running a config file

A contribution plugin can mark a section as *executable*. When a config file contains such a section,
the file gets a run action. The `solver` section of Config MDEO is the one executable section in the
bundled set, which is why running a `.config` file starts an optimisation.

The config plugin does not know what running means. It looks up which contribution plugin owns the
executable section, forwards the execution to that plugin's language service, and afterwards relays
follow-up requests — summary, file tree, file contents, cancel, delete — to the same place.

## Contribution plugins contributed

None. Config is the language that *receives* contributions.

### The extension point it defines

A config contribution plugin hands the config language:

| Field | Meaning |
| --- | --- |
| `id` | Unique id, used for dependency resolution |
| `name` | Short name used in qualified section names |
| `languageKey` | The language id whose service handles requests for this plugin |
| `grammar` | A serialised grammar containing the rules for all its sections |
| `sections` | The sections it contributes: name, rule, AST interface, and whether it is executable |
| `dependencies` | Plugin ids whose exported types this grammar needs |
| `exportedTypes` | Types this plugin makes available to plugins that depend on it |
| `sectionDependencies` | Sections whose computed data must be available before this plugin's handler runs |

At startup the config language sorts the active contribution plugins topologically by `dependencies`,
deserialises each grammar in a context containing the types exported by its dependencies, wraps every
section in a rule that prefixes it with its keyword, and assembles them into a single root rule.

The result is a grammar that exists only for the plugin set of one project. Change the project's
plugins and the `.config` language changes with it.

See [Config contributions](/develop/config-contributions) for how to write one, and
[Contribution plugins](/develop/contribution-plugins) for the general mechanism.

## Server-side capabilities

| File data key | Contents |
| --- | --- |
| `config` | The merged section data, assembled from every contribution plugin's own computation |

Computing that data is a two-level process. The config service splits the file into the sections of
each plugin, sends each fragment to the plugin that owns it as a `config` request, and merges the
answers — respecting `sectionDependencies`, so a plugin that needs the `problem` section receives its
computed data alongside its own text.
