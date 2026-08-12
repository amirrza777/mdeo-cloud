# What is MDEO Cloud?

MDEO Cloud is a web-based platform for **model-driven engineering optimisation**: you describe a
design space as a metamodel, a starting model and a set of model transformations, state what makes
one design better than another, and let a search algorithm explore the space for you.

It is a fork of [MDEOptimiser](https://github.com/mde-optimiser/mde_optimiser) that replaces the
Eclipse-based tooling with a browser workbench and a distributed execution platform.

## The problem it solves

Many engineering problems are really search problems over structured artefacts:

- Which components should each class of a system own, so that cohesion is high and coupling is low?
- How should tasks be spread across a team without overloading anyone?
- Which set of features fits into the next release, given a budget and a dependency graph?

All of these have the same shape. There is a **structure** (a model), a set of **legal edits** to that
structure, and one or more **numeric criteria** that say how good a structure is. MDEO Cloud lets you
write down exactly those three things and hands the rest — mutation, evaluation, multi-objective
search, parallel execution — to the platform.

## What you write

A complete optimisation problem is five kinds of file, each with its own language, editor and
validation:

| File | Language | Purpose |
| --- | --- | --- |
| `.mm` | [Metamodel](/plugins/metamodel) | The structure of your domain: classes, properties, associations |
| `.m` | [Model](/plugins/model) | A concrete instance to start the search from |
| `.mt` | [Model Transformation](/plugins/model-transformation) | The legal edits — the moves the search may make |
| `.fn` | [Script](/plugins/script) | Objectives and constraints, as ordinary functions over the model |
| `.config` | [Config](/plugins/config) | Which files to use, what to optimise, and how to search |

Here is what that looks like end to end. First the domain:

<<< @/../samples/task-allocation/tasks.mm{mm}

A starting point:

<<< @/../samples/task-allocation/plan.m{mdeo-model}

The moves the search is allowed to make:

<<< @/../samples/task-allocation/assign.mt{mt}

What "better" means:

<<< @/../samples/task-allocation/objectives.fn{fn}

And finally, how to run it:

<<< @/../samples/task-allocation/optimize.config{mdeo-config}

The [walkthrough](/guide/walkthrough) builds this example up step by step and runs it.

## What makes it different

**Everything runs in the browser.** Metamodels and models have graphical editors as well as textual
ones, and both views edit the same file. Language support — completion, validation, formatting,
go-to-definition — comes from Langium language servers that run in a web worker, so editing stays
responsive without a round trip to a server.

**Search runs somewhere else.** An optimisation run is dispatched to dedicated execution nodes. A
single run can be spread across several nodes and many threads, and the workbench streams progress
back over a WebSocket while you keep working.

**Every language is a plugin.** The five languages above are not built into the workbench. Each one
is served by a plugin — an HTTP service that publishes a manifest describing the languages, editors
and language extensions it provides. The workbench discovers plugins at runtime and loads their code
as ES modules. Adding a sixth language means writing a plugin, not patching the workbench.

That last point is the reason this platform exists as a *platform*: see
[the plugin catalogue](/plugins/) for what ships with it, and
[the developer guide](/develop/) for how to add your own.

## Where to go next

- [Core concepts](/guide/concepts) — the vocabulary used throughout these docs
- [Architecture](/guide/architecture) — how the pieces fit together
- [Getting started](/guide/getting-started) — run MDEO Cloud locally
- [Walkthrough](/guide/walkthrough) — build and run a complete optimisation
