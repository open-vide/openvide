/**
 * File browser operations via daemon RPC.
 */

import type { Store } from '../state/store';
import type { FsEntry } from '../state/types';
import { rpc } from './daemon-client';

/** Fetch directory listing and dispatch to store. */
export async function fetchBrowserEntries(store: Store, dirPath: string): Promise<void> {
  try {
    const res = await rpc('fs.list', { path: dirPath });
    if (res.ok && Array.isArray(res.entries)) {
      const entries: FsEntry[] = (res.entries as any[]).map((e) => ({
        name: e.name,
        type: e.type,
        size: e.size,
        modifiedAt: e.modifiedAt,
      }));
      store.dispatch({ type: 'BROWSER_ENTRIES', entries, path: dirPath });
    } else {
      console.error('[file-browser] fs.list failed:', res.error);
    }
  } catch (err) {
    console.error('[file-browser] fs.list error:', err);
  }
}

/** Fetch file content and dispatch to store. */
export async function fetchFileContent(store: Store, filePath: string): Promise<void> {
  try {
    const res = await rpc('fs.read', { path: filePath });
    if (res.ok && res.fileContent) {
      const fc = res.fileContent as any;
      const fileName = filePath.split('/').pop() ?? 'file';
      store.dispatch({ type: 'FILE_CONTENT', content: fc.content, fileName });
    } else {
      console.error('[file-browser] fs.read failed:', res.error);
    }
  } catch (err) {
    console.error('[file-browser] fs.read error:', err);
  }
}
