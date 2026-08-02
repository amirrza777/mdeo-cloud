<template>
    <div class="h-screen w-screen flex">
        <SidebarRail />
        <div ref="workbench" class="flex-1 min-w-0">
            <ResizablePanelGroup direction="horizontal">
                <SplitterPanel
                    ref="sidebarPanel"
                    :min-size="minSidebarWidth"
                    :max-size="80"
                    :default-size="sidebarDefaultWidth"
                    :collapsed-size="0"
                    collapsible
                    @resize="onSidebarResize"
                    @collapse="workbenchState.sidebarCollapsed.value = true"
                    @expand="workbenchState.sidebarCollapsed.value = false"
                >
                    <Sidebar />
                </SplitterPanel>
                <ResizableHandle />
                <SplitterPanel>
                    <div class="flex flex-col h-full w-full">
                        <Tabs />
                        <Editor
                            v-if="workbenchState.languageClient.value != undefined"
                            :key="workbenchState.clientVersionCounter.value"
                            v-show="workbenchState.tabs.value.length > 0"
                        />
                        <WorkbenchBackground v-show="workbenchState.tabs.value.length == 0" />
                    </div>
                </SplitterPanel>
            </ResizablePanelGroup>
        </div>
    </div>
    <Teleport to="head">
        <link v-for="styleUrl in pluginStylesUrls" rel="stylesheet" :href="styleUrl" as="style" />
    </Teleport>
    <ActionDialog :workbench-state="workbenchState" />
</template>
<script setup lang="ts">
import { computed, provide, ref, Teleport, useTemplateRef, watch } from "vue";
import Tabs from "../tabs/Tabs.vue";
import { ResizablePanelGroup, ResizableHandle } from "../ui/resizable";
import Sidebar from "../sidebar/Sidebar.vue";
import SidebarRail from "../sidebar/SidebarRail.vue";
import Editor from "../editor/Editor.vue";
import WorkbenchBackground from "./WorkbenchBackground.vue";
import ActionDialog from "../action/ActionDialog.vue";
import { useEventListener, useResizeObserver } from "@vueuse/core";
import type * as monacoType from "monaco-editor";
import { SplitterPanel } from "reka-ui";
import { authStateKey, workbenchStateKey } from "./util";
import type { WorkbenchState } from "@/data/workbenchState";
import type { AuthState } from "@/data/authState";

const props = defineProps<{
    workbenchState: WorkbenchState;
    authState: AuthState;
}>();

provide(workbenchStateKey, props.workbenchState);
provide(authStateKey, props.authState);

const workbenchWidth = ref<number>();
const absoluteMinSidebarWidth = 150;
const minSidebarWidth = ref(10);
const absoluteSidebarWidth = ref(300);

const workbench = useTemplateRef("workbench");
const sidebarPanel = useTemplateRef("sidebarPanel");

const sidebarDefaultWidth = computed(() => {
    if (workbenchWidth.value != undefined) {
        return (absoluteSidebarWidth.value / workbenchWidth.value) * 100;
    }
    return undefined;
});

useResizeObserver(workbench, (entries) => {
    const entry = entries[0];
    if (entry != undefined) {
        workbenchWidth.value = entry.contentRect.width;
        minSidebarWidth.value = Math.max((absoluteMinSidebarWidth / entry.contentRect.width) * 100, 0.1);
    }
});

function onSidebarResize(size: number) {
    if (workbenchWidth.value != undefined) {
        absoluteSidebarWidth.value = (size / 100) * workbenchWidth.value;
    }
}

const sidebarCollapsed = computed(() => props.workbenchState.sidebarCollapsed.value);

watch(
    sidebarCollapsed,
    (newValue) => {
        if (newValue) {
            sidebarPanel.value?.collapse();
        } else {
            sidebarPanel.value?.expand();
        }
    },
    { immediate: true }
);

watch(
    () => sidebarPanel.value,
    (panel) => {
        if (panel) {
            if (props.workbenchState.sidebarCollapsed.value) {
                panel.collapse();
            } else {
                panel.expand();
            }
        }
    }
);

useEventListener(
    window,
    "keydown",
    (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) {
            return;
        }
        if (event.key.toLowerCase() !== "f") {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        props.workbenchState.revealSearch(getSelectedText());
    },
    { capture: true }
);

/**
 * Reads the text that is currently selected, either in the active editor or in the document.
 * Selections spanning multiple lines are ignored, as they are not useful as a search term.
 *
 * @returns the selected text, or undefined if nothing usable is selected
 */
function getSelectedText(): string | undefined {
    const editor = props.workbenchState.monacoApi.editorService.activeTextEditorControl as
        | monacoType.editor.ICodeEditor
        | undefined;
    const selection = editor?.getSelection?.();
    const model = editor?.getModel?.();

    if (selection != undefined && model != undefined && "getValueInRange" in model && !selection.isEmpty()) {
        return singleLine(model.getValueInRange(selection));
    }

    return singleLine(window.getSelection()?.toString());
}

/**
 * Restricts a selection to a usable search term.
 *
 * @param text the selected text
 * @returns the text if it is a non empty single line, undefined otherwise
 */
function singleLine(text: string | undefined): string | undefined {
    if (text == undefined || text.length === 0 || text.includes("\n")) {
        return undefined;
    }
    return text;
}

const pluginStylesUrls = computed(() =>
    props.workbenchState.languagePlugins.value
        .map((plugin) => plugin.graphicalEditorPlugin?.stylesUrl)
        .filter((url) => url != undefined)
);

/**
 * Triggers the demo action dialog by setting the pending action.
 * This demonstrates the action dialog feature with multi-step forms.
 */
function triggerDemoAction(): void {
    props.workbenchState.pendingAction.value = {
        type: "demo",
        languageId: "model",
        data: {}
    };
}
</script>
