import { useCallback } from 'react'
import { useSettings } from './use-settings'
import { t as translate } from '../utils/i18n'
import type { AppLanguage } from '../utils/i18n'

export function useTranslation() {
  const { data: settings } = useSettings()
  const lang = (settings?.language ?? 'en') as AppLanguage

  const t = useCallback(
    (key: string) => translate(key, lang),
    [lang],
  )

  return { t, lang }
}
