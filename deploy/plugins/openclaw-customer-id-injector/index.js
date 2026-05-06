import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SESSION_KEY_RE = /^agent:([^:]+):([^:]+):direct:(.+)$/;

function canonicalLineUid(raw) {
  if (/^[uU][0-9a-f]{32}$/.test(raw)) return "U" + raw.slice(1).toLowerCase();
  return raw;
}

function parseSessionKey(sessionKey) {
  if (!sessionKey) return null;
  const m = sessionKey.match(SESSION_KEY_RE);
  if (!m) return null;
  return { agentId: m[1], channel: m[2], userId: canonicalLineUid(m[3]) };
}

function resolveWorkspaceDir(api, agentId) {
  try {
    const list = api.config?.agents?.list ?? [];
    const entry = list.find((a) => a?.id === agentId);
    const ws = entry?.workspace;
    if (typeof ws === "string" && ws.length > 0) return ws;
  } catch {
    /* ignore */
  }
  return null;
}

function isWikiPersonMode(workspaceDir) {
  const path = join(workspaceDir, "AGENTS.md");
  if (!existsSync(path)) return false;
  try {
    const content = readFileSync(path, "utf-8");
    const start = content.indexOf("<!-- cs:memory-mode:start -->");
    const end = content.indexOf("<!-- cs:memory-mode:end -->");
    if (start < 0 || end <= start) return false;
    return /###\s+客戶長期記憶（wiki person/.test(content.slice(start, end));
  } catch {
    return false;
  }
}

function buildEntityStub(userId) {
  const now = new Date().toISOString();
  return [
    "---",
    "pageType: entity",
    "entityType: person",
    `id: entity.customer-line-${userId}`,
    `canonicalId: line.${userId}`,
    "aliases:",
    `  - ${userId}`,
    "privacyTier: confirm-before-use",
    `lastRefreshedAt: "${now}"`,
    "personCard:",
    "  handles:",
    `    - line:${userId}`,
    "  timezone: Asia/Taipei",
    "  confidence: 0.4",
    "claims: []",
    "relationships: []",
    "---",
    "",
    `# Customer ${userId}`,
    "",
    `Auto-created stub by customer-id-injector on first inbound message at ${now}.`,
    "",
    "The AI client agent is expected to fill this page in via `wiki_apply` as it",
    "learns facts during conversation. Anything written here is by the AI from",
    "customer messages — treat as confirm-before-use.",
    "",
  ].join("\n");
}

