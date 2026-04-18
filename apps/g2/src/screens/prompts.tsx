import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { usePrompts, useAddPrompt, useRemovePrompt, useUpdatePrompt } from '../hooks/use-prompts';
import { useSendPrompt } from '../hooks/use-send-prompt';
import { useSessions } from '../hooks/use-sessions';
import { EmptyState } from '../components/shared/empty-state';
import { useTranslation } from '../hooks/useTranslation';
import { Button, Card, Input, Textarea, ConfirmDialog, ListItem, useDrawerHeader } from 'even-toolkit/web';
import { IcFeatQuickNote } from 'even-toolkit/web/icons/svg-icons';
import type { Prompt } from '../types';

export function PromptsRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: prompts } = usePrompts();
  const { data: sessions } = useSessions();
  const addPrompt = useAddPrompt();
  const removePrompt = useRemovePrompt();
  const updatePrompt = useUpdatePrompt();
  const sendPrompt = useSendPrompt(sessions);
  const { t } = useTranslation();

  // Back always returns to the chat when we were invoked from one (via ?from=chat&id=…),
  // otherwise fall back to /sessions.
  const fromId = searchParams.get('id');
  const backTo = searchParams.get('from') === 'chat' && fromId
    ? `/chat?id=${encodeURIComponent(fromId)}`
    : '/sessions';
  useDrawerHeader({ title: t('web.prompts') ?? 'Prompts', backTo });

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [formLabel, setFormLabel] = useState('');
  const [formText, setFormText] = useState('');

  // Only show user-configured prompts. Built-in defaults are hidden from
  // management UI — the chat / voice input screens still surface them as
  // suggestions via the daemon's prompt.list response.
  const allPrompts = prompts ?? [];
  const custom = allPrompts.filter((p) => !p.isBuiltIn);

  const openCreate = () => { setEditingPrompt(null); setFormLabel(''); setFormText(''); setShowForm(true); };
  const openEdit = (p: Prompt) => { setEditingPrompt(p); setFormLabel(p.label); setFormText(p.prompt); setShowForm(true); };

  const handleSave = async () => {
    if (!formLabel.trim() || !formText.trim()) return;
    if (editingPrompt) {
      await updatePrompt.mutateAsync({ oldId: editingPrompt.id, label: formLabel, prompt: formText });
    } else {
      await addPrompt.mutateAsync({ label: formLabel, prompt: formText });
    }
    setShowForm(false);
  };

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 pt-4 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[20px] tracking-[-0.6px] font-normal">{t('web.prompts')}</h1>
            <p className="text-[11px] tracking-[-0.11px] text-text-dim">{`${custom.length} prompt${custom.length !== 1 ? 's' : ''} in library`}</p>
          </div>
          <Button size="sm" onClick={openCreate}>{t('web.addPrompt')}</Button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Form */}
          {showForm && (
            <Card className="mb-2">
              <div className="flex flex-col gap-3">
                <h3 className="text-[13px] tracking-[-0.13px] font-normal">{editingPrompt ? t('web.editPrompt') : t('web.newPrompt')}</h3>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.label')}</label>
                  <Input placeholder="e.g. Fix Bugs" value={formLabel} onChange={(e) => setFormLabel(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.promptText')}</label>
                  <Textarea rows={3} placeholder="e.g. Find and fix all bugs in..." value={formText} onChange={(e) => setFormText(e.target.value)} />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="default" size="sm" onClick={() => setShowForm(false)}>{t('web.cancel')}</Button>
                  <Button size="sm" onClick={handleSave} disabled={!formLabel.trim() || !formText.trim()}>
                    {editingPrompt ? t('web.update') : t('web.save')}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Content — user-configured prompts only */}
          {custom.length === 0 && !showForm ? (
            <EmptyState icon={<IcFeatQuickNote width={32} height={32} />} title={t('web.noPrompts')} description={t('web.noPromptsHint')} />
          ) : (
            <div className="flex flex-col gap-1.5">
              {custom.map((p) => (
                <ListItem
                  key={p.id}
                  title={p.label}
                  subtitle={p.prompt.slice(0, 60)}
                  onPress={() => openEdit(p)}
                  onDelete={() => setDeleteTarget(p.id)}
                />
              ))}
            </div>
          )}
        </div>

        <ConfirmDialog
          open={deleteTarget !== null}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => { if (deleteTarget) removePrompt.mutate(deleteTarget); setDeleteTarget(null); }}
          title="Delete prompt?"
          description="This action cannot be undone."
          confirmLabel="Delete"
          variant="danger"
        />
      </div>
    </div>
  );
}
