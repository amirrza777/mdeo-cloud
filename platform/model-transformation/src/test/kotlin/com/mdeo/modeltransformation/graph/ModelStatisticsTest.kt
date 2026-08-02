package com.mdeo.modeltransformation.graph

import org.apache.tinkerpop.gremlin.structure.T
import org.apache.tinkerpop.gremlin.tinkergraph.structure.TinkerGraph
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

/**
 * Tests for the cardinality snapshot that feeds the cost-based match planner.
 */
class ModelStatisticsTest {

    private fun sampleGraph(): TinkerGraph {
        val graph = TinkerGraph.open()
        val room1 = graph.addVertex(T.label, "Room")
        val room2 = graph.addVertex(T.label, "Room")
        val shift = graph.addVertex(T.label, "Shift")
        room1.addEdge("`shifts`_`room`", shift)
        room2.addEdge("`shifts`_`room`", shift)
        room1.addEdge("`neighbour`_`neighbour`", room2)
        return graph
    }

    @Test
    fun `snapshot counts vertices and edges per label`() {
        sampleGraph().use { graph ->
            val statistics = ModelStatistics.snapshotOf(graph)

            assertEquals(3, statistics.vertexCount)
            assertEquals(3, statistics.edgeCount)
            assertEquals(2, statistics.verticesWithLabel("Room"))
            assertEquals(1, statistics.verticesWithLabel("Shift"))
            assertEquals(2, statistics.edgesWithLabel("`shifts`_`room`"))
            assertEquals(1, statistics.edgesWithLabel("`neighbour`_`neighbour`"))
        }
    }

    @Test
    fun `unknown labels report zero rather than failing`() {
        sampleGraph().use { graph ->
            val statistics = ModelStatistics.snapshotOf(graph)

            assertEquals(0, statistics.verticesWithLabel("Nurse"))
            assertEquals(0, statistics.edgesWithLabel("`nurse`_`shift`"))
        }
    }

    @Test
    fun `empty statistics report zero everywhere`() {
        assertEquals(0, ModelStatistics.EMPTY.vertexCount)
        assertEquals(0, ModelStatistics.EMPTY.edgeCount)
        assertEquals(0, ModelStatistics.EMPTY.verticesWithLabel("Room"))
    }

    @Test
    fun `cache reuses the snapshot while the vertex count is unchanged`() {
        sampleGraph().use { graph ->
            var recomputes = 0
            val cache = GraphStatisticsCache({ recomputes++; graph }, { graph.verticesCount })

            val first = cache.get()
            val second = cache.get()

            assertEquals(1, recomputes, "an unchanged graph must not be re-measured")
            assertEquals(first, second)
        }
    }

    @Test
    fun `cache refreshes after a vertex is added`() {
        sampleGraph().use { graph ->
            val cache = GraphStatisticsCache({ graph }, { graph.verticesCount })
            assertEquals(2, cache.get().verticesWithLabel("Room"))

            graph.addVertex(T.label, "Room")

            assertEquals(3, cache.get().verticesWithLabel("Room"))
            assertEquals(4, cache.get().vertexCount)
        }
    }
}
