# Optimising a task allocation

This walkthrough builds a complete optimisation problem from nothing. The problem: a project has a
set of tasks with an effort estimate, and a set of developers with a capacity. Assign tasks to
developers so that as little work as possible stays unassigned and nobody is badly overloaded — while
never leaving a high-priority task unassigned.

Every file below lives in `website/samples/task-allocation` in the repository and is parsed and
validated on every documentation build, so you can copy them verbatim.

Create a project with all default plugins enabled and follow along.

## 1. Describe the domain

Start with a metamodel. It names the classes, their properties, and how they relate.

<<< @/../samples/task-allocation/tasks.mm{mm}

Three things worth noticing:

- `abstract class WorkItem` cannot be instantiated; `Task` inherits its `name` and `effort`.
- `Project.tasks[*] *--> Task.project` is a **composition**: the project owns its tasks, and the
  association is navigable in both directions, so `Task` gets a `project` property too.
- `Task.assignee[0..1] <--> Developer.tasks[*]` is the association the search will manipulate. A task
  has at most one assignee; a developer has any number of tasks.

Open the diagram view to check the shape of the metamodel — for anything larger than this it is much
easier to read than the text.

## 2. Provide a starting point

A model instantiates the metamodel. This one is the situation before any assignment has been made.

<<< @/../samples/task-allocation/plan.m{mdeo-model}

`using "./tasks.mm"` binds the model to its metamodel; from that point on, completion offers the
classes and properties defined there. Objects are `name : Class { ... }`, and links between them are
written with `--`, naming the property on the side you are navigating from.

Note that no task has an assignee yet. That is deliberate: the search will add them.

## 3. Define the legal moves

A model transformation matches a fragment of the model and rewrites it. During a search each
transformation is a mutation operator, applied to random matches.

The first one assigns a task to a developer:

<<< @/../samples/task-allocation/assign.mt{mt}

The second takes an assignment away again:

<<< @/../samples/task-allocation/unassign.mt{mt}

Together these two moves are enough to reach any assignment from any other, which is what a search
needs.

Inside a `match` block, an element written plainly has to exist. `create` adds an object or a link,
`delete` removes one, and a property written with a comparison operator (`effort > 0`) constrains the
match rather than changing anything.

## 4. Say what "better" means

Objectives and constraints are ordinary functions over the model. They take no parameters and return
a number; the model is reached through the generated `all()` accessor on each class.

<<< @/../samples/task-allocation/objectives.fn{fn}

- `unassignedEffort` and `maxOverload` are the two objectives. Both are minimised, and they pull in
  opposite directions — assigning more work reduces the first and tends to increase the second. That
  tension is exactly what makes this a multi-objective problem.
- `unassignedHighPriority` is a constraint. It returns `0` when the constraint holds; any larger value
  is how badly it is violated.

## 5. Wire it together

The config file names the files, the goals and the search parameters. Each block comes from a
different plugin, which is why the [Config](/plugins/config) language on its own has no syntax at all.

<<< @/../samples/task-allocation/optimize.config{mdeo-config}

Section by section:

- **`problem`** — the metamodel and the starting model. Contributed by
  [Config Optimization](/plugins/config-optimization).
- **`goal`** — imports the objective functions and states which to minimise, maximise, or treat as a
  constraint. Same plugin.
- **`search`** — the mutation operators. Contributed by [Config MDEO](/plugins/config-mdeo).
- **`solver`** — the algorithm and its parameters. NSGA-II with a population of 40, mutation-only
  variation, stopping after 500 generations. Same plugin.
- **`runtime`** — per-call timeouts and how many threads the run may use. Same plugin.

## 6. Run it

The `solver` section is marked executable, so the config file gets a run action. Trigger it and the
run appears in the **Executions** panel, streaming progress while it works.

What happens next: the backend hands the execution to the config plugin, which routes it to the
Config MDEO plugin, which forwards it to `optimizer-execution`. There the search creates a population
of models, mutates each one by applying `assign.mt` and `unassign.mt` at random matches, scores every
candidate with your two objective functions, checks the constraint, and keeps the best trade-offs.

## 7. Look at the answer

You do not get one solution but a Pareto front — see [Reading the results](/guide/results).

## Things to try next

- Add `batches = 3` to the `solver` section to run the same configuration three times independently
  and see how stable the front is.
- Swap `algorithm = NSGAII` for `SPEA2` or `IBEA` and compare.
- Add a third objective, for instance the number of developers used, and watch the front grow.
- Add a `refine` entry to the `goal` section to tighten a multiplicity for the search only.
