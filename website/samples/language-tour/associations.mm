// One example per association operator. A class only gets a property for an end that
// carries a name, and the star always sits on the side that owns (contains) the other one.

class Whole {
    id: string
}

class Part {
    id: string
}

// Plain association, navigable from source to target only.
Whole.partsA[*] --> Part

// Plain association, navigable from target to source only.
Whole <-- Part.wholeB

// Plain association, navigable in both directions.
Whole.partsC[*] <--> Part.wholeC

// Composition with the whole on the left, navigable in both directions.
Whole.partsD[*] *--> Part.wholeD

// Composition with the whole on the left, navigable from the part only.
Whole *-- Part.wholeE

// Composition with the whole on the right, navigable in both directions.
Part.wholeF <--* Whole.partsF[*]

// Composition with the whole on the right, navigable from the part only.
Part.wholeG --* Whole
