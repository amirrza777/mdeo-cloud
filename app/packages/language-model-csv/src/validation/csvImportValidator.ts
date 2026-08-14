import type { ValidationAcceptor, ValidationChecks } from "langium";
import { UriUtils } from "langium";
import type { ExtendedLangiumServices } from "@mdeo/language-common";
import { resolveRelativePath, sharedImport } from "@mdeo/language-shared";
import type { CsvClassImportType } from "../grammar/csvImportTypes.js";

const { AstUtils } = sharedImport("langium");

/**
 * Interface mapping for the AST types this contribution validates.
 */
interface CsvImportAstTypes {
    CsvClassImport: CsvClassImportType;
}

/**
 * Registers this contribution's validation checks.
 *
 * They run against `import CSV` blocks in `.m` documents: the model language's
 * validator hands each contributed import back to the plugin that contributed
 * it, so these checks see the real node the user is editing and report on it.
 *
 * They do not run in the model-csv service, which builds its synthetic
 * documents with validation off — deliberately, since it has neither the
 * metamodel nor the workspace to check anything against.
 *
 * @param services This plugin's language services
 */
export function registerCsvImportValidationChecks(services: ExtendedLangiumServices): void {
    const validator = new CsvImportValidator(services);

    const checks: ValidationChecks<CsvImportAstTypes> = {
        CsvClassImport: validator.validateClassImport.bind(validator)
    };

    services.validation.ValidationRegistry.register(checks, validator);
}

/**
 * Validator for the CSV import contribution.
 */
export class CsvImportValidator {
    constructor(private readonly services: ExtendedLangiumServices) {}

    /**
     * Checks that the imported file's type is one this workspace can read.
     *
     * Files are read through the workspace's documents, which resolves them by
     * file extension — so a `.csv` file can only be read when some enabled
     * plugin registers a language for `.csv`. That is the separate CSV plugin,
     * and this one does not depend on it at load time, so an installation can
     * end up with the import syntax available and no way to read what it
     * points at.
     *
     * Reporting it here turns that into a plain editor error naming the plugin
     * to enable, rather than an import that quietly produces nothing.
     *
     * @param entry The class import entry
     * @param accept The validation acceptor
     */
    validateClassImport(entry: CsvClassImportType, accept: ValidationAcceptor): void {
        const file = entry.file;
        if (!file) {
            return;
        }

        const uri = resolveRelativePath(AstUtils.getDocument(entry), file);
        const extension = UriUtils.extname(uri);
        const isRegistered = this.services.shared.ServiceRegistry.all.some((services) =>
            services.LanguageMetaData.fileExtensions.includes(extension)
        );

        if (!isRegistered) {
            accept(
                "error",
                `No enabled plugin can read '${extension}' files, so this import cannot be resolved. ` +
                    `Enable the CSV plugin for this project to import '${extension}' data.`,
                { node: entry, property: "file" }
            );
        }
    }
}
