import type { LangiumCoreServices, ServiceRegistry } from "langium";

/**
 * Finds another plugin's full Langium services by its language ID.
 *
 * Every plugin's language services are registered in the same shared
 * `ServiceRegistry`, indexed by language ID among other things. This is the
 * mechanism that lets one plugin call into another's services directly (e.g.
 * scope resolution, AST serialization, diagram rendering) without any RPC or
 * dynamic-import mechanism.
 *
 * @param registry The shared Langium service registry
 * @param languageId The target plugin's language ID (its `languageKey`)
 * @returns The plugin's language services, or undefined if none is registered under that ID
 */
export function getServicesByLanguageId(registry: ServiceRegistry, languageId: string): LangiumCoreServices | undefined {
    return registry.all.find((services) => services.LanguageMetaData.languageId === languageId);
}
