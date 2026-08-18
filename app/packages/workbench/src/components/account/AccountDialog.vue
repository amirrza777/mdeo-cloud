<template>
    <Dialog v-model:open="open">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Account</DialogTitle>
            </DialogHeader>

            <div class="space-y-5">
                <div class="flex items-center gap-4 rounded-3xl border border-border/70 bg-muted/40 p-4">
                    <div class="rounded-2xl bg-primary/10 p-3 text-primary">
                        <UserRound class="size-5" />
                    </div>
                    <div>
                        <p class="text-sm font-semibold text-foreground">{{ username }}</p>
                        <p class="text-xs text-muted-foreground">Signed in to MDEO</p>
                    </div>
                </div>

                <Collapsible v-model:open="isPasswordSectionOpen">
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" class="w-full">
                            <component :is="isPasswordSectionOpen ? ChevronUp : ChevronDown" class="size-4" />
                            <span>Change password</span>
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <form class="mt-4 space-y-4" @submit.prevent="handlePasswordChange">
                            <FieldGroup>
                                <Field>
                                    <FieldLabel for="current-password">Current password</FieldLabel>
                                    <FieldContent>
                                        <PasswordField
                                            id="current-password"
                                            v-model="currentPassword"
                                            autocomplete="current-password"
                                            placeholder="••••••••"
                                        />
                                    </FieldContent>
                                </Field>

                                <Field>
                                    <FieldLabel for="new-password">New password</FieldLabel>
                                    <FieldContent>
                                        <PasswordField
                                            id="new-password"
                                            v-model="newPassword"
                                            autocomplete="new-password"
                                        />
                                    </FieldContent>
                                </Field>

                                <Field>
                                    <FieldLabel for="confirm-password">Confirm new password</FieldLabel>
                                    <FieldContent>
                                        <PasswordField
                                            id="confirm-password"
                                            v-model="confirmPassword"
                                            autocomplete="new-password"
                                            placeholder="Repeat new password"
                                        />
                                    </FieldContent>
                                </Field>

                                <Field v-if="passwordError">
                                    <FieldError :errors="[passwordError]" />
                                </Field>

                                <Field v-if="passwordSuccess">
                                    <FieldContent>
                                        <div
                                            class="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-500"
                                        >
                                            {{ passwordSuccess }}
                                        </div>
                                    </FieldContent>
                                </Field>

                                <Field>
                                    <FieldContent>
                                        <Button type="submit" class="w-full" :disabled="isUpdatingPassword">
                                            <span v-if="!isUpdatingPassword">Update password</span>
                                            <span v-else class="animate-pulse">Updating…</span>
                                        </Button>
                                    </FieldContent>
                                </Field>
                            </FieldGroup>
                        </form>
                    </CollapsibleContent>
                </Collapsible>

                <Collapsible v-model:open="isTokensSectionOpen" @update:open="handleTokensSectionToggle">
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" class="w-full">
                            <component :is="isTokensSectionOpen ? ChevronUp : ChevronDown" class="size-4" />
                            <span>Access tokens</span>
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <div class="mt-4 space-y-4">
                            <p class="text-xs text-muted-foreground">
                                Use a token instead of your password when cloning or pushing over git. A
                                token can be revoked on its own, without changing your account password.
                            </p>

                            <div v-if="createdToken" class="space-y-2 rounded-lg border border-border/70 p-3">
                                <p class="text-xs text-muted-foreground">
                                    Copy this token now - it will not be shown again.
                                </p>
                                <div class="flex items-center gap-2">
                                    <Input :model-value="createdToken.token" readonly class="flex-1 text-xs font-mono" />
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                class="h-8 w-8 shrink-0"
                                                :aria-label="isTokenCopied ? 'Copied' : 'Copy token'"
                                                @click="handleCopyToken"
                                            >
                                                <Check v-if="isTokenCopied" class="size-4" />
                                                <Copy v-else class="size-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                            {{ isTokenCopied ? "Copied" : "Copy token" }}
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                                <Button type="button" variant="ghost" size="sm" @click="createdToken = undefined">
                                    Done
                                </Button>
                            </div>

                            <ul v-else-if="tokens.length > 0" class="space-y-2">
                                <li
                                    v-for="token in tokens"
                                    :key="token.id"
                                    class="flex items-center justify-between gap-2 rounded-lg border border-border/70 p-3"
                                >
                                    <div class="min-w-0">
                                        <p class="truncate text-sm font-medium text-foreground">{{ token.name }}</p>
                                        <p class="truncate text-xs text-muted-foreground font-mono">
                                            {{ token.tokenPrefix }}…
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        class="h-8 w-8 shrink-0 text-destructive"
                                        aria-label="Revoke token"
                                        :disabled="revokingTokenId === token.id"
                                        @click="handleRevokeToken(token.id)"
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </li>
                            </ul>

                            <p v-else class="text-xs text-muted-foreground">No access tokens yet.</p>

                            <form class="flex items-center gap-2" @submit.prevent="handleCreateToken">
                                <Input
                                    v-model="newTokenName"
                                    placeholder="Token name, e.g. this laptop"
                                    class="flex-1"
                                />
                                <Button type="submit" :disabled="isCreatingToken || !newTokenName.trim()">
                                    {{ isCreatingToken ? "Creating…" : "Create" }}
                                </Button>
                            </form>

                            <Field v-if="tokensError">
                                <FieldError :errors="[tokensError]" />
                            </Field>
                        </div>
                    </CollapsibleContent>
                </Collapsible>

                <Collapsible v-model:open="isSshKeysSectionOpen" @update:open="handleSshKeysSectionToggle">
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" class="w-full">
                            <component :is="isSshKeysSectionOpen ? ChevronUp : ChevronDown" class="size-4" />
                            <span>SSH keys</span>
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <div class="mt-4 space-y-4">
                            <p class="text-xs text-muted-foreground">
                                Register a public key to clone or push over git-over-SSH instead of HTTP.
                            </p>

                            <ul v-if="sshKeys.length > 0" class="space-y-2">
                                <li
                                    v-for="key in sshKeys"
                                    :key="key.id"
                                    class="flex items-center justify-between gap-2 rounded-lg border border-border/70 p-3"
                                >
                                    <div class="min-w-0">
                                        <p class="truncate text-sm font-medium text-foreground">{{ key.name }}</p>
                                        <p class="truncate text-xs text-muted-foreground font-mono">
                                            {{ key.fingerprint }}
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        class="h-8 w-8 shrink-0 text-destructive"
                                        aria-label="Remove key"
                                        :disabled="removingSshKeyId === key.id"
                                        @click="handleRemoveSshKey(key.id)"
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </li>
                            </ul>

                            <p v-else class="text-xs text-muted-foreground">No SSH keys yet.</p>

                            <form class="space-y-2" @submit.prevent="handleAddSshKey">
                                <Input
                                    v-model="newSshKeyName"
                                    placeholder="Key name, e.g. this laptop"
                                />
                                <textarea
                                    v-model="newSshKeyValue"
                                    placeholder="ssh-ed25519 AAAA... comment"
                                    rows="3"
                                    class="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                                <Button
                                    type="submit"
                                    class="w-full"
                                    :disabled="isAddingSshKey || !newSshKeyName.trim() || !newSshKeyValue.trim()"
                                >
                                    {{ isAddingSshKey ? "Adding…" : "Add key" }}
                                </Button>
                            </form>

                            <Field v-if="sshKeysError">
                                <FieldError :errors="[sshKeysError]" />
                            </Field>
                        </div>
                    </CollapsibleContent>
                </Collapsible>

                <div class="flex flex-wrap justify-between gap-3">
                    <Button
                        type="button"
                        variant="destructive"
                        class="flex-1"
                        @click="handleLogout"
                        :disabled="isLoggingOut"
                    >
                        <LogOut class="size-4" />
                        <span>{{ isLoggingOut ? "Logging out…" : "Log out" }}</span>
                    </Button>
                    <DialogClose asChild>
                        <Button type="button" variant="ghost" class="flex-1">Close</Button>
                    </DialogClose>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { UserRound, LogOut, ChevronDown, ChevronUp, Copy, Check, Trash2 } from "@lucide/vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import PasswordField from "@/components/auth/PasswordField.vue";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { PersonalAccessTokenCreated, PersonalAccessTokenInfo, SshPublicKeyInfo } from "@/data/api/areas/authApi";
