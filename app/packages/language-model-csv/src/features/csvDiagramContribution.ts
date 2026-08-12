import type { AstNode } from "langium";
import { AstUtils } from "langium";
import type { ExtendedLangiumServices } from "@mdeo/language-common";
import { resolveRelativePath } from "@mdeo/language-shared";
import { resolveClassChain, type ClassType, type PropertyType } from "@mdeo/language-metamodel";
import type { ModelDiagramContributionData, ModelDiagramContributionServices } from "@mdeo/language-model";
import type { CsvImportBlockType } from "../grammar/csvImportTypes.js";
import { importCsvEntries, type CsvImportEntry, type MetamodelClassInfo, type MetamodelPropertyInfo } from "./csvImport.js";

/**
 * Computes diagram nodes for the CSV import contribution.
 *
 * Runs entirely in-process, in whichever environment loaded this plugin's
 * language services (the workbench today): it reads the referenced CSV files
 * through its own `LangiumDocuments`, the same way the rest of this codebase
 * reads a cross-referenced file, and interprets them with the same
 * {@link importCsvEntries} the backend uses for the same purpose. Nothing
 * here is specific to how it is called; `language-model`'s diagram factory
 * only knows it as a {@link ModelDiagramContributionServices}.
 */
export class CsvDiagramContribution implements ModelDiagramContributionServices {
    constructor(private readonly services: ExtendedLangiumServices) {}

    async computeDiagramData(importContent: AstNode): Promise<ModelDiagramContributionData> {
        const content = importContent as CsvImportBlockType;
        const doc = AstUtils.getDocument(importContent);

        const entries: CsvImportEntry[] = [];
        const metamodelClasses: MetamodelClassInfo[] = [];
        const seenClasses = new Set<string>();

        for (const entry of content.imports ?? []) {
            const classRef = entry.class?.ref as ClassType | undefined;
            if (classRef == undefined) {
                continue;
            }

            if (!seenClasses.has(classRef.name)) {
                seenClasses.add(classRef.name);
                metamodelClasses.push(this.toMetamodelClassInfo(classRef));
            }

            try {
                const uri = resolveRelativePath(doc, entry.file ?? "");
                const csvDocument = await this.services.shared.workspace.LangiumDocuments.getOrCreateDocument(uri);
                entries.push({
                    className: classRef.name,
                    csvText: csvDocument.textDocument.getText(),
                    mappings: (entry.mappings ?? []).map((mapping) => ({
                        csvColumn: mapping.csvColumn,
                        property: mapping.property
                    }))
                });
            } catch {
                // Unreadable CSV: skip this entry, the rest of the import is
                // still rendered. Matches how the platform generally treats
                // one broken reference as not fatal to the whole diagram.
            }
        }

        const { instances, links } = importCsvEntries(entries, metamodelClasses);
        return { instances, links };
    }

    /**
     * Converts a resolved class (and its extended classes) into the plain
     * metamodel description {@link importCsvEntries} maps CSV columns
     * against, flattening inherited properties the same way column
     * resolution already treated them.
     *
     * Only plain attributes are included, matching this plugin's existing
     * scope: reference/association-end properties are not resolved here, so
     * a CSV import does not (yet) produce links, the same as before this was
     * moved out of `language-model`.
     *
     * @param classType The imported class, already resolved
     * @returns The class described in the shape `importCsvEntries` expects
     */
    private toMetamodelClassInfo(classType: ClassType): MetamodelClassInfo {
        const chain = resolveClassChain(classType, this.services.shared.AstReflection);

        const seen = new Set<string>();
        const properties: MetamodelPropertyInfo[] = [];
        for (const cls of chain) {
            for (const property of cls.properties ?? []) {
                if (property?.name != undefined && !seen.has(property.name)) {
                    seen.add(property.name);
                    properties.push(this.toMetamodelPropertyInfo(property));
                }
            }
        }

        return { name: classType.name, properties };
    }

    /**
     * Converts one resolved property into the plain shape
     * {@link importCsvEntries} expects.
     *
     * @param property The property, already resolved
     * @returns The property described generically
     */
    private toMetamodelPropertyInfo(property: PropertyType): MetamodelPropertyInfo {
        const type = property.type as
            | { name?: string; enum?: { ref?: { name?: string; entries?: { name: string }[] } } }
            | undefined;

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
