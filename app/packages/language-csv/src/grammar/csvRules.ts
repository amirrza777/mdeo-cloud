import { createTerminal, createRule, optional, WS } from "@mdeo/language-common";
import { CsvFile } from "./csvTypes.js";

/**
 * Matches a whole CSV file as one token. The CSV language does no structural
 * parsing of its own, the content is interpreted where it is imported.
 *
 * The pattern requires at least one character, since a terminal that can match
 * the empty string would never advance the lexer. An empty file is handled by
 * making the assignment optional in the rule below rather than by allowing an
 * empty match here.
 */
export const ANY_TEXT = createTerminal("ANY_TEXT").as(/[\s\S]+/);

export const CsvFileRule = createRule("CsvFileRule")
    .returns(CsvFile)
    .as(({ set }) => [optional(set("content", ANY_TEXT))]);

export const CsvTerminals = [WS, ANY_TEXT];
