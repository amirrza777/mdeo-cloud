import type { InjectionKey, Ref } from "vue";
import { type FileSystemNode, type Folder } from "@/data/filesystem/file";
import type { ResolvedWorkbenchLanguagePlugin } from "@/data/plugin/plugin";
import { FileType } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";

/**
 * Sorts an array of FileSystemNode objects such that folders appear before files,
 * and both folders and files are sorted alphabetically by their name.
 *
 * @param nodes Array of FileSystemNode objects to sort
 * @returns An object containing two arrays: one for sorted folders and one for sorted files
 */
export function sortFileSystemNodes(nodes: FileSystemNode[]): { folders: FileSystemNode[]; files: FileSystemNode[] } {
    const folders = nodes
        .filter((node) => node.type === FileType.Directory)
        .sort((a, b) => a.name.localeCompare(b.name));
    const files = nodes.filter((node) => node.type === FileType.File).sort((a, b) => a.name.localeCompare(b.name));
    return { folders, files };
}

/**
 * State of the inline editor for a file system item which is currently being created.
 * At most one item can be created at a time, therefore this state is shared across the whole file tree.
 */
export interface NewFileSystemItemState {
    /**
     * Whether a file or a folder is being created
     */
    type: "file" | "folder";
    /**
     * The folder in which the new item is created
     */
    parent: Folder;
    /**
     * The type of the new file, only present if type is "file"
     */
    fileType?: ResolvedWorkbenchLanguagePlugin;
}

/**
 * Injection key providing the shared {@link NewFileSystemItemState} of the file tree
 */
export const newFileSystemItemStateKey = Symbol("newFileSystemItemState") as InjectionKey<
    Ref<NewFileSystemItemState | undefined>
>;
