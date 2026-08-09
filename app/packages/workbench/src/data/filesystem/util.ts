import { FileType } from "vscode";
import type { FileSystemNode } from "./file";

/**
 * Traverses the file tree to find a file node by its path
 *
 * @param root Root of the file tree
 * @param targetPath Path within the tree (e.g., "/folder/file.txt")
 * @returns The found file node or undefined if not found
 */
export function findFileInTree(root: FileSystemNode, targetPath: string): FileSystemNode | undefined {
    const segments = targetPath.split("/").filter((s) => s.length > 0);

    if (segments.length === 0) {
        return root;
    }

    let current: FileSystemNode = root;

    for (const segment of segments) {
        if (current.type !== FileType.Directory) {
            return undefined;
        }

        const child: FileSystemNode | undefined = current.children.find((c) => c.name === segment);
        if (child == undefined) {
            return undefined;
        }

        current = child;
    }

    return current;
}

/**
 * Gets the file extension from a file path
 *
 * @param filePath The file path
 * @returns The file extension including the dot (e.g., ".txt"), or an empty string if none
 */
export function getFileExtension(filePath: string): string {
    const fileName = filePath.split("/").pop() || "";
    const lastDotIndex = fileName.lastIndexOf(".");
    return lastDotIndex > 0 ? fileName.substring(lastDotIndex) : "";
}

/**
 * Reduces a name to its final path segment, stripping both `/` and `\`.
 *
 * A `File`'s `name` is meant to be a bare file name, but nothing enforces
 * that: it comes from outside the application (an OS file picker or drag and
 * drop), so a crafted or unusual one could contain path separators. Used
 * before joining a `File`'s name onto a target URI, so an upload can only
 * ever land directly inside the folder it was dropped on.
 *
 * @param name The name to reduce to a base name
 * @returns The final path segment, with both separators considered
 */
export function getFileBaseName(name: string): string {
    const segments = name.split(/[/\\]/);
    return segments[segments.length - 1] ?? name;
}
