import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";

export interface Attachment {
  id: string;
  name: string;
  uri: string;
  size: number;
  mimeType: string;
  /** Whether this file is small enough to inline in the prompt */
  isInlinable: boolean;
}

const MAX_INLINE_SIZE = 50 * 1024; // 50KB

const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-sh",
  "application/sql",
];

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export function canInline(attachment: Attachment): boolean {
  return attachment.size <= MAX_INLINE_SIZE && isTextMime(attachment.mimeType);
}

/** Read a local file's content as text for inlining into a prompt */
export async function readAttachmentContent(uri: string): Promise<string> {
  return await readAsStringAsync(uri, { encoding: EncodingType.UTF8 });
}

/** Build the prompt text with attachments inlined */
export async function buildPromptWithAttachments(
  prompt: string,
  attachments: Attachment[],
): Promise<string> {
  if (attachments.length === 0) return prompt;

  const parts: string[] = [];

  for (const att of attachments) {
    if (canInline(att)) {
      try {
        const content = await readAttachmentContent(att.uri);
        const safeName = att.name.replace(/[<>"&]/g, "_");
      parts.push(`<attached_file name="${safeName}">\n${content}\n</attached_file>`);
      } catch {
        parts.push(`[Failed to read: ${att.name}]`);
      }
    } else {
      parts.push(`[Attachment: ${att.name} (${formatSize(att.size)}, ${att.mimeType})]`);
    }
  }

  return parts.join("\n\n") + "\n\n" + prompt;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

let _counter = 0;
export function newAttachmentId(): string {
  return `att_${Date.now()}_${++_counter}`;
}
