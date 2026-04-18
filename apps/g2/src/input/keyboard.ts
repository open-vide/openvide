/**
 * Keyboard bindings for browser testing.
 *
 * Enter/Space = Click (tap)
 * Escape      = Double Click (go back)
 * ArrowUp     = Scroll Up
 * ArrowDown   = Scroll Down
 */

import type { Store } from '../state/store';
import type { Action } from '../state/actions';

const SCROLLABLE_SCREENS = [
  'home', 'host-list', 'workspace-list', 'session-list', 'session-detail',
  'live-output', 'file-browser', 'file-viewer',
  'session-diffs', 'settings', 'prompt-select', 'port-browser',
];

export function bindKeyboard(store: Store, handleAction: (action: Action) => void): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.repeat) return;

    const state = store.getState();

    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        switch (state.screen) {
          case 'home':
            handleAction({ type: 'PRIMARY_ACTION' });
            break;
          case 'host-list':
          case 'workspace-list':
          case 'session-list':
          case 'file-browser':
          case 'prompt-select':
            handleAction({ type: 'SELECT_HIGHLIGHTED' });
            break;
          case 'session-detail':
          case 'settings':
            handleAction({ type: 'PRIMARY_ACTION' });
            break;
          case 'action-result':
            handleAction({ type: 'CLEAR_RESULT' });
            break;
          case 'live-output':
            handleAction({ type: 'CHAT_TAP' });
            break;
        }
        break;

      case 'Escape':
        handleAction({ type: 'GO_BACK' });
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (SCROLLABLE_SCREENS.includes(state.screen)) {
          handleAction({ type: 'HIGHLIGHT_MOVE', direction: 'up' });
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (SCROLLABLE_SCREENS.includes(state.screen)) {
          handleAction({ type: 'HIGHLIGHT_MOVE', direction: 'down' });
        }
        break;
    }
  });
}
