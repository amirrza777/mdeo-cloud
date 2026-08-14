/**
 * Headless validator for every DSL sample shipped with the documentation.
 *
 * The docs embed the files below `website/samples/` verbatim, so a sample that stops
 * parsing (or stops resolving its cross-file references) breaks the build instead of
 * silently rotting on the website.
 *
 * The harness mirrors what the workbench does in its language-server web worker
 * (`app/packages/workbench/src/server/extensibleLangiumServer.ts`): it instantiates every
 * language plugin against one shared Langium service registry, adds all sample files of a
 * project as documents, and runs a full build with validation. Because every file of a
 * sample project is present locally, no backend is needed to resolve references and the
 * external-reference resolver can be a no-op.
 *
 * The `@mdeo` packages are imported through relative paths into the built `dist` folders
 * below `app/packages`. Their own bare imports (`langium`, ...) then resolve through
 * `app/node_modules`, so this script needs no dependencies of its own.
 *
 * Usage: node website/scripts/validate-samples.mjs
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, extname, join, relative, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const websiteDir = resolve(here, "..");
const samplesDir = join(websiteDir, "samples");
const packagesDir = resolve(websiteDir, "..", "app", "packages");

/**
 * Imports a built `@mdeo` workspace package by name.
 *
 * @param {string} specifier Package-relative path, e.g. `language-metamodel/dist/index.js`
 * @returns {Promise<any>} The module namespace
 */
function importPackage(specifier) {
    return import(pathToFileURL(join(packagesDir, specifier)).href);
}

/**
 * Boots the plugin context and creates one shared Langium environment holding every
 * language of the default plugin set.
 *
 * @returns {Promise<{shared: any, langium: any}>} The shared services and the Langium namespace
 */
async function createEnvironment() {
    const { initializePluginContext } = await importPackage("service-common/dist/util/pluginContext.js");
    initializePluginContext();
    const pluginContext = globalThis.pluginContext;
    const langium = pluginContext.langium;
    const langiumLsp = pluginContext["langium/lsp"];

    const { createModule, createGLSPModule } = await importPackage("language-common/dist/index.js");
    const { metamodelPluginProvider } = await importPackage("language-metamodel/dist/index.js");
    const { modelPluginProvider, generatedModelPluginProvider } = await importPackage("language-model/dist/index.js");
    const { modelTransformationPluginProvider, generatedModelTransformationPluginProvider } = await importPackage(
        "language-model-transformation/dist/index.js"
    );
    const { scriptPluginProvider } = await importPackage("language-script/dist/index.js");
    const { csvPluginProvider } = await importPackage("language-csv/dist/index.js");
    const { modelCsvPluginProvider, createModelCsvContributionPlugin } = await importPackage(
        "language-model-csv/dist/index.js"
    );
    const { configPluginProvider } = await importPackage("language-config/dist/index.js");
    const { configOptimizationPluginProvider, createOptimizationContributionPlugin } = await importPackage(
        "language-config-optimization/dist/index.js"
    );
    const { configMdeoPluginProvider, createMdeoContributionPlugin } = await importPackage(
        "language-config-mdeo/dist/index.js"
    );
    const { createMetamodelConfigContributionPlugin } = await importPackage(
        "service-metamodel/dist/metamodelConfigContributionPlugin.js"
    );
    const { createScriptConfigContributionPlugin } = await importPackage(
        "service-script/dist/scriptConfigContributionPlugin.js"
    );

    // The import contributions the backend hands to the model service when all default
    // plugins are enabled, so a sample's `import CSV` block is parsed the same way the
    // workbench parses it.
    const modelContributionPlugins = [createModelCsvContributionPlugin()];

    // Same set of contribution plugins the backend hands to the config service when all
    // default plugins are enabled for a project.
    const configContributionPlugins = [
        createMetamodelConfigContributionPlugin(),
        createScriptConfigContributionPlugin(),
        createOptimizationContributionPlugin(),
        createMdeoContributionPlugin()
    ];

    const definitions = [
        { id: "metamodel", extension: ".mm", provider: metamodelPluginProvider, contributionPlugins: [] },
        {
            id: "model",
            extension: ".m",
            provider: modelPluginProvider,
            contributionPlugins: modelContributionPlugins
        },
        { id: "csv", extension: ".csv", provider: csvPluginProvider, contributionPlugins: [] },
        { id: "model-csv", extension: undefined, provider: modelCsvPluginProvider, contributionPlugins: [] },
        { id: "model_gen", extension: ".m_gen", provider: generatedModelPluginProvider, contributionPlugins: [] },
        {
            id: "model-transformation",
            extension: ".mt",
            provider: modelTransformationPluginProvider,
            contributionPlugins: []
        },
        {
            id: "model-transformation_gen",
            extension: ".mt_gen",
            provider: generatedModelTransformationPluginProvider,
            contributionPlugins: []
        },
        { id: "script", extension: ".fn", provider: scriptPluginProvider, contributionPlugins: [] },
        {
            id: "config",
            extension: ".config",
            provider: configPluginProvider,
            contributionPlugins: configContributionPlugins
        },
        {
            id: "config-optimization",
            extension: undefined,
            provider: configOptimizationPluginProvider,
            contributionPlugins: []
        },
        { id: "config-mdeo", extension: undefined, provider: configMdeoPluginProvider, contributionPlugins: [] }
    ];

    const plugins = definitions.map((definition) => ({
        ...definition,
        languagePlugin: definition.provider.create(definition.contributionPlugins)
    }));

    const languageModule = createModule(
        plugins.map((plugin) => plugin.languagePlugin),
        pluginContext
    );

    const context = { fileSystemProvider: () => new langium.EmptyFileSystemProvider() };
    const shared = langium.inject(
        langiumLsp.createDefaultSharedModule(context),
        {
            AstReflection: () => languageModule.reflection,
            references: {
                // Every file of a sample project is loaded up front, so nothing has to be
                // fetched from the backend.
                ExternalReferenceResolver: () => ({ async loadExternalDocuments() {} })
            }
        },
        createGLSPModule(pluginContext)
    );

    for (const plugin of plugins) {
        plugin.services = langium.inject(
            langiumLsp.createDefaultModule({ shared }),
            {
                Grammar: () => languageModule.grammars.get(plugin.languagePlugin),
                LanguageMetaData: () => ({
                    languageId: plugin.id,
                    fileExtensions: plugin.extension ? [plugin.extension] : [],
                    caseInsensitive: false,
                    mode: "development"
                }),
                parser: {}
            },
            plugin.languagePlugin.module
        );
    }
    for (const plugin of plugins) {
        shared.ServiceRegistry.register(plugin.services);
    }
    for (const plugin of plugins) {
        plugin.languagePlugin.postCreate?.(plugin.services, context);
    }

    return { shared, langium };
}

