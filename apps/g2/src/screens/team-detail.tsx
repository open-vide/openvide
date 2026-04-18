import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Card, Button, Badge, EmptyState, Input, Select, Dialog, MultiSelect, Textarea, ListItem } from 'even-toolkit/web';
import { IcEditAdd, IcEditChecklist, IcEditEdit, IcEditTrash, IcFeatLearnExplore } from 'even-toolkit/web/icons/svg-icons';
import { ProviderBadge } from '../components/chat/provider-badge';
import { rpc } from '../domain/daemon-client';
import { usePullRefresh } from '../hooks/use-pull-refresh';
import { UNTITLED_DIALOG_CLASS } from '../lib/dialog';

interface TeamTaskSummary {
  id: string;
  subject: string;
  owner: string;
  ownerTool?: string;
  status: string;
}

interface TeamMemberOption {
  value: string;
  label: string;
}

interface TeamMemberDraft {
  name: string;
  tool: string;
  role: string;
}

interface TeamPlanVote {
  reviewer: string;
  vote: 'approve' | 'revise' | 'reject';
  feedback?: string;
  iteration: number;
}

interface TeamPlanSummary {
  id: string;
  status: string;
  mode: string;
  iteration: number;
  maxIterations: number;
  reviewers: string[];
  votes: TeamPlanVote[];
  revisions: Array<{
    id: string;
    author: string;
    createdAt: string;
    tasks: Array<{ subject: string; description: string; owner: string; dependencies?: string[] }>;
  }>;
}

const STATUS_COLUMNS = ['TODO', 'IN PROGRESS', 'DONE', 'REVIEW', 'APPROVED'];

const colDotColor: Record<string, string> = {
  'TODO': 'bg-text-dim',
  'IN PROGRESS': 'bg-accent-warning',
  'DONE': 'bg-positive',
  'REVIEW': 'bg-[#4285F4]',
  'APPROVED': 'bg-positive',
};

const PLAN_MODE_OPTIONS = [
  { value: 'simple', label: 'Simple' },
  { value: 'consensus', label: 'Consensus' },
];

const PLAN_MAX_ITERATION_OPTIONS = [
  { value: '2', label: '2 rounds' },
  { value: '3', label: '3 rounds' },
  { value: '4', label: '4 rounds' },
  { value: '5', label: '5 rounds' },
  { value: '6', label: '6 rounds' },
  { value: '8', label: '8 rounds' },
  { value: '10', label: '10 rounds' },
];

const TEAM_TOOL_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];

const TEAM_ROLE_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'planner', label: 'Planner' },
  { value: 'coder', label: 'Coder' },
  { value: 'reviewer', label: 'Reviewer' },
];

type TabId = 'board' | 'plan' | 'chat';

