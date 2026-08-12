using "./shapes.mm"

// `if match ... then ... else ...` applies a rewrite only when the pattern is found.
// Objects bound by the condition stay in scope inside the `then` block, where they are
// referenced by name instead of being matched again.
if match {
    small: Circle {
        radius < 1.0
    }
} then {
    match {
        small {
            radius = 1.0
        }
    }
} else {
    match {
        canvas: Canvas { }
        create spare: Layer {
            index = 99
        }
        create canvas.layers -- spare
    }
}

// `for match ... do ...` runs the body once per match instead of once in total.
for match {
    rectangle: Rectangle { }
} do {
    if (rectangle.width > rectangle.height) {
        match {
            rectangle {
                visible = true
            }
        }
    } else {
        match {
            rectangle {
                visible = false
            }
        }
    }
}

// `while match ... do ...` repeats as long as the pattern still matches, and
// `until match ... do ...` repeats until it matches for the first time.
while match {
    blank: Annotation {
        text == ""
    }
} do {
    match {
        delete blank
    }
}

until match {
    marker: Layer {
        index == 99
    }
} do {
    match {
        target: Canvas { }
        create extra: Layer {
            index = 99
        }
        create target.layers -- extra
    }
}

// `stop` ends the transformation successfully, `kill` aborts it and discards the result.
if match {
    overfull: Canvas {
        revision > 100
    }
} then {
    match {
        overfull {
            revision = 100
        }
    }
    stop
} else {
    match {
        broken: Canvas {
            revision < 0
        }
    }
    kill
}
