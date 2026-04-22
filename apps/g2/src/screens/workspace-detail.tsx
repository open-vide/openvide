import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSessions } from '../hooks/use-sessions';
import { useWorkspaces } from '../hooks/use-workspaces';
import { useModels } from '../hooks/use-models';
import { useCreateSession } from '../hooks/use-create-session';
import { useDismissSession } from '../hooks/use-send-prompt';
import { EmptyState } from '../components/shared/empty-state';
import { useTranslation } from '../hooks/useTranslation';
import { ProviderBadge } from '../components/chat/provider-badge';
import { usePullRefresh } from '../hooks/use-pull-refresh';
import { Button, Card, Input, Badge, Select, ListItem, Dialog } from 'even-toolkit/web';
import type { WebSession } from '../types';
import { getSessionDisplayTitle, setSessionLabel } from '../lib/session-labels';
import { getToolModelOptions } from '../lib/model-options';
import { getHostOptions, resolvePreferredHostId } from '../lib/bridge-hosts';
import { filterSessionsByChip, isScheduledSession, isTeamSession, type SessionFilter } from '../lib/session-filters';
import { UNTITLED_DIALOG_CLASS } from '../lib/dialog';
import { IcEditAdd, IcEditChecklist, IcStatusFile } from 'even-toolkit/web/icons/svg-icons';
import { useBridge } from '../contexts/bridge';
import { useDrawerHeader } from 'even-toolkit/web';
import { useOpenSession } from '../hooks/use-open-session';

const WORKSPACE_SESSION_PAGE_SIZE = 50;

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

function formatStatus(status: string, translate: (key: string) => string): string {
  return status === 'awaiting_approval' ? translate('web.statusApproval') : status;
}

