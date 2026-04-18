import { useEffect, useState } from 'react';
import { Card, Badge, Button, Input, Select, EmptyState, ListItem, Dialog, useDrawerHeader } from 'even-toolkit/web';
import { IcEditAdd, IcFeatAccount, IcStatusFile, IcEditTrash } from 'even-toolkit/web/icons/svg-icons';
import { useNavigate } from 'react-router';
import { rpc } from '../domain/daemon-client';
import { usePullRefresh } from '../hooks/use-pull-refresh';
import { consumePickedLocation, useDialogDraft } from '../hooks/use-dialog-draft';
import { useBridge } from '../contexts/bridge';
import { getHostOptions, resolvePreferredHostId } from '../lib/bridge-hosts';
import { UNTITLED_DIALOG_CLASS } from '../lib/dialog';
import { useTranslation } from '../hooks/useTranslation';

interface TeamMember {
  name: string;
  tool: string;
  role: string;
}

interface TeamInfo {
  id: string;
  name: string;
  workingDirectory: string;
  members: TeamMember[];
  createdAt: string;
  tasksDone?: number;
  tasksTotal?: number;
}

const TOOLS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];

const ROLES = [
  { value: 'lead', label: 'Lead' },
  { value: 'coder', label: 'Coder' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'planner', label: 'Planner' },
];

const EMPTY_TEAM_DRAFT = {
  teamName: '',
  teamCwd: '',
  hostId: '',
  members: [
    { name: '', tool: 'claude', role: 'lead' },
  ] as TeamMember[],
};

