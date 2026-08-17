package com.mdeo.script.compiler

import com.mdeo.expression.ast.types.ClassTypeRef
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

/**
 * Regression tests for the scope levels the language server reports for nested lambdas.
 *
 * The `scope` of every identifier in a typed AST is the level of the scope that declares it,
 * counted by the language server. The language server gives a lambda one level for its
 * parameters and a second one for its body only when that body is a block, because an
 * expression body is not a scope of its own. The compiler has to build the same number of
 * scopes, otherwise the levels it assigns to declarations drift away from the levels the
 * identifiers were annotated with and lookups fail.
 *
 * Before the fix the compiler created a body scope for every lambda, so each lambda with an
 * expression body cost one level too many and a lambda nested inside it could not read its
 * own parameter:
 *
 * ```
 * java.lang.IllegalStateException: Variable 'inner' at scope level 5 is not accessible in
 *   lambda scope at level 6. All outer variables must be captured.
 * ```
 */
class LambdaExpressionBodyScopeLevelTest {

    private val helper = CompilerTestHelper()

    /**
     * ```
     * fun nested(): double {
     *     var numbers = listOf(1, 2)
     *     return numbers.map((outer) => listOf(10, 20).map((inner) => inner).sum()).sum()
     * }
     * ```
     *
     * Both lambdas have an expression body, so the language server declares `outer` at level 4
     * and `inner` at level 5 — the inner lambda's parameters sit directly inside the outer
     * lambda's parameter scope.
     */
    @Test
    fun `lambda nested in an expression-bodied lambda can read its own parameter`() {
        val ast = buildTypedAst {
            voidType() // 0
            stringType() // 1
            val doubleTypeIdx = doubleType() // 2
            booleanType() // 3
            anyNullableType() // 4

            val intTypeIdx = intType() // 5
            val listIntTypeIdx = addType(ClassTypeRef("builtin", "List", false, typeArgs = mapOf("T" to ClassTypeRef("builtin", "int", false)))) // 6
            val collectionIntTypeIdx = addType(ClassTypeRef("builtin", "Collection", false, typeArgs = mapOf("T" to ClassTypeRef("builtin", "int", false)))) // 7
            val collectionDoubleTypeIdx = addType(ClassTypeRef("builtin", "Collection", false, typeArgs = mapOf("T" to ClassTypeRef("builtin", "double", false)))) // 8

            // (inner: int) => int
            val innerLambdaTypeIdx = lambdaType(
                ClassTypeRef("builtin", "int", false),
                "param0" to ClassTypeRef("builtin", "int", false)
            ) // 9

            // (outer: int) => double
            val outerLambdaTypeIdx = lambdaType(
                ClassTypeRef("builtin", "double", false),
                "param0" to ClassTypeRef("builtin", "int", false)
            ) // 10

            // (inner) => inner
            val innerLambda = lambdaExpr(
                parameters = listOf("inner"),
                body = listOf(returnStmt(identifier("inner", intTypeIdx, 5))),
                lambdaTypeIndex = innerLambdaTypeIdx,
                hasBlockBody = false
            )

            // (outer) => listOf(10, 20).map((inner) => inner).sum()
            val outerLambda = lambdaExpr(
                parameters = listOf("outer"),
                body = listOf(
                    returnStmt(
                        memberCall(
                            expression = memberCall(
                                expression = functionCall(
                                    name = "listOf",
                                    overload = "",
                                    arguments = listOf(
                                        intLiteral(10, intTypeIdx),
                                        intLiteral(20, intTypeIdx)
                                    ),
                                    resultTypeIndex = listIntTypeIdx
                                ),
                                member = "map",
                                overload = "",
                                arguments = listOf(innerLambda),
                                resultTypeIndex = collectionIntTypeIdx
                            ),
                            member = "sum",
                            overload = "",
                            arguments = emptyList(),
                            resultTypeIndex = doubleTypeIdx
                        )
                    )
                ),
                lambdaTypeIndex = outerLambdaTypeIdx,
                hasBlockBody = false
            )

            function(
                name = "nested",
                returnType = doubleTypeIdx,
                body = listOf(
                    varDecl(
                        "numbers",
                        listIntTypeIdx,
                        functionCall(
                            name = "listOf",
                            overload = "",
                            arguments = listOf(intLiteral(1, intTypeIdx), intLiteral(2, intTypeIdx)),
                            resultTypeIndex = listIntTypeIdx
                        )
                    ),
                    returnStmt(
                        memberCall(
                            expression = memberCall(
                                expression = identifier("numbers", listIntTypeIdx, 3),
                                member = "map",
                                overload = "",
                                arguments = listOf(outerLambda),
                                resultTypeIndex = collectionDoubleTypeIdx
                            ),
                            member = "sum",
                            overload = "",
                            arguments = emptyList(),
                            resultTypeIndex = doubleTypeIdx
                        )
                    )
                )
            )
        }

        assertEquals(60.0, helper.compileAndInvoke(ast, "nested"))
    }

