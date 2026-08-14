import type { AstReflection } from "@mdeo/language-common";
import { resolveClassChain, type ClassType, type PropertyType } from "@mdeo/language-metamodel";
import { BaseMetamodelHelper } from "../features/baseMetamodelHelper.js";

/**
 * Description of a single metamodel property, generic enough for an import
 * contribution plugin to map its own source data onto without resolving the
 * metamodel document itself.
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
 * Description of a single metamodel class, flattened across its full
 * inheritance chain.
 */
export interface MetamodelClassInfo {
    /**
     * Name of the class as declared in the metamodel.
     */
    name: string;

    /**
     * The class' own name followed by all its superclasses' names, in
     * resolution order.
     *
     * Optional so a plain wire-format description (crossing an RPC boundary
     * where only `properties` is needed to interpret source data) stays
     * assignable to this type without carrying a field it never reads.
     */
    classHierarchy?: string[];

    /**
     * The class' properties: its own attributes and association ends, plus
     * every superclass' in the same shape, deduplicated by name.
     */
    properties: MetamodelPropertyInfo[];
}

class MetamodelClassInfoResolver extends BaseMetamodelHelper {
    resolve(classType: ClassType): MetamodelClassInfo {
        const chain = resolveClassChain(classType, this.reflection);
        const chainSet = new Set(chain);

        const seen = new Set<string>();
        const properties: MetamodelPropertyInfo[] = [];

        for (const cls of chain) {
            for (const property of cls.properties ?? []) {
                if (property?.name != undefined && !seen.has(property.name)) {
                    seen.add(property.name);
                    properties.push(this.toAttributePropertyInfo(property));
                }
            }
        }

        for (const association of this.findAssociationsForClass(classType)) {
            const sourceClass = this.resolveToClass(association.source?.class?.ref);
            const targetClass = this.resolveToClass(association.target?.class?.ref);

            if (sourceClass != undefined && chainSet.has(sourceClass) && association.target?.name != undefined) {
                this.addReferenceProperty(properties, seen, association.target.name, targetClass?.name);
            }
            if (targetClass != undefined && chainSet.has(targetClass) && association.source?.name != undefined) {
                this.addReferenceProperty(properties, seen, association.source.name, sourceClass?.name);
            }
        }

        return {
            name: classType.name,
            classHierarchy: chain.map((cls) => cls.name),
            properties
        };
    }

    private addReferenceProperty(
        properties: MetamodelPropertyInfo[],
        seen: Set<string>,
        name: string,
        referencedClass: string | undefined
    ): void {
        if (seen.has(name)) {
            return;
        }
        seen.add(name);
        properties.push({ name, type: "reference", isReference: true, referencedClass });
    }

    private toAttributePropertyInfo(property: PropertyType): MetamodelPropertyInfo {
        const type = property.type as
            { name?: string; enum?: { ref?: { name?: string; entries?: { name: string }[] } } } | undefined;

        if (type?.enum != undefined) {
            return {
                name: property.name,
                type: "enum",
                enumEntries: type.enum.ref?.entries?.map((entry) => entry.name) ?? []
            };
        }

        return {
            name: property.name,
            type: (type?.name as MetamodelPropertyInfo["type"] | undefined) ?? "string"
        };
    }
}

/**
 * Flattens a resolved metamodel class into a plain description covering its
 * full inheritance chain: attribute properties and association-end
 * (reference) properties, both from the class itself and its superclasses.
 *
 * This is the single place that answers "what does this class look like" for
 * an import contribution plugin, so a plugin's diagram rendering and the
 * model service's own data computation for that plugin agree on the same
 * answer instead of maintaining two implementations that can drift apart.
 *
 * @param classType The resolved class
 * @param reflection The AST reflection used for chain and association resolution
 * @returns The class described generically, with inherited attributes and references
 */
export function resolveMetamodelClassInfo(classType: ClassType, reflection: AstReflection): MetamodelClassInfo {
    return new MetamodelClassInfoResolver(reflection).resolve(classType);
}
