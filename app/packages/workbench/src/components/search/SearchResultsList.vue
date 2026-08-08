<template>
    <ScrollAreaRoot :class="cn('relative', props.class)">
        <ScrollAreaViewport
            ref="viewport"
            class="size-full rounded-[inherit] outline-none"
            @scroll="handleScroll"
            @keydown="handleKeydown"
        >
            <div class="relative w-full" :style="{ height: `${rows.length * ROW_HEIGHT + 2 * LIST_PADDING}px` }">
                <div
                    v-for="item in visibleRows"
                    :key="item.row.id"
                    class="absolute inset-x-2"
                    :style="{ top: `${item.index * ROW_HEIGHT + LIST_PADDING}px`, height: `${ROW_HEIGHT}px` }"
                >
                    <button
                        v-if="item.row.kind === 'file'"
                        :class="rowClass"
                        :data-active="item.index === activeIndex"
                        @click="handleFileClick(item.index)"
                    >
                        <ChevronRight
                            :class="[
                                'size-4 shrink-0 transition-transform',
                                collapsedFiles.has(item.row.file.id) ? '' : 'rotate-90'
                            ]"
                        />
                        <FileTypeIcon
                            class="size-4 shrink-0"
                            :model-value="languagePluginByExtension.get(getFileExtension(item.row.file.name))"
                        />
                        <span class="truncate">{{ item.row.file.name }}</span>
                        <span class="min-w-0 flex-1 truncate text-xs opacity-70">{{ item.row.file.folder }}</span>
                        <span class="shrink-0 text-xs opacity-70 tabular-nums">{{ item.row.file.matches.length }}</span>
                    </button>
                    <div v-else class="h-full pl-3.5">
                        <div class="border-sidebar-border h-full border-l pl-2.5">
                            <button
                                :class="rowClass"
                                :data-active="item.index === activeIndex"
                                @click="handleMatchClick(item.index, item.row.match)"
                                @dblclick="emit('open', item.row.match, false)"
                            >
                                <span class="truncate"
                                    >{{ item.row.match.before
                                    }}<span :class="highlightClass">{{ item.row.match.highlight }}</span
                                    >{{ item.row.match.after }}</span
                                >
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </ScrollAreaViewport>
        <ScrollBar />
        <ScrollAreaCorner />
    </ScrollAreaRoot>
</template>
<script setup lang="ts">
import { computed, inject, ref, useTemplateRef, watch, type HTMLAttributes } from "vue";
import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaViewport } from "reka-ui";
import { useResizeObserver } from "@vueuse/core";
import { ChevronRight } from "@lucide/vue";
import { cn } from "@/lib/utils";
import ScrollBar from "@/components/ui/scroll-area/ScrollBar.vue";
import FileTypeIcon from "@/components/FileTypeIcon.vue";
import { getFileExtension } from "@/data/filesystem/util";
import { workbenchStateKey } from "../workbench/util";
import type { FileSearchResult, SearchMatch, SearchResultRow } from "./types";

/**
 * Height of a single row in pixels, all rows have to be equally high to be virtualized
 */
const ROW_HEIGHT = 32;

/**
 * Number of rows rendered above and below the visible area
 */
const OVERSCAN = 8;

/**
 * Space in pixels kept above the first and below the last row
 */
const LIST_PADDING = 4;

const props = defineProps<{
    class?: HTMLAttributes["class"];
    rows: SearchResultRow[];
    collapsedFiles: Set<string>;
}>();

const emit = defineEmits<{
    /**
     * Emitted when a match should be shown in the editor.
     * The match is only opened temporarily while it is browsed through.
     */
    open: [match: SearchMatch, temporary: boolean];
    /**
     * Emitted when the matches of a file should be shown or hidden
     */
    toggle: [file: FileSearchResult];
}>();

const { languagePluginByExtension } = inject(workbenchStateKey)!;

const viewportRef = useTemplateRef("viewport");
const activeIndex = ref(-1);
const scrollTop = ref(0);
const viewportHeight = ref(0);

const rows = computed(() => props.rows);

/**
 * The element that scrolls the results, provided by the scroll area
 */
const viewport = computed<HTMLElement | undefined>(() => viewportRef.value?.viewportElement);

/**
 * The rows that are currently within the visible area, together with their position
 */
