package com.mdeo.script.ast.expressions

import com.mdeo.expression.ast.expressions.TypedExpression
import com.mdeo.expression.ast.TypedCallableBody
import kotlinx.serialization.Serializable

/**
 * Lambda expression in the script language.
 *
 * Lambda expressions allow defining anonymous functions that can be passed
 * to higher-order functions such as collection operations (filter, map, etc.).
 *
 * @param kind Always "lambda" for this expression type.
 * @param evalType Index into the types array for the type this expression evaluates to.
 *                 This will be a function type representing the lambda's signature.
 * @param parameters Names of the lambda parameters. The types are encoded in evalType.
 * @param body Body of the lambda containing the statements to execute.
 * @param hasBlockBody Whether [body] is the lambda's own block. False when the lambda was written
 *                     with an expression body and [body] only wraps that expression in a synthetic
 *                     return statement.
 *
 *                     The identifier scope levels in a typed AST are the ones the language server
 *                     assigned, and it counts a block body as a scope of its own while an expression
 *                     body is none. The compiler builds its scope tree from this AST, so it needs to
 *                     know which of the two it is looking at to arrive at the same levels.
 */
@Serializable
data class TypedLambdaExpression(
    override val kind: String = "lambda",
    override val evalType: Int,
    val parameters: List<String>,
    val body: TypedCallableBody,
    val hasBlockBody: Boolean = true
) : TypedExpression
