import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useBrowserEntries, useFileContent } from '../hooks/use-file-browser';
import { useSettings } from '../hooks/use-settings';
import { EmptyState } from '../components/shared/empty-state';
import { useTranslation } from '../hooks/useTranslation';
import { useBridge } from '../contexts/bridge';
import { getHostOptions, resolvePreferredHostId } from '../lib/bridge-hosts';
import { PICKED_PATH_STORAGE_KEY } from '../hooks/use-dialog-draft';
import { Button, Input, Select, Card, useDrawerHeader } from 'even-toolkit/web';
import { storageSetRaw } from 'even-toolkit/storage';
import { IcFeatLearnExplore, IcStatusArchivedFile, IcStatusFile } from 'even-toolkit/web/icons/svg-icons';

type SortMode = 'name' | 'size' | 'modified' | 'type';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
  { value: 'modified', label: 'Modified' },
  { value: 'type', label: 'Type' },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatModified(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function loadSortPrefs(): { mode: SortMode; dir: SortDir } {
  try {
    const raw = localStorage.getItem('openvide_file_sort');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { mode: 'name', dir: 'asc' };
}

function saveSortPrefs(mode: SortMode, dir: SortDir): void {
  storageSetRaw('openvide_file_sort', JSON.stringify({ mode, dir }));
}

export function FilesRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPath = searchParams.get('path') || '~';
  const pickMode = searchParams.get('pick') === 'dir';
  const requestedHostId = searchParams.get('host');
  const source = searchParams.get('source');
  const navigate = useNavigate();
  const { hosts, activeHostId, switchHost } = useBridge();

  const [browserPath, setBrowserPath] = useState(initialPath);
  const [viewFilePath, setViewFilePath] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>(loadSortPrefs().mode);
  const [sortDir, setSortDir] = useState<SortDir>(loadSortPrefs().dir);
  const selectedHostId = useMemo(
    () => resolvePreferredHostId(hosts, activeHostId, requestedHostId),
    [activeHostId, hosts, requestedHostId],
  );

  const { data: entries } = useBrowserEntries(browserPath, selectedHostId || null);
  const { data: fileContent } = useFileContent(viewFilePath, selectedHostId || null);
  const { data: settings } = useSettings();
  const { t } = useTranslation();

  // Persist sort prefs
  useEffect(() => {
    saveSortPrefs(sortMode, sortDir);
  }, [sortMode, sortDir]);

  const showHidden = settings?.showHiddenFiles ?? false;
  const allEntries = entries ?? [];

  // Filter
  const filtered = useMemo(() => {
    let list = showHidden ? allEntries : allEntries.filter((e) => !e.name.startsWith('.'));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    return list;
  }, [allEntries, showHidden, search]);

  // Sort
  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      // Directories always first regardless of sort
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;

      switch (sortMode) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'size':
          return dir * (a.size - b.size);
        case 'modified':
          return dir * ((a.modifiedAt ?? '').localeCompare(b.modifiedAt ?? ''));
        case 'type': {
          const extA = a.name.includes('.') ? a.name.split('.').pop()! : '';
          const extB = b.name.includes('.') ? b.name.split('.').pop()! : '';
          return dir * extA.localeCompare(extB);
        }
        default:
          return 0;
      }
    });
    return list;
  }, [filtered, sortMode, sortDir]);

  // Breadcrumbs
  const parts = browserPath.split('/').filter(Boolean);
  const breadcrumbs: { label: string; path: string }[] = [];
  let accumulated = '';
  for (const part of parts) {
    accumulated += '/' + part;
    breadcrumbs.push({ label: part, path: accumulated });
  }
  if (browserPath === '~') {
    breadcrumbs.unshift({ label: '~', path: '~' });
  }

  const parentPath = browserPath.split('/').slice(0, -1).join('/') || '/';
  const canGoUp = browserPath !== '/' && browserPath !== '~';

  const dirCount = sorted.filter((e) => e.type === 'dir').length;
  const fileCount = sorted.filter((e) => e.type !== 'dir').length;

  const toggleSortDir = () => setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
  const hostOptions = useMemo(() => getHostOptions(hosts), [hosts]);
  const showHostSelector = source === 'drawer' && !pickMode && hostOptions.length > 0;

  useEffect(() => {
    setBrowserPath(initialPath);
  }, [initialPath]);

  const syncRoute = (nextPath: string, nextHostId = selectedHostId) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('path', nextPath);
    if (pickMode) nextParams.set('pick', 'dir');
    else nextParams.delete('pick');
    if (nextHostId) nextParams.set('host', nextHostId);
    else nextParams.delete('host');
    setSearchParams(nextParams, { replace: true });
  };

  useDrawerHeader({
    title: viewFilePath
      ? (viewFilePath.split('/').pop() ?? viewFilePath)
      : `${pickMode ? t('web.selectFolder') : t('web.files')} • ${dirCount + fileCount}`,
  });

  // File view mode
  if (viewFilePath && fileContent !== undefined) {
    const fileName = viewFilePath.split('/').pop() ?? viewFilePath;
    return (
      <div className="flex-1 flex min-h-0 flex-col bg-bg">
        <div className="px-3 pt-4 pb-2 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] tracking-[-0.17px] font-normal truncate">{fileName}</h1>
            <p className="data-mono truncate">{viewFilePath}</p>
          </div>
          <Button variant="default" size="sm" onClick={() => setViewFilePath(null)}>Close</Button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pt-2 pb-8">
          {fileContent ? (
            <div className="code-surface p-0">
              {fileContent.split('\n').map((ln, i) => (
                <div key={i} className="flex px-3 min-h-[20px] hover:bg-white/[0.03]">
                  <span className="line-num">{i + 1}</span>
                  <span className="flex-1 whitespace-pre">{ln}</span>
                </div>
              ))}
            </div>
          ) : <div className="text-text-dim text-center p-8 status-breathe-fast">Loading...</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 flex-col bg-bg">
      <div className="px-3 py-4 pb-2">
        {showHostSelector && (
          <div className="mb-2">
            <div className="w-full">
              <Select
                value={selectedHostId}
                options={hostOptions}
                onValueChange={(hostId) => {
                  if (hostId && hostId !== activeHostId) switchHost(hostId);
                  setViewFilePath(null);
                  setSearch('');
                  setBrowserPath('~');
                  syncRoute('~', hostId);
                }}
              />
            </div>
          </div>
        )}

        {/* Search bar */}
        <div className="flex gap-2 mb-2">
          <div className="flex-1 relative">
            <Input
              placeholder="Search files..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text cursor-pointer bg-transparent border-none text-[13px]"
                onClick={() => setSearch('')}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Select
              value={sortMode}
              options={SORT_OPTIONS}
              onValueChange={(v) => setSortMode(v as SortMode)}
            />
          </div>
          <button
            className="h-9 w-16 rounded-[6px] bg-surface border border-border text-[13px] tracking-[-0.13px] text-text cursor-pointer hover:bg-surface-light transition-colors press-spring text-center"
            onClick={toggleSortDir}
          >
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>
      </div>

      {/* Breadcrumb pills */}
      <div className="px-3 pb-2 overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-1 whitespace-nowrap">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-[11px] tracking-[-0.11px] text-text-dim">/</span>}
              <button
                className="px-2 py-0.5 rounded-[6px] bg-surface border border-border text-[11px] tracking-[-0.11px] font-normal text-accent cursor-pointer hover:bg-surface-light transition-colors press-spring"
                onClick={() => {
                  setBrowserPath(crumb.path);
                  syncRoute(crumb.path);
                }}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* File list */}
      <div className={`flex-1 overflow-y-auto px-3 pt-1 ${pickMode ? 'pb-20' : 'pb-8'}`}>
        {sorted.length === 0 && !search ? (
          <EmptyState icon={<IcStatusArchivedFile width={32} height={32} />} title="Empty directory" description="No files or folders here" />
        ) : sorted.length === 0 && search ? (
          <EmptyState icon={<IcFeatLearnExplore width={32} height={32} />} title="No matches" description={`Nothing matches "${search}"`} />
        ) : (
          <div className="flex flex-col gap-0.5">
            {canGoUp && (
              <div
                className="flex items-center gap-3 px-3 py-2.5 bg-surface rounded-[6px] cursor-pointer card-hover"
                onClick={() => {
                  setBrowserPath(parentPath);
                  syncRoute(parentPath);
                }}
              >
                <span className="text-[15px] text-accent">←</span>
                <span className="data-mono text-accent">..</span>
              </div>
            )}
            {sorted.map((entry) => {
              const isDir = entry.type === 'dir';
              const fullPath = browserPath.endsWith('/') ? browserPath + entry.name : browserPath + '/' + entry.name;
              return (
                <div
                  key={entry.name}
                  className="flex items-center gap-3 px-3 py-2.5 bg-surface rounded-[6px] cursor-pointer card-hover group"
                  onClick={() => {
                    if (isDir) {
                      setBrowserPath(fullPath);
                      syncRoute(fullPath);
                    } else {
                      setViewFilePath(fullPath);
                    }
                  }}
                >
                  <span className="w-5 shrink-0 text-text-dim flex items-center justify-center">
                    {isDir ? <IcStatusArchivedFile width={18} height={18} /> : <IcStatusFile width={18} height={18} />}
                  </span>
                  <span className={`data-mono flex-1 truncate ${isDir ? '!text-accent' : '!text-text'}`}>
                    {entry.name}
                  </span>
                  {!isDir && entry.modifiedAt && (
                    <span className="data-mono shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatModified(entry.modifiedAt)}
                    </span>
                  )}
                  {!isDir && <span className="data-mono shrink-0">{formatSize(entry.size)}</span>}
                  {isDir && <span className="text-text-dim text-[11px] tracking-[-0.11px]">›</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pick mode footer — fixed at bottom of viewport */}
      {pickMode && (
        <div className="fixed bottom-0 left-0 right-0 px-3 py-3 pb-6 border-t border-border bg-surface z-30 max-w-[430px] mx-auto">
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              sessionStorage.setItem(PICKED_PATH_STORAGE_KEY, JSON.stringify({ path: browserPath, hostId: selectedHostId || undefined }));
              navigate(-1);
            }}
          >
            Select "{browserPath.split('/').pop() || browserPath}"
          </Button>
        </div>
      )}
    </div>
  );
}
