import type { AppState } from './types';
import type { Action } from './actions';
import { reduce, initialState } from './reducer';

export type Listener = (state: AppState, prevState: AppState) => void;

export interface Store {
  getState(): AppState;
  dispatch(action: Action): void;
  subscribe(listener: Listener): () => void;
}

export function createStore(initial?: AppState): Store {
  let state: AppState = initial ?? initialState;
  const listeners = new Set<Listener>();

  return {
    getState() {
      return state;
    },

    dispatch(action: Action) {
      const prev = state;
      state = reduce(state, action);
      if (state !== prev) {
        listeners.forEach((fn) => fn(state, prev));
      }
    },

    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
