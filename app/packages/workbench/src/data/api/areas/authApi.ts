import { ApiResult, CommonErrorCode, type CommonError } from "../apiResult";
import type { BackendApiCore } from "../backendApi";

/**
 * User information returned from authentication operations
 */
export interface User {
    id: string;
    username: string;
    isAdmin: boolean;
    canCreateProject: boolean;
}

/**
 * A personal access token's metadata, without the raw value.
 */
export interface PersonalAccessTokenInfo {
    id: string;
    name: string;
    tokenPrefix: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
}

/**
 * Response to creating a personal access token. `token` is the raw secret
 * value and is only ever present in this one response.
 */
export interface PersonalAccessTokenCreated {
    id: string;
    name: string;
    token: string;
    createdAt: string;
    expiresAt: string | null;
}

/**
 * A registered SSH public key's metadata.
 */
export interface SshPublicKeyInfo {
    id: string;
    name: string;
    fingerprint: string;
    createdAt: string;
    lastUsedAt: string | null;
}

/**
 * API for authentication operations including login, logout, registration,
 * and password management.
 */
export class AuthApi {
    /**
     * Creates a new AuthApi instance
     *
     * @param core The core backend API providing HTTP utilities
     */
    constructor(private readonly core: BackendApiCore) {}

    /**
     * Gets the currently authenticated user
     *
     * @returns A promise resolving to the current user or an error
     */
    async getCurrentUser(): Promise<ApiResult<User, CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/auth/me`, {
                method: "GET",
                credentials: "include"
            });

            if (!response.ok) {
                if (response.status === 401) {
                    return ApiResult.commonFailure(CommonErrorCode.Unknown, "Not authenticated");
                }
                return ApiResult.commonFailure(CommonErrorCode.Unavailable, "Failed to get current user");
            }

            const data = await response.json();
            return ApiResult.success(data);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }

    /**
     * Authenticates a user with username and password
     *
     * @param username The username to authenticate
     * @param password The password for authentication
     * @returns A promise resolving to the authenticated user or an error
     */
    async login(username: string, password: string): Promise<ApiResult<User, CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ username, password })
            });

            if (!response.ok) {
                if (response.status === 401) {
                    return ApiResult.commonFailure(CommonErrorCode.Unknown, "Invalid credentials");
                }
                return ApiResult.commonFailure(CommonErrorCode.Unavailable, "Login failed");
            }

            const data = await response.json();
            return ApiResult.success(data.user);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }

    /**
     * Registers a new user account
     *
     * @param username The username for the new account
     * @param password The password for the new account
     * @returns A promise resolving to the created user or an error
     */
    async register(username: string, password: string): Promise<ApiResult<User, CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ username, password })
            });

            if (!response.ok) {
                if (response.status === 409) {
                    return ApiResult.commonFailure(CommonErrorCode.Unknown, "Username already exists");
                }
                return ApiResult.commonFailure(CommonErrorCode.Unavailable, "Registration failed");
            }

            const data = await response.json();
            return ApiResult.success(data.user);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }

    /**
     * Logs out the currently authenticated user
     */
    async logout(): Promise<void> {
        await fetch(`${this.core.baseUrl}/auth/logout`, {
            method: "POST",
            credentials: "include"
        });
    }

    /**
     * Changes the current user's password
     *
     * @param currentPassword The current password for verification
     * @param newPassword The new password to set
     * @returns A promise resolving to success or an error
     */
    async changePassword(currentPassword: string, newPassword: string): Promise<ApiResult<void, CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/auth/password`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ currentPassword, newPassword })
            });

            if (!response.ok) {
                if (response.status === 400) {
                    return ApiResult.commonFailure(CommonErrorCode.Unknown, "Current password is incorrect");
                }
                return ApiResult.commonFailure(CommonErrorCode.Unavailable, "Failed to change password");
            }

            return ApiResult.success(undefined);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }

    /**
     * Creates a new personal access token for the current user. The raw
     * token value in the response is shown only this once.
     *
     * @param name A label to tell this token apart from others later
     * @param expiresAt When the token stops working, or undefined for no expiry
     * @returns A promise resolving to the created token or an error
     */
    async createToken(
        name: string,
        expiresAt?: string
    ): Promise<ApiResult<PersonalAccessTokenCreated, CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/tokens`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ name, expiresAt })
            });

            if (!response.ok) {
                return ApiResult.commonFailure(CommonErrorCode.Unavailable, "Failed to create token");
            }

            const data = await response.json();
            return ApiResult.success(data);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }

    /**
     * Lists the current user's own personal access tokens. Never includes
     * a raw token value.
     *
     * @returns A promise resolving to the list of tokens or an error
     */
    async listTokens(): Promise<ApiResult<PersonalAccessTokenInfo[], CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/tokens`, {
                method: "GET",
                credentials: "include"
            });

            if (!response.ok) {
                return ApiResult.commonFailure(CommonErrorCode.Unavailable, "Failed to list tokens");
            }

            const data = await response.json();
            return ApiResult.success(data);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }

    /**
     * Revokes one of the current user's own personal access tokens.
     *
     * @param tokenId The token to revoke
     * @returns A promise resolving to success or an error
     */
    async revokeToken(tokenId: string): Promise<ApiResult<void, CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/tokens/${tokenId}`, {
                method: "DELETE",
                credentials: "include"
            });

            if (!response.ok) {
                if (response.status === 404) {
                    return ApiResult.commonFailure(CommonErrorCode.Unknown, "Token not found");
                }
                return ApiResult.commonFailure(CommonErrorCode.Unavailable, "Failed to revoke token");
            }

            return ApiResult.success(undefined);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }

    /**
     * Registers a new SSH public key for the current user.
     *
     * @param name A label to tell this key apart from others later
     * @param publicKey The full authorized_keys-format line
     * @returns A promise resolving to the registered key or an error
     */
    async addSshKey(name: string, publicKey: string): Promise<ApiResult<SshPublicKeyInfo, CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/ssh-keys`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ name, publicKey })
            });

            if (!response.ok) {
                const data = await response.json().catch(() => undefined);
                return ApiResult.commonFailure(CommonErrorCode.Unknown, data?.error ?? "Failed to add key");
            }

            const data = await response.json();
            return ApiResult.success(data);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }

    /**
     * Lists the current user's own registered SSH public keys.
     *
     * @returns A promise resolving to the list of keys or an error
     */
    async listSshKeys(): Promise<ApiResult<SshPublicKeyInfo[], CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/ssh-keys`, {
                method: "GET",
                credentials: "include"
            });

            if (!response.ok) {
                return ApiResult.commonFailure(CommonErrorCode.Unavailable, "Failed to list keys");
            }

            const data = await response.json();
            return ApiResult.success(data);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }

    /**
     * Removes one of the current user's own registered SSH public keys.
     *
     * @param keyId The key to remove
     * @returns A promise resolving to success or an error
     */
    async removeSshKey(keyId: string): Promise<ApiResult<void, CommonError>> {
        try {
            const response = await fetch(`${this.core.baseUrl}/ssh-keys/${keyId}`, {
                method: "DELETE",
                credentials: "include"
            });

            if (!response.ok) {
                if (response.status === 404) {
                    return ApiResult.commonFailure(CommonErrorCode.Unknown, "Key not found");
                }
                return ApiResult.commonFailure(CommonErrorCode.Unavailable, "Failed to remove key");
            }

            return ApiResult.success(undefined);
        } catch (error) {
            return ApiResult.commonFailure(CommonErrorCode.Unavailable, String(error));
        }
    }
}
