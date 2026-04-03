import type { WebSettings } from '../types';
import { APP_LANGUAGES, type AppLanguage } from '../utils/i18n';

export const APP_LANGUAGE_IDS = APP_LANGUAGES.map((entry) => entry.id);

export const VOICE_LANGUAGE_OPTIONS = [
  { value: 'en-US', label: 'English' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'es-ES', label: 'Espanol' },
  { value: 'fr-FR', label: 'Francais' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'pt-BR', label: 'Portugues' },
  { value: 'zh-CN', label: '中文' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'ru-RU', label: 'Русский' },
] as const;

const DEFAULT_VOICE_LANGUAGE_BY_APP_LANGUAGE: Record<AppLanguage, string> = {
  en: 'en-US',
  it: 'it-IT',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-BR',
  ja: 'ja-JP',
  zh: 'zh-CN',
  ko: 'ko-KR',
  ru: 'ru-RU',
};

export function getDefaultVoiceLanguage(language: string): string {
  return DEFAULT_VOICE_LANGUAGE_BY_APP_LANGUAGE[language as AppLanguage] ?? 'en-US';
}

export function applySettingsPatch(current: WebSettings, patch: Partial<WebSettings>): WebSettings {
  const next = { ...current, ...patch };
  if (
    typeof patch.language === 'string'
    && !Object.prototype.hasOwnProperty.call(patch, 'voiceLang')
  ) {
    next.voiceLang = getDefaultVoiceLanguage(patch.language);
  }
  return next;
}
