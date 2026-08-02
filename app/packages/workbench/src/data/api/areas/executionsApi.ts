import { ApiResult, CommonErrorCode, ExecutionErrorCode, type ExecutionError } from "../apiResult";
import type {
    Execution,
    ExecutionFileEntry,
    ExecutionWithTree,
    CreateExecutionRequest
} from "../../execution/execution";
import type { BackendApiCore } from "../backendApi";
import type { WebSocketApi } from "./webSocketApi";

/**
 * Everything known about one execution's results, held for as long as the execution is shown.
 *
 * Result files only become readable once a run has finished, and never change afterwards, so
 * anything read is worth keeping: the editor asks for the same file again on every tab
 * switch, and the download action asks for all of them at once.
 */
interface CachedExecutionResults {
    tree?: ExecutionFileEntry[];
    files: Map<string, Uint8Array>;
    /**
     * The in-flight bulk load, if one is running. A read that misses waits on this rather
     * than issuing its own request, so opening a file the prefetch is about to deliver does
     * not race it.
     */
    prefetch?: Promise<void>;
    /**
     * Set once every file in the tree has been loaded, so a miss on a path that is simply not
     * in the results is answered from here instead of costing another request.
     */
    complete: boolean;
}

/**
 * API for execution management operations.
 * Provides methods for creating, listing, and managing executions
 * within projects.
 *
 * Result access — summaries, trees, and file contents — goes over the WebSocket connection
 * the workbench already holds rather than a request per file: those reads travel two further
 * hops behind the backend, so each one was a chain of three requests. Opening an execution
 * fetches its whole result set in one go and serves the files afterwards from memory.
 */
export class ExecutionsApi {
    private readonly resultCache = new Map<string, CachedExecutionResults>();

    /**
     * Creates a new ExecutionsApi instance
     *
     * @param core The core backend API providing HTTP utilities
     * @param websocket The WebSocket API used for result access
     */
    constructor(
        private readonly core: BackendApiCore,
        private readonly websocket: WebSocketApi
    ) {}

    /**
     * Lists all executions for a project
     *
     * @param projectId The ID of the project
     * @returns A promise resolving to an array of executions
     */
    async list(projectId: string): Promise<ApiResult<Execution[], ExecutionError>> {
        return this.core.fetchApiResult(`${this.core.baseUrl}/projects/${projectId}/executions`, {
            method: "GET"
        });
    }

    /**
     * Gets an execution with its file tree
     *
     * @param projectId The ID of the project
     * @param executionId The ID of the execution
     * @returns A promise resolving to the execution with file tree
     */
    async get(projectId: string, executionId: string): Promise<ApiResult<ExecutionWithTree, ExecutionError>> {
        return this.core.fetchApiResult(`${this.core.baseUrl}/projects/${projectId}/executions/${executionId}`, {
            method: "GET"
        });
    }

    /**
     * Gets the summary document for an execution
     *
     * @param projectId The ID of the project
     * @param executionId The ID of the execution
     * @returns A promise resolving to the summary content as bytes
     */
    async getSummary(projectId: string, executionId: string): Promise<ApiResult<Uint8Array, ExecutionError>> {
        // Deliberately not cached: a summary can be opened while its execution is still
        // running, and it grows as the run progresses. Result files are only readable once
        // the run has finished, which is why those are safe to keep.
        try {
            const summary = await this.websocket.getExecutionSummary(projectId, executionId);
            return ApiResult.success(new TextEncoder().encode(summary));
        } catch (error) {
            return this.toFailure(error);
        }
    }

