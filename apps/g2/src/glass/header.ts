/**
 * Compact glass header — title + separator, no gap.
 * The extra \n that caused the blank gap has been fixed in the toolkit.
 * Returns 2 DisplayLines → 8 content slots (10 - 2).
 */
import type { DisplayLine } from 'even-toolkit/types';
import { line, separator } from 'even-toolkit/types';

export function compactHeader(title: string, actionBar?: string, notice?: string): DisplayLine[] {
  const text = [title, actionBar, notice].filter(Boolean).join('  ');
  return [line(text, 'normal'), separator()];
}
