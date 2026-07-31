import { type AstReflection, type ExtendedLangiumServices } from "@mdeo/language-common";
import { sharedImport, resolveRelativePath } from "@mdeo/language-shared";
import type {
    AstNode,
    AstNodeDescription,
    AstNodeDescriptionProvider,
    DocumentCache as DocumentCacheType,
    LangiumDocuments,
    ReferenceInfo,
    Scope
} from "langium";
import {
    ObjectInstance,
    PropertyAssignment,
    EnumValue,
    LinkEnd,
    type ModelType,
    type ObjectInstanceType,
    type PropertyAssignmentType,
    type LinkEndType,
    type EnumValueType,
    Model
} from "../grammar/modelTypes.js";
import {
    EnumTypeReference,
    getScopeFromMetamodelFile,
    getExportedEntitiesFromMetamodelFile,
    createScopeFromDescriptions,
    resolveClassChain,
    type ClassType,
    type EnumType
} from "@mdeo/language-metamodel";
import { AssociationEndCache } from "./associationEndCache.js";

const { DefaultScopeProvider, AstUtils, EMPTY_SCOPE, MapScope, DocumentCache, DocumentState } =
    sharedImport("langium");

/**
 * The scope provider for the Model language.
 * Handles scoping for object instance classes, properties, enum values, and links.
 */
export class ModelScopeProvider extends DefaultScopeProvider {
    /**
     * The AST reflection service for type checking and model introspection.
     */
    private readonly astReflection: AstReflection;

    /**
     * Cache for association end lookups.
     */
    private readonly associationEndCache: AssociationEndCache;

    /**
     * The Langium documents service for accessing imported files.
     */
    private readonly documents: LangiumDocuments;

    /**
     * The description provider for creating AST node descriptions.
     */
    private readonly descriptionProvider: AstNodeDescriptionProvider;

    /**
     * Cache of the scope over a model's object instances, keyed by the model node.
     *
     * Every link end resolves its `object` reference against every object in the model, so this
     * scope is requested once per link end. Rebuilding it each time — and scanning it linearly to
     * find one name — made linking cost O(objects * links), which is minutes rather than seconds
     * on large models (16k objects and 35k links take over five minutes uncached).
     */
    private readonly objectInstanceScopeCache: DocumentCacheType<ModelType, Scope>;

    /**
     * Constructs a new ModelScopeProvider.
     * @param services The extended Langium services.
     */
    constructor(services: ExtendedLangiumServices) {
        super(services);
        this.astReflection = services.shared.AstReflection;
        this.associationEndCache = new AssociationEndCache(services);
        this.documents = services.shared.workspace.LangiumDocuments;
        this.descriptionProvider = services.workspace.AstNodeDescriptionProvider;
        this.objectInstanceScopeCache = new DocumentCache(services.shared, DocumentState.Linked);
    }

    /**
     * Gets the scope for a given reference context.
     *
     * @param context The reference context
     * @returns The scope for the reference
     */
    override getScope(context: ReferenceInfo): Scope {
        const document = AstUtils.getDocument(context.container);

        if (context.property === "class" && this.astReflection.isInstance(context.container, ObjectInstance)) {
            return this.getObjectClassScope(context, document);
        }
        if (context.property === "name" && this.astReflection.isInstance(context.container, PropertyAssignment)) {
            return this.getPropertyNameScope(context);
        }
        if (context.property === "enumRef" && this.astReflection.isInstance(context.container, EnumValue)) {
            return this.getEnumRefScope(context, document);
        }
        if (context.property === "value" && this.astReflection.isInstance(context.container, EnumValue)) {
            return this.getEnumValueScope(context);
        }
        if (context.property === "property" && this.astReflection.isInstance(context.container, LinkEnd)) {
            return this.getLinkPropertyScope(context);
        }
        if (context.property === "object" && this.astReflection.isInstance(context.container, LinkEnd)) {
            return this.getObjectInstancesScope(context);
        }

        return EMPTY_SCOPE;
    }

    /**
     * Gets the scope for object class references.
     * Resolves the imported metamodel file and returns a scope with all accessible classes.
     *
     * @param context The reference context
     * @param document The current document
     * @returns A scope containing all accessible classes from the imported metamodel
     */
    private getObjectClassScope(context: ReferenceInfo, document: any): Scope {
        const model = context.container.$container as ModelType;
        const metamodelImport = model.import;
        const relativePath = metamodelImport?.file;

        if (relativePath == undefined) {
            return EMPTY_SCOPE;
        }

        const metamodelUri = resolveRelativePath(document, relativePath);
        const metamodelDoc = this.documents.getDocument(metamodelUri);

        if (metamodelDoc == undefined) {
            return EMPTY_SCOPE;
        }

        return getScopeFromMetamodelFile(metamodelDoc, this.documents, this.descriptionProvider);
    }

    /**
     * Gets the scope for property name references.
     *
     * @param context The reference context
     * @return The scope containing the properties of the object's class chain
     */
    private getPropertyNameScope(context: ReferenceInfo): Scope {
        let objectInstance = context.container.$container as ObjectInstanceType;
        // workaround for langium weirdness in completion mode
        if (this.astReflection.isInstance(objectInstance, PropertyAssignment)) {
            objectInstance = objectInstance.$container as ObjectInstanceType;
        }
        const classRef = objectInstance?.class?.ref as ClassType | undefined;
        if (!classRef) {
            return EMPTY_SCOPE;
        }
        const classChain = resolveClassChain(classRef, this.astReflection);
        return this.createScopeForNodes(classChain.flatMap((cls) => cls.properties));
    }

