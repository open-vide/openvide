import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useBridge } from '../contexts/bridge';
import { useSessions } from '../hooks/use-sessions';
import { useTranslation } from '../hooks/useTranslation';
import { EmptyState } from '../components/shared/empty-state';
import { StatusDot } from '../components/shared/status-dot';
import { usePullRefresh } from '../hooks/use-pull-refresh';
import { UNTITLED_DIALOG_CLASS } from '../lib/dialog';
import { Button, Card, Input, Badge, ListItem, Dialog, useDrawerHeader } from 'even-toolkit/web';
import { IcEditAdd, IcStatusDisconnected } from 'even-toolkit/web/icons/svg-icons';

export function HostsRoute() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const { hosts, activeHostId, hostStatuses, addHost, removeHost } = useBridge();
  const { data: sessions } = useSessions();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pullHandlers, PullIndicator } = usePullRefresh(async () => {
    await queryClient.invalidateQueries();
  });

  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formToken, setFormToken] = useState('');

  const handleSave = () => {
    const name = formName.trim();
    const url = formUrl.trim();
    if (name && url) {
      addHost(name, url, formToken.trim() || undefined);
      setShowForm(false);
      setFormName('');
      setFormUrl('');
      setFormToken('');
    }
  };

  useDrawerHeader({
    title: `${t('web.hosts')} • ${hosts.length}`,
    right: (
      <Button size="icon" onClick={() => setShowForm(!showForm)}>
        <IcEditAdd width={16} height={16} />
      </Button>
    ),
  });

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 py-4 pb-8" {...pullHandlers}>
        <PullIndicator />

        <div className="flex flex-col gap-3">
          {/* Add Host Form */}
          <Dialog open={showForm} onClose={() => setShowForm(false)} title="" className={UNTITLED_DIALOG_CLASS}>
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.name')}</label>
                  <Input placeholder="My Host" value={formName} onChange={(e) => setFormName(e.target.value)} />
                </div>
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.url')}</label>
                  <Input placeholder="http://localhost:7842" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">{t('web.token')}</label>
                <Input placeholder={t('web.authToken')} type="password" value={formToken} onChange={(e) => setFormToken(e.target.value)} />
              </div>
              <div className="flex gap-2 justify-end mt-2">
                <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>{t('web.cancel')}</Button>
                <Button size="sm" onClick={handleSave}>{t('web.save')}</Button>
              </div>
            </div>
          </Dialog>

          {/* Empty State */}
          {hosts.length === 0 && !showForm ? (
            <EmptyState icon={<IcStatusDisconnected width={32} height={32} />} title={t('web.noHosts')} description={t('web.noHostsHint')} />
          ) : (
            <div className="flex flex-col gap-1.5">
              {hosts.map((host) => {
                const isActive = activeHostId === host.id;
                const status = hostStatuses[host.id] ?? 'disconnected';
                const isConnected = status === 'connected';
                const hostSessions = sessions?.filter((s) => s.hostId === host.id) ?? [];
                const runningCount = hostSessions.filter((s) => s.status === 'running').length;

                return (
                  <ListItem
                    key={host.id}
                    title={host.name}
                    subtitle={host.url}
                    leading={
                      <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center shrink-0">
                        <StatusDot
                          status={status}
                          className={`w-3 h-3 ${isConnected ? 'status-breathe' : ''}`}
                        />
                      </div>
                    }
                    trailing={
                      <div className="flex items-center gap-3 shrink-0">
                        {isActive && <Badge variant="positive">Active</Badge>}
                        <div className="text-center">
                          <div className="data-mono text-text">{hostSessions.length}</div>
                          <div className="text-[11px] tracking-[-0.11px] text-text-dim">sessions</div>
                        </div>
                        {runningCount > 0 && (
                          <div className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-positive status-breathe" />
                              <span className="data-mono text-positive">{runningCount}</span>
                            </div>
                            <div className="text-[11px] tracking-[-0.11px] text-text-dim">running</div>
                          </div>
                        )}
                      </div>
                    }
                    onPress={() => navigate(`/host?id=${host.id}`)}
                    onDelete={() => removeHost(host.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
