// Enumerations, abstract classes, inheritance, primitive types and multiplicities.

enum Colour {
    RED
    GREEN
    BLUE
}

abstract class Shape {
    name: string
    visible: boolean
    colour: Colour
    tags: string[*]
}

class Rectangle extends Shape {
    width: double
    height: double
}

class Circle extends Shape {
    radius: double
}

class Canvas {
    title: string
    revision: long
}

class Layer {
    index: int
}

class Annotation {
    text: string
}

// A canvas owns at least one layer; both ends are navigable.
Canvas.layers[1..*] *--> Layer.canvas

// A layer owns any number of shapes.
Layer.shapes[*] *--> Shape.layer

// Shapes and annotations reference each other.
Shape.annotations[*] <--> Annotation.shape