import { authStateKey } from "../workbench/util";

const open = defineModel<boolean>("open", { default: false });

const injectedAuthState = inject(authStateKey);
if (injectedAuthState == undefined) {
    throw new Error("AccountDialog requires an auth state");
}
const authState = injectedAuthState;

const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const passwordError = ref<string>();
const passwordSuccess = ref<string>();
const isUpdatingPassword = ref(false);
const isLoggingOut = ref(false);
const isPasswordSectionOpen = ref(false);

const isTokensSectionOpen = ref(false);
const tokens = ref<PersonalAccessTokenInfo[]>([]);
const tokensError = ref<string>();
const newTokenName = ref("");
const isCreatingToken = ref(false);
const createdToken = ref<PersonalAccessTokenCreated>();
const isTokenCopied = ref(false);
const revokingTokenId = ref<string>();

const isSshKeysSectionOpen = ref(false);
const sshKeys = ref<SshPublicKeyInfo[]>([]);
const sshKeysError = ref<string>();
const newSshKeyName = ref("");
const newSshKeyValue = ref("");
const isAddingSshKey = ref(false);
const removingSshKeyId = ref<string>();

const username = computed(() => authState.user.value?.username ?? "Unknown user");

async function handlePasswordChange() {
    if (isUpdatingPassword.value) {
        return;
    }
    passwordError.value = undefined;
    passwordSuccess.value = undefined;

    if (!currentPassword.value || !newPassword.value) {
        passwordError.value = "Please provide your current and new password.";
        return;
    }

    if (newPassword.value !== confirmPassword.value) {
        passwordError.value = "New passwords do not match.";
        return;
    }

    isUpdatingPassword.value = true;
    try {
        const result = await authState.changePassword(currentPassword.value, newPassword.value);
        if (!result.success) {
            passwordError.value = result.error.message;
            return;
        }
        passwordSuccess.value = "Password updated successfully.";
        currentPassword.value = "";
        newPassword.value = "";
        confirmPassword.value = "";
    } finally {
        isUpdatingPassword.value = false;
    }
}

