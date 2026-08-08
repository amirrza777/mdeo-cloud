/**
 * Keeps the version of every workspace package and the ranges the packages use for each other in
 * sync. `npm run set-version` bumps the versions, syncpack then rewrites the `@mdeo/*` ranges to
 * match; `npm run lint:versions` checks the same thing without changing anything.
 *
 * Only `@mdeo/*` is managed. Third-party ranges are chosen per dependency, so syncpack neither
 * rewrites them nor complains when two packages disagree.
 */
export default {
    // Matches the prettier config, so the rewritten manifests stay formatted.
    indent: "    ",
    // The first matching group wins, so the catch-all has to come last.
    versionGroups: [
        { dependencies: ["@mdeo/**"], packages: ["**"] },
        { dependencies: ["**"], packages: ["**"], isIgnored: true }
    ],
    semverGroups: [
        { dependencies: ["@mdeo/**"], packages: ["**"], range: "^" },
        { dependencies: ["**"], packages: ["**"], isIgnored: true }
    ]
};
