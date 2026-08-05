import type { ModelDataInstance, ModelDataLink } from "@mdeo/language-model";
import type { FileDependency, DataDependency } from "@mdeo/service-common";

/**
 * Description of a single metamodel property, as sent to import plugins.
 *
 * Import plugins map their own source data (CSV columns, spreadsheet fields, and
 * so on) onto these, so they need to know each property's name and type without
 * having to resolve the metamodel document themselves.
 */
export interface MetamodelPropertyInfo {
    /**
     * Name of the property as declared in the metamodel.
     */
    name: string;

    /**
     * The property's declared type. `reference` means the property is an
     * association end rather than an attribute.
     */
    type: "string" | "int" | "long" | "double" | "float" | "boolean" | "enum" | "reference";

    /**
     * For enum-typed properties, the names of the enum's entries.
     */
    enumEntries?: string[];

    /**
     * True when the property is an association end.
     */
    isReference?: boolean;

    /**
     * For reference properties, the name of the class being referenced.
     */
    referencedClass?: string;
}

/**
 * Description of a single metamodel class, as sent to import plugins.
 */
export interface MetamodelClassInfo {
    /**
     * Name of the class as declared in the metamodel.
     */
    name: string;

    /**
     * The class' properties.
     */
    properties: MetamodelPropertyInfo[];
}

/**
 * Request body sent to a model import contribution plugin's request handler.
 *
 * Mirrors `ConfigPluginRequestBody`: the model service extracts the text of the
 * plugin's own import block and hands it back to the plugin's service, so the
 * plugin parses and interprets its own syntax rather than the model service
 * knowing anything about it.
 */
export interface ModelPluginRequestBody {
    /**
     * The source text of this plugin's import block content, without the
     * surrounding `import <Name>` keywords.
     */
    text: string;

    /**
     * URI string of the originating `.m` file. Used to build a stable synthetic
     * document URI and to resolve paths referenced by the import relative to it.
     */
    modelFileUri: string;

    /**
     * Path of the metamodel the model imports, as written in the `.m` file.
     */
    metamodelPath: string;

    /**
     * The metamodel's classes, so the plugin can map its source data onto them
     * without resolving the metamodel document itself.
     */
    metamodelClasses: MetamodelClassInfo[];
}

/**
 * The instances and links produced by one import contribution plugin.
 */
export interface ModelPluginData {
    /**
     * Object instances derived from the plugin's imported data.
     */
    instances: ModelDataInstance[];

    /**
     * Links derived from the plugin's imported data.
     */
    links: ModelDataLink[];

    /**
     * Non-fatal problems encountered while importing (unknown columns, unresolved
     * references, and similar). Present so the host service can surface them.
     */
    warnings?: string[];
}

/**
 * Response returned by a model import contribution plugin's request handler.
 *
 * As with the config equivalent, dependencies MUST be reported even when
 * {@link data} is `null`, so the host service can propagate them to the cache
 * and avoid incorrect cache invalidation.
 *
 * @template T The type of the payload.
 */
export interface ModelPluginRequestResponse<T = ModelPluginData> {
    /**
     * The computed import data, or `null` when the plugin could not produce a
     * valid result (for example a parse or validation error).
     */
    data: T | null;

    /**
     * Files (and their versions) read while processing the import.
     */
    fileDependencies: FileDependency[];

    /**
     * Other file-data computations consulted while processing the import.
     */
    dataDependencies: DataDependency[];
}

/**
 * Request-handler key used by model import contribution plugin services to
 * register and handle import-data requests from the model service.
 */
export const MODEL_PLUGIN_REQUEST_KEY = "model-import";
