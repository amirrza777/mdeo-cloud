<template>
    <div class="flex flex-col h-full">
        <SidebarPanelHeader label="Search" />
        <div class="px-3 pb-1">
            <div class="relative">
                <Input
                    ref="searchInput"
                    v-model="searchText"
                    placeholder="Search..."
                    class="pr-23"
                    @keydown.down.prevent="focusResults"
                    @keydown.enter.prevent="focusResults"
                />
                <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div>
                                <Toggle v-model="isCaseSensitive" class="h-7 min-w-7 px-0">
                                    <CaseSensitive c />
                                </Toggle>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="top"> Match Case </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div>
                                <Toggle v-model="isWholeWord" class="h-7 min-w-7 px-0">
                                    <WholeWord c />
                                </Toggle>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="top"> Match Whole Word </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div>
                                <Toggle v-model="isRegex" class="h-7 min-w-7 px-0">
                                    <Regex c />
                                </Toggle>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="top"> Use Regular Expression </TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </div>
        <div :class="cn('px-3 pb-2 min-h-5 text-xs truncate', errorMessage ? 'text-destructive' : 'opacity-70')">
            {{ errorMessage ?? statusText }}
        </div>
        <SearchResultsList
            ref="resultsList"
            class="flex-1 min-h-0"
            :rows="rows"
            :collapsed-files="collapsedFiles"
            @open="handleOpenMatch"
            @toggle="toggleFile"
        />
    </div>
