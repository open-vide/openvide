import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSTT } from 'even-toolkit/stt/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useBridge } from '../contexts/bridge';
import { useSessions } from '../hooks/use-sessions';
import { useBridgeConfig, useUpdateBridgeConfig } from '../hooks/use-bridge-config';
import { useSettings, useUpdateSetting } from '../hooks/use-settings';
import { useTranslation } from '../hooks/useTranslation';
import { isScheduledSession, isTeamSession } from '../lib/session-filters';
import { APP_VERSION } from '../lib/app-meta';
import { StatusDot } from '../components/shared/status-dot';
import { Card, Select, Toggle, Input, Button, ConfirmDialog, useDrawerHeader } from 'even-toolkit/web';
import { IcEditTrash } from 'even-toolkit/web/icons/svg-icons';
import { APP_LANGUAGES } from '../utils/i18n';
import { VOICE_LANGUAGE_OPTIONS } from '../lib/settings';
import { rpc } from '@/domain/daemon-client';


const POLL_OPTIONS = [
  { value: '1000', label: '1s' },
  { value: '2500', label: '2.5s' },
  { value: '5000', label: '5s' },
  { value: '10000', label: '10s' },
];

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <span className="text-[15px] tracking-[-0.15px] text-text font-normal">{label}</span>
        {description && <p className="text-[11px] tracking-[-0.11px] text-text-dim mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5 mt-2">
      <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal uppercase">{children}</span>
      <div className="flex-1 h-[1px] bg-border" />
    </div>
  );
}

function STTTestSection({ apiKey, language }: { apiKey: string; language: string }) {
  const [testing, setTesting] = useState(false);
  const { transcript, interimTranscript, isListening, isLoading, error, state, start, stop, reset } = useSTT({
    provider: 'soniox',
    language,
    apiKey,
  });

  const handleToggle = useCallback(async () => {
    if (isListening) {
      stop();
      setTesting(false);
    } else {
      reset();
      setTesting(true);
      await start();
    }
  }, [isListening, start, stop, reset]);

  if (!apiKey) return null;

  return (
    <div className="py-3 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-[13px] tracking-[-0.13px] text-text font-normal">Test STT</span>
          <p className="text-[11px] tracking-[-0.11px] text-text-dim mt-0.5">
            {state === 'idle' && !testing ? 'Tap to test voice recognition' :
             state === 'loading' || isLoading ? 'Connecting...' :
             isListening ? 'Listening — speak now' :
             state === 'processing' ? 'Processing...' :
             'Done'}
          </p>
        </div>
        <Button
          size="sm"
          variant={isListening ? 'danger' : 'default'}
          onClick={handleToggle}
          disabled={isLoading || state === 'processing'}
        >
          {isListening ? 'Stop' : testing ? 'Restart' : 'Test'}
        </Button>
      </div>
      {isListening && (
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-negative animate-pulse shrink-0" />
          <span className="text-[11px] tracking-[-0.11px] text-negative font-normal">Recording</span>
        </div>
      )}
      {(interimTranscript || transcript) && (
        <div className="rounded-[6px] bg-bg p-3 mt-1">
          <p className="text-[13px] tracking-[-0.13px] text-text font-normal whitespace-pre-wrap">
            {interimTranscript || transcript || '...'}
          </p>
        </div>
      )}
      {error && (
        <p className="text-[11px] tracking-[-0.11px] text-negative mt-1.5 font-normal">
          {error.message}
        </p>
      )}
    </div>
  );
}

