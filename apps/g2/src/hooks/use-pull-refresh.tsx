import { useRef, useCallback, useState, type TouchEvent as ReactTouchEvent } from 'react';

/**
 * Pull-to-refresh hook for web. Returns touch handlers and a refreshing state.
 * Attach the handlers to a scrollable container.
 *
 * Usage:
 * const { refreshing, pullHandlers, PullIndicator } = usePullRefresh(refreshFn);
 * <div {...pullHandlers}> ... </div>
 * <PullIndicator />
 */
export function usePullRefresh(onRefresh: () => Promise<void> | void) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const scrollTop = useRef(0);
  const pulling = useRef(false);

  const THRESHOLD = 60;

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    const target = e.currentTarget as HTMLElement;
    scrollTop.current = target.scrollTop;
    if (scrollTop.current <= 0) {
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    }
  }, []);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!pulling.current || refreshing) return;
    const target = e.currentTarget as HTMLElement;
    if (target.scrollTop > 0) {
      pulling.current = false;
      setPullDistance(0);
      return;
    }
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) {
      setPullDistance(Math.min(dy * 0.4, 80));
    }
  }, [refreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullDistance >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(0);
      try {
        await onRefresh();
      } catch { /* ignore */ }
      setRefreshing(false);
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, refreshing, onRefresh]);

  const pullHandlers = {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };

  function PullIndicator() {
    if (pullDistance <= 0 && !refreshing) return null;
    return (
      <div
        className="flex items-center justify-center overflow-hidden transition-all"
        style={{ height: refreshing ? 40 : pullDistance }}
      >
        {refreshing ? (
          <span className="text-[11px] tracking-[-0.11px] text-text-dim status-breathe-fast">Refreshing...</span>
        ) : (
          <span className="text-[11px] tracking-[-0.11px] text-text-dim" style={{ opacity: Math.min(pullDistance / THRESHOLD, 1) }}>
            {pullDistance >= THRESHOLD ? '↓ Release to refresh' : '↓ Pull to refresh'}
          </span>
        )}
      </div>
    );
  }

  return { refreshing, pullHandlers, PullIndicator };
}
