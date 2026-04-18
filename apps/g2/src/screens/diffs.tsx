import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useDiffs, useFileDiff } from '../hooks/use-diffs';
import { useSessions } from '../hooks/use-sessions';
import { EmptyState } from '../components/shared/empty-state';
import { useTranslation } from '../hooks/useTranslation';
import { Badge, Button } from 'even-toolkit/web';
import { IcEditCopy } from 'even-toolkit/web/icons/svg-icons';

export function DiffsRoute() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('id') ?? '';
  const navigate = useNavigate();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { data: sessions } = useSessions();
  const { t } = useTranslation();
  const { data: diffFiles } = useDiffs(sessionId, sessions);
  const { data: diffContent } = useFileDiff(sessionId, selectedFile);
  const session = sessions?.find((s) => s.id === sessionId);

  // Diff detail view
  if (selectedFile && diffContent !== undefined) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-bg">
        <div className="px-3 pt-4 pb-2 flex items-center justify-between">
          <div>
            <h1 className="text-[17px] tracking-[-0.17px] font-normal">{selectedFile.split('/').pop()}</h1>
            <p className="data-mono">{selectedFile}</p>
          </div>
          <Button variant="default" size="sm" onClick={() => setSelectedFile(null)}>Back</Button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pt-4 pb-8">
          {diffContent ? (
            <div className="code-surface p-0">
              {diffContent.split('\n').map((ln, i) => {
                let cls = '';
                if (ln.startsWith('+') && !ln.startsWith('+++')) cls = ' line-added';
                else if (ln.startsWith('-') && !ln.startsWith('---')) cls = ' line-removed';
                else if (ln.startsWith('@@')) cls = ' line-meta';
                return (
                  <div key={i} className={`flex px-3 min-h-[20px]${cls}`}>
                    <span className="line-num">{i + 1}</span>
                    <span className="flex-1 whitespace-pre">{ln}</span>
                  </div>
                );
              })}
            </div>
          ) : <div className="text-text-dim text-center p-8 status-breathe-fast">Loading...</div>}
        </div>
      </div>
    );
  }

  // File list view
  const totalAdded = (diffFiles ?? []).reduce((sum, f) => sum + f.added, 0);
  const totalRemoved = (diffFiles ?? []).reduce((sum, f) => sum + f.removed, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg">
      <div className="px-3 pt-4 pb-2">
        <h1 className="text-[17px] tracking-[-0.17px] font-normal">{t('web.diffs')}</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="data-mono">{session?.tool ?? 'Session'}</span>
          <span className="text-text-dim text-[11px] tracking-[-0.11px]">/</span>
          <span className="data-mono">{(diffFiles ?? []).length} file{(diffFiles ?? []).length !== 1 ? 's' : ''}</span>
          {totalAdded > 0 && <Badge variant="positive">+{totalAdded}</Badge>}
          {totalRemoved > 0 && <Badge variant="negative">-{totalRemoved}</Badge>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pt-4 pb-8">
        {!diffFiles || diffFiles.length === 0 ? (
          <EmptyState icon={<IcEditCopy width={32} height={32} />} title={t('web.noDiffs')} description={t('web.noDiffsHint')} />
        ) : (
          <div className="flex flex-col gap-0.5">
            {diffFiles.map((file) => (
              <div
                key={file.path}
                className="flex items-center gap-3 px-3 py-2.5 bg-surface border border-border rounded-[6px] cursor-pointer card-hover"
                onClick={() => setSelectedFile(file.path)}
              >
                <span className="data-mono flex-1 min-w-0 truncate !text-text">{file.path}</span>
                {file.isNew && <Badge variant="positive">{t('web.new')}</Badge>}
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="positive">+{file.added}</Badge>
                  <Badge variant="negative">-{file.removed}</Badge>
                </div>
                <span className="text-text-dim text-[11px] tracking-[-0.11px]">{'\u203A'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
