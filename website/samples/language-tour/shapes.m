using "./shapes.mm"

board : Canvas {
    title = "Poster"
    revision = 3
}

background : Layer {
    index = 0
}

foreground : Layer {
    index = 1
}

frame : Rectangle {
    name = "Frame"
    visible = true
    colour = Colour.BLUE
    tags = ["decoration", "border"]
    width = 210.0
    height = 297.0
}

dot : Circle {
    name = "Dot"
    visible = false
    colour = Colour.RED
    tags = []
    radius = 2.5
}

note : Annotation {
    text = "Keep the frame aligned with the page."
}

board.layers -- background
board.layers -- foreground
background.shapes -- frame
foreground.shapes -- dot
frame.annotations -- note
