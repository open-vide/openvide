/**
 * Voice input using even-toolkit STTEngine with supported cloud providers only.
 */

import type { Store } from '../state/store';

let engine: any = null;
let activeStore: Store | null = null;
let committedTranscript = '';
let interimTranscript = '';

const VALID_PROVIDERS = ['soniox', 'whisper-api', 'deepgram'] as const;

function normalizeProvider(provider?: string | null): string {
  if (provider && (VALID_PROVIDERS as readonly string[]).includes(provider)) return provider;
  return 'soniox';
}

function normalizeTranscriptText(text?: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function mergeTranscript(base: string, next: string): string {
  const normalizedBase = normalizeTranscriptText(base);
  const normalizedNext = normalizeTranscriptText(next);

  if (!normalizedBase) return normalizedNext;
  if (!normalizedNext) return normalizedBase;
  if (normalizedNext.startsWith(normalizedBase)) return normalizedNext;
  if (normalizedBase.endsWith(normalizedNext)) return normalizedBase;
  return `${normalizedBase} ${normalizedNext}`.trim();
}

/** Check if voice is available (always true — STTEngine handles provider availability). */
export function isVoiceAvailable(): boolean {
  return true;
}

export async function startVoiceCapture(store: Store): Promise<void> {
  if (engine) {
    stopVoiceCapture();
  }

  activeStore = store;
  committedTranscript = '';
  interimTranscript = '';
  const settings = store.getState().settings;
  const provider = normalizeProvider(settings.sttProvider);
  const apiKey = settings.sttApiKey?.trim();

  store.dispatch({ type: 'VOICE_START' });

  if (!apiKey) {
    store.dispatch({ type: 'VOICE_ERROR', error: `${provider} API key missing` });
    return;
  }

  try {
    const { STTEngine } = await import('even-toolkit/stt');

    engine = new STTEngine({
      provider,
      source: 'microphone',
      language: settings.voiceLang ?? 'en-US',
      apiKey,
    });

    engine.onTranscript((t: { text: string; isFinal: boolean }) => {
      if (!activeStore) return;
      const nextText = normalizeTranscriptText(t.text);
      if (t.isFinal) {
        committedTranscript = mergeTranscript(committedTranscript, nextText);
        interimTranscript = '';
        activeStore.dispatch({ type: 'VOICE_FINAL', text: committedTranscript });
      } else {
        interimTranscript = nextText;
        activeStore.dispatch({
          type: 'VOICE_INTERIM',
          text: mergeTranscript(committedTranscript, interimTranscript),
        });
      }
    });

    engine.onError((err: { message: string }) => {
      activeStore?.dispatch({ type: 'VOICE_ERROR', error: err.message });
    });

    await engine.start();
  } catch (error) {
    engine = null;
    activeStore?.dispatch({
      type: 'VOICE_ERROR',
      error: error instanceof Error ? error.message : 'Failed to start speech-to-text',
    });
  }
}

export function stopVoiceCapture(): void {
  if (engine) {
    try { engine.stop(); } catch { /* ignore */ }
    engine = null;
  }
  activeStore = null;
  committedTranscript = '';
  interimTranscript = '';
}
