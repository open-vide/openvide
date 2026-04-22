import assert from 'node:assert/strict';
import test from 'node:test';
import { liveOutputChatMode } from '../src/glass/live-output-mode.ts';

const HISTORIC_REGRESSION_LINE = 500;

test('read mode preserves long chat offsets instead of decoding as another mode', () => {
  const encoded = liveOutputChatMode.encode('read', HISTORIC_REGRESSION_LINE);
  assert.equal(liveOutputChatMode.getMode(encoded), 'read');
  assert.equal(liveOutputChatMode.getOffset(encoded), HISTORIC_REGRESSION_LINE);
});

test('readOpen mode preserves long chat offsets instead of decoding as another mode', () => {
  const encoded = liveOutputChatMode.encode('readOpen', HISTORIC_REGRESSION_LINE);
  assert.equal(liveOutputChatMode.getMode(encoded), 'readOpen');
  assert.equal(liveOutputChatMode.getOffset(encoded), HISTORIC_REGRESSION_LINE);
});