const visibleRows = computed(() => {
    const total = props.rows.length;
    if (total === 0 || viewportHeight.value === 0) {
        return [];
    }

    const start = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(total, Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN);

    const visible: { index: number; row: SearchResultRow }[] = [];
    for (let index = start; index < end; index++) {
        visible.push({ index, row: props.rows[index]! });
    }
    return visible;
});

const rowClass =
    "flex h-full w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm outline-none " +
    "hover:bg-accent/75 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground [&_*]:pointer-events-none";

const highlightClass = "bg-yellow-200 dark:bg-yellow-800 rounded-xs";

useResizeObserver(viewport, (entries) => {
    viewportHeight.value = entries[0]?.contentRect.height ?? 0;
});

watch(rows, (newRows) => {
    if (activeIndex.value >= newRows.length) {
        activeIndex.value = newRows.length - 1;
    }
    if (newRows.length === 0) {
        activeIndex.value = -1;
        if (viewport.value != undefined) {
            viewport.value.scrollTop = 0;
        }
        scrollTop.value = 0;
    }
});

function handleScroll(event: Event): void {
    scrollTop.value = (event.target as HTMLElement).scrollTop;
}

/**
 * Moves the keyboard selection to a row and shows it in the editor if it is a match
 *
 * @param index the index of the row to select
 */
function selectRow(index: number): void {
    if (index < 0 || index >= props.rows.length) {
        return;
    }

    activeIndex.value = index;
    scrollIntoView(index);

    const row = props.rows[index]!;
    if (row.kind === "match") {
        emit("open", row.match, true);
    }
}

/**
 * Scrolls a row into view without moving it further than necessary
 *
 * @param index the index of the row to reveal
 */
function scrollIntoView(index: number): void {
    const element = viewport.value;
    if (element == undefined) {
        return;
    }

    const top = index * ROW_HEIGHT + LIST_PADDING;
    if (top < element.scrollTop) {
        element.scrollTop = top;
    } else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
        element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
}

/**
 * Handles a click on the row of a file
 *
 * @param index the index of the clicked row
 */
function handleFileClick(index: number): void {
    const row = props.rows[index];
    if (row?.kind !== "file") {
        return;
    }
    activeIndex.value = index;
    emit("toggle", row.file);
}

/**
 * Handles a click on the row of a match
 *
 * @param index the index of the clicked row
 * @param match the match of the clicked row
 */
function handleMatchClick(index: number, match: SearchMatch): void {
    activeIndex.value = index;
    emit("open", match, true);
}

function handleKeydown(event: KeyboardEvent): void {
    const rowCount = props.rows.length;
    if (rowCount === 0) {
        return;
    }

    const row = activeIndex.value >= 0 ? props.rows[activeIndex.value] : undefined;

    switch (event.key) {
        case "ArrowDown":
            event.preventDefault();
            selectRow(Math.min(activeIndex.value + 1, rowCount - 1));
            break;
        case "ArrowUp":
            event.preventDefault();
            selectRow(Math.max(activeIndex.value - 1, 0));
            break;
        case "Home":
            event.preventDefault();
            selectRow(0);
            break;
        case "End":
            event.preventDefault();
            selectRow(rowCount - 1);
            break;
        case "ArrowRight":
            if (row?.kind === "file" && props.collapsedFiles.has(row.file.id)) {
                event.preventDefault();
                emit("toggle", row.file);
            }
            break;
        case "ArrowLeft":
            if (row?.kind === "file" && !props.collapsedFiles.has(row.file.id)) {
                event.preventDefault();
                emit("toggle", row.file);
            } else if (row?.kind === "match") {
                event.preventDefault();
                const fileIndex = props.rows.findIndex((candidate) => candidate.id === row.file.id);
                if (fileIndex !== -1) {
                    activeIndex.value = fileIndex;
                    scrollIntoView(fileIndex);
                }
            }
            break;
        case "Enter":
            event.preventDefault();
            if (row?.kind === "match") {
                emit("open", row.match, false);
            } else if (row?.kind === "file") {
                emit("toggle", row.file);
            }
            break;
    }
}

/**
 * Moves the focus into the list and selects its first row if nothing is selected yet
 */
function focusFirstRow(): void {
    viewport.value?.focus();
    if (activeIndex.value < 0) {
        selectRow(0);
    }
}

defineExpose({ focusFirstRow });
</script>
