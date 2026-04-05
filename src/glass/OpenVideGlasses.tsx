import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useGlasses } from 'even-toolkit/useGlasses';
import { createScreenMapper } from 'even-toolkit/glass-router';
import { toDisplayData, onGlassAction } from './selectors';
import type { OpenVideSnapshot, OpenVideActions } from './types';
import { rpc, rpcToHost, subscribe } from '../domain/daemon-client';
import { parseOutputLine } from '../domain/output-parser';
import { useSessions } from '../hooks/use-sessions';
import { useWorkspaces } from '../hooks/use-workspaces';
import { useBridge } from '../contexts/bridge';
import { useSettings, defaultSettings, normalizeSettings } from '../hooks/use-settings';
import { useBrowserEntries, useFileContent } from '../hooks/use-file-browser';
import { startVoiceCapture, stopVoiceCapture } from '../input/voice';
import type { Store } from '../state/store';
import type { Action } from '../state/actions';
import { applySettingsPatch } from '../lib/settings';
import {
  SETTINGS_CACHE_KEY,
  SETTINGS_PENDING_KEY,
  clearStoredSettings,
  writeStoredSettings,
} from '../lib/settings-storage';

const VOICE_ROUTE = '/voice-input';

const deriveScreen = createScreenMapper([
  { pattern: '/', screen: 'home' },
  { pattern: '/workspace', screen: 'workspace-detail' },
  { pattern: '/sessions', screen: 'session-list' },
  { pattern: VOICE_ROUTE, screen: 'voice-input' },
  { pattern: /^\/chat/, screen: 'live-output' },
  { pattern: '/hosts', screen: 'host-list' },
  { pattern: '/teams', screen: 'team-list' },
  { pattern: /^\/team-chat/, screen: 'team-chat' },
  { pattern: /^\/team/, screen: 'team-detail' },
  { pattern: '/settings', screen: 'settings' },
  { pattern: '/schedules', screen: 'schedules' },
  { pattern: '/file-view', screen: 'file-viewer' },
  { pattern: /^\/files/, screen: 'file-browser' },
  { pattern: '/diffs', screen: 'session-diffs' },
], 'home');

/**
 * Subscribe to a session's output stream and collect parsed display lines.
 * Mirrors the web UI's useSessionStream but returns flat string[] for the glass snapshot.
 */
function useGlassOutputStream(
  sessionId: string | null,
  sessions: Array<{ id: string; hostId?: string }> | undefined,
  ensureBridge: (sessionId: string, sessions: Array<{ id: string; hostId?: string }>) => void,
): string[] {
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const linesRef = useRef<string[]>([]);
  const seenRef = useRef(new Set<string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ensure bridge points at the right host before subscribing
  useEffect(() => {
    if (sessionId && sessions) ensureBridge(sessionId, sessions);
  }, [sessionId, sessions, ensureBridge]);

  useEffect(() => {
    if (!sessionId) {
      setOutputLines([]);
      linesRef.current = [];
      seenRef.current = new Set();
      return;
    }

    // Reset on session change
    linesRef.current = [];
    seenRef.current = new Set();
    setOutputLines([]);

    const unsub = subscribe(sessionId, (rawLine: string) => {
      if (seenRef.current.has(rawLine)) return;
      seenRef.current.add(rawLine);

      const parsed = parseOutputLine(rawLine);
      if (parsed.length > 0) {
        linesRef.current.push(...parsed);
        // Debounce state update
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setOutputLines([...linesRef.current]);
        }, 150);
      }
    });

    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [sessionId]);

  return outputLines;
}

/**
 * Poll teams list via RPC (no react-query hook exists for teams).
 */
