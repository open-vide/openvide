import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PersistedState } from "../core/types";

const STORAGE_KEY = "open-vide/state";
const CURRENT_VERSION = 4;

const EMPTY_STATE: PersistedState = {
  version: CURRENT_VERSION,
  targets: [],
  runs: [],
  readinessByTarget: {},
  workspaces: [],
  sessions: [],
  promptTemplates: [],
  promptFlows: [],
  hiddenBuiltInPromptIds: [],
  autoAcceptTools: false,
  notificationsEnabled: true,
  speechLanguage: "en-US",
};

function migrate(state: Record<string, unknown>): PersistedState {
  const version = typeof state["version"] === "number" ? state["version"] : 0;

  // v0 → v1: add promptTemplates, promptFlows
  if (version < 1) {
    if (!Array.isArray(state["promptTemplates"])) {
      state["promptTemplates"] = [];
    }
    if (!Array.isArray(state["promptFlows"])) {
      state["promptFlows"] = [];
    }
    state["version"] = 1;
  }

  // v1 → v2: detectedTools added to TargetProfile (optional fields, no migration needed)
  if (version < 2) {
    state["version"] = 2;
  }

  // v2 → v3: workspace-first model; reset existing local sessions and add workspaces bucket
  if (version < 3) {
    state["sessions"] = [];
    if (!Array.isArray(state["workspaces"])) {
      state["workspaces"] = [];
    }
    state["version"] = 3;
  }

  // v3 → v4: add hiddenBuiltInPromptIds
  if (version < 4) {
    if (!Array.isArray(state["hiddenBuiltInPromptIds"])) {
      state["hiddenBuiltInPromptIds"] = [];
    }
    state["version"] = 4;
  }

  return {
    version: CURRENT_VERSION,
    targets: (state["targets"] as PersistedState["targets"]) ?? [],
    runs: (state["runs"] as PersistedState["runs"]) ?? [],
    readinessByTarget: (state["readinessByTarget"] as PersistedState["readinessByTarget"]) ?? {},
    workspaces: (state["workspaces"] as PersistedState["workspaces"]) ?? [],
    sessions: (state["sessions"] as PersistedState["sessions"]) ?? [],
    promptTemplates: (state["promptTemplates"] as PersistedState["promptTemplates"]) ?? [],
    promptFlows: (state["promptFlows"] as PersistedState["promptFlows"]) ?? [],
    hiddenBuiltInPromptIds: (state["hiddenBuiltInPromptIds"] as string[]) ?? [],
    autoAcceptTools: (state["autoAcceptTools"] as boolean) ?? false,
    notificationsEnabled: (state["notificationsEnabled"] as boolean) ?? true,
    speechLanguage: (state["speechLanguage"] as string) ?? "en-US",
  };
}

export async function loadState(): Promise<PersistedState> {
  console.log("[OV:storage] loadState called");
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    console.log("[OV:storage] no persisted state found, returning empty");
    return EMPTY_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result = migrate(parsed);
    console.log(
      "[OV:storage] loaded state: v" + result.version + ",",
      result.targets.length, "targets,",
      result.workspaces.length, "workspaces,",
      result.sessions.length, "sessions,",
      result.runs.length, "runs",
    );
    return result;
  } catch (err) {
    console.warn("[OV:storage] failed to parse persisted state:", err);
    return EMPTY_STATE;
  }
}

export async function saveState(state: PersistedState): Promise<void> {
  console.log(
    "[OV:storage] saveState:",
    state.targets.length, "targets,",
    state.workspaces.length, "workspaces,",
    state.sessions.length, "sessions,",
    state.runs.length, "runs",
  );
  const toSave = { ...state, version: CURRENT_VERSION };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}