    /**
     * Gets a result file for an execution
     *
     * @param projectId The ID of the project
     * @param executionId The ID of the execution
     * @param path The path to the file within the execution results
     * @returns A promise resolving to the file contents as bytes
     */
    async getFile(
        projectId: string,
        executionId: string,
        path: string
    ): Promise<ApiResult<Uint8Array, ExecutionError>> {
        const normalizedPath = normalizeResultPath(path);
        let cached = this.resultCache.get(executionId);
        let content = cached?.files.get(normalizedPath);
        if (content !== undefined) {
            return ApiResult.success(content);
        }

        // A prefetch may be about to deliver this very file. Waiting for it costs nothing the
        // user was not already waiting for, and avoids asking for a file twice over.
        if (cached?.prefetch !== undefined) {
            await cached.prefetch;
            cached = this.resultCache.get(executionId);
            content = cached?.files.get(normalizedPath);
            if (content !== undefined) {
                return ApiResult.success(content);
            }
        }

        if (cached?.complete) {
            return ApiResult.executionFailure(
                ExecutionErrorCode.ExecutionNotFound,
                `File not found in execution results: ${path}`
            );
        }

        try {
            const text = await this.websocket.getExecutionFile(projectId, executionId, normalizedPath);
            const encoded = new TextEncoder().encode(text);
            this.cacheFor(executionId).files.set(normalizedPath, encoded);
            return ApiResult.success(encoded);
        } catch (error) {
            return this.toFailure(error);
        }
    }

    /**
     * Fetches an execution's result tree, and starts warming its files in the background.
     *
     * The tree is deliberately awaited on its own. Waiting for the whole result set before
     * showing anything leaves the execution looking like it is loading forever — the files
     * can take a while, and the point of showing a tree is to let the user pick from it. So
     * the tree comes back in one round trip and renders, and the bulk load that makes every
     * subsequent open free runs behind it.
     *
     * @param projectId The ID of the project
     * @param executionId The ID of the execution
     * @returns The entries in the result tree
     */
    async loadResults(
        projectId: string,
        executionId: string
    ): Promise<ApiResult<ExecutionFileEntry[], ExecutionError>> {
        const cached = this.resultCache.get(executionId);
        if (cached?.tree !== undefined) {
            return ApiResult.success(cached.tree);
        }

        let tree: ExecutionFileEntry[];
        try {
            tree = await this.websocket.getExecutionFileTree(projectId, executionId);
        } catch (error) {
            return this.toFailure(error);
        }

        const entry = this.cacheFor(executionId);
        entry.tree = tree;
        this.startPrefetch(projectId, executionId, entry);
        return ApiResult.success(tree);
    }

    /**
     * Loads every result file of an execution, and returns the tree describing them.
     *
     * For callers that need the whole result set anyway — downloading it as an archive — this
     * is a single round trip: the bulk load already answers with the tree, so asking for the
     * tree separately first would pay for the same traversal twice. Reading the files
     * afterwards costs nothing, because they are all cached by the time this resolves.
     *
     * @param projectId The ID of the project
     * @param executionId The ID of the execution
     * @returns The entries in the result tree
     */
    async loadAllResults(
        projectId: string,
        executionId: string
    ): Promise<ApiResult<ExecutionFileEntry[], ExecutionError>> {
        const entry = this.cacheFor(executionId);
        if (!entry.complete) {
            // A prefetch started by an earlier tree load is the same request this would make,
            // so join it rather than issuing a second one.
            this.startPrefetch(projectId, executionId, entry);
            await entry.prefetch;
        }

        if (entry.tree === undefined) {
            return this.toFailure(
                new Error(`Loading the results of execution ${executionId} did not return a file tree`)
            );
        }
        return ApiResult.success(entry.tree);
    }

    /**
     * Starts the background bulk load, unless one is already running or finished.
     *
     * Its failure is not surfaced to whoever triggered it in the background: nothing is
     * waiting on it, and every file it would have delivered is still individually readable.
     * It only ever removes work.
     */
    private startPrefetch(projectId: string, executionId: string, entry: CachedExecutionResults): void {
        if (entry.complete || entry.prefetch !== undefined) {
            return;
        }
        entry.prefetch = this.websocket
            .loadExecutionFiles(projectId, executionId, null, (path, content) => {
                entry.files.set(normalizeResultPath(path), new TextEncoder().encode(content));
            })
            .then((tree) => {
                // The bulk load reports the tree it actually sent, so a caller that skipped
                // the separate tree request still ends up with one.
                entry.tree ??= tree;
                entry.complete = true;
            })
            .catch((error: unknown) => {
                // eslint-disable-next-line no-console
                console.warn(`[exec-ws] prefetch of execution ${executionId} results failed:`, error);
            })
            .finally(() => {
                entry.prefetch = undefined;
            });
    }

