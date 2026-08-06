// A metamodel can be split across files. `import` pulls in every class and enum of the
// imported file, including the ones it imports itself.
import "./shapes.mm"

class Sticker extends Shape {
    url: string
}

// An association end may only carry a property name for a class declared in this file,
// so the imported `Layer` stays unnamed here.
Sticker.placedOn --> Layer
