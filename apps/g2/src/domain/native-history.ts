import type { ChatMessage } from '../types';
import {
  encodeAgentMessageDelta,
  encodeAgentMessageFinal,
  parseAgentMessageDelta,
  parseAgentMessageFinal,
  THINK_BODY,
  THINK_HEADER,
} from './output-parser';

let nativeThinkingCounter = 10_000;

function nextThinkingId(): number {
  nativeThinkingCounter += 1;
  return nativeThinkingCounter;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*[-*]\s+/, '- ')
    .replace(/^\s*\d+\.\s+/, '')
    .trim();
}

function splitIntoLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => stripMarkdown(line.trim()))
    .filter(Boolean);
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';

  const parts: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    const type = typeof block.type === 'string' ? block.type : '';
    const text = typeof block.text === 'string' ? block.text.trim() : '';
    if (!text) continue;
    if (type === 'text' || type === 'input_text' || type === 'output_text') {
      parts.push(text);
    }
  }
  return parts.join('\n').trim();
}

function buildToolLine(name: string, input: unknown): string {
  const safeName = name || 'tool';
  if (!input || typeof input !== 'object') {
    return `>> ${safeName}`;
  }
  const record = input as Record<string, unknown>;
  const detail =
    (typeof record.question === 'string' && record.question)
    || (typeof record.file_path === 'string' && record.file_path)
    || (typeof record.command === 'string' && record.command)
    || (typeof record.pattern === 'string' && record.pattern)
    || (typeof record.query === 'string' && record.query)
    || (typeof record.text === 'string' && record.text)
    || (typeof record.content === 'string' && record.content)
    || '';
  return detail ? `>> ${safeName} ${detail}` : `>> ${safeName}`;
}

function isCodexBootstrapPrompt(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes('<environment_context>')) return true;
  if (lower.includes('agents.md instructions for')) return true;
  if (lower.includes('<permissions instructions>')) return true;
  if (lower.includes('filesystem sandboxing defines')) return true;
  if (lower.includes('approved command prefixes')) return true;
  if (text.length > 4000 && lower.includes('## skills')) return true;
  return false;
}

function isCodexControlPrompt(text: string): boolean {
  return /^<turn_aborted(?:\s|>|$)/.test(text.trim());
}

function shouldDisplayCodexUserPrompt(text: string): boolean {
  return !isCodexBootstrapPrompt(text) && !isCodexControlPrompt(text);
}

function parseNativeClaudeHistory(lines: string[]): string[] {
  const out: string[] = [];
  const seenAssistantBlocks = new Set<string>();

  for (const raw of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof parsed.type === 'string' ? parsed.type : '';
    const message = parsed.message as Record<string, unknown> | undefined;
    if (!message) continue;

    if (type === 'user' && message.role === 'user') {
      const prompt = extractTextFromUnknown(message.content);
      if (prompt) {
        out.push(`§P§${prompt}`);
      }
      continue;
    }

    if (type !== 'assistant') continue;

    const messageId = typeof message.id === 'string'
      ? message.id
      : (typeof parsed.uuid === 'string' ? parsed.uuid : `claude:${out.length}`);
    const content = Array.isArray(message.content) ? message.content : [];

    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const block = item as Record<string, unknown>;
      const blockType = typeof block.type === 'string' ? block.type : '';
      const dedupeKey = `${messageId}:${JSON.stringify(block)}`;
      if (seenAssistantBlocks.has(dedupeKey)) continue;
      seenAssistantBlocks.add(dedupeKey);

      if (blockType === 'text' && typeof block.text === 'string') {
        out.push(...splitIntoLines(block.text));
        continue;
      }

      if (blockType === 'thinking' && typeof block.thinking === 'string') {
        const thinkLines = splitIntoLines(block.thinking);
        if (thinkLines.length === 0) continue;
        const id = nextThinkingId();
        out.push(`${THINK_HEADER}${id}§${thinkLines[0] ?? 'Thinking...'}`);
        for (const line of thinkLines.slice(1)) {
          out.push(`${THINK_BODY}${id}§${line}`);
        }
        continue;
      }

      if (blockType === 'tool_use' || blockType === 'server_tool_use') {
        const name = typeof block.name === 'string' ? block.name : 'tool';
        out.push(buildToolLine(name, block.input));
      }
    }
  }

  return out;
}