export function SettingsRoute() {
  const navigate = useNavigate();
  const { connectionStatus, hosts, activeHostId } = useBridge();
  const { data: settings } = useSettings();
  const { t } = useTranslation();
  const { data: bridgeConfig, error: bridgeConfigError } = useBridgeConfig();
  const { data: sessions = [] } = useSessions();
  const queryClient = useQueryClient();
  const updateSetting = useUpdateSetting();
  const updateBridgeConfig = useUpdateBridgeConfig();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [bridgeCwdDraft, setBridgeCwdDraft] = useState('');

  useDrawerHeader({
    title: t('web.settings'),
    right: <span className="data-mono text-[11px] text-text-dim">v{APP_VERSION}</span>,
  });

  const isConnected = connectionStatus === 'connected';
  const connectedHosts = hosts.filter((h) => true).length; // all configured hosts
  const activeHost = hosts.find((host) => host.id === activeHostId) ?? hosts[0] ?? null;
  const endpointBase = activeHost?.url ?? '';
  const endpointUrl = endpointBase ? `${endpointBase}/v1/chat/completions` : '/v1/chat/completions';

  useEffect(() => {
    setBridgeCwdDraft(bridgeConfig?.defaultCwd ?? '');
  }, [bridgeConfig?.defaultCwd]);

  const bridgeSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (isScheduledSession(session)) return false;
      if (isTeamSession(session)) return false;
      if (!activeHostId) return true;
      return !session.hostId || session.hostId === activeHostId;
    });
  }, [activeHostId, sessions]);

  const pinnedSessionOptions = bridgeSessions.map((session) => {
    const cwdLabel = session.workingDirectory.split('/').filter(Boolean).pop() ?? session.workingDirectory;
    return {
      value: session.id,
      label: `${session.tool.toUpperCase()} · ${cwdLabel} · ${session.id.slice(0, 8)}`,
    };
  });

  const saveDefaultCwd = () => {
    const next = bridgeCwdDraft.trim();
    updateBridgeConfig.mutate({ defaultCwd: next });
  };

  const handleClearSessions = async () => {
    const targetSessions = sessions.filter((session) => {
      if (isScheduledSession(session) || isTeamSession(session)) return false;
      if (!activeHostId) return true;
      return !session.hostId || session.hostId === activeHostId;
    });

    await Promise.allSettled(
      targetSessions.map((session) => rpc('session.remove', { id: session.id })),
    );

    await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    setShowClearConfirm(false);
  };

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 py-4 pb-8">

        {/* Status hero card */}
        <Card className="mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isConnected ? 'bg-positive/10' : 'bg-negative/10'}`}>
              <StatusDot status={isConnected ? 'connected' : 'disconnected'} className={`w-3 h-3 ${isConnected ? 'status-breathe' : ''}`} />
            </div>
            <div className="flex-1">
              <span className="text-[15px] tracking-[-0.15px] text-text font-normal">
                {isConnected ? t('web.connected') : t('web.disconnected')}
              </span>
              <p className="data-mono">{connectedHosts} {connectedHosts === 1 ? t('web.host') : t('web.hosts')} configured</p>
            </div>
            <span className="data-mono">v{APP_VERSION}</span>
          </div>
        </Card>

        <SectionLabel>{t('web.guide')}</SectionLabel>
        <Card className="mb-4">
          <SettingRow
            label={t('guide.title')}
            description="Setup, bridge pairing, host selection, and external links"
          >
            <Button size="sm" variant="secondary" onClick={() => navigate('/guide')}>
              {t('web.open')}
            </Button>
          </SettingRow>
        </Card>

        {/* Language & Voice */}
        <SectionLabel>{t('settings.language')} &amp; {t('settings.voice')}</SectionLabel>
        <Card className="mb-4">
          <SettingRow label={t('settings.language')}>
            <Select
              value={settings?.language ?? 'en'}
              options={APP_LANGUAGES.map((l) => ({ value: l.id, label: l.name }))}
              onValueChange={(v) => updateSetting.mutate({ key: 'language', value: v })}
              className="w-[130px]"
            />
          </SettingRow>
          <SettingRow label={t('settings.voice')}>
            <Select
              value={settings?.voiceLang ?? 'en-US'}
              options={VOICE_LANGUAGE_OPTIONS as unknown as Array<{ value: string; label: string }>}
              onValueChange={(v) => updateSetting.mutate({ key: 'voiceLang', value: v })}
              className="w-[130px]"
            />
          </SettingRow>
          <SettingRow label="STT Engine" description="Speech-to-text provider for voice input">
            <span className="text-[13px] tracking-[-0.13px] text-text font-normal">Soniox</span>
          </SettingRow>
          <div className="py-3">
            <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Soniox API Key</span>
            <Input
              type="password"
              value={settings?.sttApiKey ?? ''}
              onChange={(e) => updateSetting.mutate({ key: 'sttApiKey' as any, value: e.target.value })}
              placeholder="Enter Soniox API key"
              className="mt-1"
            />
          </div>
          <STTTestSection apiKey={settings?.sttApiKey ?? ''} language={settings?.voiceLang ?? 'en-US'} />
        </Card>

        {/* Even AI bridge */}
        <SectionLabel>Even AI Bridge</SectionLabel>
        <Card className="mb-4">
          <SettingRow
            label="Endpoint"
            description="Even AI-compatible OpenAI endpoint used by the bridge host"
          >
            <span className="data-mono text-[11px] max-w-[220px] truncate" title={endpointUrl}>
              /v1/chat/completions
            </span>
          </SettingRow>
          <SettingRow
            label="Bridge host"
            description="Settings apply to the active connected daemon host"
          >
            <span className="data-mono text-[11px] max-w-[220px] truncate" title={endpointBase || 'No active host'}>
              {endpointBase || 'No active host'}
            </span>
          </SettingRow>
          <SettingRow
            label="Even AI tool"
            description="Default tool used by /v1/chat/completions unless the path forces one"
          >
            <Select
              value={bridgeConfig?.evenAiTool ?? 'claude'}
              options={[
                { value: 'claude', label: 'Claude' },
                { value: 'codex', label: 'Codex' },
              ]}
              disabled={!isConnected}
              onValueChange={(value) => updateBridgeConfig.mutate({ evenAiTool: value as 'claude' | 'codex' })}
              className="w-[130px]"
            />
          </SettingRow>
          <SettingRow
            label="Session routing"
            description="Choose whether bridge prompts reuse the last session, always create a new one, or stay pinned to one session"
          >
            <Select
              value={bridgeConfig?.evenAiMode ?? 'last'}
              options={[
                { value: 'last', label: 'Latest Session' },
                { value: 'new', label: 'Always New' },
                { value: 'pinned', label: 'Pinned Session' },
              ]}
              disabled={!isConnected}
              onValueChange={(value) => updateBridgeConfig.mutate({ evenAiMode: value as 'last' | 'new' | 'pinned' })}
              className="w-[150px]"
            />
          </SettingRow>
          {bridgeConfig?.evenAiMode === 'pinned' ? (
            <SettingRow
              label="Pinned session"
              description="Specific daemon session used by Even AI bridge requests"
            >
              <Select
                value={bridgeConfig.evenAiPinnedSessionId || ''}
                options={[
                  { value: '', label: pinnedSessionOptions.length ? 'Select session' : 'No sessions available' },
                  ...pinnedSessionOptions,
                ]}
                disabled={!isConnected}
                onValueChange={(value) => updateBridgeConfig.mutate({ evenAiPinnedSessionId: value })}
                className="w-[220px]"
              />
            </SettingRow>
          ) : null}
          <SettingRow
            label="Latest session"
            description="Read-only session currently tracked by the bridge when routing mode is set to latest"
          >
            <span className="data-mono text-[11px] max-w-[220px] truncate" title={bridgeConfig?.currentEvenAiSessionId || 'None'}>
              {bridgeConfig?.currentEvenAiSessionId ? bridgeConfig.currentEvenAiSessionId.slice(0, 12) : 'None'}
            </span>
          </SettingRow>
          <div className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <span className="text-[15px] tracking-[-0.15px] text-text font-normal">Default working directory</span>
                <p className="text-[11px] tracking-[-0.11px] text-text-dim mt-0.5">
                  Used when the bridge creates a new Even AI session
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={saveDefaultCwd}
                disabled={updateBridgeConfig.isPending || bridgeCwdDraft.trim() === (bridgeConfig?.defaultCwd ?? '')}
              >
                Save
              </Button>
            </div>
            <Input
              value={bridgeCwdDraft}
              onChange={(e) => setBridgeCwdDraft(e.target.value)}
              placeholder="~/projects"
              className="mt-2"
            />
          </div>
          {bridgeConfigError ? (
            <p className="text-[11px] tracking-[-0.11px] text-negative mt-2">
              Unable to load bridge routing settings from the active daemon host.
            </p>
          ) : null}
        </Card>

        {/* Display */}
        <SectionLabel>{t('web.display')}</SectionLabel>
        <Card className="mb-4">
          <SettingRow label={t('settings.toolDetails')} description="Show file edits, commands, and tool calls inline">
            <Toggle
              checked={settings?.showToolDetails ?? true}
              onChange={(v) => updateSetting.mutate({ key: 'showToolDetails', value: v })}
            />
          </SettingRow>
          <SettingRow label={t('settings.hiddenFiles')} description="Show dotfiles in file browser">
            <Toggle
              checked={settings?.showHiddenFiles ?? false}
              onChange={(v) => updateSetting.mutate({ key: 'showHiddenFiles', value: v })}
            />
          </SettingRow>
        </Card>

        {/* Performance */}
        <SectionLabel>Performance</SectionLabel>
        <Card className="mb-4">
          <SettingRow label={t('settings.poll')} description="How often to check for session updates">
            <Select
              value={String(settings?.pollInterval ?? 2500)}
              options={POLL_OPTIONS}
              onValueChange={(v) => updateSetting.mutate({ key: 'pollInterval', value: Number(v) })}
              className="w-[80px]"
            />
          </SettingRow>
        </Card>

        {/* Danger zone */}
        <SectionLabel>Danger Zone</SectionLabel>
        <Card>
          <SettingRow label={t('settings.clearSessions')} description="Remove non-team, non-scheduled daemon sessions from the active host">
            <button
              type="button"
              className="w-9 h-9 rounded-[6px] bg-negative text-white flex items-center justify-center cursor-pointer border-none hover:opacity-90 transition-opacity press-spring"
              onClick={() => setShowClearConfirm(true)}
              title={t('settings.clearSessions')}
            >
              <IcEditTrash width={16} height={16} />
            </button>
          </SettingRow>
        </Card>

      </div>

      <ConfirmDialog
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => { void handleClearSessions(); }}
        title={`${t('settings.clearSessions')}?`}
        description="This removes normal daemon sessions on the active host. Team and scheduled sessions are left untouched."
        confirmLabel={t('web.clear')}
        variant="danger"
      />
    </div>
  );
}