/**
 * Collects the sample projects. Every direct subdirectory of `website/samples` is one
 * project and is validated as a self-contained workspace.
 *
 * @returns {Promise<{name: string, files: string[]}[]>} The discovered projects
 */
async function collectProjects() {
    const entries = await readdir(samplesDir, { withFileTypes: true });
    const projects = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort()) {
        const projectDir = join(samplesDir, entry.name);
        const files = [];
        const walk = async (dir) => {
            for (const child of await readdir(dir, { withFileTypes: true })) {
                const path = join(dir, child.name);
                if (child.isDirectory()) {
                    await walk(path);
                } else if (KNOWN_EXTENSIONS.has(extname(child.name))) {
                    files.push(path);
                }
            }
        };
        await walk(projectDir);
        projects.push({ name: entry.name, dir: projectDir, files: files.sort() });
    }
    return projects;
}

const KNOWN_EXTENSIONS = new Set([".mm", ".m", ".m_gen", ".mt", ".mt_gen", ".fn", ".config", ".csv"]);

const SEVERITY_LABELS = { 1: "error", 2: "warning", 3: "information", 4: "hint" };

/**
 * Validates one sample project and prints every diagnostic it produces.
 *
 * @param {{name: string, dir: string, files: string[]}} project The project to validate
 * @returns {Promise<number>} The number of errors found
 */
async function validateProject(project) {
    // A fresh environment per project keeps documents of different projects from seeing
    // each other through the global index.
    const { shared, langium } = await createEnvironment();
    const documents = shared.workspace.LangiumDocuments;
    const factory = shared.workspace.LangiumDocumentFactory;

    for (const file of project.files) {
        const text = await readFile(file, "utf8");
        documents.addDocument(factory.fromString(text, langium.URI.file(file)));
    }

    await shared.workspace.DocumentBuilder.build(documents.all.toArray(), { validation: true });

    let errors = 0;
    for (const file of project.files) {
        const document = documents.getDocument(langium.URI.file(file));
        const label = relative(websiteDir, file);
        const problems = [];

        for (const parserError of document.parseResult.parserErrors) {
            problems.push({ severity: 1, line: parserError.token?.startLine ?? 1, message: parserError.message });
        }
        for (const lexerError of document.parseResult.lexerErrors ?? []) {
            problems.push({ severity: 1, line: lexerError.line ?? 1, message: lexerError.message });
        }
        for (const diagnostic of document.diagnostics ?? []) {
            problems.push({
                severity: diagnostic.severity ?? 1,
                line: diagnostic.range.start.line + 1,
                message: diagnostic.message
            });
        }

        const failures = problems.filter((problem) => problem.severity === 1);
        errors += failures.length;

        if (problems.length === 0) {
            console.log(`  ok    ${label}`);
        } else {
            console.log(`  ${failures.length > 0 ? "FAIL" : "warn"}  ${label}`);
            for (const problem of problems) {
                console.log(`          ${SEVERITY_LABELS[problem.severity]} line ${problem.line}: ${problem.message}`);
            }
        }
    }
    return errors;
}

const projects = await collectProjects();
if (projects.length === 0) {
    console.error(`No sample projects found below ${samplesDir}`);
    process.exit(1);
}

let totalErrors = 0;
for (const project of projects) {
    console.log(`\n${project.name} (${project.files.length} files)`);
    totalErrors += await validateProject(project);
}

console.log("");
if (totalErrors > 0) {
    console.error(`${totalErrors} error(s) in the documentation samples.`);
    process.exit(1);
}
console.log("All documentation samples parse and validate cleanly.");
