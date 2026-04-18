import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useBridge } from '../contexts/bridge';
import { useHostHealth } from '../hooks/use-hosts';
import { useTranslation } from '../hooks/useTranslation';
import { StatusDot } from '../components/shared/status-dot';
import { Card, Input, Button, Badge } from 'even-toolkit/web';

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

export function HostDetailRoute() {
  const [searchParams] = useSearchParams();
  const hostId = searchParams.get('id') ?? '';
  const { hosts, activeHostId, hostStatuses, switchHost, updateHost } = useBridge();
  const host = hosts.find((h) => h.id === hostId);
  const { data: health, isLoading, refetch } = useHostHealth(host);
  const { t } = useTranslation();

  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editToken, setEditToken] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync from host on load
  useEffect(() => {
    if (host) {
      setEditName(host.name);
      setEditUrl(host.url);
      setEditToken(host.token ?? '');
      setDirty(false);
    }
  }, [host?.id]);

  if (!host) {
    return (
      <div className="flex-1 bg-bg">
        <div className="px-3 pt-4 pb-8">
          <h1 className="text-[20px] tracking-[-0.6px] font-normal">{t('web.hostNotFound')}</h1>
        </div>
      </div>
    );
  }

  const status = hostStatuses[hostId] ?? 'disconnected';
  const isConnected = status === 'connected';
  const isActive = activeHostId === hostId;

  const handleFieldChange = (field: 'name' | 'url' | 'token', value: string) => {
    if (field === 'name') setEditName(value);
    else if (field === 'url') setEditUrl(value);
    else setEditToken(value);
    setDirty(true);
    setSaved(false);
  };

  const handleSave = () => {
    updateHost(hostId, {
      name: editName.trim(),
      url: editUrl.trim().replace(/\/$/, ''),
      token: editToken.trim() || undefined,
    });
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 pt-4 pb-8">

        {/* Status hero card */}
        <Card className="mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isConnected ? 'bg-positive/10' : 'bg-negative/10'}`}>
              <StatusDot status={status} className={`w-3 h-3 ${isConnected ? 'status-breathe' : ''}`} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[15px] tracking-[-0.15px] text-text font-normal">{host.name}</span>
              <p className="data-mono truncate">{host.url}</p>
            </div>
            {isActive
              ? <Badge variant="positive">Active</Badge>
              : <Button size="sm" onClick={() => switchHost(hostId)}>Connect</Button>
            }
          </div>
        </Card>

        {/* Connection info */}
        <SectionLabel>Connection</SectionLabel>
        <Card className="mb-4">
          <SettingRow label="Status">
            {isLoading ? (
              <span className="data-mono status-breathe-fast">Checking...</span>
            ) : health?.ok ? (
              <span className="text-[13px] tracking-[-0.13px] text-positive font-normal">Connected</span>
            ) : (
              <span className="text-[13px] tracking-[-0.13px] text-negative font-normal">Unreachable</span>
            )}
          </SettingRow>
          {health?.ok && health.version && (
            <SettingRow label="Bridge version">
              <span className="data-mono">{health.version as string}</span>
            </SettingRow>
          )}
          {health?.ok && (
            <SettingRow label="TLS">
              <span className="data-mono">{health.tls ? 'Enabled' : 'Disabled'}</span>
            </SettingRow>
          )}
          <SettingRow label="Test connection">
            <Button size="sm" variant="secondary" onClick={() => refetch()}>
              Ping
            </Button>
          </SettingRow>
        </Card>

        {/* Daemon info when connected */}
        {health?.ok && (
          <>
            <SectionLabel>Daemon</SectionLabel>
            <Card className="mb-4">
              {health.name && (
                <SettingRow label="Hostname">
                  <span className="data-mono">{health.name}</span>
                </SettingRow>
              )}
              {health.pid && (
                <SettingRow label="PID">
                  <span className="data-mono">{health.pid}</span>
                </SettingRow>
              )}
              <SettingRow label="Sessions">
                <span className="data-mono">
                  {health.activeSessions ?? 0} active / {health.totalSessions ?? 0} total
                </span>
              </SettingRow>
            </Card>
          </>
        )}

        {/* CLI tools installation status */}
        {health?.ok && health.tools && (
          <>
            <SectionLabel>Installed CLIs</SectionLabel>
            <Card className="mb-4">
              <SettingRow label="Claude Code">
                {health.tools.claude
                  ? <Badge variant="positive">Installed</Badge>
                  : <Badge variant="neutral">Not found</Badge>
                }
              </SettingRow>
              <SettingRow label="Codex">
                {health.tools.codex
                  ? <Badge variant="positive">Installed</Badge>
                  : <Badge variant="neutral">Not found</Badge>
                }
              </SettingRow>
              <SettingRow label="Gemini">
                {health.tools.gemini
                  ? <Badge variant="positive">Installed</Badge>
                  : <Badge variant="neutral">Not found</Badge>
                }
              </SettingRow>
            </Card>
          </>
        )}

        {/* Editable fields */}
        <SectionLabel>Host Configuration</SectionLabel>
        <Card className="mb-4">
          <div className="py-3 border-b border-border">
            <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal uppercase">Name</span>
            <Input
              value={editName}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              placeholder="My Mac"
              className="mt-1"
            />
          </div>
          <div className="py-3 border-b border-border">
            <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal uppercase">URL</span>
            <Input
              value={editUrl}
              onChange={(e) => handleFieldChange('url', e.target.value)}
              placeholder="http://localhost:7842"
              className="mt-1"
            />
          </div>
          <div className="py-3">
            <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal uppercase">Pairing token</span>
            <Input
              type="password"
              value={editToken}
              onChange={(e) => handleFieldChange('token', e.target.value)}
              placeholder="Bridge pairing token from daemon"
              className="mt-1"
            />
            <p className="text-[11px] tracking-[-0.11px] text-text-dim mt-1">
              Used once to establish a rotating bridge session. Generate with: openvide-daemon bridge token
            </p>
          </div>
        </Card>

        {/* Save button */}
        {dirty && (
          <Button size="sm" onClick={handleSave} className="w-full">
            Save Changes
          </Button>
        )}
        {saved && (
          <p className="text-[13px] tracking-[-0.13px] text-positive font-normal text-center mt-2">
            Saved
          </p>
        )}

      </div>
    </div>
  );
}
