import { createModeEncoder } from 'even-toolkit/glass-mode';

export const CHAT_MODE_STRIDE = 100_000;

export const LIVE_OUTPUT_CHAT_MODE_BASES = {
  buttons: 0,
  read: CHAT_MODE_STRIDE,
  readOpen: CHAT_MODE_STRIDE * 2,
  modeSelect: CHAT_MODE_STRIDE * 3,
  modelSelect: CHAT_MODE_STRIDE * 4,
} as const;

export type LiveOutputChatMode = keyof typeof LIVE_OUTPUT_CHAT_MODE_BASES;

export const liveOutputChatMode = createModeEncoder<LiveOutputChatMode>(LIVE_OUTPUT_CHAT_MODE_BASES);
