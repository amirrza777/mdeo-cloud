import { DEFAULT_MAX_REQUEST_BODY_BYTES } from "../service/service.js";

/**
 * Parses configuration from environment variables with defaults.
 *
 * @returns Configuration object with port, host, backendApiUrl, jwtIssuer, maxLangiumInstances and
 *   maxRequestBodyBytes
 */
export function parseServiceConfigFromEnv(): {
    port: number;
    host: string;
    backendApiUrl: string;
    jwtIssuer: string;
    maxLangiumInstances: number;
    maxRequestBodyBytes: number;
    version?: string;
} {
    const port = parseInt(process.env.PORT ?? "3000", 10);
    const host = process.env.HOST ?? "0.0.0.0";
    const backendApiUrl = process.env.BACKEND_API_URL ?? "http://localhost:8080/api";
    const jwtIssuer = process.env.JWT_ISSUER ?? "mdeo-platform";
    const maxLangiumInstances = parseInt(process.env.MAX_LANGIUM_INSTANCES ?? "5", 10);
    const maxRequestBodyBytes = parseInt(process.env.MAX_REQUEST_BODY_BYTES ?? `${DEFAULT_MAX_REQUEST_BODY_BYTES}`, 10);
    const version = process.env.SERVICE_VERSION?.trim();

    return {
        port,
        host,
        backendApiUrl,
        jwtIssuer,
        maxLangiumInstances,
        maxRequestBodyBytes,
        version: version && version.length > 0 ? version : undefined
    };
}