</template>
<script setup lang="ts">
import {
    computed,
    inject,
    nextTick,
    onActivated,
    onDeactivated,
    onUnmounted,
    ref,
    shallowRef,
    useTemplateRef,
    watch
} from "vue";
import { useDebounceFn, watchDebounced } from "@vueuse/core";
import { CaseSensitive, WholeWord, Regex } from "@lucide/vue";
import { Input } from "../ui/input";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import SidebarPanelHeader from "@/components/sidebar/SidebarPanelHeader.vue";
import SearchResultsList from "./SearchResultsList.vue";
import { cn } from "@/lib/utils";
import { workbenchStateKey } from "../workbench/util";
import { CancellationTokenSource } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
import { isCancellationError } from "@codingame/monaco-vscode-api/vscode/vs/base/common/errors";
import {
    DEFAULT_MAX_SEARCH_RESULTS,
    isFileMatch
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";
import { createFileSearchResult, createResultRows, createSearchQuery } from "./util";
import type { FileSearchResult, SearchMatch } from "./types";

/**
 * Time in milliseconds the search waits for further input before it starts
 */
const SEARCH_DEBOUNCE = 200;

/**
 * Time in milliseconds after which the search starts even while the input keeps changing
 */
const SEARCH_MAX_WAIT = 600;

const { monacoApi, project, activeTab, searchText, searchRevealCounter } = inject(workbenchStateKey)!;

const isCaseSensitive = ref(false);
const isWholeWord = ref(false);
const isRegex = ref(false);

const results = shallowRef<FileSearchResult[]>([]);
const collapsedFiles = shallowRef<Set<string>>(new Set());
const isSearching = ref(false);
const limitHit = ref(false);
const errorMessage = ref<string>();
const isPanelActive = ref(true);

const searchInput = useTemplateRef("searchInput");
const resultsList = useTemplateRef("resultsList");

let searchTokenSource: CancellationTokenSource | undefined;
let incomingResults: FileSearchResult[] = [];
let flushRequest: number | undefined;

/**
 * The query the shown results belong to, used to skip searches that would not change anything
 */
let shownQuery: string | undefined;

/**
 * The value of the reveal counter that has already been handled
 */
let handledReveal = searchRevealCounter.value;

const rows = computed(() => createResultRows(results.value, collapsedFiles.value));

const matchCount = computed(() => results.value.reduce((count, file) => count + file.matches.length, 0));

const statusText = computed(() => {
    if (searchText.value.trim() === "") {
        return "";
    }
    if (matchCount.value === 0) {
        return isSearching.value ? "Searching..." : "No results found";
    }

    const matches = `${matchCount.value} ${matchCount.value === 1 ? "result" : "results"}`;
    const files = `${results.value.length} ${results.value.length === 1 ? "file" : "files"}`;
    if (isSearching.value) {
        return `${matches} in ${files} so far...`;
    }
    if (limitHit.value) {
        return `First ${DEFAULT_MAX_SEARCH_RESULTS} results in ${files}`;
    }
    return `${matches} in ${files}`;
});

/**
 * Starts a new search, replacing the results of the previous one
 *
 * @param force whether the search is started even if the shown results already belong to the query
 */
function startSearch(force = false): void {
    const query = JSON.stringify([
        project.value?.id,
        searchText.value,
        isRegex.value,
        isCaseSensitive.value,
        isWholeWord.value
    ]);
    if (!force && query === shownQuery) {
        return;
    }

    stopSearch();

    results.value = [];
    collapsedFiles.value = new Set();
    limitHit.value = false;
    errorMessage.value = undefined;

    const projectId = project.value?.id;
    const pattern = searchText.value;
    if (projectId == undefined || pattern.trim() === "" || !isPanelActive.value) {
        // While the panel is hidden nothing is searched, so the query has to run once it is shown again
        shownQuery = isPanelActive.value ? query : undefined;
        return;
    }

    shownQuery = query;
    isSearching.value = true;

    const tokenSource = new CancellationTokenSource();
    searchTokenSource = tokenSource;

    monacoApi.searchService
        .textSearch(
            createSearchQuery(projectId, pattern, isRegex.value, isCaseSensitive.value, isWholeWord.value),
            tokenSource.token,
            (progress) => {
                if (isFileMatch(progress)) {
                    incomingResults.push(createFileSearchResult(progress));
                    scheduleFlush();
                }
            }
        )
        .then((complete) => {
            if (searchTokenSource !== tokenSource) {
                return;
            }
            flushResults();
            limitHit.value = complete.limitHit ?? false;
            finishSearch(tokenSource);
        })
        .catch((error: unknown) => {
            if (searchTokenSource !== tokenSource || isCancellationError(error)) {
                return;
            }
            flushResults();
            errorMessage.value = error instanceof Error ? error.message : String(error);
            finishSearch(tokenSource);
        });
}

/**
 * Marks a search as completed
 *
 * @param tokenSource the token source of the completed search
 */
function finishSearch(tokenSource: CancellationTokenSource): void {
    isSearching.value = false;
    searchTokenSource = undefined;
    tokenSource.dispose();
}

/**
 * Cancels the running search, if there is one
 */
function stopSearch(): void {
    if (searchTokenSource != undefined) {
        // The results of a cancelled search are incomplete, so it has to run again
        shownQuery = undefined;
        searchTokenSource.cancel();
        searchTokenSource.dispose();
        searchTokenSource = undefined;
    }
    isSearching.value = false;
    incomingResults = [];
    if (flushRequest != undefined) {
        cancelAnimationFrame(flushRequest);
        flushRequest = undefined;
    }
}

/**
 * Schedules the results that arrived from the worker to be rendered with the next frame,
 * so that a search reporting many small batches does not rerender the list for each of them
 */
function scheduleFlush(): void {
    if (flushRequest != undefined) {
        return;
    }
    flushRequest = requestAnimationFrame(() => {
        flushRequest = undefined;
        flushResults();
    });
}

/**
 * Renders all results that arrived from the worker so far
 */
function flushResults(): void {
    if (incomingResults.length === 0) {
        return;
    }
    results.value = [...results.value, ...incomingResults];
    incomingResults = [];
}

/**
 * Shows or hides the matches of a file
 *
 * @param file the file to toggle
 */
function toggleFile(file: FileSearchResult): void {
    const collapsed = new Set(collapsedFiles.value);
    if (!collapsed.delete(file.id)) {
        collapsed.add(file.id);
    }
    collapsedFiles.value = collapsed;
}

/**
 * Opens a match in the editor
 *
 * @param match the match to open
 * @param temporary whether the editor is only opened to preview the match
 */
async function handleOpenMatch(match: SearchMatch, temporary: boolean): Promise<void> {
    await monacoApi.editorService.openEditor({
        resource: match.file.resource,
        options: {
            preserveFocus: true,
            selection: {
                startLineNumber: match.range.startLineNumber + 1,
                startColumn: match.range.startColumn + 1,
                endLineNumber: match.range.endLineNumber + 1,
                endColumn: match.range.endColumn + 1
            }
        }
    });

    if (!temporary && activeTab.value != undefined) {
        activeTab.value.temporary = false;
    }
}

/**
 * Moves the focus from the search input into the results
 */
function focusResults(): void {
    resultsList.value?.focusFirstRow();
}

/**
 * Focuses the search input and selects its content
 */
function focusInput(): void {
    const input = searchInput.value?.$el as HTMLInputElement | undefined;
    input?.focus();
    input?.select();
}

const rerunSearch = useDebounceFn(() => startSearch(true), SEARCH_DEBOUNCE);

watchDebounced(
    [searchText, isCaseSensitive, isWholeWord, isRegex],
    () => {
        startSearch();
    },
    {
        debounce: SEARCH_DEBOUNCE,
        maxWait: SEARCH_MAX_WAIT
    }
);

watch(
    () => project.value?.id,
    () => {
        startSearch();
    }
);

watch(searchRevealCounter, (revealCount) => {
    if (isPanelActive.value) {
        handledReveal = revealCount;
        void nextTick(focusInput);
    }
});

const fileChangeListener = monacoApi.fileService.onDidFilesChange(() => {
    if (isPanelActive.value && searchText.value.trim() !== "") {
        void rerunSearch();
    }
});

onActivated(() => {
    isPanelActive.value = true;
    startSearch();

    if (handledReveal !== searchRevealCounter.value) {
        handledReveal = searchRevealCounter.value;
        void nextTick(focusInput);
    }
});

onDeactivated(() => {
    isPanelActive.value = false;
    stopSearch();
});

onUnmounted(() => {
    stopSearch();
    fileChangeListener.dispose();
});
</script>
