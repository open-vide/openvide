const NOTION_VERSION = "2022-06-28";

interface NotionDatabase {
  properties?: Record<string, { type?: string }>;
}

interface NotionPage {
  id: string;
  url?: string;
}

function notionToken(): string | undefined {
  return process.env.NOTION_TOKEN || process.env.OPENVIDE_NOTION_TOKEN;
}

function assertToken(): string {
  const token = notionToken();
  if (!token) {
    throw new Error("Missing NOTION_TOKEN or OPENVIDE_NOTION_TOKEN");
  }
  return token;
}

async function notionRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
): Promise<T> {
  const token = assertToken();
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion ${method} ${path} failed: ${res.status} ${text}`);
  }

  return await res.json() as T;
}

async function getTitleProperty(databaseId: string): Promise<string> {
  const db = await notionRequest<NotionDatabase>(`/databases/${databaseId}`, "GET");
  const titleProperty = Object.entries(db.properties ?? {}).find(([, value]) => value.type === "title");
  return titleProperty?.[0] ?? "Name";
}

function textBlock(text: string): Record<string, unknown> {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: text
        ? [{ type: "text", text: { content: text.slice(0, 1900) } }]
        : [],
    },
  };
}

function markdownBlocks(markdown: string): Record<string, unknown>[] {
  return markdown
    .split("\n")
    .slice(0, 80)
    .map((line) => textBlock(line));
}

export async function createNotionTask(input: {
  databaseId: string;
  title: string;
  body: string;
}): Promise<{ id: string; url?: string }> {
  const titleProperty = await getTitleProperty(input.databaseId);
  const page = await notionRequest<NotionPage>("/pages", "POST", {
    parent: { database_id: input.databaseId },
    properties: {
      [titleProperty]: {
        title: [{ text: { content: input.title.slice(0, 200) } }],
      },
    },
    children: markdownBlocks(input.body),
  });

  return { id: page.id, url: page.url };
}

export async function createNotionBriefing(input: {
  databaseId: string;
  title: string;
  markdown: string;
}): Promise<{ id: string; url?: string }> {
  const titleProperty = await getTitleProperty(input.databaseId);
  const page = await notionRequest<NotionPage>("/pages", "POST", {
    parent: { database_id: input.databaseId },
    properties: {
      [titleProperty]: {
        title: [{ text: { content: input.title.slice(0, 200) } }],
      },
    },
    children: markdownBlocks(input.markdown),
  });

  return { id: page.id, url: page.url };
}

export async function appendNotionPage(input: {
  pageId: string;
  markdown: string;
}): Promise<void> {
  await notionRequest(`/blocks/${input.pageId}/children`, "PATCH", {
    children: markdownBlocks(input.markdown),
  });
}
