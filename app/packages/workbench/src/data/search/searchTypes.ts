import type {
    IPatternInfo,
    ITextSearchPreviewOptions,
    ITextSearchResult
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";

/**
 * Maximum size in bytes of a file that is added to the search index.
 */
export const MAX_INDEXED_FILE_SIZE = 20 * 1024 * 1024;

/**
 * The content of a file to add to or replace in the search index.
 */
export interface IndexedFileData {
    /**
     * The path of the file
     */
    path: string;
    /**
     * The raw content of the file, decoded by the worker when it is searched
     */
    bytes: Uint8Array;
}

/**
 * The parameters of a text search, taken from the vscode text query.
 */
export interface WorkerSearchQuery {
    /**
     * The pattern to search for
     */
    contentPattern: IPatternInfo;
    /**
     * How the preview of a match is built
     */
    previewOptions?: ITextSearchPreviewOptions;
    /**
     * The number of context lines reported around a match
     */
    surroundingContext?: number;
    /**
     * The maximum number of matches reported for the search
     */
    maxResults: number;
    /**
     * The paths to search, everything in the index is searched if it is not set
     */
    paths?: string[];
}

/**
 * The matches of a single file, in the format used by the vscode search service.
 */
export interface WorkerFileResult {
    /**
     * The path of the file the matches were found in
     */
    path: string;
    /**
     * The matches found in the file
     */
    results: ITextSearchResult[];
}

/**
 * A message sent from the workbench to the search worker.
 */
export type SearchWorkerRequest =
    | {
          type: "index-reset";
      }
    | {
          type: "index-put";
          files: IndexedFileData[];
      }
    | {
          type: "index-remove";
          paths: string[];
      }
    | {
          type: "search";
          id: number;
          query: WorkerSearchQuery;
      }
    | {
          type: "cancel";
          id: number;
      };

/**
 * A message sent from the search worker to the workbench.
 */
export type SearchWorkerResponse =
    | {
          type: "results";
          id: number;
          files: WorkerFileResult[];
      }
    | {
          type: "done";
          id: number;
          limitHit: boolean;
      }
    | {
          type: "error";
          id: number;
          message: string;
      };
