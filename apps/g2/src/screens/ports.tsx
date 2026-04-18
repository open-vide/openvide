import { useState } from 'react';
import { usePorts } from '../hooks/use-ports';
import { EmptyState } from '../components/shared/empty-state';
import { useTranslation } from '../hooks/useTranslation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card } from 'even-toolkit/web';
import { IcFeatServices } from 'even-toolkit/web/icons/svg-icons';

export function PortsRoute() {
  const { data: ports } = usePorts();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const allPorts = ports ?? [];

  // Preview mode
  if (previewUrl) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-bg">
        <div className="px-3 pt-4 pb-2 flex items-center justify-between bg-surface border-b border-border">
          <div>
            <h1 className="text-[15px] tracking-[-0.15px] font-normal">Preview</h1>
            <p className="data-mono">{previewUrl}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="default" size="sm" onClick={() => {
              const iframe = document.querySelector('iframe[data-port-preview]') as HTMLIFrameElement;
              if (iframe) iframe.src = previewUrl;
            }}>Reload</Button>
            <Button variant="default" size="sm" onClick={() => setPreviewUrl(null)}>Close</Button>
          </div>
        </div>
        <div className="flex-1 flex overflow-hidden">
          <iframe src={previewUrl} data-port-preview className="w-full h-full border-none" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 pt-4 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[20px] tracking-[-0.6px] font-normal">{t('web.ports')}</h1>
            <p className="text-[11px] tracking-[-0.11px] text-text-dim">{`${allPorts.length} listening port${allPorts.length !== 1 ? 's' : ''}`}</p>
          </div>
          <Button variant="default" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['ports'] })}>{t('web.refresh')}</Button>
        </div>

        <div className="flex flex-col gap-1.5">
          {allPorts.length === 0 ? (
            <EmptyState icon={<IcFeatServices width={32} height={32} />} title={t('web.noListeningPorts')} description={t('web.noListeningPortsHint')} />
          ) : allPorts.map((port) => (
            <Card
              key={port.port}
              className="card-hover cursor-pointer"
              onClick={() => {
                const addr = port.address === '*' || port.address === '0.0.0.0' ? 'localhost' : port.address;
                setPreviewUrl(`http://${addr}:${port.port}`);
              }}
            >
              <div className="flex items-center gap-3">
                {/* Large port number */}
                <div className="shrink-0">
                  <span className="text-[24px] tracking-[-0.72px] font-normal text-accent" style={{ fontFamily: 'var(--font-mono)' }}>
                    {port.port}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] tracking-[-0.13px] text-text font-normal truncate">{port.process}</p>
                  <p className="data-mono">{port.address}</p>
                </div>
                <span className="text-text-dim text-[11px] tracking-[-0.11px]">{'\u203A'}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
