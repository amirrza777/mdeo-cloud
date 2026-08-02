import { Uri } from "vscode";
import type { IFileService } from "@codingame/monaco-vscode-api";
import type { CancellationToken } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
import type { IDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { FileChangesEvent } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import {
    DEFAULT_MAX_SEARCH_RESULTS,
    pathIncludedInQuery,
    SearchCompletionExitCode,
    type IFileMatch,
    type IFileQuery,
    type ISearchComplete,
    type ISearchProgressItem,
    type ISearchResultProvider,
    type ITextQuery
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";
import { fuzzyContains } from "@codingame/monaco-vscode-api/vscode/vs/base/common/strings";
import {
    MAX_INDEXED_FILE_SIZE,
    type IndexedFileData,
    type SearchWorkerRequest,
    type SearchWorkerResponse,
    type WorkerFileResult,
    type WorkerSearchQuery
} from "./searchTypes";

/**
 * Number of files read in parallel while building the index.
 */
const INDEX_CHUNK_SIZE = 64;

/**
 * Time in milliseconds after which a search that never reports back is considered stuck.
 * A pathological regular expression can block the worker, in which case it is replaced.
 */
const SEARCH_TIMEOUT = 15000;

/**
 * The callbacks of a search that is currently running in the worker.
 */
interface RunningSearch {
    /**
     * Invoked for every batch of results the worker reports
     *
     * @param files the files the batch contains results for
     */
    onResults(files: WorkerFileResult[]): void;

    /**
     * Invoked once when the search completed
     *
     * @param limitHit whether the search stopped early because too many matches were found
     */
    onDone(limitHit: boolean): void;

    /**
     * Invoked when the search failed, for example because the pattern is not a valid regex
     *
     * @param message the message describing the failure
     */
    onError(message: string): void;
}

/**
 * Search provider for the workbench file system, registered with the vscode search service.
 *
 * The content of the workspace is held by a dedicated worker, so that neither reading the files
 * nor matching them blocks the main thread. Matching itself is done by the same code vscode uses
 * for its own in browser search, the worker only adds the index, batching and cancellation.
 */
export class ProjectSearchProvider implements ISearchResultProvider {
    /**
     * The worker holding the index, created on first use
     */
    private worker: Worker | undefined;

    /**
     * The id used for the next search
     */
    private nextSearchId = 1;

    /**
     * The searches that are still running, keyed by search id
     */
    private readonly runningSearches = new Map<number, RunningSearch>();

    /**
     * The timeouts guarding the running searches, keyed by search id
     */
    private readonly searchTimeouts = new Map<number, ReturnType<typeof setTimeout>>();

    /**
     * The folders the index has been built for, as their string representation
     */
    private indexedFolders: string[] = [];

    /**
     * The files that are currently indexed, keyed by their path
     */
    private indexedFiles = new Map<string, Uri>();

    /**
     * Counter identifying the current index, used to abandon outdated builds
     */
    private indexGeneration = 0;

    /**
     * The build of the current index
     */
    private indexPromise: Promise<void> | undefined;

    /**
     * The index updates that are still in flight
     */
    private readonly pendingUpdates = new Set<Promise<void>>();

    /**
     * Creates a new search provider
     *
     * @param fileService the file service used to read the files of the workspace
     */
    constructor(private readonly fileService: IFileService) {
        this.fileService.onDidFilesChange((event) => {
            this.handleFilesChanged(event);
        });
    }

    async getAIName(): Promise<string | undefined> {
        return undefined;
    }

    async textSearch(
        query: ITextQuery,
        onProgress?: (progress: ISearchProgressItem) => void,
        token?: CancellationToken
    ): Promise<ISearchComplete> {
        await this.ensureIndex(query.folderQueries.map((folderQuery) => folderQuery.folder));

        const paths = this.getSearchedPaths(query);
        const results: IFileMatch[] = [];

        const limitHit = await new Promise<boolean>((resolve, reject) => {
            const search = this.startSearch(
                {
                    contentPattern: query.contentPattern,
                    previewOptions: query.previewOptions,
                    surroundingContext: query.surroundingContext,
                    maxResults: query.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS,
                    paths
                },
                {
                    onResults: (files) => {
                        for (const file of files) {
                            const match: IFileMatch = {
                                resource: this.indexedFiles.get(file.path) ?? Uri.file(file.path),
                                results: file.results
                            };
                            results.push(match);
                            onProgress?.(match);
                        }
                    },
                    onDone: resolve,
                    onError: (message) => reject(new Error(message))
                }
            );

            token?.onCancellationRequested(() => {
                search.cancel();
                resolve(false);
            });
        });

        return {
            results,
            limitHit,
            messages: [],
            stats: { type: "textSearchProvider" },
            exit: SearchCompletionExitCode.Normal
        };
    }

    async fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete> {
        await this.ensureIndex(query.folderQueries.map((folderQuery) => folderQuery.folder));

        const maxResults = query.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS;
        const filePattern = query.filePattern ?? "";
        const results: IFileMatch[] = [];
        let limitHit = false;

        for (const [path, resource] of this.indexedFiles) {
            if (token?.isCancellationRequested) {
                break;
            }
            if (!pathIncludedInQuery(query, resource.fsPath)) {
                continue;
            }
            if (filePattern !== "" && !fuzzyContains(path, filePattern)) {
                continue;
            }
            if (results.length >= maxResults) {
                limitHit = true;
                break;
            }
            results.push({ resource, results: [] });
        }

        return {
            results,
            limitHit,
            messages: [],
            stats: {
                type: "fileSearchProvider",
                fromCache: true,
                detailStats: { providerTime: 0, postProcessTime: 0 },
                resultCount: results.length
            },
            exit: SearchCompletionExitCode.Normal
        };
    }

    async clearCache(): Promise<void> {
        this.indexedFolders = [];
        this.indexPromise = undefined;
        this.indexGeneration++;
        this.indexedFiles = new Map();
        this.pendingUpdates.clear();
        this.postMessage({ type: "index-reset" });
    }

    /**
     * Returns the paths the query covers, undefined if it covers the whole index.
     *
     * @param query the query to filter the indexed files with
     * @returns the paths to search, undefined if everything is searched
     */
    private getSearchedPaths(query: ITextQuery): string[] | undefined {
        const hasFilter =
            query.includePattern != undefined ||
            query.excludePattern != undefined ||
            query.folderQueries.some(
                (folderQuery) => folderQuery.includePattern != undefined || folderQuery.excludePattern != undefined
            );
        if (!hasFilter) {
            return undefined;
        }

        const paths: string[] = [];
        for (const [path, resource] of this.indexedFiles) {
            if (pathIncludedInQuery(query, resource.fsPath)) {
                paths.push(path);
            }
        }
        return paths;
    }

    /**
     * Runs a search in the worker.
     *
     * @param query the query to run
     * @param callbacks the callbacks invoked while the search runs
     * @returns a handle that allows cancelling the search
     */
    private startSearch(query: WorkerSearchQuery, callbacks: RunningSearch): IDisposable & { cancel(): void } {
        const id = this.nextSearchId++;
        this.runningSearches.set(id, callbacks);
        this.postMessage({ type: "search", id, query });
        this.searchTimeouts.set(
            id,
            setTimeout(() => {
                this.handleStuckSearch(id);
            }, SEARCH_TIMEOUT)
        );

        const cancel = () => {
            if (this.runningSearches.delete(id)) {
                this.clearTimeout(id);
                this.worker?.postMessage({ type: "cancel", id } satisfies SearchWorkerRequest);
            }
        };
        return { cancel, dispose: cancel };
    }

    /**
     * Makes sure the index contains the current content of the given folders.
     *
     * @param folders the folders that are searched
     */
    private async ensureIndex(folders: readonly URI[]): Promise<void> {
        const key = folders.map((folder) => folder.toString()).sort();

        if (key.join("\n") !== this.indexedFolders.join("\n")) {
            this.indexedFolders = key;
            this.indexGeneration++;
            this.indexedFiles = new Map();
            this.pendingUpdates.clear();
            this.postMessage({ type: "index-reset" });
            this.indexPromise = this.buildIndex(folders, this.indexGeneration).catch((error: unknown) => {
                if (this.indexedFolders === key) {
                    this.indexedFolders = [];
                }
                throw error;
            });
        }

        await this.indexPromise;
        await Promise.all([...this.pendingUpdates]);
    }

    /**
     * Reads all files of the given folders and sends them to the worker.
     *
     * @param folders the folders to index
     * @param generation the index generation this build belongs to
     */
    private async buildIndex(folders: readonly URI[], generation: number): Promise<void> {
        const files: Uri[] = [];
        for (const folder of folders) {
            files.push(...(await this.collectFiles(Uri.from(folder), generation)));
        }

        for (let start = 0; start < files.length; start += INDEX_CHUNK_SIZE) {
            if (generation !== this.indexGeneration) {
                return;
            }

            const chunk = files.slice(start, start + INDEX_CHUNK_SIZE);
            const indexed = await this.readFiles(chunk);
            if (generation !== this.indexGeneration) {
                return;
            }
            if (indexed.length > 0) {
                this.postMessage({ type: "index-put", files: indexed });
            }
        }
    }

    /**
     * Collects the URIs of all files below a folder.
     *
     * @param root the folder to collect the files of
     * @param generation the index generation this build belongs to
     * @returns the URIs of all files below the folder
     */
    private async collectFiles(root: Uri, generation: number): Promise<Uri[]> {
        const files: Uri[] = [];
        const folders: Uri[] = [root];

        while (folders.length > 0) {
            if (generation !== this.indexGeneration) {
                return [];
            }

            const folder = folders.pop()!;
            try {
                const stat = await this.fileService.resolve(folder);
                for (const child of stat.children ?? []) {
                    if (child.isDirectory) {
                        folders.push(Uri.from(child.resource));
                    } else {
                        files.push(Uri.from(child.resource));
                    }
                }
            } catch {
                // A folder that cannot be resolved is simply not searched
            }
        }

        return files;
    }

    /**
     * Reads the content of the given files, skipping the ones that cannot be searched.
     *
     * @param uris the files to read
     * @returns the content of the readable files
     */
    private async readFiles(uris: Uri[]): Promise<IndexedFileData[]> {
        const files = await Promise.all(
            uris.map(async (uri): Promise<IndexedFileData | undefined> => {
                try {
                    const content = await this.fileService.readFile(uri);
                    if (content.value.byteLength > MAX_INDEXED_FILE_SIZE) {
                        return undefined;
                    }
                    this.indexedFiles.set(uri.path, uri);
                    // The buffer of the file service is copied, so that it is never detached by the worker
                    return { path: uri.path, bytes: new Uint8Array(content.value.buffer) };
                } catch {
                    return undefined;
                }
            })
        );

        return files.filter((file) => file != undefined);
    }

    /**
     * Keeps the index in sync with the files of the workspace.
     *
     * @param event the change reported by the file service
     */
    private handleFilesChanged(event: FileChangesEvent): void {
        if (this.indexedFolders.length === 0) {
            return;
        }

        const deleted = event.rawDeleted.filter((resource) => this.isIndexed(resource));
        if (deleted.length > 0) {
            const paths = deleted.map((resource) => resource.path);
            for (const path of paths) {
                this.indexedFiles.delete(path);
            }
            this.postMessage({ type: "index-remove", paths });
        }

        const changed = [...event.rawAdded, ...event.rawUpdated]
            .filter((resource) => this.isIndexed(resource))
            .map((resource) => Uri.from(resource));
        if (changed.length === 0) {
            return;
        }

        const generation = this.indexGeneration;
        const update = this.readFiles(changed).then((files) => {
            if (generation === this.indexGeneration && files.length > 0) {
                this.postMessage({ type: "index-put", files });
            }
        });
        this.pendingUpdates.add(update);
        void update.finally(() => this.pendingUpdates.delete(update));
    }

    /**
     * Checks whether a changed resource belongs to the indexed folders.
     *
     * @param resource the resource to check
     * @returns true if the resource is part of the index
     */
    private isIndexed(resource: URI): boolean {
        if (resource.scheme !== "file") {
            return false;
        }
        return this.indexedFolders.some((folder) => resource.toString().startsWith(`${folder}/`));
    }

    /**
     * Handles a response of the worker.
     *
     * @param message the response of the worker
     */
    private handleResponse(message: SearchWorkerResponse): void {
        const search = this.runningSearches.get(message.id);
        if (search == undefined) {
            return;
        }

        switch (message.type) {
            case "results":
                search.onResults(message.files);
                break;
            case "done":
                this.finishSearch(message.id);
                search.onDone(message.limitHit);
                break;
            case "error":
                this.finishSearch(message.id);
                search.onError(message.message);
                break;
        }
    }

    /**
     * Replaces the worker of a search that never reported back and fails the search.
     * The index is dropped and rebuilt with the next search.
     *
     * @param id the id of the stuck search
     */
    private handleStuckSearch(id: number): void {
        const search = this.runningSearches.get(id);
        this.clearTimeout(id);
        this.runningSearches.delete(id);

        this.worker?.terminate();
        this.worker = undefined;
        this.indexedFolders = [];
        this.indexPromise = undefined;
        this.indexedFiles = new Map();
        this.pendingUpdates.clear();

        search?.onError("The search took too long and was stopped");
    }

    /**
     * Removes all state of a finished search.
     *
     * @param id the id of the search
     */
    private finishSearch(id: number): void {
        this.clearTimeout(id);
        this.runningSearches.delete(id);
    }

    /**
     * Clears the timeout guarding a search.
     *
     * @param id the id of the search
     */
    private clearTimeout(id: number): void {
        const timeout = this.searchTimeouts.get(id);
        if (timeout != undefined) {
            clearTimeout(timeout);
            this.searchTimeouts.delete(id);
        }
    }

    /**
     * Sends a message to the worker, creating it if necessary.
     *
     * @param message the message to send
     */
    private postMessage(message: SearchWorkerRequest): void {
        this.getWorker().postMessage(message);
    }

    /**
     * Returns the worker holding the index, creating it on first use.
     *
     * @returns the search worker
     */
    private getWorker(): Worker {
        if (this.worker == undefined) {
            this.worker = new Worker(new URL("./searchWorker.ts", import.meta.url), {
                type: "module"
            });
            this.worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
                this.handleResponse(event.data);
            };
        }
        return this.worker;
    }
}
