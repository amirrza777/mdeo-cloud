import type { Uri } from "vscode";
import type { ISearchRange } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";

/**
 * A single match of a search inside a file, prepared for rendering.
 */
export interface SearchMatch {
    /**
     * Identifier of the match, unique within the whole result set
     */
    id: string;
    /**
     * The result of the file the match belongs to
     */
    file: FileSearchResult;
    /**
     * The location of the match within the file, as reported by the search service
     */
    range: ISearchRange;
    /**
     * The part of the previewed line in front of the match
     */
    before: string;
    /**
     * The matched part of the previewed line
     */
    highlight: string;
    /**
     * The part of the previewed line behind the match
     */
    after: string;
}

/**
 * All matches of a search inside a single file.
 */
export interface FileSearchResult {
    /**
     * Identifier of the result, the path of the file
     */
    id: string;
    /**
     * The file the matches were found in
     */
    resource: Uri;
    /**
     * The name of the file
     */
    name: string;
    /**
     * The path of the folder containing the file, relative to the project
     */
    folder: string;
    /**
     * The matches found in the file
     */
    matches: SearchMatch[];
}

/**
 * A row of the flattened result list that is rendered by the virtual list.
 */
export type SearchResultRow =
    | {
          /**
           * Identifier of the row
           */
          id: string;
          kind: "file";
          /**
           * The file result rendered by the row
           */
          file: FileSearchResult;
      }
    | {
          /**
           * Identifier of the row
           */
          id: string;
          kind: "match";
          /**
           * The file result the match belongs to
           */
          file: FileSearchResult;
          /**
           * The match rendered by the row
           */
          match: SearchMatch;
      };
