import { createRule, many, optional, or, ref, group, createExternalTerminalRule } from "@mdeo/language-common";
import { CsvClassImport, CsvColumnMapping, CsvImportBlock, ExternalClass } from "./csvImportTypes.js";

/**
 * Stand-ins for the base language's common terminals, so this grammar's
 * serialized form marks them as external rather than inlining duplicate
 * definitions. The real terminals are supplied via the deserialization
 * context wherever this grammar is merged in.
 */
const ID = createExternalTerminalRule<string>("ID");
const STRING = createExternalTerminalRule<string>("STRING");
const NEWLINE = createExternalTerminalRule<string>("NEWLINE");

export const CsvColumnMappingRule = createRule("CsvColumnMappingRule")
    .returns(CsvColumnMapping)
    .as(({ set }) => [set("csvColumn", STRING), "=", set("property", ID)]);

/**
 * The optional explicit mapping list is introduced by the "with" keyword,
 * the same way the model-transformation grammar disambiguates two adjacent
 * brace blocks in one rule (e.g. `match { pattern } then { block }`): the
 * keyword between them is what tells the parser which block it's entering,
 * not the bracket type. Reusing bare curly braces here, with nothing between
 * `file` and the mapping list's own "{", caused the parser to misread the
 * mapping list's opening brace as the start of a new class import.
 */
export const CsvClassImportRule = createRule("CsvClassImportRule")
    .returns(CsvClassImport)
    .as(({ set, add }) => [
        set("class", ref(ExternalClass, ID)),
        "from",
        set("file", STRING),
        optional(
            group("with", "{", many(or(add("mappings", CsvColumnMappingRule), NEWLINE)), "}")
        )
    ]);

/**
 * The content of a CSV import block (everything between the braces).
 * The `import CSV` keywords themselves are added by the wrapper rule the
 * Model language builds around this contribution, not by this rule.
 */
export const CsvImportContentRule = createRule("CsvImportContentRule")
    .returns(CsvImportBlock)
    .as(({ add }) => ["{", many(or(add("imports", CsvClassImportRule), NEWLINE)), "}"]);
