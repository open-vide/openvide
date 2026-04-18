import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSessions } from '../hooks/use-sessions';
import { useWorkspaces } from '../hooks/use-workspaces';
import { useModels } from '../hooks/use-models';
import { useCreateSession } from '../hooks/use-create-session';
import { useBridge } from '../contexts/bridge';
import { useTranslation } from '../hooks/useTranslation';
import { rpc } from '../domain/daemon-client';
import { EmptyState } from '../components/shared/empty-state';
import { ProviderBadge } from '../components/chat/provider-badge';
import { usePullRefresh } from '../hooks/use-pull-refresh';
import { consumePickedLocation, useDialogDraft } from '../hooks/use-dialog-draft';
import { getToolModelOptions } from '../lib/model-options';
import { isScheduledSession, isTeamSession } from '../lib/session-filters';
import { getHostOptions, resolvePreferredHostId } from '../lib/bridge-hosts';
import { rpcForHost } from '../lib/bridge-hosts';
import { UNTITLED_DIALOG_CLASS } from '../lib/dialog';
import { Button, Card, Input, Select, Badge, ListItem, Dialog, useDrawerHeader } from 'even-toolkit/web';
import { IcEditAdd, IcMenuHome, IcStatusFile } from 'even-toolkit/web/icons/svg-icons';

const WORKSPACE_PAGE_SIZE = 50;

const EMPTY_WORKSPACE_DRAFT = {
  cwd: '',
  tool: 'claude',
  model: '',
  hostId: '',
};

