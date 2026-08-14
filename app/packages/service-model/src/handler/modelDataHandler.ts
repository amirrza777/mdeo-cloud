import {
    type ModelData,
    type ModelServices,
    ModelDataConverter,
    Model,
    ModelContributionPlugin,
    pluginForImport,
    resolveMetamodelClassInfo
} from "@mdeo/language-model";
import { Class, type ClassType } from "@mdeo/language-metamodel";
import type { AstReflection } from "@mdeo/language-common";
import type {
    MetamodelClassInfo,
    ModelPluginData,
    ModelPluginRequestBody,
    ModelPluginRequestResponse
} from "@mdeo/service-model-common";
import { MODEL_PLUGIN_REQUEST_KEY } from "@mdeo/service-model-common";
import { hasErrors, type FileDataHandler, type FileDependency, type DataDependency } from "@mdeo/service-common";
import { resolveRelativePath } from "@mdeo/language-shared";
import type { AstNode } from "langium";

export const MODEL_DATA_HANDLER_KEY = "model-data";

/**
 * Extracts a flat description of a metamodel's classes for import plugins.
 *
 * Import plugins map their own source data onto the metamodel but have no access
 * to the metamodel document, so this is sent to them as plain data. Uses the
 * same {@link resolveMetamodelClassInfo} the diagram-rendering side of an
 * import contribution plugin uses, so both agree on what a class looks like
 * (its full inherited attribute and reference properties) instead of two
 * independent implementations that can silently drift apart.
 *
 * @param metamodelAst The parsed metamodel document root
 * @param reflection The AST reflection used for chain and association resolution
 * @returns One entry per class declared in the metamodel
 */
function extractMetamodelClasses(
    metamodelAst: { elements?: AstNode[] } | undefined,
    reflection: AstReflection
): MetamodelClassInfo[] {
    return (metamodelAst?.elements ?? [])
        .filter((element): element is ClassType => reflection.isInstance(element, Class))
        .map((cls) => resolveMetamodelClassInfo(cls, reflection));
}

/**
 * File-data handler that computes the structured data for a model file.
 *
 * Hand-authored objects and links are converted directly. Imported data is not:
 * the model service has no knowledge of any particular import format, so for
 * each contribution plugin whose import appears in the file it forwards that
 * import block's own source text to the plugin's language service and merges
 * back the instances and links the plugin returns. This mirrors how the config
 * service delegates each section to the plugin that contributes it, and keeps
 * the model service independent of CSV or any other future import format.
 *
 * Returns `null` when the document has errors, or when any plugin reports that
 * it could not produce a valid result.
 */
export const modelDataHandler: FileDataHandler<ModelData | null, ModelServices> = async (context) => {
    const { instance, fileInfo, serverApi, contributionPlugins } = context;

    if (fileInfo == undefined) {
        return {
            data: null,
            ...serverApi.getTrackedRequests()
        };
    }

    const document = await instance.buildDocument(fileInfo.uri);

    if (hasErrors(document)) {
        return {
            data: null,
            ...serverApi.getTrackedRequests()
        };
    }

    const model = document.parseResult.value;
    const reflection = instance.services.shared.AstReflection;

    if (!reflection.isInstance(model, Model)) {
        throw new Error("Document root is not a Model");
    }

    const converter = new ModelDataConverter(reflection);
    const handAuthored = converter.convertModel(model);

    const modelImports = (model.imports ?? []) as (AstNode & { content?: AstNode })[];
    const activeModelPlugins = contributionPlugins.filter(ModelContributionPlugin.is);

    if (modelImports.length === 0 || activeModelPlugins.length === 0) {
        return {
            data: handAuthored,
            ...serverApi.getTrackedRequests()
        };
    }

    const metamodelPath = model.import?.file;
    if (!metamodelPath) {
        return { data: null, ...serverApi.getTrackedRequests() };
    }

    const metamodelUri = resolveRelativePath(document, metamodelPath);
    const metamodelDoc = instance.services.shared.workspace.LangiumDocuments.getDocument(metamodelUri);
    if (!metamodelDoc) {
        return { data: null, ...serverApi.getTrackedRequests() };
    }

    const metamodelClasses = extractMetamodelClasses(
        metamodelDoc.parseResult?.value as { elements?: AstNode[] },
        reflection
    );

    const importedInstances: ModelData["instances"] = [];
    const importedLinks: ModelData["links"] = [];
    const accumulatedFileDeps: FileDependency[] = [];
    const accumulatedDataDeps: DataDependency[] = [];

    const contributionImports = instance.services.contributions.Imports;
    const partialBlocksByPlugin = new Map<string, string[]>();
    for (const modelImport of modelImports) {
        const namingInfo = pluginForImport(contributionImports, modelImport);
        if (namingInfo == undefined) {
            continue;
        }
        const contentText = modelImport.content?.$cstNode?.text ?? "";
        if (contentText === "") {
            continue;
        }
        const blocks = partialBlocksByPlugin.get(namingInfo.plugin.languageKey) ?? [];
        blocks.push(`import ${namingInfo.importName} ${contentText}`);
        partialBlocksByPlugin.set(namingInfo.plugin.languageKey, blocks);
    }

    for (const plugin of activeModelPlugins) {
        const partialBlocks = partialBlocksByPlugin.get(plugin.languageKey);

        if (partialBlocks == undefined || partialBlocks.length === 0) {
            continue;
        }

        const requestBody: ModelPluginRequestBody = {
            text: `using "${metamodelPath}"\n\n${partialBlocks.join("\n")}`,
            modelFileUri: fileInfo.uri.toString(),
            metamodelPath,
            metamodelClasses
        };

        const rawPluginResult = await serverApi.sendPluginRequest(
            plugin.languageKey,
            MODEL_PLUGIN_REQUEST_KEY,
            requestBody
        );
        const pluginResponse = rawPluginResult as ModelPluginRequestResponse<ModelPluginData>;

        accumulatedFileDeps.push(...(pluginResponse?.fileDependencies ?? []));
        accumulatedDataDeps.push(...(pluginResponse?.dataDependencies ?? []));

        if (pluginResponse?.data == null) {
            const trackedRequests = serverApi.getTrackedRequests();
            return {
                data: null,
                fileDependencies: [...trackedRequests.fileDependencies, ...accumulatedFileDeps],
                dataDependencies: [...trackedRequests.dataDependencies, ...accumulatedDataDeps]
            };
        }

        importedInstances.push(...(pluginResponse.data.instances ?? []));
        importedLinks.push(...(pluginResponse.data.links ?? []));
    }

    const modelData: ModelData = {
        metamodelPath,
        instances: [...handAuthored.instances, ...importedInstances],
        links: [...handAuthored.links, ...importedLinks]
    };

    const trackedRequests = serverApi.getTrackedRequests();
    return {
        data: modelData,
        fileDependencies: [...trackedRequests.fileDependencies, ...accumulatedFileDeps],
        dataDependencies: [...trackedRequests.dataDependencies, ...accumulatedDataDeps]
    };
};
