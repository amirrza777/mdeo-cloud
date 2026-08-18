import type { AstReflection } from "@mdeo/language-common";
import { PatternModifierKind } from "@mdeo/protocol-model-transformation";
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

/**
 * Returns the pattern a node belongs to, seeing through application condition blocks.
 *
 * @param node The node to start from.
 * @param reflection The AST reflection instance for type checks.
 * @returns The enclosing pattern, or `undefined` when the node is not inside one.
 */
export function findContainingPattern(node: AstNode, reflection: AstReflection): PatternType | undefined {
    let current: AstNode | undefined = node.$container;
    while (current != undefined) {
        if (reflection.isInstance(current, Pattern)) {
            return current as PatternType;
        }
        current = current.$container;
    }
    return undefined;
}

/**
 * Returns the application condition block a node is declared in.
 *
 * @param node The node to start from.
 * @param reflection The AST reflection instance for type checks.
 * @returns The block, or `undefined` when the node belongs to the match pattern itself.
 */
export function findContainingCondition(
    node: AstNode,
    reflection: AstReflection
): PatternApplicationConditionType | undefined {
    let current: AstNode | undefined = node.$container;
    while (current != undefined) {
        if (reflection.isInstance(current, PatternApplicationCondition)) {
            return current as PatternApplicationConditionType;
        }
        if (reflection.isInstance(current, Pattern)) {
            return undefined;
        }
        current = current.$container;
    }
    return undefined;
}

/**
 * Converts a modifier keyword to the corresponding {@link PatternModifierKind}.
 *
 * @param modifier The raw modifier keyword, if any.
 * @returns The matching kind, {@link PatternModifierKind.NONE} for an unknown or absent keyword.
 */
export function patternModifierKind(modifier: string | undefined): PatternModifierKind {
    switch (modifier) {
        case "create":
            return PatternModifierKind.CREATE;
        case "delete":
            return PatternModifierKind.DELETE;
        case "require":
            return PatternModifierKind.REQUIRE;
        case "forbid":
            return PatternModifierKind.FORBID;
        default:
            return PatternModifierKind.NONE;
    }
}

/**
 * Returns the modifier an element effectively carries.
 *
 * An element declared inside an application condition block carries the block's kind:
 * a block is what `forbid` / `require` element modifiers used to express, so everything
 * that reasons about modifiers - what a link may connect, whether a property may be
 * assigned - has to read the block that way.
 *
 * @param node The element, or a node declared inside one.
 * @param reflection The AST reflection instance for type checks.
 * @returns The effective modifier kind of the element.
 */
export function effectivePatternModifier(node: AstNode, reflection: AstReflection): PatternModifierKind {
    const condition = findContainingCondition(node, reflection);
    if (condition != undefined) {
        return patternModifierKind(condition.kind);
    }
    const modifier = (node as { modifier?: { modifier?: string } }).modifier?.modifier;
    return patternModifierKind(modifier);
}
