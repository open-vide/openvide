import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSessions } from '../hooks/use-sessions';
import { useModels } from '../hooks/use-models';
import { useCreateSession } from '../hooks/use-create-session';
import { useDismissSession } from '../hooks/use-send-prompt';
import { useOpenSession } from '../hooks/use-open-session';
import { useBridge } from '../contexts/bridge';
import { useTranslation } from '../hooks/useTranslation';
import { EmptyState } from '../components/shared/empty-state';
import { ProviderBadge } from '../components/chat/provider-badge';
import { usePullRefresh } from '../hooks/use-pull-refresh';
import { consumePickedLocation, useDialogDraft } from '../hooks/use-dialog-draft';
import { getToolModelOptions } from '../lib/model-options';
import { getHostOptions, resolvePreferredHostId } from '../lib/bridge-hosts';
import { filterSessionsByChip, isScheduledSession, isTeamSession, type SessionFilter } from '../lib/session-filters';
import { UNTITLED_DIALOG_CLASS } from '../lib/dialog';
import { Button, Card, Input, Select, Badge, ListItem, Dialog, useDrawerHeader } from 'even-toolkit/web';
import { IcEditAdd, IcEditChecklist, IcStatusFile } from 'even-toolkit/web/icons/svg-icons';

const SESSION_PAGE_SIZE = 50;

function formatTimeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const EMPTY_SESSION_DRAFT = {
  tool: 'claude',
  model: '',
  cwd: '',
  hostId: '',
};