function parseNativeCodexHistory(lines: string[]): string[] {
  const out: string[] = [];

  for (const raw of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (parsed.type === 'response_item') {
      const payload = parsed.payload as Record<string, unknown> | undefined;
      if (!payload) continue;
      const payloadType = typeof payload.type === 'string' ? payload.type : '';

      if (payloadType === 'message') {
        const role = typeof payload.role === 'string' ? payload.role : '';
        const text = extractTextFromUnknown(payload.content);
        if (!text) continue;
        if (role === 'user') {
          if (shouldDisplayCodexUserPrompt(text)) {
            out.push(`§P§${text}`);
          }
          continue;
        }
        if (role === 'assistant') {
          out.push(...splitIntoLines(text));
        }
        continue;
      }

      if (payloadType === 'reasoning') {
        const summary = Array.isArray(payload.summary)
          ? payload.summary
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return '';
              const typed = entry as Record<string, unknown>;
              return typeof typed.text === 'string' ? typed.text : '';
            })
            .filter(Boolean)
            .join('\n')
          : (typeof payload.text === 'string' ? payload.text : '');
        const thinkLines = splitIntoLines(summary);
        if (thinkLines.length === 0) continue;
        const id = nextThinkingId();
        out.push(`${THINK_HEADER}${id}§${thinkLines[0] ?? 'Reasoning...'}`);
        for (const line of thinkLines.slice(1)) {
          out.push(`${THINK_BODY}${id}§${line}`);
        }
        continue;
      }

      if (payloadType === 'function_call') {
        const name = typeof payload.name === 'string' ? payload.name : 'tool';
        const args = typeof payload.arguments === 'string' ? payload.arguments : '';
        let input: unknown = args;
        if (args) {
          try {
            input = JSON.parse(args);
          } catch {
            input = args;
          }
        }
        out.push(buildToolLine(name, input));
        continue;
      }
    }

    if (parsed.type === 'item.completed' || parsed.type === 'item.created') {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (!item) continue;
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        const id = typeof item.id === 'string' ? item.id : 'agent_message';
        if (parsed.type === 'item.created') {
          if (item.text) {
            out.push(encodeAgentMessageDelta(id, item.text));
          }
          continue;
        }
        if (item.text) {
          out.push(encodeAgentMessageFinal(id, item.text));
        }
        continue;
      }
      if (item.type === 'message') {
        const role = typeof item.role === 'string' ? item.role : '';
        const text = extractTextFromUnknown(item.content);
        if (!text) continue;
        if (role === 'user') {
          if (shouldDisplayCodexUserPrompt(text)) {
            out.push(`§P§${text}`);
          }
          continue;
        }
        out.push(...splitIntoLines(text));
        continue;
      }
      if (item.type === 'reasoning' && typeof item.text === 'string') {
        const thinkLines = splitIntoLines(item.text);
        if (thinkLines.length === 0) continue;
        const id = nextThinkingId();
        out.push(`${THINK_HEADER}${id}§${thinkLines[0] ?? 'Reasoning...'}`);
        for (const line of thinkLines.slice(1)) {
          out.push(`${THINK_BODY}${id}§${line}`);
        }
        continue;
      }
      if (item.type === 'tool_call' || item.type === 'function_call') {
        const name = typeof item.name === 'string' ? item.name : 'tool';
        out.push(buildToolLine(name, item.arguments));
      }
    }
  }

  return out;
}

export function parseNativeHistoryToDisplayLines(format: string | undefined, lines: string[]): string[] {
  if (format === 'native_claude_jsonl') return parseNativeClaudeHistory(lines);
  if (format === 'native_codex_jsonl') return parseNativeCodexHistory(lines);
  return [];
}

function canReuseTimestamp(previous: ChatMessage | undefined, next: ChatMessage): boolean {
  if (!previous || previous.role !== next.role) return false;
  const previousThinking = previous.thinking ?? '';
  const nextThinking = next.thinking ?? '';
  return (
    (next.content === previous.content || next.content.startsWith(previous.content))
    && (nextThinking === previousThinking || nextThinking.startsWith(previousThinking))
  );
}

