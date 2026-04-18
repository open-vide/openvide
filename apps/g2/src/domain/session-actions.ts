/**
 * Async executors for session actions: sendPrompt, cancel, dismiss.
 */

import type { Store } from '../state/store';
import { rpc } from './daemon-client';

export async function sendPrompt(store: Store, sessionId: string, prompt: string): Promise<void> {
  store.dispatch({ type: 'ACTION_STARTED', action: 'send', sessionId });
  try {
    const res = await rpc('session.send', { id: sessionId, prompt });
    store.dispatch({
      type: 'ACTION_COMPLETED',
      result: {
        action: 'send',
        sessionId,
        success: res.ok === true,
        message: res.ok ? 'Prompt sent' : (res.error as string) ?? 'Send failed',
      },
    });
  } catch (err: any) {
    store.dispatch({
      type: 'ACTION_COMPLETED',
      result: {
        action: 'send',
        sessionId,
        success: false,
        message: err?.message ?? 'Send failed',
      },
    });
  }
}

export async function cancelSession(store: Store, sessionId: string): Promise<void> {
  store.dispatch({ type: 'ACTION_STARTED', action: 'cancel', sessionId });
  try {
    const res = await rpc('session.cancel', { id: sessionId });
    store.dispatch({
      type: 'ACTION_COMPLETED',
      result: {
        action: 'cancel',
        sessionId,
        success: res.ok === true,
        message: res.ok ? 'Session cancelled' : (res.error as string) ?? 'Cancel failed',
      },
    });
  } catch (err: any) {
    store.dispatch({
      type: 'ACTION_COMPLETED',
      result: {
        action: 'cancel',
        sessionId,
        success: false,
        message: err?.message ?? 'Cancel failed',
      },
    });
  }
}

export async function pushToChannel(store: Store, sessionId: string, content: string, meta?: Record<string, unknown>): Promise<void> {
  try {
    const res = await rpc('channel.push', { sessionId, content, meta });
    if (!res.ok) {
      store.dispatch({
        type: 'ACTION_COMPLETED',
        result: { action: 'channel.push', sessionId, success: false, message: (res.error as string) ?? 'Push failed' },
      });
    }
    // No success notification — the text is injected silently
  } catch (err: any) {
    store.dispatch({
      type: 'ACTION_COMPLETED',
      result: { action: 'channel.push', sessionId, success: false, message: err?.message ?? 'Push failed' },
    });
  }
}

export async function dismissSession(store: Store, sessionId: string): Promise<void> {
  store.dispatch({ type: 'ACTION_STARTED', action: 'dismiss', sessionId });
  try {
    const res = await rpc('session.remove', { id: sessionId });
    store.dispatch({
      type: 'ACTION_COMPLETED',
      result: {
        action: 'dismiss',
        sessionId,
        success: res.ok === true,
        message: res.ok ? 'Session removed' : (res.error as string) ?? 'Remove failed',
      },
    });
  } catch (err: any) {
    store.dispatch({
      type: 'ACTION_COMPLETED',
      result: {
        action: 'dismiss',
        sessionId,
        success: false,
        message: err?.message ?? 'Remove failed',
      },
    });
  }
}
