import { useState, useEffect, useRef } from 'react';
import { subscribe } from '@/domain/daemon-client';
import { parseOutputLine } from '@/domain/output-parser';
import { buildMessagesFromDisplayLines, parseNativeHistoryToDisplayLines } from '@/domain/native-history';
import { useBridge } from '../contexts/bridge';
import { rpcForHost } from '../lib/bridge-hosts';
import type { ChatMessage, WebSession } from '../types';

const NATIVE_SYNC_POLL_MS = 4000;

function sameMessages(current: ChatMessage[], next: ChatMessage[]): boolean {
  if (current.length !== next.length) return false;
  for (let i = 0; i < current.length; i += 1) {
    const left = current[i];
    const right = next[i];
    if (!left || !right) return false;
    if (
      left.role !== right.role
      || left.content !== right.content
      || left.thinking !== right.thinking
      || left.isStreaming !== right.isStreaming
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Subscribes to a session's output stream and builds chat messages.
 *
 * The bridge sends ALL existing output lines on subscribe (full replay),
 * then tails new lines. To prevent duplicates:
 * - We batch incoming lines with a 100ms debounce
 * - On each batch, we rebuild messages from ALL accumulated raw lines
 * - This means re-subscribes just re-deliver the same lines → same result
 */
export function useSessionStream(sessionId: string | undefined, sessions?: WebSession[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { ensureBridgeForSession, hosts, activeHostId } = useBridge();
  const streamRawLinesRef = useRef<string[]>([]);
  const nativeDisplayLinesRef = useRef<string[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestMessagesRef = useRef<ChatMessage[]>([]);
  const rebuildMessagesRef = useRef<() => void>(() => {});
  const loadedNativeHistoryKeyRef = useRef<string | null>(null);
  const nativeHistoryLineCountRef = useRef(0);
  const session = sessions?.find((entry) => entry.id === sessionId);

  // Ensure bridge is set for this session's host
  useEffect(() => {
    if (sessionId && sessions) ensureBridgeForSession(sessionId, sessions);
  }, [sessionId, sessions, ensureBridgeForSession]);

  function rebuildMessages() {
    const streamDisplayLines = streamRawLinesRef.current.flatMap((raw) => parseOutputLine(raw));
    // For resumed sessions the WebSocket stream IS the native live watcher,
    // and we ALSO poll session.history as a safety net. The poll overwrites
    // nativeDisplayLinesRef with the full current history; the stream carries
    // in deltas. Prefer the longer view so we never regress.
    const useStream = streamDisplayLines.length >= nativeDisplayLinesRef.current.length;
    const combinedDisplayLines = useStream
      ? streamDisplayLines
      : nativeDisplayLinesRef.current;
    const stabilized = buildMessagesFromDisplayLines(combinedDisplayLines, latestMessagesRef.current);

    if (sameMessages(latestMessagesRef.current, stabilized)) return;

    latestMessagesRef.current = stabilized;
    setMessages(stabilized);
  }
  rebuildMessagesRef.current = rebuildMessages;

  // Subscribe to output stream. For resumed sessions (native or daemon) we
  // subscribe to the NATIVE id (`claude:<uuid>`, `codex:<uuid>`, `gemini:<id>`)
  // instead of the daemon session id, so external CLI writes to the native
  // history file stream in live — matching the behavior the glasses already
  // have. Non-resumed daemon sessions continue to subscribe to the daemon id.
  useEffect(() => {
    if (!sessionId) return;

    setMessages([]);
    latestMessagesRef.current = [];
    streamRawLinesRef.current = [];
    nativeDisplayLinesRef.current = [];
    loadedNativeHistoryKeyRef.current = null;
    nativeHistoryLineCountRef.current = 0;

    const nativeSub = session?.resumeId && (session.tool === 'claude' || session.tool === 'codex' || session.tool === 'gemini')
      ? `${session.tool}:${session.resumeId}`
      : null;
    const target = nativeSub ?? sessionId;

    // Deduplicate: track raw lines by content to handle replays
    const seenLines = new Set<string>();

    const unsub = subscribe(target, (rawLine: string) => {
      // Skip exact duplicate raw lines (replay protection)
      if (seenLines.has(rawLine)) return;
      seenLines.add(rawLine);

      streamRawLinesRef.current.push(rawLine);

      // Debounce rebuild — batch lines arriving within 100ms
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      batchTimerRef.current = setTimeout(() => rebuildMessagesRef.current(), 100);
    });

    return () => {
      unsub();
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, session?.resumeId, session?.tool]);

  useEffect(() => {
    if (!sessionId || !session?.resumeId) return;
    if (session.tool !== 'claude' && session.tool !== 'codex') return;
    // Always bootstrap native history when a resumeId is present — previously
    // we skipped when the daemon had any output, which meant resumed sessions
    // lost their prior conversation after a single new turn.

    // Bootstrap ONCE per session entry. Do NOT include session.outputLines in
    // the key — otherwise every new turn would retrigger a native refetch, and
    // since the CLI persists the new turn to the native history file it would
    // then duplicate whatever the daemon stream is already replaying.
    const nativeHistoryKey = [
      session.id,
      session.origin ?? 'daemon',
      session.tool,
      session.resumeId,
      session.workingDirectory,
    ].join(':');
    if (loadedNativeHistoryKeyRef.current === nativeHistoryKey) return;
    loadedNativeHistoryKeyRef.current = nativeHistoryKey;

    let cancelled = false;
    void (async () => {
      try {
        const res = await rpcForHost(hosts, session.hostId ?? activeHostId, 'session.history', {
          tool: session.tool,
          resumeId: session.resumeId,
          cwd: session.workingDirectory,
          limitLines: 8000,
        });
        if (cancelled || !res.ok || !res.history || !Array.isArray((res.history as any).lines)) {
          return;
        }

        nativeHistoryLineCountRef.current = typeof (res.history as any).lineCount === 'number'
          ? ((res.history as any).lineCount as number)
          : nativeHistoryLineCountRef.current;
        nativeDisplayLinesRef.current = parseNativeHistoryToDisplayLines(
          (res.history as any).format as string | undefined,
          (res.history as any).lines as string[],
        );
        rebuildMessagesRef.current();
      } catch {
        // Keep the current stream state visible if native history bootstrap fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeHostId, hosts, session?.hostId, session?.id, session?.origin, session?.resumeId, session?.tool, session?.workingDirectory, sessionId]);

  useEffect(() => {
    if (!sessionId || !session?.resumeId) return;
    if (session.tool !== 'claude' && session.tool !== 'codex') return;
    if (session.status === 'running') return;

    let cancelled = false;

    const syncNativeHistory = async () => {
      try {
        const res = await rpcForHost(hosts, session.hostId ?? activeHostId, 'session.history', {
          tool: session.tool,
          resumeId: session.resumeId,
          cwd: session.workingDirectory,
          limitLines: 8000,
        });
        if (cancelled || !res.ok || !res.history || !Array.isArray((res.history as any).lines)) {
          return;
        }

        const lineCount = typeof (res.history as any).lineCount === 'number'
          ? ((res.history as any).lineCount as number)
          : 0;
        const shouldBootstrap = session.origin === 'native' || session.outputLines === 0;
        const hasNewNativeHistory = lineCount > nativeHistoryLineCountRef.current;
        const shouldUseNativeHistory = shouldBootstrap || streamRawLinesRef.current.length === 0;

        if (!shouldUseNativeHistory || (!shouldBootstrap && !hasNewNativeHistory)) {
          return;
        }

        nativeHistoryLineCountRef.current = Math.max(nativeHistoryLineCountRef.current, lineCount);
        nativeDisplayLinesRef.current = parseNativeHistoryToDisplayLines(
          (res.history as any).format as string | undefined,
          (res.history as any).lines as string[],
        );
        rebuildMessagesRef.current();
      } catch {
        // Keep the current stream state visible if native history polling fails.
      }
    };

    void syncNativeHistory();
    const timer = setInterval(() => {
      void syncNativeHistory();
    }, NATIVE_SYNC_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    activeHostId,
    hosts,
    session?.hostId,
    session?.id,
    session?.origin,
    session?.outputLines,
    session?.resumeId,
    session?.status,
    session?.tool,
    session?.workingDirectory,
    sessionId,
  ]);

  return messages;
}
