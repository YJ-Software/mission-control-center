import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const DAY_INDEX = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function parseHHMM(value) {
  const m = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function nowInTimezone(tz) {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const dayShort = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayIdx = map[dayShort];
    if (dayIdx === undefined) return null;
    const hourFixed = hour === 24 ? 0 : hour;
    return { dayIdx, minutes: hourFixed * 60 + minute };
  } catch {
    return null;
  }
}

function isWithinWindow(now, win) {
  if (!win.days.some((d) => DAY_INDEX[d] === now.dayIdx)) return false;
  const start = parseHHMM(win.start);
  const end = parseHHMM(win.end);
  if (start === null || end === null) return false;
  if (end <= start) return now.minutes >= start || now.minutes < end;
  return now.minutes >= start && now.minutes < end;
}

/** Best-effort extraction of a LINE userId from the heterogenous event shapes
 *  openclaw hands the plugin. We probe the well-known places without assuming
 *  any single layout. */
function extractUserId(event, ctx) {
  return (
    event?.source?.userId ??
    event?.userId ??
    ctx?.userId ??
    ctx?.user?.id ??
    ctx?.source?.userId ??
    null
  );
}

function extractText(event) {
  if (typeof event?.message?.text === "string") return event.message.text;
  if (typeof event?.text === "string") return event.text;
  return null;
}

function extractType(event) {
  return event?.message?.type ?? event?.type ?? "other";
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fail-open: any error means we let the agent reply as if no pause was set. */
async function checkPause(mccBaseUrl, userId) {
  if (!mccBaseUrl || !userId) return false;
  try {
    const res = await fetchWithTimeout(
      `${mccBaseUrl}/api/customer-service/cs-pause-check?userId=${encodeURIComponent(userId)}`,
      {},
      300,
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.paused === true;
  } catch {
    return false;
  }
}

/** Best-effort mirror; never blocks dispatch. */
function mirrorInbound(mccBaseUrl, payload) {
  if (!mccBaseUrl) return;
  fetchWithTimeout(
    `${mccBaseUrl}/api/customer-service/cs-event`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    1000,
  ).catch(() => {});
}

export default definePluginEntry({
  id: "business-hours-gate",
  name: "Business Hours Gate",
  description:
    "Claims inbound messages during configured business hours so human staff handles them; AI is silenced or sends a canned reply. Also mirrors LINE events to Mission Control and honours per-user operator pause flags.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      schedule: {
        type: "object",
        additionalProperties: false,
        properties: {
          timezone: { type: "string" },
          windows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["days", "start", "end"],
              properties: {
                days: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                  },
                },
                start: { type: "string" },
                end: { type: "string" },
              },
            },
          },
        },
      },
      replyText: { type: "string" },
      channels: { type: "array", items: { type: "string" } },
      pauseAi: { type: "boolean" },
      // Mission Control integration. When unset, the cs-event mirror
      // and per-user pause check are skipped — plugin behaves like the
      // legacy hours-only gate.
      mccBaseUrl: { type: "string" },
    },
  },
  register(api) {
    api.on("before_dispatch", async (event, ctx) => {
      try {
        const cfg = api.pluginConfig ?? {};
        const mccBaseUrl = cfg.mccBaseUrl ?? "http://127.0.0.1:3737";

        if (cfg.channels && cfg.channels.length > 0) {
          const channelId = ctx.channelId ?? event.channel;
          if (!channelId || !cfg.channels.includes(channelId)) return;
        }

        // Mirror inbound event to MCC for the Conversations tab.
        const userId = extractUserId(event, ctx);
        if (userId && mccBaseUrl) {
          mirrorInbound(mccBaseUrl, {
            userId,
            direction: "user",
            type: extractType(event),
            text: extractText(event),
            lineMessageId: event?.message?.id ?? null,
            channelId: ctx?.channelId ?? event?.channel ?? null,
          });
        }

        // Per-user operator pause — silences the agent on this turn. MCC
        // owns the resume schedule; we just consult it here.
        if (userId && (await checkPause(mccBaseUrl, userId))) {
          return { handled: true };
        }

        if (cfg.pauseAi === true) {
          const text = cfg.replyText?.trim();
          return text ? { handled: true, text } : { handled: true };
        }

        const windows = cfg.schedule?.windows ?? [];
        if (windows.length === 0) return;

        const tz = cfg.schedule?.timezone ?? "Asia/Taipei";
        const now = nowInTimezone(tz);
        if (!now) return;

        const inWindow = windows.some((w) => isWithinWindow(now, w));
        if (!inWindow) return;

        const text = cfg.replyText?.trim();
        return text ? { handled: true, text } : { handled: true };
      } catch {
        return;
      }
    });
  },
});