export function WorkspaceDetailRoute() {
  const [searchParams] = useSearchParams();
  const wsPath = searchParams.get('path') ?? '';
  const wsHostId = searchParams.get('hostId') ?? '';
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SessionFilter>('all');

  const { data: sessions } = useSessions();
  const workspaces = useWorkspaces(sessions);
  const { data: models } = useModels();
  const createSession = useCreateSession();
  const dismissSession = useDismissSession();
  const { openSession } = useOpenSession(sessions);
  const { hosts, activeHostId, switchHost } = useBridge();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pullHandlers, PullIndicator } = usePullRefresh(async () => {
    await queryClient.invalidateQueries();
  });

  const ws = workspaces.find((w) => w.path === wsPath && (!wsHostId || w.hostId === wsHostId));
  const wsSessions = useMemo(
    () => sessions?.filter((session) => session.workingDirectory === wsPath && (!wsHostId || session.hostId === wsHostId)) ?? [],
    [sessions, wsHostId, wsPath],
  );
  const wsName = ws?.name ?? wsPath.split('/').pop() ?? wsPath;

  const [formTool, setFormTool] = useState('claude');
  const [formModel, setFormModel] = useState('');
  const [formCwd, setFormCwd] = useState(wsPath);
  const [formHostId, setFormHostId] = useState('');

  useEffect(() => {
    if (formHostId) return;
    const nextHostId = resolvePreferredHostId(hosts, activeHostId, wsHostId);
    if (nextHostId) setFormHostId(nextHostId);
  }, [activeHostId, formHostId, hosts, wsHostId]);

  const handleCreate = async () => {
    const selectedHostId = resolvePreferredHostId(hosts, activeHostId, formHostId || wsHostId);
    if (selectedHostId && selectedHostId !== activeHostId) switchHost(selectedHostId);
    const sessionId = await createSession.mutateAsync({ tool: formTool, cwd: formCwd || wsPath, model: formModel || undefined, hostId: selectedHostId || undefined });
    setShowForm(false);
    navigate(`/chat?id=${sessionId}`);
  };

  const modelOptions = useMemo(
    () => getToolModelOptions(formTool, models),
    [formTool, models],
  );

  const statusVariant = (status: string) => {
    if (status === 'running') return 'positive' as const;
    if (status === 'awaiting_approval') return 'neutral' as const;
    if (status === 'error' || status === 'failed') return 'negative' as const;
    return 'neutral' as const;
  };

  const visibleWsSessions = wsSessions.filter((session) => !isScheduledSession(session) && !isTeamSession(session));
  const scheduledWsSessions = wsSessions.filter(isScheduledSession);
  const teamWsSessions = wsSessions.filter(isTeamSession);
  const filteredWsSessions = filterSessionsByChip(wsSessions, statusFilter);
  const [visibleCount, setVisibleCount] = useState(WORKSPACE_SESSION_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(WORKSPACE_SESSION_PAGE_SIZE);
  }, [filteredWsSessions.length, statusFilter, wsPath, wsHostId]);

  const visiblePageSessions = filteredWsSessions.slice(0, visibleCount);
  const hasMoreSessions = filteredWsSessions.length > visibleCount;
  const filters: { id: SessionFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'scheduled', label: `Scheduled (${scheduledWsSessions.length})` },
    { id: 'team', label: `Team (${teamWsSessions.length})` },
    { id: 'running', label: 'Running' },
    { id: 'idle', label: 'Idle' },
    { id: 'failed', label: 'Failed' },
  ];

  const hostOptions = useMemo(() => getHostOptions(hosts), [hosts]);

  useDrawerHeader({
    title: `${wsName} • ${visibleWsSessions.length}`,
    // Always return to the workspaces list, bypassing whatever history entry
    // put us here (e.g. chat → workspace detail shouldn't loop).
    backTo: '/',
    right: (
      <div className="flex items-center gap-1.5">
        <Button
          size="icon"
          onClick={() => {
            const browseHostId = resolvePreferredHostId(hosts, activeHostId, wsHostId || formHostId);
            navigate(`/files?path=${encodeURIComponent(wsPath)}${browseHostId ? `&host=${encodeURIComponent(browseHostId)}` : ''}`);
          }}
        >
          <IcStatusFile width={16} height={16} className="text-text-highlight" />
        </Button>
        <Button size="icon" onClick={() => setShowForm(!showForm)}>
          <IcEditAdd width={16} height={16} />
        </Button>
      </div>
    ),
  });

  const handleRenameSession = (s: WebSession) => {
    const current = getSessionDisplayTitle(s.id, s.lastPrompt, s.title, s.tool);
    const newLabel = prompt('Rename session:', current);
    if (newLabel !== null) setSessionLabel(s.id, newLabel);
  };

  const renderSessionCard = (s: WebSession, showDismiss = true) => (
    <ListItem
      key={s.id}
      title={getSessionDisplayTitle(s.id, s.lastPrompt, s.title, s.tool)}
      subtitle={`${s.tool}${s.model ? ' / ' + s.model : ''}${s.scheduleName ? ' / ' + s.scheduleName : ''}${s.teamName ? ' / ' + s.teamName : ''} · ${formatTimeAgo(s.updatedAt)}`}
      leading={<ProviderBadge provider={s.tool as 'claude' | 'codex' | 'gemini'} size={32} />}
      trailing={
        <div className="flex items-center gap-1 shrink-0">
          {s.origin === 'native' && <Badge variant="neutral">native</Badge>}
          {isScheduledSession(s) && <Badge variant="neutral">scheduled</Badge>}
          {isTeamSession(s) && <Badge variant="neutral">team</Badge>}
          <Badge variant={statusVariant(s.status)}>{formatStatus(s.status, t)}</Badge>
        </div>
      }
      onPress={() => {
        void (async () => {
          const sessionId = await openSession(s);
          navigate(`/chat?id=${sessionId}`);
        })();
      }}
      onDelete={showDismiss && s.status !== 'running' && s.status !== 'awaiting_approval' ? () => dismissSession.mutate({ sessionId: s.id, sessions: wsSessions }) : undefined}
    />
  );

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 py-4 pb-8" {...pullHandlers}>
        <PullIndicator />

        {/* Filter Pills */}
        <div className="mb-3 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-1">
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

        {/* New Session Form */}
        <Dialog open={showForm} onClose={() => setShowForm(false)} title="" className={UNTITLED_DIALOG_CLASS}>
          <div className="flex flex-col gap-3">
            {hostOptions.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.host')}</label>
                <Select value={formHostId} onValueChange={setFormHostId} options={hostOptions} />
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.tool')}</label>
                <Select
                  value={formTool}
                  onValueChange={(tool) => { setFormTool(tool); setFormModel(''); }}
                  options={[
                    { value: 'claude', label: 'Claude Code' },
                    { value: 'codex', label: 'Codex' },
                    { value: 'gemini', label: 'Gemini' },
                  ]}
                />
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.model')}</label>
                <Select value={formModel} onValueChange={setFormModel} options={[{ value: '', label: t('web.default') }, ...modelOptions]} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.workingDir')}</label>
              <Input value={formCwd} onChange={(e) => setFormCwd(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end mt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>{t('web.cancel')}</Button>
              <Button size="sm" onClick={handleCreate} disabled={createSession.isPending}>
                {createSession.isPending ? t('web.starting') : t('web.startSession')}
              </Button>
            </div>
          </div>
        </Dialog>

        <div className="flex flex-col gap-3">
          {filteredWsSessions.length === 0 && !showForm ? (
            <EmptyState icon={<IcEditChecklist width={32} height={32} />} title={t('web.noSessions')} description={t('web.noSessionsInWorkspace')} />
          ) : (
            <>
              {/* Active Sessions */}
              {filteredWsSessions.length > 0 && (
                <div>
                  <div className="section-accent mb-2">
                    <span className="text-[11px] tracking-[-0.11px] font-normal text-text-dim uppercase tracking-wide">{t('web.activeSessions')}</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {visiblePageSessions.map((s) => renderSessionCard(s))}
                    {hasMoreSessions && (
                      <div className="pt-2">
                        <Button variant="secondary" size="sm" onClick={() => setVisibleCount((current) => current + WORKSPACE_SESSION_PAGE_SIZE)}>
                          Show more ({filteredWsSessions.length - visibleCount} remaining)
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

    </div>
  );
}