export function WorkspacesRoute() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const { data: sessions } = useSessions();
  const visibleSessions = useMemo(
    () => (sessions ?? []).filter((session) => !isScheduledSession(session) && !isTeamSession(session)),
    [sessions],
  );
  const workspaces = useWorkspaces(visibleSessions);
  const { data: models } = useModels();
  const { hosts, activeHostId, switchHost } = useBridge();
  const createSession = useCreateSession();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pullHandlers, PullIndicator } = usePullRefresh(async () => {
    await queryClient.invalidateQueries();
  });

  const { draft, setDraft, clearDraft } = useDialogDraft('openvide.workspaces.new-workspace', EMPTY_WORKSPACE_DRAFT);
  const formCwd = draft.cwd;
  const formTool = draft.tool;
  const formModel = draft.model;
  const formHostId = draft.hostId;

  // Pick up directory from file browser return
  useEffect(() => {
    const picked = consumePickedLocation();
    if (picked) {
      setDraft((current) => ({ ...current, cwd: picked.path, hostId: picked.hostId ?? current.hostId }));
      setShowForm(true);
    }
  }, [setDraft]);

  useEffect(() => {
    if (!showForm || draft.hostId) return;
    const nextHostId = resolvePreferredHostId(hosts, activeHostId);
    if (nextHostId) {
      setDraft((current) => ({ ...current, hostId: nextHostId }));
    }
  }, [activeHostId, draft.hostId, hosts, setDraft, showForm]);

  const handleCloseForm = () => {
    setShowForm(false);
    clearDraft();
  };

  const handleCreate = async () => {
    if (!formCwd.trim()) return;
    try {
      const selectedHostId = resolvePreferredHostId(hosts, activeHostId, formHostId);
      if (selectedHostId && selectedHostId !== activeHostId) switchHost(selectedHostId);
      await createSession.mutateAsync({ tool: formTool, cwd: formCwd, model: formModel || undefined, hostId: selectedHostId || undefined });
      handleCloseForm();
      navigate(`/workspace?path=${encodeURIComponent(formCwd)}${selectedHostId ? `&hostId=${encodeURIComponent(selectedHostId)}` : ''}`);
    } catch { /* handled by mutation */ }
  };

  const modelOptions = useMemo(
    () => getToolModelOptions(formTool, models),
    [formTool, models],
  );
  const allSessions = visibleSessions;
  const totalSessions = allSessions.length;
  const runningSessions = allSessions.filter((s) => s.status === 'running');
  const runningCount = runningSessions.length;
  const pendingCount = 0; // permissions tracked elsewhere

  const filteredWorkspaces = search.trim()
    ? workspaces.filter((ws) => ws.name.toLowerCase().includes(search.toLowerCase()) || ws.path.toLowerCase().includes(search.toLowerCase()))
    : workspaces;
  const [visibleWorkspaceCount, setVisibleWorkspaceCount] = useState(WORKSPACE_PAGE_SIZE);

  useEffect(() => {
    setVisibleWorkspaceCount(WORKSPACE_PAGE_SIZE);
  }, [filteredWorkspaces.length, search]);

  const visibleWorkspaces = filteredWorkspaces.slice(0, visibleWorkspaceCount);
  const hasMoreWorkspaces = filteredWorkspaces.length > visibleWorkspaceCount;

  useDrawerHeader({
    title: `${t('web.workspaces')} • ${workspaces.length}`,
    right: (
      <Button size="icon" onClick={() => (showForm ? handleCloseForm() : setShowForm(true))}>
        <IcEditAdd width={16} height={16} />
      </Button>
    ),
  });

  const hostOptions = useMemo(() => getHostOptions(hosts), [hosts]);

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 py-4 pb-8" {...pullHandlers}>
        <PullIndicator />

        {/* Stat Grid */}
        <div className="stat-grid mb-4">
          <div className="stat-card">
            <div className="stat-value">{totalSessions}</div>
            <div className="stat-label">Sessions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value flex items-center justify-center gap-1.5">
              {runningCount > 0 && <span className="inline-block w-2 h-2 rounded-full bg-positive status-breathe" />}
              {runningCount}
            </div>
            <div className="stat-label">Running</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{pendingCount}</div>
            <div className="stat-label">Pending</div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <Input
            placeholder="Search workspaces..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* New Workspace Form */}
        <Dialog open={showForm} onClose={handleCloseForm} title="" className={UNTITLED_DIALOG_CLASS}>
          <div className="flex flex-col gap-3">
            {hostOptions.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.host')}</label>
                <Select value={formHostId} onValueChange={(hostId) => setDraft((current) => ({ ...current, hostId }))} options={hostOptions} />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.workingDir')}</label>
              <div className="flex gap-3">
                <Input placeholder="/path/to/project" value={formCwd} onChange={(e) => setDraft((current) => ({ ...current, cwd: e.target.value }))} className="flex-1" />
                <button
                  className="shrink-0 w-9 h-9 rounded-[6px] bg-accent flex items-center justify-center cursor-pointer border-none press-spring"
                  onClick={() => {
                    const browseHostId = resolvePreferredHostId(hosts, activeHostId, formHostId);
                    navigate(`/files?path=${encodeURIComponent(formCwd || '~')}&pick=dir${browseHostId ? `&host=${encodeURIComponent(browseHostId)}` : ''}`);
                  }}
                  title="Browse folders"
                >
                  <IcStatusFile width={18} height={18} className="text-text-highlight" />
                </button>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.tool')}</label>
                <Select
                  value={formTool}
                  onValueChange={(tool) => setDraft((current) => ({ ...current, tool, model: '' }))}
                  options={[
                    { value: 'claude', label: 'Claude Code' },
                    { value: 'codex', label: 'Codex' },
                    { value: 'gemini', label: 'Gemini' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.model')}</label>
                <Select value={formModel} onValueChange={(model) => setDraft((current) => ({ ...current, model }))} options={[{ value: '', label: t('web.default') }, ...modelOptions]} />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-2">
              <Button variant="ghost" size="sm" onClick={handleCloseForm}>{t('web.cancel')}</Button>
              <Button size="sm" onClick={handleCreate} disabled={createSession.isPending}>
                {createSession.isPending ? 'Creating...' : t('web.createAndStart')}
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Active Now */}
        {runningSessions.length > 0 && (
          <div className="mb-4">
            <div className="section-accent mb-2">
              <span className="text-[11px] tracking-[-0.11px] font-normal text-text-dim uppercase tracking-wide">Active Now</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {runningSessions.map((s) => (
                <ListItem
                  key={s.id}
                  title={s.lastPrompt?.slice(0, 60) || s.tool}
                  subtitle={`${s.workingDirectory.split('/').pop()}${s.model ? ` / ${s.model}` : ''}`}
                  leading={<ProviderBadge provider={s.tool as 'claude' | 'codex' | 'gemini'} size={28} />}
                  trailing={
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="inline-block w-2 h-2 rounded-full bg-positive status-breathe" />
                      <span className="data-mono">live</span>
                    </div>
                  }
                  onPress={() => navigate(`/chat?id=${s.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Workspaces */}
        {filteredWorkspaces.length === 0 && !showForm && runningSessions.length === 0 ? (
          <EmptyState icon={<IcMenuHome width={32} height={32} />} title={t('web.noWorkspaces')} description={t('web.noWorkspacesHint')} />
        ) : filteredWorkspaces.length > 0 && (
          <div>
            <div className="mb-2">
              <span className="text-[11px] tracking-[-0.11px] font-normal text-text-dim uppercase tracking-wide">Workspaces</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {visibleWorkspaces.map((ws) => {
                const wsSessions = allSessions.filter((s) => s.workingDirectory === ws.path && (!ws.hostId || s.hostId === ws.hostId));
                const running = wsSessions.filter((s) => s.status === 'running').length;
                const host = ws.hostId ? hosts.find((h) => h.id === ws.hostId) : null;

                return (
                  <ListItem
                    key={`${ws.hostId ?? ''}:${ws.path}`}
                    title={`${ws.name}${host && hosts.length > 1 ? ` @${host.name}` : ''}`}
                    subtitle={ws.path}
                    leading={
                      <div className="w-8 h-8 rounded-[6px] bg-bg flex items-center justify-center shrink-0">
                        <IcMenuHome width={18} height={18} className="text-accent" />
                      </div>
                    }
                    trailing={
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="neutral">{ws.sessionCount}</Badge>
                        {running > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-positive status-breathe" />
                            <span className="data-mono text-positive">{running}</span>
                          </div>
                        )}
                      </div>
                    }
                    onPress={() => navigate(`/workspace?path=${encodeURIComponent(ws.path)}${ws.hostId ? `&hostId=${ws.hostId}` : ''}`)}
                    onDelete={() => {
                      // Remove all sessions in this workspace
                      const wsSessions = allSessions.filter((s) => s.workingDirectory === ws.path && (!ws.hostId || s.hostId === ws.hostId));
                      for (const s of wsSessions) {
                        void rpcForHost(hosts, s.hostId ?? activeHostId ?? null, 'session.remove', { id: s.id }).catch(() => {});
                      }
                    }}
                  />
                );
              })}
              {hasMoreWorkspaces && (
                <div className="pt-2">
                  <Button variant="secondary" size="sm" onClick={() => setVisibleWorkspaceCount((current) => current + WORKSPACE_PAGE_SIZE)}>
                    Show more ({filteredWorkspaces.length - visibleWorkspaceCount} remaining)
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
