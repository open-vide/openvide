import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, Button, Badge, EmptyState, Dialog, Input, Select, Textarea, useDrawerHeader } from 'even-toolkit/web';
import { IcEditAdd, IcEditEdit, IcEditPause, IcEditPlay, IcEditTrash, IcFeatNavigate, IcFeatTimeCounting, IcStatusFile } from 'even-toolkit/web/icons/svg-icons';
import { useNavigate } from 'react-router';
import { rpc, type RpcResponse } from '../domain/daemon-client';
import { useBridge } from '../contexts/bridge';
import { usePullRefresh } from '../hooks/use-pull-refresh';
import { consumePickedLocation, useDialogDraft } from '../hooks/use-dialog-draft';
import { getHostOptions, resolvePreferredHostId } from '../lib/bridge-hosts';
import { UNTITLED_DIALOG_CLASS } from '../lib/dialog';
import type { WebSession } from '../types';
import { useTranslation } from '../hooks/useTranslation';

type Tool = 'claude' | 'codex' | 'gemini';

interface PromptScheduleTarget {
  kind: 'prompt';
  tool: Tool;
  cwd: string;
  prompt: string;
  model?: string;
  mode?: string;
}

interface TeamScheduleTarget {
  kind: 'team';
  teamId: string;
  prompt: string;
  to?: string;
}

type ScheduleTarget = PromptScheduleTarget | TeamScheduleTarget;

interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;
  project?: string;
  enabled: boolean;
  target: ScheduleTarget;
  createdAt: string;
  updatedAt: string;
  lastRun?: string;
  lastStatus?: 'idle' | 'running' | 'success' | 'failed';
  lastError?: string;
  nextRun?: string;
  lastSessionId?: string;
}

interface TeamInfo {
  id: string;
  name: string;
  members: { name: string }[];
}

interface ScheduleDraft {
  hostId: string;
  name: string;
  schedule: string;
  project: string;
  enabled: 'true' | 'false';
  targetKind: 'prompt' | 'team';
  tool: Tool;
  cwd: string;
  prompt: string;
  teamId: string;
  to: string;
}

const CRON_PRESETS = [
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 0 * * *', label: 'Daily at midnight' },
  { value: '0 9 * * *', label: 'Daily at 9am' },
  { value: '0 9 * * 1-5', label: 'Weekdays at 9am' },
  { value: '*/15 * * * *', label: 'Every 15 minutes' },
  { value: '0 0 * * 0', label: 'Weekly (Sunday)' },
];

const TARGET_KIND_OPTIONS = [
  { value: 'prompt', label: 'Prompt Session' },
  { value: 'team', label: 'Team Dispatch' },
];

const TOOL_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];

const ENABLED_OPTIONS = [
  { value: 'true', label: 'Enabled' },
  { value: 'false', label: 'Paused' },
];

const EMPTY_SCHEDULE_DRAFT: ScheduleDraft = {
  hostId: '',
  name: '',
  schedule: '0 9 * * 1-5',
  project: '',
  enabled: 'true',
  targetKind: 'prompt',
  tool: 'claude',
  cwd: '',
  prompt: '',
  teamId: '',
  to: '*',
};

function toDraft(schedule?: ScheduledTask): ScheduleDraft {
  if (!schedule) return EMPTY_SCHEDULE_DRAFT;
  if (schedule.target.kind === 'team') {
    return {
      hostId: '',
      name: schedule.name,
      schedule: schedule.schedule,
      project: schedule.project ?? '',
      enabled: schedule.enabled ? 'true' : 'false',
      targetKind: 'team',
      tool: 'claude',
      cwd: '',
      prompt: schedule.target.prompt,
      teamId: schedule.target.teamId,
      to: schedule.target.to ?? '*',
    };
  }
  return {
    hostId: '',
    name: schedule.name,
    schedule: schedule.schedule,
    project: schedule.project ?? '',
    enabled: schedule.enabled ? 'true' : 'false',
    targetKind: 'prompt',
    tool: schedule.target.tool,
    cwd: schedule.target.cwd,
    prompt: schedule.target.prompt,
    teamId: '',
    to: '*',
  };
}

function getTargetLabel(task: ScheduledTask, teams: TeamInfo[]): string {
  if (task.target.kind === 'team') {
    const target = task.target as TeamScheduleTarget;
    const team = teams.find((entry) => entry.id === target.teamId);
    const destination = target.to && target.to !== '*' ? `@${target.to}` : '@all';
    return `${team?.name ?? target.teamId} ${destination}`;
  }
  return `${task.target.tool} · ${task.target.cwd}`;
}

