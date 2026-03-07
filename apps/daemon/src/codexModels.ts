import * as child_process from "node:child_process";
import * as readline from "node:readline";

export interface CodexModelRecord {
  id: string;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
}

function augmentedEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const extraDirs = [
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.cargo/bin`,
    `${home}/.bun/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const currentPath = process.env.PATH ?? "/usr/bin:/bin";
  return {
    ...process.env,
    PATH: [...extraDirs, currentPath].join(":"),
  };
}

export async function listCodexModels(timeoutMs = 15000): Promise<CodexModelRecord[]> {
  return await new Promise<CodexModelRecord[]>((resolve, reject) => {
    const child = child_process.spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "ignore"],
      env: augmentedEnv(),
    });
    const rl = child.stdout
      ? readline.createInterface({ input: child.stdout })
      : undefined;

    let done = false;

    const finish = (err?: Error, models?: CodexModelRecord[]): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        rl?.close();
      } catch {
        // no-op
      }
      try {
        child.kill("SIGTERM");
      } catch {
        // no-op
      }
      if (err) {
        reject(err);
        return;
      }
      resolve(models ?? []);
    };

    const timer = setTimeout(() => {
      finish(new Error("Codex model list timed out"));
    }, timeoutMs);

    child.on("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });

    child.on("exit", (code, signal) => {
      if (done) return;
      finish(new Error(`Codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "none"})`));
    });

    rl?.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg["id"] === 1) {
        if (msg["error"]) {
          finish(new Error("Codex initialize failed"));
          return;
        }
        child.stdin?.write(JSON.stringify({ method: "initialized" }) + "\n");
        child.stdin?.write(
          JSON.stringify({
            id: 2,
            method: "model/list",
            params: {
              limit: 200,
            },
          }) + "\n",
        );
        return;
      }

      if (msg["id"] === 2) {
        if (msg["error"]) {
          finish(new Error("Codex model/list failed"));
          return;
        }
        const result = msg["result"] as Record<string, unknown> | undefined;
        const rawData = Array.isArray(result?.["data"]) ? result["data"] : [];
        const seen = new Set<string>();
        const models: CodexModelRecord[] = [];

        for (const rawItem of rawData) {
          if (!rawItem || typeof rawItem !== "object") continue;
          const item = rawItem as Record<string, unknown>;
          const id = typeof item["id"] === "string" ? item["id"].trim() : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          models.push({
            id,
            displayName: typeof item["displayName"] === "string" && item["displayName"].trim().length > 0
              ? item["displayName"].trim()
              : id,
            hidden: item["hidden"] === true,
            isDefault: item["isDefault"] === true,
          });
        }
        finish(undefined, models);
      }
    });

    child.stdin?.write(
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "openvide-daemon",
            version: "0.1.7",
          },
          capabilities: {},
        },
      }) + "\n",
    );
  });
}
