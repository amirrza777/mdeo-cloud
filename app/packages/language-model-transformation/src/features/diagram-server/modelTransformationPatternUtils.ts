import type { AstReflection } from "@mdeo/language-common";
import type { AstNode } from "langium";
import {
    Pattern,
    MatchStatement,
    IfMatchConditionAndBlock,
    WhileMatchStatement,
    UntilMatchStatement,
    ForMatchStatement,
    PatternApplicationCondition,
    type PatternType,
    type MatchStatementType,
    type IfMatchConditionAndBlockType,
    type WhileMatchStatementType,
    type UntilMatchStatementType,
    type ForMatchStatementType,
    type PatternApplicationConditionType
} from "../../grammar/modelTransformationTypes.js";

/**
 * Extracts the {@link PatternType} from an AST node returned by
 * {@link GModelIndex.getAstNode} for a match node GModel element.
 *
 * Match node elements are created with different AST node IDs depending on the
 * statement type:
 * - `MatchStatement` — the element ID is the statement's own ID, so
 *   `getAstNode` returns the `MatchStatement` itself.  The pattern is accessed
 *   via `stmt.pattern`.
 * - `IfMatchStatement`, `WhileMatchStatement`, `UntilMatchStatement`,
 *   `ForMatchStatement` — the element ID is the inner `Pattern`'s ID, so
 *   `getAstNode` returns the `Pattern` directly.
 * - `IfMatchConditionAndBlock` — if ever returned directly (unlikely given
 *   current ID generation), its `.pattern` is used.
 *
 * @param astNode An AST node returned by {@link GModelIndex.getAstNode}
 * @param reflection The AST reflection instance for type checks
 * @returns The associated {@link PatternType}, or `undefined` if the node is
 *          not a pattern-bearing match node
 */
export function getPatternFromMatchNode(astNode: AstNode, reflection: AstReflection): PatternType | undefined {
    if (reflection.isInstance(astNode, Pattern)) {
        return astNode as PatternType;
    }

    if (reflection.isInstance(astNode, MatchStatement)) {
        return (astNode as MatchStatementType).pattern;
    }

    if (reflection.isInstance(astNode, IfMatchConditionAndBlock)) {
        return (astNode as IfMatchConditionAndBlockType).pattern;
    }

    if (reflection.isInstance(astNode, WhileMatchStatement)) {
        return (astNode as WhileMatchStatementType).pattern;
    }

    if (reflection.isInstance(astNode, UntilMatchStatement)) {
        return (astNode as UntilMatchStatementType).pattern;
    }

    if (reflection.isInstance(astNode, ForMatchStatement)) {
        return (astNode as ForMatchStatementType).pattern;
    }

    return undefined;
}

/**
 * A pattern element together with the application condition block it was declared in.
 */
export interface FlattenedPatternElement {
    /** The pattern element itself. */
    element: AstNode;
    /** The block the element belongs to, or `undefined` for elements of the match pattern. */
    condition?: PatternApplicationConditionType;
}

/**
 * Returns every element of a pattern together with the application condition block it
 * belongs to, so that block members are handled like the elements of the match pattern.
 *
 * Blocks are not drawn as containers: following Henshin, their members stay in the
 * match node and are tagged with `«forbid name»` / `«require name»` instead, which
 * keeps a condition legible next to the pattern it constrains. Everything that walks a
 * pattern for its diagram elements therefore has to see through the blocks.
 *
 * @param pattern The pattern whose elements should be listed.
 * @param reflection The AST reflection instance for type checks.
 * @returns The elements in declaration order, block members after the main pattern.
 */
export function flattenPatternElements(
    pattern: { elements?: unknown[] } | undefined,
    reflection: AstReflection
): FlattenedPatternElement[] {
    const result: FlattenedPatternElement[] = [];
    const conditions: FlattenedPatternElement[] = [];

    for (const element of pattern?.elements ?? []) {
        if (reflection.isInstance(element, PatternApplicationCondition)) {
            const condition = element as PatternApplicationConditionType;
            for (const member of condition.elements ?? []) {
                conditions.push({ element: member as AstNode, condition });
            }
        } else {
            result.push({ element: element as AstNode });
        }
    }

    return [...result, ...conditions];
}