    /**
     * Gets the scope for enum references (the EnumName part of EnumName.Entry).
     * Returns all enums from the imported metamodel file.
     *
     * @param context The reference context
     * @param document The current document
     * @returns The scope containing all enums from the metamodel
     */
    private getEnumRefScope(context: ReferenceInfo, document: any): Scope {
        const model = AstUtils.getContainerOfType(context.container, (node) =>
            this.astReflection.isInstance(node, Model)
        ) as ModelType | undefined;
        const relativePath = model?.import?.file;
        if (relativePath == undefined) {
            return EMPTY_SCOPE;
        }
        const metamodelUri = resolveRelativePath(document, relativePath);
        const metamodelDoc = this.documents.getDocument(metamodelUri);
        if (metamodelDoc == undefined) {
            return EMPTY_SCOPE;
        }
        const exports = getExportedEntitiesFromMetamodelFile(metamodelDoc, this.documents);
        const enumDescriptions = Array.from(exports.enums).map((e) =>
            this.descriptionProvider.createDescription(e, e.name ?? "")
        );
        return createScopeFromDescriptions(enumDescriptions);
    }

    /**
     * Gets the scope for enum value references (the Entry part of EnumName.Entry).
     * Returns all entries of the enum referenced by enumRef.
     *
     * @param context The reference context
     * @returns The scope containing the enum entries
     */
    private getEnumValueScope(context: ReferenceInfo): Scope {
        const enumValue = context.container as EnumValueType;
        const enumRef = enumValue.enumRef?.ref as EnumType | undefined;
        if (enumRef != undefined) {
            return this.createScopeForNodes(enumRef.entries);
        }
        return EMPTY_SCOPE;
    }

    /**
     * Gets the scope for object instance references in links.
     */
    private getObjectInstancesScope(context: ReferenceInfo): Scope {
        const model = AstUtils.getContainerOfType(context.container, (node) =>
            this.astReflection.isInstance(node, Model)
        ) as ModelType | undefined;
        if (model == undefined) {
            return EMPTY_SCOPE;
        }
        const document = AstUtils.getDocument(model);
        return this.objectInstanceScopeCache.get(document.uri, model, () =>
            this.createMapScopeForNodes(model.objects)
        );
    }

    /**
     * Builds a scope over the given nodes that looks names up by hash rather than by scanning.
     *
     * {@link DefaultScopeProvider.createScopeForNodes} returns a stream-backed scope, which has to
     * walk every element (creating a description for each) to answer a single lookup. That is fine
     * for the handful of elements the metamodel scopes hold, but not for the object instances of a
     * large model, which are looked up once per link end.
     *
     * Duplicate names keep the first node, matching what the stream-backed scope resolved to.
     *
     * @param nodes The nodes to expose in the scope
     * @returns A scope resolving those nodes by name in constant time
     */
    private createMapScopeForNodes(nodes: Iterable<AstNode>): Scope {
        const descriptions = new Map<string, AstNodeDescription>();
        for (const node of nodes) {
            const name = this.nameProvider.getName(node);
            if (name != undefined && !descriptions.has(name)) {
                descriptions.set(name, this.descriptionProvider.createDescription(node, name));
            }
        }
        return new MapScope(descriptions.values());
    }

    /**
     * Gets the scope for property references in link ends.
     *
     * This method now properly handles associations instead of just primitive properties.
     * It traverses the class chain and for each class, looks up all association ends
     * that reference that class in the metamodel.
     *
     * @param context The reference context
     * @returns The scope containing the association ends of the linked object's class chain
     */
    private getLinkPropertyScope(context: ReferenceInfo): Scope {
        const linkEnd = context.container as LinkEndType;
        const objectRef = linkEnd.object?.ref as ObjectInstanceType | undefined;

        if (objectRef == undefined) {
            return EMPTY_SCOPE;
        }

        const classRef = objectRef.class?.ref as ClassType | undefined;
        if (classRef == undefined) {
            return EMPTY_SCOPE;
        }

        const classChain = resolveClassChain(classRef, this.astReflection);

        const allAssociationEnds = classChain.flatMap((cls) => {
            return this.associationEndCache.getAssociationEndsForClass(cls);
        });

        const uniqueAssociationEnds = Array.from(new Map(allAssociationEnds.map((end) => [end.name, end])).values());

        return this.createScopeForNodes(uniqueAssociationEnds);
    }

    /**
     * Finds the property assignment containing the given node.
     */
    private findPropertyAssignment(node: any): PropertyAssignmentType | undefined {
        let current = node.$container;
        while (current) {
            if (this.astReflection.isInstance(current, PropertyAssignment)) {
                return current as PropertyAssignmentType;
            }
            current = current.$container;
        }
        return undefined;
    }

    /**
     * Gets enum entries from a property type.
     * Since EnumTypeReference now directly references Enum (no imports),
     * we can simply access the entries from the resolved enum.
     *
     * @param type The property type to get enum entries from
     * @returns A scope containing the enum entries, or EMPTY_SCOPE if not an enum type
     */
    private getEnumEntriesFromType(type: any): Scope {
        if (this.astReflection.isInstance(type, EnumTypeReference)) {
            const enumRef = type.enum?.ref as EnumType | undefined;
            if (enumRef != undefined) {
                return this.createScopeForNodes(enumRef.entries);
            }
        }
        return EMPTY_SCOPE;
    }
}