    /**
     * Drops everything cached for an execution.
     *
     * @param executionId The ID of the execution
     */
    invalidateResults(executionId: string): void {
        this.resultCache.delete(executionId);
    }

    /**
     * Cancels a running execution
     *
     * @param projectId The ID of the project
     * @param executionId The ID of the execution to cancel
     * @returns A promise resolving to success or an error
     */
    async cancel(projectId: string, executionId: string): Promise<ApiResult<void, ExecutionError>> {
        return this.core.fetchApiResult(`${this.core.baseUrl}/projects/${projectId}/executions/${executionId}/cancel`, {
            method: "POST"
        });
    }

    /**
     * Deletes an execution (implies cancel if still running)
     *
     * @param projectId The ID of the project
     * @param executionId The ID of the execution to delete
     * @returns A promise resolving to success or an error
     */
    async delete(projectId: string, executionId: string): Promise<ApiResult<void, ExecutionError>> {
        this.invalidateResults(executionId);
        return this.core.fetchApiResult(`${this.core.baseUrl}/projects/${projectId}/executions/${executionId}`, {
            method: "DELETE"
        });
    }

    /**
     * Deletes all executions for a project
     *
     * @param projectId The ID of the project
     * @returns A promise resolving to success or an error
     */
    async deleteAll(projectId: string): Promise<ApiResult<void, ExecutionError>> {
        this.resultCache.clear();
        return this.core.fetchApiResult(`${this.core.baseUrl}/projects/${projectId}/executions`, {
            method: "DELETE"
        });
    }

    /**
     * Creates a new execution
     *
     * @param projectId The ID of the project
     * @param request The execution creation request containing file path and data
     * @returns A promise resolving to the created execution
     */
    async create(projectId: string, request: CreateExecutionRequest): Promise<ApiResult<Execution, ExecutionError>> {
        return this.core.fetchApiResult(`${this.core.baseUrl}/projects/${projectId}/executions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request)
        });
    }

    /**
     * Reads metadata for an execution file
     *
     * @param projectId The ID of the project
     * @param executionId The ID of the execution
     * @param path The path to the file within the execution results
     * @returns A promise resolving to the metadata object
     */
    async readExecutionFileMetadata(
        projectId: string,
        executionId: string,
        path: string
    ): Promise<ApiResult<object, ExecutionError>> {
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        return this.core.fetchApiResult(
            `${this.core.baseUrl}/projects/${projectId}/executions/${executionId}/metadata/${encodedPath}`,
            { method: "GET" }
        );
    }

    /**
     * Writes metadata for an execution file
     *
     * @param projectId The ID of the project
     * @param executionId The ID of the execution
     * @param path The path to the file within the execution results
     * @param metadata The metadata object to write
     * @returns A promise resolving to success or an error
     */
    async writeExecutionFileMetadata(
        projectId: string,
        executionId: string,
        path: string,
        metadata: object
    ): Promise<ApiResult<void, ExecutionError>> {
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        return this.core.fetchApiResult(
            `${this.core.baseUrl}/projects/${projectId}/executions/${executionId}/metadata/${encodedPath}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(metadata)
            }
        );
    }

    private cacheFor(executionId: string): CachedExecutionResults {
        let entry = this.resultCache.get(executionId);
        if (entry === undefined) {
            entry = { files: new Map(), complete: false };
            this.resultCache.set(executionId, entry);
        }
        return entry;
    }

    /**
     * Converts a rejected WebSocket request into an API failure, keeping the error code the
     * originating service raised so the file system provider can still tell "not found" from
     * "unreachable".
     */
    private toFailure<T>(error: unknown): ApiResult<T, ExecutionError> {
        const wsError = error as { code?: string; message?: string };
        if (wsError?.code === "NotFound") {
            return ApiResult.executionFailure(
                ExecutionErrorCode.ExecutionNotFound,
                wsError.message ?? "Execution result not found"
            );
        }
        return ApiResult.commonFailure(CommonErrorCode.Unavailable, wsError?.message ?? String(error));
    }
}

/**
 * Strips a leading slash so that paths from the editor's URIs and paths from the result tree
 * are the same cache key.
 *
 * @param path A result file path
 * @returns The path without a leading slash
 */
function normalizeResultPath(path: string): string {
    return path.startsWith("/") ? path.slice(1) : path;
}
