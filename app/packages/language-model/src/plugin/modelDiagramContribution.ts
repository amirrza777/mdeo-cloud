import type { AstNode } from "langium";
import type { ModelDataInstance, ModelDataLink } from "../features/modelData.js";

/**
 * Instances and links a contribution plugin computes for its own import, so
 * the diagram can render them alongside hand-authored objects.
 */
export interface ModelDiagramContributionData {
    instances: ModelDataInstance[];
    links: ModelDataLink[];
}

/**
 * Optional Langium service a model import contribution plugin can implement
 * to supply diagram nodes for its own import, keeping the interpretation of
 * its own data (reading files, mapping columns, or whatever else a future
 * format needs) inside the plugin rather than in `language-model`.
 *
 * A plugin's own language services are already loaded into the same shared
 * environment as the Model language's (see `ModelContributionPlugin.languageKey`
 * and the workbench's plugin loading), so this is looked up through the
 * ordinary Langium `ServiceRegistry` rather than needing any new mechanism to
 * reach it. A plugin that does not implement it simply contributes no diagram
 * nodes; nothing else is affected.
 */
export interface ModelDiagramContributionServices {
    /**
     * Computes the diagram data for one instance of this plugin's import.
     *
     * @param importContent The import's own content node, exactly as parsed
     *   by the plugin's grammar, so the plugin can interpret whatever shape
     *   it defined for itself
     * @returns The instances and links to render for this import
     */
    computeDiagramData(importContent: AstNode): ModelDiagramContributionData | Promise<ModelDiagramContributionData>;
}

/**
 * Services that optionally provide a {@link ModelDiagramContributionServices}
 * under a `diagram` group, the location `ModelGModelFactory` looks for it in.
 */
export interface ModelDiagramContributionAdditionalServices {
    diagram?: {
        Contribution?: ModelDiagramContributionServices;
    };
}
