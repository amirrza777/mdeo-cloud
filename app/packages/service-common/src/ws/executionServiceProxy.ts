import type { ExecutionResultEntry } from "../execution/types.js";
import { ExecutionWsClient } from "./executionWsClient.js";
import type {
    ExecutionFilePayload,
    ExecutionFileTreePayload,
    ExecutionSummaryPayload,
    ExecutionWsContext,
    ExecutionWsRequest
} from "./protocol.js";

/**
 * Client shared by every proxying execution handler in a service process.
 *
 * One pool of connections per process is what makes the caching worthwhile: two languages
 * proxying to the same execution service reuse the same connection, and a connection stays
 * warm across the burst of requests one user interaction produces.
 */
const sharedClient = new ExecutionWsClient();

/**
 * The parts of a request context the proxy needs.
 *
 * Deliberately narrower than `ExecutionRequestContext` — which satisfies it structurally —
 * so that plain request handlers, which never see a Langium instance, can proxy too.
 */
export interface ExecutionProxyContext {
    /**
     * The execution being addressed.
     */
    executionId: string;
    /**
     * Token authorizing the request, forwarded to the execution service.
     */
    jwt: string;
    /**
     * The owning project, when the caller knows it.
     */
    project?: string;
    /**
     * Execution metadata to forward, when the caller has it.
     */
    metadata?: Record<string, unknown>;
}

/**
 * Access to a platform execution service over the shared execution WebSocket protocol.
 *
 * Every execution handler in this repository that owns results is a proxy: it forwards
 * summaries, trees, and file reads to a Kotlin execution service. Doing that over HTTP costs
 * a connection-scoped request per file; this holds one connection per target service open
 * across a burst of reads and drops it again once it goes unused. Each request repeats the
 * token that authorizes it, so nothing is bound to the connection.
 *
 * @param baseUrl Base URL of the execution service to proxy to
 * @param client The connection pool to use; the process-wide pool by default
 */
export class ExecutionServiceWsProxy {
    constructor(
        private readonly baseUrl: string,
        private readonly client: ExecutionWsClient = sharedClient
    ) {}

    /**
     * Fetches the markdown summary of an execution.
     *
     * @param context The execution request context
     * @returns The summary, or the empty string if the service returned none
     */
    async getSummary(context: ExecutionProxyContext): Promise<string> {
        const response = await this.client.request(this.baseUrl, (requestId) => ({
            messageType: "exec/summary",
            requestId,
            context: this.wsContext(context)
        }));
        return (response.data as ExecutionSummaryPayload | undefined)?.summary ?? "";
    }

    /**
     * Fetches the result file tree of an execution.
     *
     * @param context The execution request context
     * @returns The entries in the result tree
     */
    async getFileTree(context: ExecutionProxyContext): Promise<ExecutionResultEntry[]> {
        const response = await this.client.request(this.baseUrl, (requestId) => ({
            messageType: "exec/fileTree",
            requestId,
            context: this.wsContext(context)
        }));
        return (response.data as ExecutionFileTreePayload | undefined)?.files ?? [];
    }

    /**
     * Reads a single result file of an execution.
     *
     * @param context The execution request context
     * @param path Path of the file within the execution results
     * @returns The file's text content
     */
    async getFile(context: ExecutionProxyContext, path: string): Promise<string> {
        const response = await this.client.request(this.baseUrl, (requestId) => ({
            messageType: "exec/file",
            requestId,
            context: this.wsContext(context),
            path
        }));
        return (response.data as ExecutionFilePayload | undefined)?.content ?? "";
    }

    /**
     * Reads many result files in a single request, reporting each as it streams back.
     *
     * @param context The execution request context
     * @param paths Files to read, or null for every file in the result tree
     * @param onFile Called with each file's path and content as it arrives
     * @returns The entries that were actually read
     */
    async getFiles(
        context: ExecutionProxyContext,
        paths: string[] | null,
        onFile: (path: string, content: string) => void
    ): Promise<ExecutionResultEntry[]> {
        const response = await this.client.request(
            this.baseUrl,
            (requestId) => ({
                messageType: "exec/files",
                requestId,
                context: this.wsContext(context),
                paths
            }),
            (message) => {
                if (message.messageType === "exec/fileData") {
                    onFile(message.path, message.content);
                }
            }
        );
        return (response.data as ExecutionFileTreePayload | undefined)?.files ?? [];
    }

    /**
     * Cancels a running execution.
     *
     * @param context The execution request context
     */
    async cancel(context: ExecutionProxyContext): Promise<void> {
        await this.client.request(this.baseUrl, (requestId) => this.lifecycle("exec/cancel", requestId, context));
    }

    /**
     * Deletes an execution and its results.
     *
     * @param context The execution request context
     */
    async delete(context: ExecutionProxyContext): Promise<void> {
        await this.client.request(this.baseUrl, (requestId) => this.lifecycle("exec/delete", requestId, context));
    }

    private lifecycle(
        messageType: "exec/cancel" | "exec/delete",
        requestId: string,
        context: ExecutionProxyContext
    ): ExecutionWsRequest {
        return { messageType, requestId, context: this.wsContext(context) };
    }

    private wsContext(context: ExecutionProxyContext): ExecutionWsContext {
        return {
            executionId: context.executionId,
            auth: context.jwt,
            projectId: context.project,
            metadata: context.metadata ?? null
        };
    }
}