function useGlassTeams(hosts: Array<{
  id?: string;
  url: string;
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  authSessionId?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}>) {
  const [teams, setTeams] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        // Try first connected host
        for (const host of hosts) {
          try {
            const res = await rpcToHost(host.url, 'team.list', undefined, undefined, {
              hostId: host.id,
              token: host.token,
              accessToken: host.accessToken,
              refreshToken: host.refreshToken,
              authSessionId: host.authSessionId,
              accessTokenExpiresAt: host.accessTokenExpiresAt,
              refreshTokenExpiresAt: host.refreshTokenExpiresAt,
            });
            if (!cancelled && res.ok && Array.isArray(res.teams)) {
              setTeams(res.teams);
              return;
            }
          } catch { /* try next */ }
        }
        // Fallback to default rpc
        const res = await rpc('team.list').catch(() => ({ ok: false }));
        if (!cancelled && (res as any).ok && Array.isArray((res as any).teams)) {
          setTeams((res as any).teams);
        }
      } catch { /* keep previous */ }
    }

    poll();
    const timer = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [hosts]);

  return teams;
}

/**
 * Fetch team tasks + messages when viewing a specific team.
 */
function useGlassTeamData(teamId: string | null) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [plan, setPlan] = useState<any | null>(null);

  useEffect(() => {
    if (!teamId) {
      setTasks([]);
      setMessages([]);
      setPlan(null);
      return;
    }

    let cancelled = false;

    async function fetch() {
      try {
        const [tasksRes, msgsRes, planRes] = await Promise.all([
          rpc('team.task.list', { teamId }).catch(() => ({ ok: false })),
          rpc('team.message.list', { teamId, limit: 50 }).catch(() => ({ ok: false })),
          rpc('team.plan.latest', { teamId }).catch(() => ({ ok: false })),
        ]);
        if (cancelled) return;
        if ((tasksRes as any).ok && Array.isArray((tasksRes as any).teamTasks)) {
          setTasks((tasksRes as any).teamTasks);
        }
        if ((msgsRes as any).ok && Array.isArray((msgsRes as any).teamMessages)) {
          setMessages((msgsRes as any).teamMessages);
        }
        if ((planRes as any).ok && (planRes as any).teamPlan) {
          setPlan((planRes as any).teamPlan);
        } else {
          setPlan(null);
        }
      } catch { /* keep previous */ }
    }

    fetch();
    const timer = setInterval(fetch, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [teamId]);

  return { tasks, messages, plan };
}

/**
 * Fetch schedules list.
 */
function useGlassSchedules() {
  const [schedules, setSchedules] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      try {
        const res = await rpc('schedule.list').catch(() => ({ ok: false }));
        if (!cancelled && (res as any).ok && Array.isArray((res as any).schedules)) {
          setSchedules((res as any).schedules);
        }
      } catch { /* keep previous */ }
    }
    fetch();
    const timer = setInterval(fetch, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return schedules;
}

export function OpenVideGlasses() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Share data with web UI via react-query hooks
  const { data: sessions } = useSessions();
  const workspaces = useWorkspaces(sessions);
  const { hosts, activeHostId, hostStatuses, connectionStatus, ensureBridgeForSession, ensureBridgeForCommand, switchHost } = useBridge();
  const { data: settings } = useSettings();
  const [glassSettings, setGlassSettings] = useState(() => normalizeSettings(settings));
  const [sessionModePrefs, setSessionModePrefs] = useState<Record<string, string>>({});
  const [sessionModelPrefs, setSessionModelPrefs] = useState<Record<string, string>>({});
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceText, setVoiceText] = useState<string | null>(null);
  const voiceReturnPathRef = useRef('/sessions');
  const settingsRef = useRef(glassSettings);
  settingsRef.current = glassSettings;

  const dispatchVoiceAction = useCallback((action: Action) => {
    switch (action.type) {
      case 'VOICE_START':
        setVoiceListening(true);
        setVoiceText(null);
        break;
      case 'VOICE_INTERIM':
        setVoiceListening(true);
        setVoiceText(action.text);
        break;
      case 'VOICE_FINAL':
        setVoiceListening(false);
        setVoiceText(action.text);
        break;
      case 'VOICE_ERROR':
        setVoiceListening(false);
        setVoiceText(`Error: ${action.error}`);
        break;
      case 'VOICE_CANCEL':
      case 'VOICE_CLEAR':
        setVoiceListening(false);
        setVoiceText(null);
        break;
      default:
        break;
    }
  }, []);

  const voiceStoreRef = useRef<Store>({
    getState: () => ({ settings: settingsRef.current } as any),
    dispatch: dispatchVoiceAction,
    subscribe: () => () => {},
  });
  voiceStoreRef.current = {
    getState: () => ({ settings: settingsRef.current } as any),
    dispatch: dispatchVoiceAction,
    subscribe: () => () => {},
  };

  useEffect(() => {
    const resolved = normalizeSettings(settings);
    setGlassSettings((current) => {
      const currentJson = JSON.stringify(current);
      const resolvedJson = JSON.stringify(resolved);
      return currentJson === resolvedJson ? current : resolved;
    });
  }, [settings]);

  useEffect(() => () => {
    stopVoiceCapture();
  }, []);

  // Extract params from URL
  const urlParams = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      sessionId: params.get('id') || params.get('session'),
      teamId: params.get('id'),
      browserPath: params.get('path') || '~',
      browserHost: params.get('host'),
      workspace: params.get('workspace'),
      workspaceHost: params.get('host'),
    };
  }, [location.search]);

  const isFilesScreen = location.pathname.startsWith('/files') || location.pathname === '/file-view';
  const isTeamScreen = location.pathname.startsWith('/team');
  const selectedSession = useMemo(
    () => (sessions ?? []).find((session) => session.id === (urlParams.sessionId ?? null)) ?? null,
    [sessions, urlParams.sessionId],
  );
  const selectedSessionMode = useMemo(
    () => (urlParams.sessionId ? sessionModePrefs[urlParams.sessionId] : undefined) ?? 'auto',
    [sessionModePrefs, urlParams.sessionId],
  );
  const selectedSessionModel = useMemo(() => {
    if (!urlParams.sessionId) return '';
    const preferred = sessionModelPrefs[urlParams.sessionId];
    if (preferred) return preferred;
    if (selectedSession?.model) return selectedSession.model;
    if (selectedSession?.tool === 'claude') return 'opus';
    return '';
  }, [selectedSession?.model, selectedSession?.tool, sessionModelPrefs, urlParams.sessionId]);

  // Subscribe to active session's output for glass chat display
  const outputLines = useGlassOutputStream(urlParams.sessionId ?? null, sessions, ensureBridgeForSession);

  // Poll teams + team detail data + schedules
  const teams = useGlassTeams(hosts);
  const activeTeamId = isTeamScreen ? (urlParams.teamId ?? null) : null;
  const { tasks: teamTasks, messages: teamMessages, plan: teamPlan } = useGlassTeamData(activeTeamId);
  const scheduledTasks = useGlassSchedules();

  // File browser entries and file content
  const isViewingFile = location.pathname === '/file-view' || (isFilesScreen && new URLSearchParams(location.search).get('view') === 'true');
  const browserHostId = urlParams.browserHost ?? activeHostId ?? null;
  const { data: browserEntries } = useBrowserEntries(isFilesScreen && !isViewingFile ? urlParams.browserPath : '~', browserHostId);
  const { data: fileContent } = useFileContent(isViewingFile ? urlParams.browserPath : null, browserHostId);

  // Build snapshot from shared data
  const snapshot: OpenVideSnapshot = useMemo(() => ({
    sessions: (sessions ?? []) as unknown as OpenVideSnapshot['sessions'],
    hosts: hosts as unknown as OpenVideSnapshot['hosts'],
    selectedHostId: browserHostId ?? activeHostId ?? null,
    hostStatuses,
    workspaces,
    connectionStatus,
    selectedSessionId: urlParams.sessionId ?? null,
    selectedSessionMode,
    selectedSessionModel,
    selectedWorkspace: urlParams.workspace ?? null,
    selectedWorkspaceHostId: urlParams.workspaceHost ?? null,
    outputLines: isViewingFile && fileContent ? fileContent.split('\n') : outputLines,
    outputScrollOffset: 0,
    chatHighlight: 0,
    expandedThinking: [],
    voiceListening,
    voiceText,
    teams: teams as unknown as OpenVideSnapshot['teams'],
    selectedTeamId: activeTeamId,
    teamTasks: teamTasks as unknown as OpenVideSnapshot['teamTasks'],
    teamMessages: teamMessages as unknown as OpenVideSnapshot['teamMessages'],
    teamPlan: teamPlan as OpenVideSnapshot['teamPlan'],
    scheduledTasks: scheduledTasks as unknown as OpenVideSnapshot['scheduledTasks'],
    settings: glassSettings as OpenVideSnapshot['settings'],
    browserPath: urlParams.browserPath,
    browserEntries: (browserEntries ?? []) as unknown as OpenVideSnapshot['browserEntries'],
    diffFiles: [],
    prompts: [],
    ports: [],
    pendingResult: null,
  }), [sessions, hosts, browserHostId, activeHostId, hostStatuses, workspaces, connectionStatus, urlParams, outputLines, voiceListening, voiceText, glassSettings, teams, teamTasks, teamMessages, teamPlan, scheduledTasks, browserEntries, activeTeamId, isViewingFile, fileContent, selectedSessionMode, selectedSessionModel]);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  const rpcWithSharedState = useCallback<OpenVideActions['rpc']>(async (cmd, params) => {
    if (cmd === 'session.send') {
      const sessionId = typeof params?.id === 'string' ? params.id : null;
      if (sessionId) {
        const modeOverride = sessionModePrefs[sessionId];
        const modelOverride = sessionModelPrefs[sessionId];
        const nextParams: Record<string, unknown> = { ...(params ?? {}) };
        if (modeOverride && modeOverride !== 'auto' && typeof nextParams.mode !== 'string') {
          nextParams.mode = modeOverride;
        }
        if (modelOverride && typeof nextParams.model !== 'string') {
          nextParams.model = modelOverride;
        }
        return rpc(cmd, nextParams);
      }
    }

    if (cmd !== 'settings.set') {
      return rpc(cmd, params);
    }

    ensureBridgeForCommand();

    const previous = normalizeSettings(queryClient.getQueryData(['settings']) as Partial<typeof defaultSettings> | undefined);
    const next = normalizeSettings(
      applySettingsPatch(
        previous,
        (params?.settings as Partial<typeof defaultSettings> | undefined) ?? previous,
      ),
    );

    setGlassSettings(next);
    queryClient.setQueryData(['settings'], next);
    try {
      void writeStoredSettings(SETTINGS_CACHE_KEY, next);
      void writeStoredSettings(SETTINGS_PENDING_KEY, next);
    } catch {
      // Ignore local persistence failures and keep optimistic in-memory state.
    }

    try {
      const res = await rpc(cmd, { ...params, settings: next });
      if (res.ok && res.settings) {
        const persisted = normalizeSettings(res.settings as Partial<typeof defaultSettings>);
        setGlassSettings(persisted);
        queryClient.setQueryData(['settings'], persisted);
        try {
          void writeStoredSettings(SETTINGS_CACHE_KEY, persisted);
          clearStoredSettings(SETTINGS_PENDING_KEY);
        } catch {
          // Ignore local persistence failures.
        }
      } else {
        try {
          void writeStoredSettings(SETTINGS_CACHE_KEY, next);
          void writeStoredSettings(SETTINGS_PENDING_KEY, next);
        } catch {
          // Ignore local persistence failures.
        }
      }
      return res;
    } catch {
      return { ok: false, error: 'Failed to persist settings immediately; keeping local value and retrying later.' };
    }
  }, [ensureBridgeForCommand, queryClient, sessionModePrefs, sessionModelPrefs]);

  const startVoice = useCallback(() => {
    voiceReturnPathRef.current = `${location.pathname}${location.search}` || '/sessions';
    setVoiceListening(true);
    setVoiceText(null);
    navigate(`${VOICE_ROUTE}${location.search}`);
    void (async () => {
      await startVoiceCapture(voiceStoreRef.current);
    })();
  }, [location.pathname, location.search, navigate]);

  const stopVoice = useCallback(() => {
    stopVoiceCapture();
    setVoiceListening(false);
    setVoiceText(null);
    const target = voiceReturnPathRef.current || '/sessions';
    if (`${location.pathname}${location.search}` !== target) {
      navigate(target, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const submitVoice = useCallback(async (prompt: string) => {
    const text = prompt.trim();
    if (!text || text.startsWith('Error:')) {
      stopVoice();
      return;
    }

    stopVoiceCapture();
    setVoiceListening(false);
    setVoiceText(null);

    const target = voiceReturnPathRef.current || '/sessions';
    const [pathname, search = ''] = target.split('?');
    const params = new URLSearchParams(search);

    if (pathname.startsWith('/team')) {
      const teamId = params.get('id');
      if (teamId) {
        await rpcWithSharedState('team.message.send', { teamId, text });
      }
    } else {
      const sessionId = params.get('id') ?? params.get('session') ?? urlParams.sessionId;
      if (sessionId) {
        await rpcWithSharedState('session.send', { id: sessionId, prompt: text });
      }
    }

    if (`${location.pathname}${location.search}` !== target) {
      navigate(target, { replace: true });
    }
  }, [location.pathname, location.search, navigate, rpcWithSharedState, stopVoice, urlParams.sessionId]);

  const ctxRef = useRef<OpenVideActions>({
    navigate,
    rpc: rpcWithSharedState,
    switchHost,
    setSessionMode: (mode: string) => {
      const sessionId = snapshotRef.current.selectedSessionId;
      if (!sessionId) return;
      setSessionModePrefs((current) => (current[sessionId] === mode ? current : { ...current, [sessionId]: mode }));
    },
    setSessionModel: (model: string) => {
      const sessionId = snapshotRef.current.selectedSessionId;
      if (!sessionId) return;
      setSessionModelPrefs((current) => (current[sessionId] === model ? current : { ...current, [sessionId]: model }));
    },
    startVoice,
    stopVoice,
    submitVoice,
  });
  ctxRef.current.navigate = navigate;
  ctxRef.current.rpc = rpcWithSharedState;
  ctxRef.current.switchHost = switchHost;
  ctxRef.current.setSessionMode = (mode: string) => {
    const sessionId = snapshotRef.current.selectedSessionId;
    if (!sessionId) return;
    setSessionModePrefs((current) => (current[sessionId] === mode ? current : { ...current, [sessionId]: mode }));
  };
  ctxRef.current.setSessionModel = (model: string) => {
    const sessionId = snapshotRef.current.selectedSessionId;
    if (!sessionId) return;
    setSessionModelPrefs((current) => (current[sessionId] === model ? current : { ...current, [sessionId]: model }));
  };
  ctxRef.current.startVoice = startVoice;
  ctxRef.current.stopVoice = stopVoice;
  ctxRef.current.submitVoice = submitVoice;

  const handleAction = useCallback(
    (action: Parameters<typeof onGlassAction>[0], nav: Parameters<typeof onGlassAction>[1], snap: OpenVideSnapshot) =>
      onGlassAction(action, nav, snap, ctxRef.current),
    [],
  );

  useGlasses({
    getSnapshot,
    toDisplayData,
    onGlassAction: handleAction,
    deriveScreen,
    appName: 'OPENVIDE',
    getPageMode: (screen) => (screen === 'home' ? 'home' : 'text'),
  });

  return null;
}
