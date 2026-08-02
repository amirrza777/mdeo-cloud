import type { LangiumDocument, LangiumDocuments, URI } from "langium";
import { sharedImport } from "../sharedImport.js";

const { UriUtils } = sharedImport("langium");

/**
 * Resolves a relative file path based on the current document's URI.
 *
 * @param document The current Langium document
 * @param file The relative file path to resolve
 * @returns The resolved absolute URI of the file
 */
export function resolveRelativePath(document: LangiumDocument, file: string): URI {
    const currentUri = document.uri;
    const dirname = UriUtils.dirname(currentUri);
    return UriUtils.joinPath(dirname, file);
}

/**
 * Reports whether a relative path climbs above the project root.
 *
 * `UriUtils.joinPath` clamps `..` at the root rather than failing, so `../foo.mm` written next
 * to a file that already sits in the project root silently resolves to `foo.mm` in that same
 * root. The wrong path then behaves exactly like the right one, which is why such a typo could
 * go unreported. Callers use this to reject the path instead.
 *
 * @param document The current Langium document
 * @param file The relative file path to check
 * @returns True if resolving the path would leave the project
 */
export function climbsAboveProjectRoot(document: LangiumDocument, file: string): boolean {
    const dirname = UriUtils.dirname(document.uri);
    let depth = dirname.path.split("/").filter((segment) => segment.length > 0).length;

    for (const segment of file.split("/")) {
        if (segment === "" || segment === ".") {
            continue;
        }
        if (segment === "..") {
            depth--;
            if (depth < 0) {
                return true;
            }
        } else {
            depth++;
        }
    }

    return false;
}

/**
 * Resolves and loads a document from a relative path.
 *
 * @param fromDocument The source document from which the relative path is resolved
 * @param relativePath The relative file path to resolve
 * @param documents The Langium document registry
 * @returns The resolved Langium document, or undefined if not found
 */
export function resolveRelativeDocument(
    fromDocument: LangiumDocument,
    relativePath: string | undefined,
    documents: LangiumDocuments
): LangiumDocument | undefined {
    if (relativePath == undefined || relativePath.trim() === "") {
        return undefined;
    }

    if (climbsAboveProjectRoot(fromDocument, relativePath)) {
        return undefined;
    }

    const uri = resolveRelativePath(fromDocument, relativePath);
    return documents.getDocument(uri);
}