async function loadTokens() {
    tokensError.value = undefined;
    const result = await authState.listTokens();
    if (!result.success) {
        tokensError.value = result.error.message;
        return;
    }
    tokens.value = result.value;
}

async function handleTokensSectionToggle(open: boolean) {
    if (open) {
        await loadTokens();
    }
}

async function handleCreateToken() {
    if (isCreatingToken.value || !newTokenName.value.trim()) {
        return;
    }
    tokensError.value = undefined;
    isCreatingToken.value = true;
    try {
        const result = await authState.createToken(newTokenName.value.trim());
        if (!result.success) {
            tokensError.value = result.error.message;
            return;
        }
        createdToken.value = result.value;
        newTokenName.value = "";
        await loadTokens();
    } finally {
        isCreatingToken.value = false;
    }
}

async function handleCopyToken() {
    if (!createdToken.value) {
        return;
    }
    await navigator.clipboard.writeText(createdToken.value.token);
    isTokenCopied.value = true;
    setTimeout(() => {
        isTokenCopied.value = false;
    }, 2000);
}

async function handleRevokeToken(tokenId: string) {
    if (revokingTokenId.value) {
        return;
    }
    tokensError.value = undefined;
    revokingTokenId.value = tokenId;
    try {
        const result = await authState.revokeToken(tokenId);
        if (!result.success) {
            tokensError.value = result.error.message;
            return;
        }
        tokens.value = tokens.value.filter((token) => token.id !== tokenId);
    } finally {
        revokingTokenId.value = undefined;
    }
}

async function loadSshKeys() {
    sshKeysError.value = undefined;
    const result = await authState.listSshKeys();
    if (!result.success) {
        sshKeysError.value = result.error.message;
        return;
    }
    sshKeys.value = result.value;
}

async function handleSshKeysSectionToggle(open: boolean) {
    if (open) {
        await loadSshKeys();
    }
}

async function handleAddSshKey() {
    if (isAddingSshKey.value || !newSshKeyName.value.trim() || !newSshKeyValue.value.trim()) {
        return;
    }
    sshKeysError.value = undefined;
    isAddingSshKey.value = true;
    try {
        const result = await authState.addSshKey(newSshKeyName.value.trim(), newSshKeyValue.value.trim());
        if (!result.success) {
            sshKeysError.value = result.error.message;
            return;
        }
        newSshKeyName.value = "";
        newSshKeyValue.value = "";
        await loadSshKeys();
    } finally {
        isAddingSshKey.value = false;
    }
}

async function handleRemoveSshKey(keyId: string) {
    if (removingSshKeyId.value) {
        return;
    }
    sshKeysError.value = undefined;
    removingSshKeyId.value = keyId;
    try {
        const result = await authState.removeSshKey(keyId);
        if (!result.success) {
            sshKeysError.value = result.error.message;
            return;
        }
        sshKeys.value = sshKeys.value.filter((key) => key.id !== keyId);
    } finally {
        removingSshKeyId.value = undefined;
    }
}

async function handleLogout() {
    if (isLoggingOut.value) {
        return;
    }
    isLoggingOut.value = true;
    try {
        await authState.logout();
        open.value = false;
    } finally {
        isLoggingOut.value = false;
    }
}
</script>