function readCustomerEntity(workspaceDir, userId, entitiesSubpath) {
  const path = join(workspaceDir, entitiesSubpath, `customer-line-${userId}.md`);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function ensureCustomerStub(workspaceDir, userId, entitiesSubpath, log) {
  try {
    const dir = join(workspaceDir, entitiesSubpath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filename = `customer-line-${userId}.md`;
    const path = join(dir, filename);
    if (existsSync(path)) return false;
    writeFileSync(path, buildEntityStub(userId), "utf-8");
    if (log) console.log(`[customer-id-injector] created entity stub: ${path}`);
    return true;
  } catch (err) {
    try { console.error(`[customer-id-injector] stub create failed: ${String(err)}`); } catch {}
    return false;
  }
}

export default definePluginEntry({
  id: "customer-id-injector",
  name: "Customer ID Injector",
  description:
    "Overrides user_id (mem0) and entity path (wiki) on customer-memory tool calls with the actual channel senderId derived from the session key.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      memToolPrefix: { type: "string" },
      wikiToolNames: { type: "array", items: { type: "string" } },
      wikiPathField: { type: "string" },
      wikiCustomerPathTemplate: { type: "string" },
      logOverrides: { type: "boolean" },
      channels: { type: "array", items: { type: "string" } },
      ensureWikiPersonStub: { type: "boolean" },
      wikiEntitiesSubpath: { type: "string" },
      injectWikiPersonContext: { type: "boolean" },
    },
  },
  register(api) {
    api.on("message_received", (_event, ctx) => {
      try {
        const cfg = api.pluginConfig ?? {};
        if (cfg.ensureWikiPersonStub === false) return;
        const channelAllow = cfg.channels ?? ["line"];
        const entitiesSubpath = cfg.wikiEntitiesSubpath ?? "wiki/entities";
        const log = cfg.logOverrides !== false;

        const session = parseSessionKey(ctx.sessionKey);
        if (!session) return;
        if (channelAllow.length > 0 && !channelAllow.includes(session.channel)) return;

        const ws = resolveWorkspaceDir(api, session.agentId);
        if (!ws) return;

        if (!isWikiPersonMode(ws)) return;
        ensureCustomerStub(ws, session.userId, entitiesSubpath, log);
      } catch (err) {
        try { console.error(`[customer-id-injector] message_received error: ${String(err)}`); } catch {}
      }
    });

    api.on("before_prompt_build", (_event, ctx) => {
      try {
        const cfg = api.pluginConfig ?? {};
        const log = cfg.logOverrides !== false;
        if (cfg.injectWikiPersonContext === false) {
          if (log) console.log(`[customer-id-injector] before_prompt_build: disabled by config`);
          return;
        }
        const channelAllow = cfg.channels ?? ["line"];
        const entitiesSubpath = cfg.wikiEntitiesSubpath ?? "wiki/entities";

        const session = parseSessionKey(ctx.sessionKey);
        if (!session) {
          if (log) console.log(`[customer-id-injector] before_prompt_build: sessionKey=${ctx.sessionKey ?? "unset"} (not customer session)`);
          return;
        }
        if (channelAllow.length > 0 && !channelAllow.includes(session.channel)) {
          if (log) console.log(`[customer-id-injector] before_prompt_build: channel ${session.channel} not in allowlist`);
          return;
        }

        const ws = resolveWorkspaceDir(api, session.agentId);
        if (!ws) {
          if (log) console.log(`[customer-id-injector] before_prompt_build: workspace not found for agent ${session.agentId}`);
          return;
        }
        if (!isWikiPersonMode(ws)) {
          if (log) console.log(`[customer-id-injector] before_prompt_build: agent ${session.agentId} not in wiki-person mode`);
          return;
        }

        const entity = readCustomerEntity(ws, session.userId, entitiesSubpath);
        if (!entity) {
          if (log) console.log(`[customer-id-injector] before_prompt_build: no entity file for ${session.userId}`);
          return;
        }
        if (log) console.log(`[customer-id-injector] before_prompt_build: injecting profile for ${session.userId} (${entity.length} bytes)`);

        const note = [
          "",
          "<!-- customer-id-injector: profile injected -->",
          `## Customer profile (auto-loaded from wiki entity: customer-line-${session.userId})`,
          "",
          "Below is everything we know about the customer who just messaged. Use it to",
          "personalize your reply (preferences, constraints, prior asks). After replying,",
          "if you learned new facts, call `wiki_apply` to update the entity. **Do not**",
          "call `wiki_get` for this entity — it has already been loaded for you below.",
          "",
          "```yaml",
          entity.trim(),
          "```",
          "",
        ].join("\n");

        return { appendContext: note };
      } catch (err) {
        try { console.error(`[customer-id-injector] before_prompt_build error: ${String(err)}`); } catch {}
      }
    });

    api.on("before_tool_call", (event, ctx) => {
      try {
        const cfg = api.pluginConfig ?? {};
        const memPrefix = cfg.memToolPrefix ?? "openclaw-mem0__";
        const wikiTools = cfg.wikiToolNames ?? ["wiki_get", "wiki_apply"];
        const wikiPathField = cfg.wikiPathField ?? "id";
        const pathTemplate = cfg.wikiCustomerPathTemplate ?? "entity.customer-line-{userId}";
        const channelAllow = cfg.channels ?? ["line"];
        const log = cfg.logOverrides !== false;

        const isMemTool = event.toolName.startsWith(memPrefix);
        const isWikiTool = wikiTools.includes(event.toolName);
        if (!isMemTool && !isWikiTool) return;

        const session = parseSessionKey(ctx.sessionKey);
        if (!session) return;
        if (channelAllow.length > 0 && !channelAllow.includes(session.channel)) return;

        if (isMemTool) {
          const ws = resolveWorkspaceDir(api, session.agentId);
          if (ws && isWikiPersonMode(ws)) {
            if (log) console.log(`[customer-id-injector] blocked ${event.toolName}: agent is in wiki-person mode`);
            return {
              block: true,
              blockReason: `Customer-memory backend is set to wiki-person mode. Use wiki_apply (or wiki_get) on entity.customer-line-${session.userId} instead of mem0 tools. The entity profile is already loaded in your context.`,
            };
          }
        }

        const params = { ...event.params };
        let changed = false;

        if (isMemTool) {
          if (params.user_id !== session.userId) {
            const before = params.user_id;
            params.user_id = session.userId;
            changed = true;
            if (log) {
              console.log(
                `[customer-id-injector] ${event.toolName}: user_id ${String(before) || "(unset)"} → ${session.userId}`,
              );
            }
          }
        }

        if (isWikiTool) {
          const expected = pathTemplate.replace("{userId}", session.userId);
          const cur = typeof params[wikiPathField] === "string" ? params[wikiPathField] : "";
          if (cur.startsWith("entity.customer-") && cur !== expected) {
            const before = cur;
            params[wikiPathField] = expected;
            changed = true;
            if (log) {
              console.log(
                `[customer-id-injector] ${event.toolName}: ${wikiPathField} ${before} → ${expected}`,
              );
            }
          }
        }

        if (changed) return { params };
      } catch (err) {
        try { console.error(`[customer-id-injector] error: ${String(err)}`); } catch {}
      }
    });
  },
});