export function SchedulesRoute() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeHostId, hosts, switchHost } = useBridge();
  const { t } = useTranslation();

  const { draft, setDraft, clearDraft } = useDialogDraft('openvide.schedules.editor', EMPTY_SCHEDULE_DRAFT);

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

  const selectedTeamMembers = useMemo(() => {
    const team = teams.find((entry) => entry.id === draft.teamId);
    if (!team) return [];
    return [
      { value: '*', label: 'All Members' },
      ...team.members.map((member) => ({ value: member.name, label: member.name })),
    ];
  }, [draft.teamId, teams]);

  const refresh = async () => {
    try {
      const [scheduleRes, teamRes] = await Promise.all([
        rpc('schedule.list').catch(() => ({ ok: false } as RpcResponse)),
        rpc('team.list').catch(() => ({ ok: false } as RpcResponse)),
      ]);
      if (scheduleRes.ok && Array.isArray(scheduleRes.schedules)) {
        setTasks(scheduleRes.schedules as ScheduledTask[]);
      }
      if (teamRes.ok && Array.isArray(teamRes.teams)) {
        setTeams(teamRes.teams as TeamInfo[]);
      }
    } catch {
      // Ignore refresh errors and keep the current state visible.
    }
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [activeHostId]);

  const { pullHandlers, PullIndicator } = usePullRefresh(refresh);

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingId(null);
    clearDraft();
  };

  const handleEdit = (task: ScheduledTask) => {
    setEditingId(task.id);
    setDraft({
      ...toDraft(task),
      hostId: resolvePreferredHostId(hosts, activeHostId),
    });
    setShowForm(true);
  };

  const buildTarget = (): ScheduleTarget => {
    if (draft.targetKind === 'team') {
      return {
        kind: 'team',
        teamId: draft.teamId,
        prompt: draft.prompt.trim(),
        to: draft.to || '*',
      };
    }
    return {
      kind: 'prompt',
      tool: draft.tool,
      cwd: draft.cwd.trim(),
      prompt: draft.prompt.trim(),
    };
  };

  const handleSave = async () => {
    if (!draft.name.trim() || !draft.schedule.trim() || !draft.prompt.trim()) return;
    if (draft.targetKind === 'prompt' && !draft.cwd.trim()) return;
    if (draft.targetKind === 'team' && !draft.teamId) return;

    setSaving(true);
    try {
      const selectedHostId = resolvePreferredHostId(hosts, activeHostId, draft.hostId);
      if (selectedHostId && selectedHostId !== activeHostId) switchHost(selectedHostId);
      if (editingId) {
        await rpc('schedule.update', {
          id: editingId,
          name: draft.name.trim(),
          schedule: draft.schedule.trim(),
          project: draft.project.trim() || undefined,
          enabled: draft.enabled === 'true',
          target: buildTarget(),
        });
      } else {
        await rpc('schedule.create', {
          name: draft.name.trim(),
          schedule: draft.schedule.trim(),
          project: draft.project.trim() || undefined,
          enabled: draft.enabled === 'true',
          target: buildTarget(),
        });
      }
      handleCloseForm();
      await refresh();
    } catch {
      // Keep the dialog open so the user can retry.
    }
    setSaving(false);
  };

  const handleRun = async (taskId: string) => {
    setRunningId(taskId);
    const startedAt = new Date().toISOString();
    setTasks((current) => current.map((task) => (
      task.id === taskId
        ? { ...task, lastStatus: 'running', lastRun: startedAt }
        : task
    )));
    try {
      const result = await rpc('schedule.run', { taskId });
      if (result.ok && result.schedule) {
        setTasks((current) => current.map((task) => (
          task.id === taskId
            ? (result.schedule as ScheduledTask)
            : task
        )));
      }
      if (result.ok && result.session && typeof result.session === 'object') {
        const session = result.session as Record<string, unknown>;
        const mappedSession: WebSession = {
          id: String(session.id),
          hostId: activeHostId ?? undefined,
          tool: String(session.tool ?? 'claude'),
          status: String(session.status ?? 'running'),
          runKind: (session.runKind as 'interactive' | 'scheduled' | undefined) ?? 'scheduled',
          scheduleId: typeof session.scheduleId === 'string' ? session.scheduleId : undefined,
          scheduleName: typeof session.scheduleName === 'string' ? session.scheduleName : undefined,
          workingDirectory: String(session.workingDirectory ?? ''),
          model: typeof session.model === 'string' ? session.model : undefined,
          lastPrompt: typeof session.lastTurn === 'object' && session.lastTurn && typeof (session.lastTurn as Record<string, unknown>).prompt === 'string'
            ? String((session.lastTurn as Record<string, unknown>).prompt)
            : undefined,
          lastError: typeof session.lastTurn === 'object' && session.lastTurn && typeof (session.lastTurn as Record<string, unknown>).error === 'string'
            ? String((session.lastTurn as Record<string, unknown>).error)
            : undefined,
          updatedAt: String(session.updatedAt ?? new Date().toISOString()),
          outputLines: typeof session.outputLines === 'number' ? session.outputLines : 0,
          origin: 'daemon',
        };

        queryClient.setQueriesData<WebSession[]>({ queryKey: ['sessions'] }, (current) => {
          const next = (current ?? []).filter((entry) => entry.id !== mappedSession.id);
          next.unshift(mappedSession);
          next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          return next;
        });
      } else {
        await queryClient.refetchQueries({ queryKey: ['sessions'], type: 'all' });
      }
      await refresh();
    } catch {
      // Ignore and keep the current list visible.
      await refresh();
    }
    setRunningId(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await rpc('schedule.delete', { id });
      await refresh();
    } catch {
      // Ignore delete errors for now.
    }
  };

  const handleToggleEnabled = async (task: ScheduledTask) => {
    setTogglingId(task.id);
    setTasks((current) => current.map((entry) => (
      entry.id === task.id ? { ...entry, enabled: !task.enabled } : entry
    )));
    try {
      await rpc('schedule.update', {
        id: task.id,
        enabled: !task.enabled,
      });
      await refresh();
    } catch {
      // Keep the current list visible if the toggle fails.
      await refresh();
    }
    setTogglingId(null);
  };

  const teamOptions = teams.map((team) => ({ value: team.id, label: team.name }));

  useDrawerHeader({
    title: `Schedules • ${tasks.length}`,
    right: (
      <Button size="icon" onClick={() => setShowForm(true)}>
        <IcEditAdd width={16} height={16} />
      </Button>
    ),
  });

  const hostOptions = getHostOptions(hosts);

  return (
    <div className="flex-1 flex flex-col bg-bg">
      <div className="px-3 py-4 pb-8 flex flex-col gap-3" {...pullHandlers}>
        <PullIndicator />

        {hostOptions.length > 1 && (
          <Card>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] tracking-[-0.13px] text-text-dim">{t('web.host')}</span>
              <div className="w-[180px]">
                <Select
                  value={resolvePreferredHostId(hosts, activeHostId)}
                  options={hostOptions}
                  onValueChange={(hostId) => switchHost(hostId)}
                />
              </div>
            </div>
          </Card>
        )}

        {loading && (
          <p className="text-[13px] tracking-[-0.13px] text-text-dim text-center py-6 status-breathe-fast">Loading...</p>
        )}

        {!loading && tasks.length === 0 && (
          <EmptyState
            icon={<IcFeatTimeCounting width={32} height={32} />}
            title="No schedules"
            description="Create a schedule to run a prompt or dispatch work to a team."
          />
        )}

        {tasks.map((task) => (
          <Card key={task.id} className="card-hover">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[15px] tracking-[-0.15px] text-text font-normal truncate">{task.name}</p>
                  <Badge variant={task.enabled ? 'positive' : 'neutral'}>
                    {task.enabled ? 'enabled' : 'paused'}
                  </Badge>
                </div>
                <p className="data-mono mt-0.5">{task.schedule}</p>
                <p className="data-mono mt-0.5">{getTargetLabel(task, teams)}</p>
                {task.nextRun && <p className="data-mono mt-0.5">Next: {new Date(task.nextRun).toLocaleString()}</p>}
                {task.lastError && <p className="data-mono mt-0.5 text-negative">Error: {task.lastError}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  className="w-8 h-8 rounded-[6px] bg-black text-white flex items-center justify-center cursor-pointer border-none press-spring disabled:opacity-50 disabled:cursor-default"
                  onClick={() => handleRun(task.id)}
                  disabled={runningId === task.id}
                  title="Run schedule"
                >
                  {runningId === task.id ? '…' : <IcFeatNavigate width={14} height={14} />}
                </button>
                <button
                  type="button"
                  className="w-8 h-8 rounded-[6px] bg-black text-white flex items-center justify-center cursor-pointer border-none press-spring disabled:opacity-50 disabled:cursor-default"
                  onClick={() => handleToggleEnabled(task)}
                  disabled={togglingId === task.id}
                  title={task.enabled ? 'Pause schedule' : 'Resume schedule'}
                >
                  {togglingId === task.id ? '…' : task.enabled ? <IcEditPause width={14} height={14} /> : <IcEditPlay width={14} height={14} />}
                </button>
                <button
                  type="button"
                  className="w-8 h-8 rounded-[6px] bg-surface text-text flex items-center justify-center cursor-pointer border border-border press-spring"
                  onClick={() => handleEdit(task)}
                  title="Edit schedule"
                >
                  <IcEditEdit width={14} height={14} />
                </button>
                <button
                  type="button"
                  className="w-8 h-8 rounded-[6px] bg-negative text-white flex items-center justify-center cursor-pointer border-none press-spring"
                  onClick={() => handleDelete(task.id)}
                  title="Delete schedule"
                >
                  <IcEditTrash width={14} height={14} />
                </button>
              </div>
            </div>
            {(task.lastRun || task.lastStatus) && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
                {task.lastRun && <span className="data-mono">Last: {new Date(task.lastRun).toLocaleString()}</span>}
                {task.lastStatus && (
                  <Badge variant={task.lastStatus === 'success' ? 'positive' : task.lastStatus === 'failed' ? 'negative' : 'neutral'}>
                    {task.lastStatus}
                  </Badge>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Dialog open={showForm} onClose={handleCloseForm} title="" className={UNTITLED_DIALOG_CLASS}>
        <div className="flex flex-col gap-3">
          {hostOptions.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.host')}</span>
              <Select value={draft.hostId} options={hostOptions} onValueChange={(value) => setDraft((current) => ({ ...current, hostId: value }))} />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Task name</span>
            <Input value={draft.name} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))} placeholder="Morning issue triage" />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Schedule (cron)</span>
            <Select value={draft.schedule} options={CRON_PRESETS} onValueChange={(value) => setDraft((current) => ({ ...current, schedule: value }))} />
            <Input value={draft.schedule} onChange={(e) => setDraft((current) => ({ ...current, schedule: e.target.value }))} placeholder="*/15 * * * *" />
          </div>

          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Status</span>
              <Select value={draft.enabled} options={ENABLED_OPTIONS} onValueChange={(value) => setDraft((current) => ({ ...current, enabled: value as 'true' | 'false' }))} />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Target</span>
              <Select value={draft.targetKind} options={TARGET_KIND_OPTIONS} onValueChange={(value) => setDraft((current) => ({ ...current, targetKind: value as 'prompt' | 'team' }))} />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Project (optional)</span>
            <Input value={draft.project} onChange={(e) => setDraft((current) => ({ ...current, project: e.target.value }))} placeholder="open-vide-g2" />
          </div>

          {draft.targetKind === 'prompt' ? (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Tool</span>
                <Select value={draft.tool} options={TOOL_OPTIONS} onValueChange={(value) => setDraft((current) => ({ ...current, tool: value as Tool }))} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Working Directory</span>
                <div className="flex gap-2">
                  <Input className="flex-1" value={draft.cwd} onChange={(e) => setDraft((current) => ({ ...current, cwd: e.target.value }))} placeholder="~/projects/openvide" />
                  <button
                    className="shrink-0 w-9 h-9 rounded-[6px] bg-accent flex items-center justify-center cursor-pointer border-none press-spring"
                    onClick={() => {
                      const browseHostId = resolvePreferredHostId(hosts, activeHostId, draft.hostId);
                      navigate(`/files?pick=dir&path=${encodeURIComponent(draft.cwd || '~')}${browseHostId ? `&host=${encodeURIComponent(browseHostId)}` : ''}`);
                    }}
                    title="Browse folders"
                  >
                    <IcStatusFile width={18} height={18} className="text-text-highlight" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Team</span>
                <Select value={draft.teamId} options={teamOptions} onValueChange={(value) => setDraft((current) => ({ ...current, teamId: value, to: '*' }))} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Recipient</span>
                <Select value={draft.to} options={selectedTeamMembers} onValueChange={(value) => setDraft((current) => ({ ...current, to: value }))} />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Prompt</span>
            <Textarea
              rows={5}
              value={draft.prompt}
              onChange={(e) => setDraft((current) => ({ ...current, prompt: e.target.value }))}
              placeholder={draft.targetKind === 'team' ? 'Ask the team to review open tasks and report blockers.' : 'Run npm test and summarize the failures.'}
            />
          </div>

          <div className="flex gap-2 justify-end mt-2">
            <Button variant="ghost" size="sm" onClick={handleCloseForm}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !draft.name.trim() || !draft.prompt.trim()}>
              {saving ? 'Saving...' : editingId ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