export function TeamDetailRoute() {
  const [params] = useSearchParams();
  const teamId = params.get('id') ?? '';
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TeamTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('board');
  const [newSubject, setNewSubject] = useState('');
  const [newOwners, setNewOwners] = useState<string[]>([]);
  const [newDesc, setNewDesc] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [teamName, setTeamName] = useState('Team');
  const [teamCwd, setTeamCwd] = useState('');
  const [teamMemberDrafts, setTeamMemberDrafts] = useState<TeamMemberDraft[]>([]);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);

  const [latestPlan, setLatestPlan] = useState<TeamPlanSummary | null>(null);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planRequest, setPlanRequest] = useState('');
  const [planMode, setPlanMode] = useState<'simple' | 'consensus'>('simple');
  const [planMaxIterations, setPlanMaxIterations] = useState('5');
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  const refreshTeam = async () => {
    try {
      const res = await rpc('team.get', { teamId });
      if (res.ok && res.team) {
        const team = res.team as { name?: string; workingDirectory?: string; members?: { name: string; tool: string; role: string }[] };
        setTeamName(team.name ?? 'Team');
        setTeamCwd(team.workingDirectory ?? '');
        if (team.members) {
          setTeamMembers(team.members.map((member) => ({
            value: member.name,
            label: `${member.name} (${member.tool} · ${member.role})`,
          })));
          setTeamMemberDrafts(team.members.map((member) => ({
            name: member.name,
            tool: member.tool,
            role: member.role,
          })));
        }
      }
    } catch {
      // Ignore team refresh errors.
    }
  };

  const refreshTasks = async () => {
    try {
      const res = await rpc('team.task.list', { teamId });
      if (res.ok && Array.isArray(res.teamTasks)) {
        setTasks(res.teamTasks as TeamTaskSummary[]);
      }
    } catch {
      // Ignore task refresh errors.
    }
  };

  const refreshPlan = async () => {
    try {
      const res = await rpc('team.plan.latest', { teamId });
      if (res.ok && res.teamPlan) {
        setLatestPlan(res.teamPlan as TeamPlanSummary);
      } else {
        setLatestPlan(null);
      }
    } catch {
      // Ignore plan refresh errors.
    }
  };

  const refresh = async () => {
    await Promise.all([refreshTeam(), refreshTasks(), refreshPlan()]);
    setLoading(false);
  };

  useEffect(() => {
    if (!teamId) return;
    void refresh();
  }, [teamId]);

  useEffect(() => {
    if (!teamId) return;
    const timer = setInterval(() => {
      void refreshTasks();
      if (activeTab === 'plan') {
        void refreshPlan();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [activeTab, teamId]);

  const { pullHandlers, PullIndicator } = usePullRefresh(refresh);

  const handleMove = async (taskId: string, newStatus: string) => {
    setMovingId(taskId);
    try {
      await rpc('team.task.update', { teamId, taskId, status: newStatus.toLowerCase().replace(/\s+/g, '_') });
      await refreshTasks();
    } catch {
      // Ignore move failures and keep the board visible.
    }
    setMovingId(null);
  };

  const handleAddTask = async () => {
    if (!newSubject.trim()) return;
    setAddingTask(true);
    try {
      await rpc('team.task.create', {
        teamId,
        subject: newSubject.trim(),
        description: newDesc.trim(),
        owner: newOwners[0] || undefined,
      });
      setNewSubject('');
      setNewOwners([]);
      setNewDesc('');
      setShowAddForm(false);
      await refreshTasks();
    } catch {
      // Keep the dialog open so the user can retry.
    }
    setAddingTask(false);
  };

  const handleGeneratePlan = async () => {
    if (!planRequest.trim()) return;
    setGeneratingPlan(true);
    try {
      await rpc('team.plan.generate', {
        teamId,
        request: planRequest.trim(),
        mode: planMode,
        maxIterations: planMode === 'consensus' ? Number(planMaxIterations) : undefined,
      });
      setPlanRequest('');
      setShowPlanForm(false);
      setActiveTab('plan');
      await refreshPlan();
    } catch {
      // Keep the dialog open for retry.
    }
    setGeneratingPlan(false);
  };

  const addTeamMember = () => {
    setTeamMemberDrafts((current) => [...current, { name: '', tool: 'codex', role: 'coder' }]);
  };

  const updateTeamMember = (index: number, field: keyof TeamMemberDraft, value: string) => {
    setTeamMemberDrafts((current) => current.map((member, memberIndex) => (
      memberIndex === index ? { ...member, [field]: value } : member
    )));
  };

  const removeTeamMember = (index: number) => {
    setTeamMemberDrafts((current) => current.length <= 1 ? current : current.filter((_, memberIndex) => memberIndex !== index));
  };

  const handleSaveTeam = async () => {
    const members = teamMemberDrafts
      .map((member) => ({ ...member, name: member.name.trim() }))
      .filter((member) => member.name.length > 0);
    if (!teamName.trim() || !teamCwd.trim() || members.length === 0) return;
    setSavingTeam(true);
    try {
      const res = await rpc('team.update', {
        teamId,
        name: teamName.trim(),
        cwd: teamCwd.trim(),
        members,
      });
      if (res.ok) {
        setShowTeamForm(false);
        await refresh();
      }
    } catch {
      // Keep the dialog open for retry.
    }
    setSavingTeam(false);
  };

  const handleDeletePlan = async (planId: string) => {
    setDeletingPlanId(planId);
    try {
      await rpc('team.plan.delete', { teamId, planId });
      await refreshPlan();
    } catch {
      // Ignore delete failures and keep current plan visible.
    }
    setDeletingPlanId(null);
  };

  const grouped: Record<string, TeamTaskSummary[]> = {};
  for (const col of STATUS_COLUMNS) grouped[col] = [];
  for (const task of tasks) {
    const key = task.status.toUpperCase().replace(/_/g, ' ');
    if (grouped[key]) grouped[key].push(task);
  }

  const latestRevision = useMemo(() => latestPlan?.revisions?.[latestPlan.revisions.length - 1] ?? null, [latestPlan]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'board', label: 'Board' },
    { id: 'plan', label: 'Plan' },
    { id: 'chat', label: 'Chat' },
  ];

  return (
    <div className="flex-1 flex flex-col bg-bg">
      <div className="px-3 pt-4 pb-8" {...pullHandlers}>
        <PullIndicator />
        <Card className="mb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] tracking-[-0.15px] text-text font-normal truncate">{teamName}</p>
              <p className="text-[11px] tracking-[-0.11px] text-text-dim mt-1 break-all">{teamCwd}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span className="text-[11px] tracking-[-0.11px] text-text-dim">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
              <Button size="sm" onClick={() => setShowTeamForm(true)}>
                <IcEditEdit width={16} height={16} />
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {teamMemberDrafts.map((member) => (
              <Badge key={`${member.name}-${member.role}`} variant="neutral">
                {member.name} · {member.role}
              </Badge>
            ))}
          </div>
        </Card>

        <div className="flex gap-0 mb-4 bg-surface rounded-[6px] p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`flex-1 py-1.5 text-[13px] tracking-[-0.13px] font-normal rounded-[4px] cursor-pointer border-none transition-colors ${
                activeTab === tab.id
                  ? 'bg-bg text-text'
                  : 'bg-transparent text-text-dim hover:text-text'
              }`}
              onClick={() => {
                if (tab.id === 'chat') {
                  navigate(`/team-chat?id=${teamId}`);
                } else {
                  setActiveTab(tab.id);
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'board' && (
          <>
            {loading && (
              <p className="text-[13px] tracking-[-0.13px] text-text-dim text-center py-6 status-breathe-fast">Loading...</p>
            )}

            {!loading && tasks.length === 0 && (
              <EmptyState
                icon={<IcEditChecklist width={32} height={32} />}
                title="No tasks"
                description="This team has no tasks yet."
              />
            )}

            {!loading && tasks.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-4">
                {STATUS_COLUMNS.map((col) => {
                  const colTasks = grouped[col] ?? [];
                  return (
                    <div key={col} className="kanban-col flex flex-col gap-1.5">
                      <div className="kanban-col-header">
                        <span className={`kanban-col-dot ${colDotColor[col] ?? 'bg-text-dim'}`} />
                        <span className="text-[11px] tracking-[-0.11px] font-normal text-text-dim uppercase">
                          {col}
                        </span>
                        <span className="data-mono ml-auto">{colTasks.length}</span>
                      </div>

                      {colTasks.map((task) => {
                        const nextIdx = STATUS_COLUMNS.indexOf(col) + 1;
                        const nextStatus = nextIdx < STATUS_COLUMNS.length ? STATUS_COLUMNS[nextIdx] : null;
                        return (
                          <Card key={task.id} className="card-hover">
                            <p className="text-[13px] tracking-[-0.13px] text-text font-normal truncate">{task.subject}</p>
                            {task.owner && (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <ProviderBadge provider={(task.ownerTool || 'claude') as 'claude' | 'codex' | 'gemini'} size={18} />
                                <span className="data-mono">@{task.owner}</span>
                              </div>
                            )}
                            {nextStatus && (
                              <Button
                                variant="default"
                                size="sm"
                                className="mt-2 w-full"
                                onClick={() => handleMove(task.id, nextStatus)}
                                disabled={movingId === task.id}
                              >
                                {movingId === task.id ? '...' : `\u2192 ${nextStatus}`}
                              </Button>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            <button
              className="fixed bottom-20 right-4 w-12 h-12 rounded-[6px] bg-accent text-text-highlight flex items-center justify-center cursor-pointer border-none z-20 press-spring"
              style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
              onClick={() => setShowAddForm(true)}
            >
              <IcEditAdd width={20} height={20} />
            </button>

            <Dialog open={showAddForm} onClose={() => setShowAddForm(false)} title="New Task">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Subject</span>
                  <Input placeholder="Fix the auth bug" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Description (optional)</span>
                  <Textarea rows={4} placeholder="Details about the task..." value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Assign to (optional)</span>
                  <MultiSelect
                    values={newOwners}
                    options={teamMembers}
                    onValuesChange={setNewOwners}
                    placeholder="Select agents..."
                  />
                </div>
                <div className="flex gap-2 justify-end mt-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleAddTask} disabled={addingTask || !newSubject.trim()}>
                    {addingTask ? 'Adding...' : 'Add Task'}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog open={showTeamForm} onClose={() => setShowTeamForm(false)} title="" className={UNTITLED_DIALOG_CLASS}>
              <div className="flex max-h-[70vh] flex-col">
                <div className="flex flex-col gap-3 overflow-y-auto pr-1">
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Team Name</span>
                    <Input placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Working Directory</span>
                    <Input placeholder="~/projects/openvide" value={teamCwd} onChange={(e) => setTeamCwd(e.target.value)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] tracking-[-0.13px] text-text font-normal">Members</span>
                    <Button size="sm" onClick={addTeamMember}>
                      <IcEditAdd width={16} height={16} />
                    </Button>
                  </div>
                  {teamMemberDrafts.map((member, index) => (
                    <div key={`${index}-${member.name}`} className="bg-surface-light rounded-[6px] p-2.5 flex flex-col gap-2">
                      <div className="flex gap-1.5 items-end">
                        <div className="flex-1 flex flex-col gap-0.5">
                          <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Name</span>
                          <Input placeholder="alice" value={member.name} onChange={(e) => updateTeamMember(index, 'name', e.target.value)} />
                        </div>
                        {teamMemberDrafts.length > 1 && (
                          <button
                            className="shrink-0 w-9 h-9 rounded-[6px] bg-negative flex items-center justify-center cursor-pointer border-none hover:opacity-90 transition-opacity press-spring"
                            onClick={() => removeTeamMember(index)}
                            style={{ color: '#fff' }}
                          >
                            <IcEditTrash width={16} height={16} />
                          </button>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <div className="flex-1 flex flex-col gap-0.5">
                          <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Tool</span>
                          <Select value={member.tool} options={TEAM_TOOL_OPTIONS} onValueChange={(value) => updateTeamMember(index, 'tool', value)} />
                        </div>
                        <div className="flex-1 flex flex-col gap-0.5">
                          <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Role</span>
                          <Select value={member.role} options={TEAM_ROLE_OPTIONS} onValueChange={(value) => updateTeamMember(index, 'role', value)} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 justify-end mt-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowTeamForm(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleSaveTeam} disabled={savingTeam || !teamName.trim() || !teamCwd.trim() || teamMemberDrafts.some((member) => !member.name.trim())}>
                    {savingTeam ? 'Saving...' : 'Save Team'}
                  </Button>
                </div>
              </div>
            </Dialog>
          </>
        )}

        {activeTab === 'plan' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] tracking-[-0.15px] font-normal text-text">Autonomous Plan</h2>
                <p className="text-[11px] tracking-[-0.11px] text-text-dim">Planner + reviewers run from the daemon.</p>
              </div>
              <Button size="sm" onClick={() => setShowPlanForm(true)}>
                <IcEditAdd width={16} height={16} />
              </Button>
            </div>

            {!latestPlan && (
              <EmptyState
                icon={<IcFeatLearnExplore width={32} height={32} />}
                title="No plan yet"
                description="Generate a plan and the team daemon will route it through planner and reviewer sessions."
              />
            )}

            {latestPlan && (
              <>
                <ListItem
                  title={latestPlan.id}
                  subtitle={`${latestPlan.mode} · iteration ${latestPlan.iteration}/${latestPlan.maxIterations}`}
                  trailing={(
                    <Badge variant={latestPlan.status === 'approved' || latestPlan.status === 'auto-approved' ? 'positive' : latestPlan.status === 'rejected' ? 'negative' : 'neutral'}>
                      {deletingPlanId === latestPlan.id ? '...' : latestPlan.status}
                    </Badge>
                  )}
                  onDelete={() => handleDeletePlan(latestPlan.id)}
                />

                <Card>
                  <div className="flex flex-wrap gap-1.5">
                    {latestPlan.reviewers.map((reviewer) => (
                      <Badge key={reviewer} variant="neutral">{reviewer}</Badge>
                    ))}
                  </div>
                </Card>

                {latestPlan.votes.length > 0 && (
                  <Card>
                    <p className="text-[13px] tracking-[-0.13px] font-normal text-text mb-2">Votes</p>
                    <div className="flex flex-col gap-2">
                      {latestPlan.votes.map((vote, index) => (
                        <div key={`${vote.reviewer}-${index}`} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="data-mono">{vote.reviewer}</p>
                            {vote.feedback && <p className="text-[11px] tracking-[-0.11px] text-text-dim mt-0.5">{vote.feedback}</p>}
                          </div>
                          <Badge variant={vote.vote === 'approve' ? 'positive' : vote.vote === 'reject' ? 'negative' : 'neutral'}>
                            {vote.vote}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                <Card>
                  <p className="text-[13px] tracking-[-0.13px] font-normal text-text mb-2">Latest Tasks</p>
                  <div className="flex flex-col gap-2">
                    {(latestRevision?.tasks ?? []).map((task, index) => (
                      <div key={`${task.subject}-${index}`} className="rounded-[6px] bg-surface-light p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="data-mono">{index + 1}.</span>
                          <span className="text-[13px] tracking-[-0.13px] text-text">{task.subject}</span>
                        </div>
                        <p className="text-[11px] tracking-[-0.11px] text-text-dim mt-1">{task.description}</p>
                        <p className="data-mono mt-1">@{task.owner}{task.dependencies?.length ? ` · deps ${task.dependencies.join(', ')}` : ''}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}

            <Dialog open={showPlanForm} onClose={() => setShowPlanForm(false)} title="Generate Plan">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Review mode</span>
                  <Select value={planMode} options={PLAN_MODE_OPTIONS} onValueChange={(value) => setPlanMode(value as 'simple' | 'consensus')} />
                </div>
                {planMode === 'consensus' && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Max consensus rounds</span>
                    <Select value={planMaxIterations} options={PLAN_MAX_ITERATION_OPTIONS} onValueChange={setPlanMaxIterations} />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">Request</span>
                  <Textarea
                    rows={6}
                    value={planRequest}
                    onChange={(e) => setPlanRequest(e.target.value)}
                    placeholder="Break down the current auth regression into implementation and review tasks, assign owners, and include dependencies."
                  />
                </div>
                <div className="flex gap-2 justify-end mt-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowPlanForm(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleGeneratePlan} disabled={generatingPlan || !planRequest.trim()}>
                    {generatingPlan ? 'Starting...' : 'Generate'}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>
        )}
      </div>
    </div>
  );
}