export function SessionsRoute() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SessionFilter>('all');
  const { data: sessions } = useSessions();
  const { data: models } = useModels();
  const { hosts, activeHostId, switchHost } = useBridge();
  const createSession = useCreateSession();
  const dismissSession = useDismissSession();
  const { openSession } = useOpenSession(sessions);
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pullHandlers, PullIndicator } = usePullRefresh(async () => {
    await queryClient.invalidateQueries();
  });

  const { draft, setDraft, clearDraft } = useDialogDraft('openvide.sessions.new-session', EMPTY_SESSION_DRAFT);
  const formTool = draft.tool;
  const formModel = draft.model;
  const formCwd = draft.cwd;
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
    const selectedHostId = resolvePreferredHostId(hosts, activeHostId, formHostId);
    if (selectedHostId && selectedHostId !== activeHostId) switchHost(selectedHostId);
    const sessionId = await createSession.mutateAsync({ tool: formTool, cwd: formCwd, model: formModel || undefined, hostId: selectedHostId || undefined });
    handleCloseForm();
    navigate(`/chat?id=${sessionId}`);
  };

  const modelOptions = useMemo(
    () => getToolModelOptions(formTool, models),
    [formTool, models],
  );
  const allSessions = sessions ?? [];
  const visibleSessions = allSessions.filter((session) => !isScheduledSession(session) && !isTeamSession(session));
  const scheduledSessions = allSessions.filter(isScheduledSession);
  const teamSessions = allSessions.filter(isTeamSession);
  const filteredSessions = filterSessionsByChip(allSessions, statusFilter);
  const [visibleCount, setVisibleCount] = useState(SESSION_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(SESSION_PAGE_SIZE);
  }, [statusFilter, filteredSessions.length]);

  const visiblePageSessions = filteredSessions.slice(0, visibleCount);
  const hasMoreSessions = filteredSessions.length > visibleCount;

  const statusVariant = (status: string) => {
    if (status === 'running') return 'positive' as const;
    if (status === 'error' || status === 'failed') return 'negative' as const;
    return 'neutral' as const;
  };

  const filters: { id: SessionFilter; label: string }[] = [
    { id: 'all', label: `All (${visibleSessions.length})` },
    { id: 'scheduled', label: `Scheduled (${scheduledSessions.length})` },
    { id: 'team', label: `Team (${teamSessions.length})` },
    { id: 'running', label: `Running (${visibleSessions.filter((s) => s.status === 'running').length})` },
    { id: 'idle', label: 'Idle' },
    { id: 'failed', label: 'Failed' },
  ];

  useDrawerHeader({
    title: `${t('web.allSessions')} • ${visibleSessions.length}`,
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

        {/* Filter Pills */}
        <div className="mb-4 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-1.5">
            {filters.map((f) => (
              <button
                key={f.id}
                className={`px-3 py-1 rounded-[6px] text-[11px] tracking-[-0.11px] font-normal border cursor-pointer transition-colors whitespace-nowrap ${
                  statusFilter === f.id
                    ? 'bg-accent text-[color:var(--color-text-highlight,#fff)] border-accent'
                    : 'bg-surface border-border text-text-dim hover:bg-bg'
                }`}
                onClick={() => setStatusFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {/* New Session Form */}
          <Dialog open={showForm} onClose={handleCloseForm} title="" className={UNTITLED_DIALOG_CLASS}>
            <div className="flex flex-col gap-3">
              {hostOptions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.host')}</label>
                  <Select value={formHostId} onValueChange={(hostId) => setDraft((current) => ({ ...current, hostId }))} options={hostOptions} />
                </div>
              )}
              <div className="flex gap-3">
                <div className="flex-1 flex flex-col gap-1">
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
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.model')}</label>
                  <Select value={formModel} onValueChange={(model) => setDraft((current) => ({ ...current, model }))} options={[{ value: '', label: t('web.default') }, ...modelOptions]} />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.workingDir')}</label>
                <div className="flex gap-3">
                  <Input className="flex-1" placeholder="/path/to/project" value={formCwd} onChange={(e) => setDraft((current) => ({ ...current, cwd: e.target.value }))} />
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
              <div className="flex gap-2 justify-end mt-2">
                <Button variant="ghost" size="sm" onClick={handleCloseForm}>{t('web.cancel')}</Button>
                <Button size="sm" onClick={handleCreate} disabled={createSession.isPending || !formCwd.trim()}>
                  {createSession.isPending ? t('web.starting') : t('web.startSession')}
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Session List */}
          {filteredSessions.length === 0 && !showForm ? (
            <EmptyState icon={<IcEditChecklist width={32} height={32} />} title={t('web.noSessions')} description={t('web.noSessionsHint')} />
          ) : (
            <div className="flex flex-col gap-1.5">
              {visiblePageSessions.map((s) => {
                const dir = s.workingDirectory.split('/').pop() ?? s.workingDirectory;
                const host = s.hostId ? hosts.find((h) => h.id === s.hostId) : null;
                return (
                  <ListItem
                    key={s.id}
                    title={s.lastPrompt?.slice(0, 80) || dir}
                    subtitle={`${s.tool} / ${dir}${s.model ? ` / ${s.model}` : ''}${s.scheduleName ? ` / ${s.scheduleName}` : ''}${s.teamName ? ` / ${s.teamName}` : ''}${host && hosts.length > 1 ? ` / @${host.name}` : ''} · ${formatTimeAgo(s.updatedAt)}`}
                    leading={<ProviderBadge provider={s.tool as 'claude' | 'codex' | 'gemini'} size={32} />}
                    trailing={
                      <div className="flex items-center gap-1 shrink-0">
                        {s.origin === 'native' && <Badge variant="neutral">native</Badge>}
                        {isScheduledSession(s) && <Badge variant="neutral">scheduled</Badge>}
                        {isTeamSession(s) && <Badge variant="neutral">team</Badge>}
                        <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                      </div>
                    }
                    onPress={() => {
                      void (async () => {
                        const sessionId = await openSession(s);
                        navigate(`/chat?id=${sessionId}`);
                      })();
                    }}
                    onDelete={s.status !== 'running' ? () => dismissSession.mutate({ sessionId: s.id, sessions: allSessions }) : undefined}
                  />
                );
              })}
              {hasMoreSessions && (
                <div className="pt-2">
                  <Button variant="secondary" size="sm" onClick={() => setVisibleCount((current) => current + SESSION_PAGE_SIZE)}>
                    Show more ({filteredSessions.length - visibleCount} remaining)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
