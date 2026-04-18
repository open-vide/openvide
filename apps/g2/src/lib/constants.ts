export const DEFAULT_POLL_INTERVAL = 2500;

export const HOSTS_STORAGE_KEY = 'openvide_hosts';
export const ACTIVE_HOST_KEY = 'openvide_active_host';

export const VOICE_LANGS = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'es-ES', label: 'Espa\u00f1ol' },
  { code: 'fr-FR', label: 'Fran\u00e7ais' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'pt-BR', label: 'Portugu\u00eas' },
  { code: 'zh-CN', label: '\u4e2d\u6587' },
  { code: 'ja-JP', label: '\u65e5\u672c\u8a9e' },
] as const;

export const POLL_INTERVALS = [
  { ms: 1000, label: '1s' },
  { ms: 2500, label: '2.5s' },
  { ms: 5000, label: '5s' },
  { ms: 10000, label: '10s' },
] as const;

export const PROMPT_CATEGORIES: Record<string, string[]> = {
  General: ['builtin_explain', 'builtin_continue', 'builtin_status'],
  Debug: ['builtin_explain_error', 'builtin_tests'],
  Review: ['builtin_review', 'builtin_changes'],
  Refactor: ['builtin_refactor', 'builtin_commit', 'builtin_undo'],
};