    /**
     * ```
     * fun nested(): double {
     *     var numbers = listOf(1, 2)
     *     return numbers.map((outer) => {
     *         var factor = 10
     *         return listOf(1, 2).map((inner) => inner * factor).sum()
     *     }).sum()
     * }
     * ```
     *
     * The outer lambda has a block body, which is a scope of its own: `outer` is declared at
     * level 4, `factor` at level 5 and `inner` at level 6. Capturing `factor` across the inner
     * lambda boundary has to keep working.
     */
    @Test
    fun `lambda nested in a block-bodied lambda captures a variable of that block`() {
        val ast = buildTypedAst {
            voidType() // 0
            stringType() // 1
            val doubleTypeIdx = doubleType() // 2
            booleanType() // 3
            anyNullableType() // 4

            val intTypeIdx = intType() // 5
            val listIntTypeIdx = addType(ClassTypeRef("builtin", "List", false, typeArgs = mapOf("T" to ClassTypeRef("builtin", "int", false)))) // 6
            val collectionIntTypeIdx = addType(ClassTypeRef("builtin", "Collection", false, typeArgs = mapOf("T" to ClassTypeRef("builtin", "int", false)))) // 7
            val collectionDoubleTypeIdx = addType(ClassTypeRef("builtin", "Collection", false, typeArgs = mapOf("T" to ClassTypeRef("builtin", "double", false)))) // 8

            val innerLambdaTypeIdx = lambdaType(
                ClassTypeRef("builtin", "int", false),
                "param0" to ClassTypeRef("builtin", "int", false)
            ) // 9

            val outerLambdaTypeIdx = lambdaType(
                ClassTypeRef("builtin", "double", false),
                "param0" to ClassTypeRef("builtin", "int", false)
            ) // 10

            // (inner) => inner * factor
            val innerLambda = lambdaExpr(
                parameters = listOf("inner"),
                body = listOf(
                    returnStmt(
                        binaryExpr(
                            left = identifier("inner", intTypeIdx, 6),
                            operator = "*",
                            right = identifier("factor", intTypeIdx, 5),
                            resultTypeIndex = intTypeIdx
                        )
                    )
                ),
                lambdaTypeIndex = innerLambdaTypeIdx,
                hasBlockBody = false
            )

            val outerLambda = lambdaExpr(
                parameters = listOf("outer"),
                body = listOf(
                    varDecl("factor", intTypeIdx, intLiteral(10, intTypeIdx)),
                    returnStmt(
                        memberCall(
                            expression = memberCall(
                                expression = functionCall(
                                    name = "listOf",
                                    overload = "",
                                    arguments = listOf(
                                        intLiteral(1, intTypeIdx),
                                        intLiteral(2, intTypeIdx)
                                    ),
                                    resultTypeIndex = listIntTypeIdx
                                ),
                                member = "map",
                                overload = "",
                                arguments = listOf(innerLambda),
                                resultTypeIndex = collectionIntTypeIdx
                            ),
                            member = "sum",
                            overload = "",
                            arguments = emptyList(),
                            resultTypeIndex = doubleTypeIdx
                        )
                    )
                ),
                lambdaTypeIndex = outerLambdaTypeIdx,
                hasBlockBody = true
            )

            function(
                name = "nested",
                returnType = doubleTypeIdx,
                body = listOf(
                    varDecl(
                        "numbers",
                        listIntTypeIdx,
                        functionCall(
                            name = "listOf",
                            overload = "",
                            arguments = listOf(intLiteral(1, intTypeIdx), intLiteral(2, intTypeIdx)),
                            resultTypeIndex = listIntTypeIdx
                        )
                    ),
                    returnStmt(
                        memberCall(
                            expression = memberCall(
                                expression = identifier("numbers", listIntTypeIdx, 3),
                                member = "map",
                                overload = "",
                                arguments = listOf(outerLambda),
                                resultTypeIndex = collectionDoubleTypeIdx
                            ),
                            member = "sum",
                            overload = "",
                            arguments = emptyList(),
                            resultTypeIndex = doubleTypeIdx
                        )
                    )
                )
            )
        }

        assertEquals(60.0, helper.compileAndInvoke(ast, "nested"))
    }
}
