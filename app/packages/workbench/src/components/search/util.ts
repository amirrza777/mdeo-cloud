import { Uri } from "vscode";
import {
    DEFAULT_MAX_SEARCH_RESULTS,
    QueryType,
    resultIsMatch,
    type IFileMatch,
    type ITextQuery,
    type SearchRangeSetPairing
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";
import type { FileSearchResult, SearchMatch, SearchResultRow } from "./types";

/**
 * Maximum number of characters shown for the line a match was found on.
 */
const PREVIEW_CHARS_PER_LINE = 250;

/**
 * Creates a search query for the specified project
 *
 * @param projectId the id of the project to search in
 * @param searchText the text to search for
 * @param isRegex whether the search text is a regex
 * @param isCaseSensitive whether the search is case sensitive
 * @param isWholeWord whether to match whole words only
 * @returns a text search query object
 */
export function createSearchQuery(
    projectId: string,
    searchText: string,
    isRegex: boolean,
    isCaseSensitive: boolean,
    isWholeWord: boolean
): ITextQuery {
    return {
        type: QueryType.Text as QueryType.Text,
        contentPattern: {
            pattern: searchText,
            isRegExp: isRegex,
            isCaseSensitive: isCaseSensitive,
            isWordMatch: isWholeWord
        },
        folderQueries: [
            {
                folder: Uri.file(`/${projectId}/files`)
            }
        ],
        previewOptions: {
            matchLines: 1,
            charsPerLine: PREVIEW_CHARS_PER_LINE
        },
        maxResults: DEFAULT_MAX_SEARCH_RESULTS
    };
}

/**
 * Converts a result of the search service into the model rendered by the search panel.
 *
 * @param fileMatch the matches the search service reported for a single file
 * @returns the result of a single file
 */
export function createFileSearchResult(fileMatch: IFileMatch): FileSearchResult {
    const path = fileMatch.resource.path;
    const fileResult: FileSearchResult = {
        id: path,
        resource: Uri.from(fileMatch.resource),
        name: getFileName(path),
        folder: getFolderPath(path),
        matches: []
    };

    for (const result of fileMatch.results ?? []) {
        if (!resultIsMatch(result)) {
            continue;
        }
        for (const location of result.rangeLocations) {
            fileResult.matches.push(createSearchMatch(fileResult, result.previewText, location));
        }
    }

    return fileResult;
}

/**
 * Splits the previewed line of a match into the parts rendered around the highlight.
 *
 * @param file the result of the file the match belongs to
 * @param previewText the preview reported by the search service
 * @param location the location of the match within the preview and within the file
 * @returns the match prepared for rendering
 */
function createSearchMatch(file: FileSearchResult, previewText: string, location: SearchRangeSetPairing): SearchMatch {
    const { preview, source } = location;
    const line = previewText.split("\n")[preview.startLineNumber] ?? "";
    const end = preview.startLineNumber === preview.endLineNumber ? preview.endColumn : line.length;

    // The preview keeps the indentation of the line, which only wastes space in the panel
    const before = line.substring(0, preview.startColumn).trimStart();

    return {
        id: `${file.id}:${source.startLineNumber}:${source.startColumn}`,
        file,
        range: source,
        before,
        highlight: line.substring(preview.startColumn, end),
        after: line.substring(end)
    };
}

/**
 * Flattens the results into the rows rendered by the virtual list.
 *
 * @param results the results of all files
 * @param collapsedFiles the ids of the files whose matches are hidden
 * @returns the rows to render
 */
export function createResultRows(results: FileSearchResult[], collapsedFiles: Set<string>): SearchResultRow[] {
    const rows: SearchResultRow[] = [];

    for (const file of results) {
        rows.push({ id: file.id, kind: "file", file });
        if (collapsedFiles.has(file.id)) {
            continue;
        }
        for (const match of file.matches) {
            rows.push({ id: match.id, kind: "match", file, match });
        }
    }

    return rows;
}

/**
 * Extracts the name of a file from its path.
 *
 * @param path the path of the file
 * @returns the name of the file
 */
export function getFileName(path: string): string {
    const segments = path.split("/").filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? "";
}

/**
 * Extracts the folder of a file, relative to the files folder of the project.
 *
 * @param path the path of the file
 * @returns the path of the containing folder, empty if the file is at the project root
 */
export function getFolderPath(path: string): string {
    const segments = path.split("/").filter((segment) => segment.length > 0);

    if (segments.length <= 2) {
        return "";
    }
    if (segments[1] === "files") {
        return segments.slice(2, -1).join("/");
    }
    return segments.slice(1, -1).join("/");
}
