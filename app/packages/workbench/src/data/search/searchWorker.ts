import { createRegExp } from "@codingame/monaco-vscode-api/vscode/vs/base/common/strings";
import { getFileResults } from "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/getFileResults";
import type { WorkerFileResult, WorkerSearchQuery, SearchWorkerRequest, SearchWorkerResponse } from "./searchTypes";

/**
 * Time in milliseconds after which the search yields to the worker event loop,
 * so that pending cancellations are processed and results are streamed out.
 */
const YIELD_INTERVAL = 8;

/**
 * Maximum number of matches read from a single file.
 *
 * getFileResults reports nothing at all for a file that holds more matches than its quota allows,
 * so the quota is a fixed per file limit instead of the matches left for the whole search.
 * That way the limit of the search itself can be applied to the returned matches.
 */
const MAX_MATCHES_PER_FILE = 10000;

/**
 * The indexed content of the project, keyed by file path.
 */
const index = new Map<string, Uint8Array>();

/**
 * The ids of the searches that are currently running.
 */
const runningSearches = new Set<number>();

/**
 * The ids of the running searches that were cancelled.
 */
const cancelledSearches = new Set<number>();

const workerScope = self as unknown as {
    postMessage(message: SearchWorkerResponse): void;
    onmessage: ((event: MessageEvent<SearchWorkerRequest>) => void) | null;
};

workerScope.onmessage = (event) => {
    const request = event.data;
    switch (request.type) {
        case "index-reset":
            index.clear();
            break;
        case "index-put":
            for (const file of request.files) {
                index.set(file.path, file.bytes);
            }
            break;
        case "index-remove":
            for (const path of request.paths) {
                removeFromIndex(path);
            }
            break;
        case "cancel":
            if (runningSearches.has(request.id)) {
                cancelledSearches.add(request.id);
            }
            break;
        case "search":
            runningSearches.add(request.id);
            void runSearch(request.id, request.query).finally(() => {
                runningSearches.delete(request.id);
                cancelledSearches.delete(request.id);
            });
            break;
    }
};

/**
 * Removes a path from the index.
 * If the path is a folder, everything below it is removed as well.
 *
 * @param path the path to remove
 */
function removeFromIndex(path: string): void {
    if (index.delete(path)) {
        return;
    }

    const folderPrefix = `${path}/`;
    for (const indexedPath of index.keys()) {
        if (indexedPath.startsWith(folderPrefix)) {
            index.delete(indexedPath);
        }
    }
}

/**
 * Searches the index for the given query and streams the results back in batches.
 *
 * @param id the id of the search, used to cancel it and to associate the responses
 * @param query the query to search for
 */
async function runSearch(id: number, query: WorkerSearchQuery): Promise<void> {
    const pattern = query.contentPattern;
    let regex: RegExp;
    try {
        regex = createRegExp(pattern.pattern, !!pattern.isRegExp, {
            wholeWord: pattern.isWordMatch,
            matchCase: pattern.isCaseSensitive,
            multiline: pattern.isMultiline,
            unicode: pattern.isUnicode,
            global: true
        });
    } catch (error) {
        workerScope.postMessage({
            type: "error",
            id,
            message: error instanceof Error ? error.message : String(error)
        });
        return;
    }

    const paths = query.paths ?? Array.from(index.keys());
    const surroundingContext = query.surroundingContext ?? 0;

    let batch: WorkerFileResult[] = [];
    let remainingQuota = query.maxResults;
    let limitHit = false;
    let lastYield = performance.now();

    for (const path of paths) {
        if (cancelledSearches.has(id)) {
            return;
        }

        const bytes = index.get(path);
        if (bytes == undefined) {
            continue;
        }

        // A file that runs out of quota leaves the regex in a partial state
        regex.lastIndex = 0;
        const results = getFileResults(bytes, regex, {
            surroundingContext,
            previewOptions: query.previewOptions,
            remainingResultQuota: MAX_MATCHES_PER_FILE
        });

        if (results.length > 0) {
            if (results.length >= remainingQuota) {
                batch.push({ path, results: results.slice(0, remainingQuota) });
                limitHit = true;
                break;
            }
            batch.push({ path, results });
            remainingQuota -= results.length;
        }

        if (performance.now() - lastYield >= YIELD_INTERVAL) {
            if (batch.length > 0) {
                workerScope.postMessage({ type: "results", id, files: batch });
                batch = [];
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
            lastYield = performance.now();
        }
    }

    if (cancelledSearches.has(id)) {
        return;
    }

    if (batch.length > 0) {
        workerScope.postMessage({ type: "results", id, files: batch });
    }
    workerScope.postMessage({ type: "done", id, limitHit });
}
