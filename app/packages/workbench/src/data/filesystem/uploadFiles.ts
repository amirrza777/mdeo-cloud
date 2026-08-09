import { VSBuffer } from "@codingame/monaco-vscode-api/vscode/vs/base/common/buffer";
import { Uri } from "vscode";
import type { Ref } from "vue";
import type { MonacoApi } from "@/lib/monacoPlugin";
import type { EditorTab } from "@/data/tab/editorTab";
import { showError, showSuccess, showWarning } from "@/lib/notifications";
import { getFileBaseName, getFileExtension } from "@/data/filesystem/util";
import type { ResolvedWorkbenchLanguagePlugin } from "@/data/plugin/plugin";

/**
 * Extensions that may be uploaded: every non-generated language plugin's, the
 * same set "Create New X" offers. Generated types (e.g. `.m_gen`) are derived
 * output, not something a user hand-authors, so they are excluded too.
 *
 * Shared by every upload entry point (the context menu action and drag and
 * drop, at the project root and per folder) so they can't drift apart.
 *
 * @param languagePlugins The workbench's registered language plugins
 * @returns Lowercased extensions, including the leading dot, that may be uploaded
 */
export function getUploadableExtensions(languagePlugins: ResolvedWorkbenchLanguagePlugin[]): Set<string> {
    return new Set(
        languagePlugins
            .filter((plugin) => !plugin.isGenerated && plugin.extension)
            .map((plugin) => plugin.extension!.toLowerCase())
    );
}

/**
 * Uploads dropped or picked files into a project folder, opening the last
 * successfully created file in a new tab.
 *
 * A file is only accepted if its extension (compared case-insensitively) is
 * in {@link uploadableExtensions}, built by {@link getUploadableExtensions}.
 *
 * @param files The files to upload
 * @param targetFolderUri The folder to create the files in
 * @param fileService Monaco's file service, used to create the files
 * @param tabs The current editor tabs
 * @param activeTab The currently active editor tab
 * @param uploadableExtensions Lowercased extensions (including the leading dot) that may be uploaded
 */
export async function uploadFiles(
    files: FileList | File[],
    targetFolderUri: Uri,
    fileService: MonacoApi["fileService"],
    tabs: Ref<EditorTab[]>,
    activeTab: Ref<EditorTab | undefined>,
    uploadableExtensions: Ref<Set<string>>
): Promise<void> {
    const fileArray = Array.from(files);
    const supportedFiles = fileArray.filter((file) =>
        uploadableExtensions.value.has(getFileExtension(file.name).toLowerCase())
    );
    const rejectedCount = fileArray.length - supportedFiles.length;

    if (rejectedCount > 0) {
        showWarning(rejectedCount === 1 ? "1 file was skipped" : `${rejectedCount} files were skipped`, {
            description: "Only files of a supported type can be uploaded here."
        });
    }

    let lastCreatedUri: Uri | undefined;
    const uploaded: string[] = [];

    for (const file of supportedFiles) {
        // file.name comes from outside the application, so it is reduced to
        // a base name before joining, rather than trusted as one path segment.
        const name = getFileBaseName(file.name);
        const uri = Uri.joinPath(targetFolderUri, name);
        try {
            const text = await file.text();
            await fileService.createFile(uri, VSBuffer.fromString(text));
            lastCreatedUri = uri;
            uploaded.push(name);
        } catch (error) {
            showError(`Failed to upload ${name}`, {
                description: error instanceof Error ? error.message : undefined
            });
        }
    }

    if (lastCreatedUri == undefined) {
        return;
    }

    if (uploaded.length < fileArray.length) {
        showSuccess(`Uploaded ${uploaded.length} of ${fileArray.length} files`);
    } else if (uploaded.length === 1) {
        showSuccess(`Uploaded ${uploaded[0]}`);
    } else {
        showSuccess(`Uploaded ${uploaded.length} files`);
    }

    const existingTab = tabs.value.find((tab) => tab.fileUri.toString() === lastCreatedUri!.toString());
    if (existingTab) {
        activeTab.value = existingTab;
        existingTab.temporary = false;
    } else {
        const newTab: EditorTab = { fileUri: lastCreatedUri, temporary: false };
        tabs.value.push(newTab);
        activeTab.value = newTab;
    }
}
