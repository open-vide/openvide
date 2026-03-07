import * as SecureStore from "expo-secure-store";
import type { SshCredentials, ToolName } from "../core/types";

const SERVICE = "open-vide-keychain";

function credentialsKey(targetId: string): string {
  return `open-vide.credentials.${targetId}`;
}

function toolEnvKey(targetId: string, tool: ToolName): string {
  return `open-vide.tool-env.${targetId}.${tool}`;
}

export async function saveTargetCredentials(
  targetId: string,
  credentials: SshCredentials,
): Promise<void> {
  await SecureStore.setItemAsync(credentialsKey(targetId), JSON.stringify(credentials), {
    keychainService: SERVICE,
  });
}

export async function loadTargetCredentials(targetId: string): Promise<SshCredentials | undefined> {
  const raw = await SecureStore.getItemAsync(credentialsKey(targetId), {
    keychainService: SERVICE,
  });
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as SshCredentials;
}

export async function deleteTargetCredentials(targetId: string): Promise<void> {
  await SecureStore.deleteItemAsync(credentialsKey(targetId), {
    keychainService: SERVICE,
  });
}

export async function saveToolEnv(
  targetId: string,
  tool: ToolName,
  env: Record<string, string>,
): Promise<void> {
  await SecureStore.setItemAsync(toolEnvKey(targetId, tool), JSON.stringify(env), {
    keychainService: SERVICE,
  });
}

export async function loadToolEnv(
  targetId: string,
  tool: ToolName,
): Promise<Record<string, string>> {
  const raw = await SecureStore.getItemAsync(toolEnvKey(targetId, tool), {
    keychainService: SERVICE,
  });
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as Record<string, string>;
}

export async function deleteToolEnv(targetId: string, tool: ToolName): Promise<void> {
  await SecureStore.deleteItemAsync(toolEnvKey(targetId, tool), {
    keychainService: SERVICE,
  });
}
