using "./tasks.mm"

// Take a task away from the developer it is currently assigned to.
match {
    task: Task { }
    developer: Developer { }
    delete task.assignee -- developer
}
