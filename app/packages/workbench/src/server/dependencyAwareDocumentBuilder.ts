import type {
    LangiumDocument,
    LangiumCoreServices,
    LangiumSharedCoreServices,
    AstNode,
    BuildOptions,
    URI,
    Cancellation
} from "langium";
import { DefaultDocumentBuilder, DocumentState } from "langium";
import type {
    ExternalReferenceAdditionalServices,
    ExtendedDocumentBuilder,
    ExternalReferenceCollector
} from "@mdeo/language-common";
import { getServicesByLanguageId } from "@mdeo/language-common";

/**
 * A document builder that tracks external reference dependencies and uses them
 * to determine which documents need relinking when a file changes.
 *
 * This enhances Langium's built-in `isAffected()` check (which uses the reference index)
 * with explicit dependency information from the ExternalReferenceCollector system.
 * This ensures that cross-language dependencies (e.g., config → metamodel) are always
 * captured, even if no direct Langium cross-references exist.
 *
 * It also guarantees that a document is never built against a workspace in which the files it
 * depends on are still missing. Both entry points resolve the dependency closure up front, so
 * callers can build a single document without knowing what it needs.
 */
export class DependencyAwareDocumentBuilder extends DefaultDocumentBuilder implements ExtendedDocumentBuilder {
    /**
     * Forward dependency map: document URI → set of dependency URIs.
     */
    private readonly forwardDeps = new Map<string, Set<string>>();

    /**
     * Inverse dependency map: dependency URI → set of dependent document URIs.
     */
    private readonly inverseDeps = new Map<string, Set<string>>();

    private readonly sharedServices: LangiumSharedCoreServices;

    constructor(services: LangiumSharedCoreServices) {
        super(services);
        this.sharedServices = services;
        this.setupDependencyTracking();
    }

    /**
     * Registers build-phase listeners so that dependency information is automatically
     * updated whenever documents are linked or deleted, without any external setup call.
     */
    private setupDependencyTracking(): void {
        this.onBuildPhase(DocumentState.Linked, async (docs) => {
            for (const doc of docs) {
                if (this.getExternalReferenceCollector(doc) == undefined) {
                    continue;
                }
                const depUris = this.findDependencies(doc).map((uri) => uri.toString());
                this.setDependencies(doc.uri.toString(), depUris);
            }
        });

        this.onUpdate(async (_changed, deleted) => {
            for (const deletedUri of deleted) {
                this.removeDependencies(deletedUri.toString());
            }
        });
    }

    /**
     * Builds the given documents together with the documents they depend on.
     *
     * `DefaultDocumentBuilder.build` only ever touches the documents it is handed. Building a
     * single document therefore links it against whatever happens to be loaded at that moment,
     * which during workspace startup is not much: a diagram is requested as soon as the client
     * restores its editor tabs, long before the workspace manager has scanned a large project. A
     * model built at that point cannot see the metamodel it imports, so every cross-file reference
     * fails and the file is flooded with "could not resolve reference" errors that have nothing to
     * do with its content — in the textual editor as much as in the diagram, since both render the
     * same `LangiumDocument.diagnostics`.
     *
     * Those errors then persist: once the document is `Validated`, every later phase of the
     * workspace build skips it, so nothing re-links it until the file is edited.
     *
     * Resolving the closure here means a caller can build one document without knowing what it
     * depends on, and the dependencies are parsed, indexed and linked in the same build rather
     * than being waited for. This matters for both styles of scoping in use: providers that walk
     * the imported AST need the dependency to exist as a document, and providers that go through
     * the symbol index need it to have been indexed.
     *
     * @param documents The documents to build
     * @param options Options for the document builder
     * @param cancelToken A cancellation token
     */
    override async build<T extends AstNode>(
        documents: Array<LangiumDocument<T>>,
        options?: BuildOptions,
        cancelToken?: Cancellation.CancellationToken
    ): Promise<void> {
        const dependencies = await this.loadDependencies(documents, cancelToken);
        return super.build([...documents, ...dependencies] as Array<LangiumDocument<T>>, options, cancelToken);
    }

    /**
     * Loads the documents the changed documents depend on before delegating to the default update.
     *
     * Unlike {@link build}, the dependencies do not have to be passed on: `update` rebuilds every
     * document that is not fully built yet, so it picks the freshly loaded ones up on its own.
     * Loading them is still necessary, because an update that runs while the workspace is still
     * being scanned would otherwise re-link the changed document against the same incomplete set of
     * documents and reproduce exactly the same errors — which is why editing the file did not make
     * them go away.
     *
     * @param changed The URIs of the changed documents
     * @param deleted The URIs of the deleted documents
     * @param cancelToken A cancellation token
     */
    override async update(changed: URI[], deleted: URI[], cancelToken?: Cancellation.CancellationToken): Promise<void> {
        const changedDocuments = changed
            .map((uri) => this.langiumDocuments.getDocument(uri))
            .filter((document) => document != undefined);
        await this.loadDependencies(changedDocuments, cancelToken);
        return super.update(changed, deleted, cancelToken);
    }

