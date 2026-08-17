import type { AstNode, ValidationAcceptor, ValidationRegistry } from "langium";
import { sharedImport } from "../sharedImport.js";

const { Cancellation } = sharedImport("langium");

/**
 * Runs a contribution plugin's own validation checks against a node it
 * contributed to a host language's document, and against every descendant.
 *
 * A contribution plugin's grammar is merged into its host language, so its
 * nodes end up in the host's documents — which are validated by the *host's*
 * registry, where the plugin's checks are not registered. Rather than teaching
 * the host about them, the host finds the contributing plugin's services (see
 * `getServicesByLanguageId`) and hands the subtree here, so the plugin
 * validates its own syntax with its own checks.
 *
 * Used by both languages that accept contributions: config for its sections,
 * model for its data imports.
 *
 * @param node The root of the contributed subtree
 * @param registry The contributing plugin's own ValidationRegistry
 * @param accept The host document's validation acceptor
 */
export function runContributedValidations(
    node: AstNode,
    registry: ValidationRegistry,
    accept: ValidationAcceptor
): void {
    for (const check of registry.getChecks(node.$type)) {
        void check(node, accept, Cancellation.CancellationToken.None);
    }

    for (const child of contributedChildren(node)) {
        runContributedValidations(child, registry, accept);
    }
}

/**
 * Returns the direct AST children of a node by iterating all array and object
 * properties, skipping Langium's own `$`-prefixed bookkeeping.
 *
 * @param node The AST node to get children for
 * @returns The direct child AST nodes
 */
function contributedChildren(node: AstNode): AstNode[] {
    const children: AstNode[] = [];
    for (const key of Object.keys(node)) {
        if (key.startsWith("$")) {
            continue;
        }
        const value = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item != null && typeof item === "object" && "$type" in item) {
                    children.push(item as AstNode);
                }
            }
        } else if (value != null && typeof value === "object" && "$type" in value) {
            children.push(value as AstNode);
        }
    }
    return children;
}
