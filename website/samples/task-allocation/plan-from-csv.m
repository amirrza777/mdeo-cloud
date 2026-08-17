// The same plan as plan.m, taken from CSV files instead of written out by hand.
//
// developers.csv has headers that already match Developer's properties, so it
// needs no mapping. tasks.csv comes from a spreadsheet and does not, so the
// columns are named explicitly — including "Estimated effort", which Task
// inherits from WorkItem, and "Assigned to", which is an association end and so
// becomes a link rather than a value.

using "./tasks.mm"

import CSV {
    Developer from "./developers.csv"
    Task from "./tasks.csv" {
        "Task name" = name
        "Estimated effort" = effort
        "Priority" = priority
        "Assigned to" = assignee
    }
}
