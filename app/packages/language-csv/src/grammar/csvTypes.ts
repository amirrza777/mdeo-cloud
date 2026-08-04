import { createInterface, Optional, type ASTType } from "@mdeo/language-common";

/**
 * A CSV file's contents, held as a single blob of text.
 *
 * `content` is optional because an empty file is a valid CSV file. The
 * workbench offers a "Create New CSV" action, which produces an empty file, so
 * requiring content would put every newly created CSV straight into a parse
 * error state.
 */
export const CsvFile = createInterface("CsvFile").attrs({
    content: Optional(String)
});

export type CsvFileType = ASTType<typeof CsvFile>;