export function TeamsRoute() {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { hosts, activeHostId, switchHost } = useBridge();
  const { t } = useTranslation();

  // Form state
  const { draft, setDraft, clearDraft } = useDialogDraft('openvide.teams.new-team', EMPTY_TEAM_DRAFT);
  const teamName = draft.teamName;
  const teamCwd = draft.teamCwd;
  const teamHostId = draft.hostId;
  const members = draft.members;

  // Pick up directory from file browser return
  useEffect(() => {
    const picked = consumePickedLocation();
    if (picked) {
      setDraft((current) => ({ ...current, teamCwd: picked.path, hostId: picked.hostId ?? current.hostId }));
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

  const refresh = async () => {
    try {
      const res = await rpc('team.list');
      if (res.ok && Array.isArray(res.teams)) {
        setTeams(res.teams as TeamInfo[]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [activeHostId]);

  const { pullHandlers, PullIndicator } = usePullRefresh(refresh);

  const addMember = () => {
    setDraft((current) => ({
      ...current,
      members: [...current.members, { name: '', tool: 'claude', role: 'coder' }],
    }));
  };

  const removeMember = (index: number) => {
    if (members.length <= 1) return;
    setDraft((current) => ({
      ...current,
      members: current.members.filter((_, i) => i !== index),
    }));
  };

  const updateMember = (index: number, field: keyof TeamMember, value: string) => {
    setDraft((current) => {
      const updated = [...current.members];
      updated[index] = { ...updated[index], [field]: value };
      return { ...current, members: updated };
    });
  };

  const handleCloseForm = () => {
    setShowForm(false);
    clearDraft();
  };

  const handleCreate = async () => {
    if (!teamName.trim() || !teamCwd.trim() || members.some((m) => !m.name.trim())) return;
    setCreating(true);
    try {
      const selectedHostId = resolvePreferredHostId(hosts, activeHostId, teamHostId);
      if (selectedHostId && selectedHostId !== activeHostId) switchHost(selectedHostId);
      const res = await rpc('team.create', {
        name: teamName.trim(),
        cwd: teamCwd.trim(),
        members: members.map((m) => ({ name: m.name.trim(), tool: m.tool, role: m.role })),
      });
      if (res.ok) {
        handleCloseForm();
        refresh();
      }
    } catch { /* ignore */ }
    setCreating(false);
  };

  const handleDelete = async (teamId: string) => {
    await rpc('team.delete', { teamId });
    refresh();
  };

  useDrawerHeader({
    title: `Teams • ${teams.length}`,
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

        {/* Create Form */}
        <Dialog open={showForm} onClose={handleCloseForm} title="" className={UNTITLED_DIALOG_CLASS}>
          <div className="flex max-h-[70vh] flex-col">
            <div className="flex flex-col gap-3 overflow-y-auto pr-1">
              {hostOptions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.host')}</span>
                  <Select value={teamHostId} options={hostOptions} onValueChange={(hostId) => setDraft((current) => ({ ...current, hostId }))} />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Team Name</span>
                <Input placeholder="api-rewrite" value={teamName} onChange={(e) => setDraft((current) => ({ ...current, teamName: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Working Directory</span>
                <div className="flex gap-2">
                  <Input className="flex-1" placeholder="/home/user/project" value={teamCwd} onChange={(e) => setDraft((current) => ({ ...current, teamCwd: e.target.value }))} />
                  <button
                    className="shrink-0 w-9 h-9 rounded-[6px] bg-accent flex items-center justify-center cursor-pointer border-none press-spring"
                    onClick={() => {
                      const browseHostId = resolvePreferredHostId(hosts, activeHostId, teamHostId);
                      navigate(`/files?pick=dir&path=${encodeURIComponent(teamCwd || '~')}${browseHostId ? `&host=${encodeURIComponent(browseHostId)}` : ''}`);
                    }}
                    title="Browse folders"
                  >
                    <IcStatusFile width={18} height={18} className="text-text-highlight" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[13px] tracking-[-0.13px] text-text font-normal">Members</span>
                <Button size="sm" onClick={addMember}>
                  <IcEditAdd width={16} height={16} />
                </Button>
              </div>

              {members.map((member, i) => (
                <div key={i} className="bg-surface-light rounded-[6px] p-2.5 flex flex-col gap-2">
                  {/* Row 1: Name (full width) */}
                  <div className="flex gap-1.5 items-end">
                    <div className="flex-1 flex flex-col gap-0.5">
                      <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Name</span>
                      <Input placeholder="alice" value={member.name} onChange={(e) => updateMember(i, 'name', e.target.value)} />
                    </div>
                    {members.length > 1 && (
                      <button
                        className="shrink-0 w-9 h-9 rounded-[6px] bg-negative flex items-center justify-center cursor-pointer border-none hover:opacity-90 transition-opacity press-spring"
                        onClick={() => removeMember(i)}
                        style={{ color: '#fff' }}
                      >
                        <IcEditTrash width={16} height={16} />
                      </button>
                    )}
                  </div>
                  {/* Row 2: Tool + Role */}
                  <div className="flex gap-1.5">
                    <div className="flex-1 flex flex-col gap-0.5">
                      <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Tool</span>
                      <Select value={member.tool} options={TOOLS} onValueChange={(v) => updateMember(i, 'tool', v)} />
                    </div>
                    <div className="flex-1 flex flex-col gap-0.5">
                      <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Role</span>
                      <Select value={member.role} options={ROLES} onValueChange={(v) => updateMember(i, 'role', v)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end mt-2">
              <Button variant="ghost" size="sm" onClick={handleCloseForm}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating || !teamName.trim() || !teamCwd.trim()}>
                {creating ? 'Creating...' : 'Create Team'}
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Loading */}
        {loading && (
          <p className="text-[13px] tracking-[-0.13px] text-text-dim text-center py-6 status-breathe-fast">Loading...</p>
        )}

        {/* Empty */}
        {!loading && !showForm && teams.length === 0 && (
          <EmptyState
            icon={<IcFeatAccount width={32} height={32} />}
            title="No teams"
            description="Create a team with AI agents to work together on tasks"
          />
        )}

        {/* Team Cards */}
        {teams.map((team) => {
          const done = team.tasksDone ?? 0;
          const total = team.tasksTotal ?? 0;

          return (
            <ListItem
              key={team.id}
              title={team.name}
              subtitle={`${team.workingDirectory} · ${team.members.length} member${team.members.length !== 1 ? 's' : ''}`}
              leading={
                <Badge variant="neutral">{team.members.length}</Badge>
              }
              trailing={
                <span className="data-mono text-text-dim">{done}/{total}</span>
              }
              onPress={() => navigate(`/team?id=${team.id}`)}
              onDelete={() => handleDelete(team.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
