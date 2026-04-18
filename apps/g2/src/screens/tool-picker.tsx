import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useBridge } from '../contexts/bridge';
import { rpcForHost } from '../lib/bridge-hosts';
import { ProviderBadge } from '../components/chat/provider-badge';
import { useTranslation } from '../hooks/useTranslation';

const TOOLS: { id: 'claude' | 'codex' | 'gemini'; label: string; description: string }[] = [
  { id: 'claude', label: 'Claude', description: 'Anthropic Claude Code CLI' },
  { id: 'codex', label: 'Codex', description: 'OpenAI Codex CLI' },
  { id: 'gemini', label: 'Gemini', description: 'Google Gemini CLI' },
];

export function ToolPickerRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hosts, activeHostId } = useBridge();
  const { t } = useTranslation();
  const [creating, setCreating] = useState<string | null>(null);

  const cwd = searchParams.get('cwd') ?? '';
  const cwdName = cwd.split('/').filter(Boolean).pop() ?? cwd ?? '~';
  const hostId = searchParams.get('hostId') ?? activeHostId ?? hosts[0]?.id ?? null;

  const pick = async (tool: 'claude' | 'codex' | 'gemini') => {
    if (creating) return;
    setCreating(tool);
    try {
      let resolvedCwd = cwd;
      if (!resolvedCwd) {
        const bridgeRes = await rpcForHost(hosts, hostId, 'bridge.config', hostId ? { hostId } : undefined);
        const bridgeConfig = (bridgeRes?.bridgeConfig ?? {}) as { defaultCwd?: string };
        resolvedCwd = bridgeConfig.defaultCwd?.trim() ?? '~';
      }
      const res = (await rpcForHost(hosts, hostId, 'session.create', {
        hostId,
        tool,
        cwd: resolvedCwd,
        autoAccept: true,
      })) as { ok?: boolean; session?: { id?: string } };
      const sessionId = typeof res?.session?.id === 'string' ? res.session.id : null;
      if (sessionId) {
        navigate(`/chat?id=${encodeURIComponent(sessionId)}`, { replace: true });
      } else {
        setCreating(null);
      }
    } catch {
      setCreating(null);
    }
  };

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 pt-4 pb-8 flex flex-col gap-4">
        <div>
          <h1 className="text-[20px] tracking-[-0.6px] font-normal text-text">
            {t('web.newSession') ?? 'New session'}
          </h1>
          <p className="text-[11px] tracking-[-0.11px] text-text-dim mt-1">
            {t('web.chooseTool') ?? 'Choose a CLI tool'} · {cwdName}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              disabled={creating !== null}
              onClick={() => void pick(tool.id)}
              className="w-full text-left rounded-[6px] bg-surface border border-border px-3 py-3 flex items-center gap-3 hover:bg-bg disabled:opacity-50 disabled:cursor-progress transition-colors"
            >
              <ProviderBadge provider={tool.id} size={36} />
              <div className="flex-1 min-w-0">
                <div className="text-[15px] tracking-[-0.15px] text-text font-normal">
                  {tool.label}
                </div>
                <div className="text-[11px] tracking-[-0.11px] text-text-dim">
                  {tool.description}
                </div>
              </div>
              {creating === tool.id && (
                <span className="text-[11px] tracking-[-0.11px] text-text-dim">
                  {t('web.starting') ?? 'Starting…'}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="text-[13px] tracking-[-0.13px] text-text-dim underline self-center mt-2"
          onClick={() => navigate(-1)}
          disabled={creating !== null}
        >
          {t('web.cancel') ?? 'Cancel'}
        </button>
      </div>
    </div>
  );
}
