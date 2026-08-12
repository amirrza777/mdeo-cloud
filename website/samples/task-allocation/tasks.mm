// Domain of the task allocation problem: a project owns tasks and developers,
// and every task may be assigned to at most one developer.

enum Priority {
    LOW
    MEDIUM
    HIGH
}

class Project {
    name: string
}

abstract class WorkItem {
    name: string
    effort: int
}

class Task extends WorkItem {
    priority: Priority
}

class Developer {
    name: string
    capacity: int
}

Project.tasks[*] *--> Task.project
Project.developers[*] *--> Developer.project
Task.assignee[0..1] <--> Developer.tasks[*]
