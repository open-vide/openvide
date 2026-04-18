import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useDrawerHeader } from 'even-toolkit/web';
import { usePrompts } from '../hooks/use-prompts';
import { useSessions } from '../hooks/use-sessions';
import { useSendPrompt } from '../hooks/use-send-prompt';
import { useTranslation } from '../hooks/useTranslation';
import { useVoice } from '../contexts/voice';

export function VoiceInputRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('id') ?? '';
  const { data: prompts } = usePrompts();
  const { data: sessions } = useSessions();
  const sendPrompt = useSendPrompt(sessions);
  const { t } = useTranslation();
  const { listening, text } = useVoice();

  const session = useMemo(
    () => sessions?.find((s) => s.id === sessionId),
    [sessions, sessionId],
  );

  // Fall back to the most-recently updated session when the URL doesn't carry
  // an id (glasses don't always pass one), so tapping a prompt still has a
  // sensible target instead of silently doing nothing.
  const resolvedSession = useMemo(() => {
    if (session) return session;
    if (!sessions?.length) return undefined;
    return [...sessions]
      .filter((s) => s.status !== 'failed')
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
  }, [session, sessions]);

  useDrawerHeader({ title: t('web.input') ?? 'Input' });

  const handleTap = (prompt: string) => {
    if (!resolvedSession) return;
    sendPrompt.mutate({ sessionId: resolvedSession.id, prompt });
    navigate(-1);
  };

  // Only user-configured prompts; built-ins are hidden from the quick-action UI.
  const top = (prompts ?? []).filter((p) => !p.isBuiltIn);
  const editTarget = resolvedSession
    ? `/prompts?from=chat&id=${encodeURIComponent(resolvedSession.id)}`
    : '/prompts';

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 pt-4 pb-8 flex flex-col gap-4">
        {/* ── Mic status ── */}
        <div className="rounded-[6px] bg-surface border border-border p-4 flex flex-col items-center gap-2">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              listening ? 'bg-accent animate-pulse' : 'bg-surface-light'
            }`}
          >
            <span className="text-[24px]">🎤</span>
          </div>
          <div className="text-[13px] tracking-[-0.13px] text-text-dim">
            {listening ? (t('web.listening') ?? 'Listening…') : (text ? (t('web.ready') ?? 'Ready to send') : (t('web.notListening') ?? 'Not listening'))}
          </div>
          {text && (
            <div className="text-[15px] tracking-[-0.15px] text-text text-center whitespace-pre-wrap break-words max-w-full">
              {text}
            </div>
          )}
        </div>

        {/* ── Quick prompts ── */}
        <div>
          <div className="text-[11px] tracking-[-0.11px] text-text-dim uppercase mb-2">
            {t('web.quickPrompts') ?? 'Quick prompts'}
          </div>
          {top.length === 0 ? (
            <div className="text-[13px] tracking-[-0.13px] text-text-dim">
              {t('web.noPrompts') ?? 'No prompts configured yet.'}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {top.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!resolvedSession}
                  onClick={() => handleTap(p.prompt)}
                  className="w-full text-left rounded-[6px] bg-surface border border-border px-3 py-3 hover:bg-bg disabled:opacity-50"
                >
                  <div className="text-[15px] tracking-[-0.15px] text-text font-normal">
                    {p.label}
                  </div>
                  <div className="text-[11px] tracking-[-0.11px] text-text-dim line-clamp-2">
                    {p.prompt}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-center pt-2">
          <button
            type="button"
            className="text-[13px] tracking-[-0.13px] text-accent underline"
            onClick={() => navigate(editTarget)}
          >
            {t('web.editPrompts') ?? 'Edit prompts'}
          </button>
        </div>
      </div>
    </div>
  );
}
