import type { AstNode, URI } from "langium";
import { AstUtils } from "langium";
import type { ExtendedLangiumServices } from "@mdeo/language-common";
import { resolveRelativePath } from "@mdeo/language-shared";
import type { ClassType } from "@mdeo/language-metamodel";
import {
    resolveMetamodelClassInfo,
    type MetamodelClassInfo,
    type ModelDiagramContributionData,
    type ModelDiagramContributionServices
} from "@mdeo/language-model";
import type { CsvImportBlockType } from "../grammar/csvImportTypes.js";
import { importCsvEntries, type CsvImportEntry } from "./csvImport.js";

/**
 * Computes diagram nodes for the CSV import contribution.
 *
 * Runs entirely in-process, in whichever environment loaded this plugin's
 * language services (the workbench today): it reads the referenced CSV files
 * (see {@link readCsvText}) and interprets them with the same
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
        const classHierarchyByName = new Map<string, string[] | undefined>();
        const seenClasses = new Set<string>();

        for (const entry of content.imports ?? []) {
            const classRef = entry.class?.ref as ClassType | undefined;
            if (classRef == undefined) {
                continue;
            }

            if (!seenClasses.has(classRef.name)) {
                seenClasses.add(classRef.name);
                const classInfo = resolveMetamodelClassInfo(classRef, this.services.shared.AstReflection);
                metamodelClasses.push(classInfo);
                classHierarchyByName.set(classRef.name, classInfo.classHierarchy);
            }

            try {
                const uri = resolveRelativePath(doc, entry.file ?? "");
                entries.push({
                    className: classRef.name,
                    csvText: await this.readCsvText(uri),
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
        const instancesWithHierarchy = instances.map((instance) => ({
            ...instance,
            classHierarchy: classHierarchyByName.get(instance.className)
        }));
        return { instances: instancesWithHierarchy, links };
    }

    /**
     * Reads one referenced CSV file through the workspace's documents, which
     * caches it and — more importantly — registers it as a document the
     * workspace tracks, so editing the CSV re-renders the diagram.
     *
     * That resolves the file by extension, so it needs a plugin that registers
     * a language for it: `.csv` comes from the separate CSV plugin, which an
     * installation can perfectly well not have enabled. Rather than silently
     * papering over that here, `CsvImportValidator` reports it on the import
     * itself, so the user sees which plugin to enable instead of an empty
     * diagram. This throws in the meantime, and the caller skips the entry.
     *
     * @param uri The resolved URI of the CSV file
     * @returns The file's text
     */
    private async readCsvText(uri: URI): Promise<string> {
        const document = await this.services.shared.workspace.LangiumDocuments.getOrCreateDocument(uri);
        return document.textDocument.getText();
    }
}