    /**
     * Resolves the transitive dependency closure of the given documents, loading the documents
     * that are not part of the workspace yet.
     *
     * Documents that are already fully built are not returned — they need no further building —
     * but they are still traversed, so dependencies reachable only through them are found.
     *
     * @param documents The documents whose dependencies should be resolved
     * @param cancelToken A cancellation token
     * @returns The dependencies that still need to be built, excluding the given documents
     */
    protected async loadDependencies(
        documents: LangiumDocument[],
        cancelToken?: Cancellation.CancellationToken
    ): Promise<LangiumDocument[]> {
        const dependencies: LangiumDocument[] = [];
        const visited = new Set(documents.map((document) => document.uri.toString()));
        let pending = documents;

        while (pending.length > 0) {
            const current = pending;
            pending = [];
            for (const document of current) {
                for (const dependencyUri of this.findDependencies(document)) {
                    if (visited.has(dependencyUri.toString())) {
                        continue;
                    }
                    visited.add(dependencyUri.toString());
                    const dependency = await this.loadDependency(dependencyUri, cancelToken);
                    if (dependency == undefined) {
                        continue;
                    }
                    if (dependency.state < DocumentState.Validated) {
                        dependencies.push(dependency);
                    }
                    pending.push(dependency);
                }
            }
        }

        return dependencies;
    }

    /**
     * Loads a single dependency, creating its document if the workspace does not have it yet.
     *
     * @param uri The URI of the dependency
     * @param cancelToken A cancellation token
     * @returns The document, or `undefined` if the file does not exist or has no language support
     */
    private async loadDependency(
        uri: URI,
        cancelToken?: Cancellation.CancellationToken
    ): Promise<LangiumDocument | undefined> {
        const existing = this.langiumDocuments.getDocument(uri);
        if (existing != undefined) {
            return existing;
        }
        try {
            return await this.langiumDocuments.getOrCreateDocument(uri, cancelToken);
        } catch {
            // The referenced file does not exist or is not backed by a language; leaving it out
            // makes the reference fail to link, which is the correct outcome in that case.
            return undefined;
        }
    }

    /**
     * Collects the URIs the given document directly depends on.
     *
     * @param document The document to collect dependencies for
     * @returns The dependency URIs, empty if the document's language contributes no collector
     */
    protected findDependencies(document: LangiumDocument): URI[] {
        const collector = this.getExternalReferenceCollector(document);
        if (collector == undefined) {
            return [];
        }
        const refs = collector.findExternalReferences([document]);
        return [...refs.local, ...refs.external];
    }

    /**
     * Looks up the external reference collector of the language the given document belongs to.
     *
     * @param document The document to look up the collector for
     * @returns The collector, or `undefined` if the language contributes none
     */
    private getExternalReferenceCollector(document: LangiumDocument): ExternalReferenceCollector | undefined {
        const langServices = getServicesByLanguageId(
            this.sharedServices.ServiceRegistry,
            document.textDocument.languageId
        ) as (LangiumCoreServices & Partial<ExternalReferenceAdditionalServices>) | undefined;
        return langServices?.references?.ExternalReferenceCollector;
    }

    /**
     * Updates the dependency information for a document based on its external references.
     *
     * @param docUri The URI of the document
     * @param dependencyUris The URIs of files this document depends on
     */
    setDependencies(docUri: string, dependencyUris: string[]): void {
        const oldDeps = this.forwardDeps.get(docUri);
        if (oldDeps) {
            for (const dep of oldDeps) {
                this.inverseDeps.get(dep)?.delete(docUri);
            }
        }

        const newDeps = new Set(dependencyUris);
        this.forwardDeps.set(docUri, newDeps);

        for (const dep of newDeps) {
            let dependents = this.inverseDeps.get(dep);
            if (!dependents) {
                dependents = new Set();
                this.inverseDeps.set(dep, dependents);
            }
            dependents.add(docUri);
        }
    }

    /**
     * Returns all transitive forward dependencies of a document (what it depends on, recursively).
     *
     * @param docUri The URI string of the document
     * @returns Array of URI strings for all transitive dependencies (excluding the document itself)
     */
    getTransitiveDependencies(docUri: string): string[] {
        const visited = new Set<string>();
        const toVisit = [docUri];
        while (toVisit.length > 0) {
            const current = toVisit.pop()!;
            if (visited.has(current)) continue;
            visited.add(current);
            for (const dep of this.forwardDeps.get(current) ?? []) {
                toVisit.push(dep);
            }
        }
        visited.delete(docUri);
        return [...visited];
    }

    /**
     * Removes all dependency information for a document.
     */
    removeDependencies(docUri: string): void {
        const deps = this.forwardDeps.get(docUri);
        if (deps) {
            for (const dep of deps) {
                this.inverseDeps.get(dep)?.delete(docUri);
            }
        }
        this.forwardDeps.delete(docUri);
    }

    /**
     * Overrides the default `shouldRelink` to also check external reference dependencies.
     * A document should be relinked if:
     * 1. It has any linking errors (Langium default behavior)
     * 2. It is affected according to the reference index (Langium default behavior)
     * 3. It depends on any changed URI via external references (our enhancement)
     */
    protected override shouldRelink(document: LangiumDocument, changedUris: Set<string>): boolean {
        if (super.shouldRelink(document, changedUris)) {
            return true;
        }
        const deps = this.forwardDeps.get(document.uri.toString());
        if (deps) {
            for (const dep of deps) {
                if (changedUris.has(dep)) {
                    return true;
                }
            }
        }
        return false;
    }
}