export function buildMessagesFromDisplayLines(
  displayLines: string[],
  previousMessages: ChatMessage[] = [],
): ChatMessage[] {
  const built: ChatMessage[] = [];
  const agentMessageStateById = new Map<string, {
    messageIndex: number;
    startOffset: number;
    length: number;
    finalized: boolean;
  }>();
  let activeAgentDeltaId: string | null = null;
  let previousLineWasAgentDelta = false;

  const replaceAgentMessageDelta = (id: string, finalText: string): boolean => {
    const state = agentMessageStateById.get(id);
    const target = state ? built[state.messageIndex] : undefined;
    if (!state || target?.role !== 'assistant') return false;

    const startOffset = Math.min(state.startOffset, target.content.length);
    const endOffset = Math.min(startOffset + state.length, target.content.length);
    const before = target.content.slice(0, startOffset);
    const after = target.content.slice(endOffset);
    target.content = `${before}${finalText}${after}`;

    const lengthDelta = finalText.length - state.length;
    state.length = finalText.length;
    state.finalized = true;
    for (const other of agentMessageStateById.values()) {
      if (other === state || other.messageIndex !== state.messageIndex) continue;
      if (other.startOffset > state.startOffset) {
        other.startOffset += lengthDelta;
      }
    }
    target.isStreaming = Array.from(agentMessageStateById.values())
      .some((other) => other.messageIndex === state.messageIndex && !other.finalized);
    return true;
  };

  for (const line of displayLines) {
    const agentDelta = parseAgentMessageDelta(line);
    if (agentDelta) {
      const continuesCurrentMessage = previousLineWasAgentDelta && activeAgentDeltaId === agentDelta.id;
      const text = continuesCurrentMessage ? agentDelta.text : agentDelta.text.trimStart();
      if (!text) continue;

      let state = agentMessageStateById.get(agentDelta.id);
      let target = state ? built[state.messageIndex] : built[built.length - 1];
      if (state && target?.role !== 'assistant') {
        agentMessageStateById.delete(agentDelta.id);
        state = undefined;
        target = built[built.length - 1];
      }
      if (!target || target.role !== 'assistant') {
        target = { role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true };
        built.push(target);
      }

      if (!state) {
        if (!continuesCurrentMessage && target.content) {
          target.content += '\n';
        }
        state = {
          messageIndex: built.length - 1,
          startOffset: target.content.length,
          length: 0,
          finalized: false,
        };
        agentMessageStateById.set(agentDelta.id, state);
      }
      target.content += text;
      target.isStreaming = true;
      state.length += text.length;
      state.finalized = false;

      activeAgentDeltaId = agentDelta.id;
      previousLineWasAgentDelta = true;
      continue;
    }

    const agentFinal = parseAgentMessageFinal(line);
    if (agentFinal) {
      const text = agentFinal.text.trim();
      if (!text) continue;

      if (!replaceAgentMessageDelta(agentFinal.id, text)) {
        const last = built[built.length - 1];
        if (last && last.role === 'assistant') {
          last.content += `${last.content ? '\n' : ''}${text}`;
        } else {
          built.push({ role: 'assistant', content: text, timestamp: Date.now() });
        }
      }

      activeAgentDeltaId = null;
      previousLineWasAgentDelta = false;
      continue;
    }

    activeAgentDeltaId = null;
    previousLineWasAgentDelta = false;

    if (line.startsWith('§P§')) {
      built.push({ role: 'user', content: line.slice(3), timestamp: Date.now() });
      continue;
    }

    if (line.startsWith('§TH§')) {
      const rest = line.slice(4);
      const sepIdx = rest.indexOf('§');
      const summary = sepIdx >= 0 ? rest.slice(sepIdx + 1) : rest;
      const last = built[built.length - 1];
      if (last && last.role === 'assistant' && !last.content) {
        last.thinking = (last.thinking ? `${last.thinking}\n` : '') + summary;
      } else {
        built.push({ role: 'assistant', content: '', timestamp: Date.now(), thinking: summary });
      }
      continue;
    }

    if (line.startsWith('§TB§')) {
      const rest = line.slice(4);
      const sepIdx = rest.indexOf('§');
      const bodyText = sepIdx >= 0 ? rest.slice(sepIdx + 1) : rest;
      const last = built[built.length - 1];
      if (last && last.role === 'assistant') {
        last.thinking = (last.thinking ? `${last.thinking}\n` : '') + bodyText;
      } else {
        built.push({ role: 'assistant', content: '', timestamp: Date.now(), thinking: bodyText });
      }
      continue;
    }

    if (line.startsWith('>> ')) {
      const last = built[built.length - 1];
      if (last && last.role === 'assistant') {
        last.content += `${last.content ? '\n' : ''}${line}`;
      } else {
        built.push({ role: 'assistant', content: line, timestamp: Date.now() });
      }
      continue;
    }

    const last = built[built.length - 1];
    if (last && last.role === 'assistant') {
      last.content += `${last.content ? '\n' : ''}${line}`;
    } else {
      built.push({ role: 'assistant', content: line, timestamp: Date.now(), isStreaming: true });
    }
  }

  return built.map((message, index) => {
    const previous = previousMessages[index];
    if (canReuseTimestamp(previous, message)) {
      return { ...message, timestamp: previous.timestamp };
    }
    return message;
  });
}
