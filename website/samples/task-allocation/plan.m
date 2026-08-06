using "./tasks.mm"

apollo : Project {
    name = "Apollo"
}

login : Task {
    name = "Login screen"
    effort = 5
    priority = Priority.HIGH
}

reporting : Task {
    name = "Reporting dashboard"
    effort = 8
    priority = Priority.MEDIUM
}

migration : Task {
    name = "Database migration"
    effort = 13
    priority = Priority.LOW
}

alice : Developer {
    name = "Alice"
    capacity = 10
}

bob : Developer {
    name = "Bob"
    capacity = 15
}

apollo.tasks -- login
apollo.tasks -- reporting
apollo.tasks -- migration
apollo.developers -- alice
apollo.developers -- bob
