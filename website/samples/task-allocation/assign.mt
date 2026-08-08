using "./tasks.mm"

// Give an unassigned task to some developer.
match {
    task: Task {
        effort > 0
    }
    developer: Developer { }
    create task.assignee -- developer
}
