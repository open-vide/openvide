/**
 * Live session output stream via WebSocket subscription.
 * Replaces SSE/EventSource with the unified WS connection.
 * Parses raw JSONL from Claude/Codex into human-readable lines.
 */

import type { Store } from '../state/store';
import { subscribe } from './daemon-client';
import { parseOutputLine } from './output-parser';

let unsubscribeFn: (() => void) | null = null;

export function startOutputStream(store: Store, sessionId: string): void {
  stopOutputStream();

  console.log('[output-stream] Subscribing to session', sessionId);

  // Coalesce renders: batch lines arriving within 100ms
  let pending: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    const batch = pending;
    pending = [];
    flushTimer = null;
    for (const line of batch) {
      store.dispatch({ type: 'OUTPUT_LINE', line });
    }
  }

  function enqueue(lines: string[]): void {
    if (lines.length === 0) return;
    pending.push(...lines);
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 100);
    }
  }

  unsubscribeFn = subscribe(sessionId, (rawLine: string) => {
    const readable = parseOutputLine(rawLine);
    enqueue(readable);
  });
}

export function stopOutputStream(): void {
  if (unsubscribeFn) {
    unsubscribeFn();
    unsubscribeFn = null;
    console.log('[output-stream] Stopped');
  }
}
