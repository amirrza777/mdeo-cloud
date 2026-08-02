import { TextDocument } from "langium";
import type { AstNode, LangiumDocument } from "langium";
import { hasParserErrors } from "@mdeo/service-common";
import type { RequestContext } from "@mdeo/service-common";
import type { ModelPluginRequestBody } from "./modelPluginTypes.js";

/**
 * A parsed import block belonging to the requesting plugin.
 */
export interface ModelPluginImport {
    /**
     * The wrapper node's `$type`, i.e. the wrapper interface name for the import keyword.
     */
    type: string;

    /**
     * The import block's content node, as defined by the plugin's own grammar.
     */
    content: AstNode;
}

/**
 * Discriminated union returned by {@link buildModelPluginDocument}.
 *
 * - `"empty"` - the request carried no text, or the parsed document contained no
 *   imports; callers should return an empty but valid response.
 * - `"error"` - the text could not be parsed; callers should return `data: null`
 *   while still reporting tracked dependencies.
 * - `"success"` - the document parsed; callers can walk {@link imports}.
 */
export type ModelPluginDocumentResult =
    | { type: "empty" }
    | { type: "error" }
    | {
          type: "success";
          /**
           * The built Langium document.
           */
          document: LangiumDocument;
          /**
           * The import blocks contributed by this plugin.
           */
          imports: ModelPluginImport[];
          /**
           * The decoded request body supplied by the model service.
           */
          requestBody: ModelPluginRequestBody;
      };

/**
 * Builds a partial model document for an import contribution plugin.
 *
 * Mirrors `buildConfigPluginDocument`, with one deliberate difference: only
 * parser errors are treated as failures, not validation errors. A plugin's
 * service has the plugin's own grammar but not the metamodel document, so
 * cross-references into the metamodel cannot be linked here and would otherwise
 * always report as errors. That costs nothing, because the model service has
 * already validated the real `.m` document (including those references) before
 * forwarding anything; plugins read referenced names from `$refText`.
 *
 * The synthetic document is given the originating `.m` file's URI so that paths
 * written inside the import block resolve relative to the model file, exactly as
 * they do in the model service.
 *
 * @param context The request context injected by the service framework
 * @param languageKey The language ID of this contribution plugin's language
 * @returns A discriminated {@link ModelPluginDocumentResult}
 */
export async function buildModelPluginDocument<S extends object>(
    context: RequestContext<S>,
    languageKey: string
): Promise<ModelPluginDocumentResult> {
    const requestBody = context.body as ModelPluginRequestBody;
    const text = requestBody?.text ?? "";

    if (!text.trim()) {
        return { type: "empty" };
    }

    const textDocument = TextDocument.create(requestBody.modelFileUri, languageKey, 0, text);
    context.services.shared.workspace.TextDocuments.set(textDocument);
    const document = context.services.shared.workspace.LangiumDocumentFactory.fromTextDocument(textDocument);

    await context.services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    if (hasParserErrors(document)) {
        return { type: "error" };
    }

    const root = document.parseResult?.value as { imports?: AstNode[] } | undefined;
    const imports = root?.imports;
    if (root == undefined || !Array.isArray(imports) || imports.length === 0) {
        return { type: "empty" };
    }

    return {
        type: "success",
        document,
        imports: imports.map((wrapper) => ({
            type: wrapper.$type,
            content: (wrapper as AstNode & { content: AstNode }).content
        })),
        requestBody
    };
}
