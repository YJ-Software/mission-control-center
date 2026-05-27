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

/** Extract LINE userId from openclaw 2026.5.x's before_dispatch event shape.
 *  Field order: senderId is the canonical case-preserving userId; conversationId
 *  is the same value for direct chats; fall through to legacy LINE-webhook
 *  shapes for older openclaw versions. */
function extractUserId(event, ctx) {
  return (
    event?.senderId ??
    ctx?.senderId ??
    ctx?.conversationId ??
    event?.source?.userId ??
    event?.userId ??
    ctx?.userId ??
    null
  );
}

function extractText(event) {
  if (typeof event?.content === "string") return event.content;
  if (typeof event?.body === "string") return event.body;
  if (typeof event?.message?.text === "string") return event.message.text;
  if (typeof event?.text === "string") return event.text;
  return null;
}

function extractType(event) {
  // openclaw normalises rich LINE events to a "<media:<kind>>" placeholder
  // in `content`. Pull the kind back out.
  const content = event?.content ?? event?.body;
  if (typeof content === "string") {
    const m = content.match(/^<media:([a-z]+)>$/);
    if (m) {
      const kind = m[1];
      if (kind === "document") return "file";
      if (["image", "video", "audio", "file", "sticker", "location"].includes(kind)) return kind;
      return "file";
    }
  }
  const lineType = event?.messageType ?? event?.message?.type;
  if (typeof lineType === "string") {
    if (["image", "video", "audio", "file", "sticker", "location"].includes(lineType)) return lineType;
  }
  if (typeof content === "string") return "text";
  return event?.type ?? "other";
}

function extractMessageId(event, ctx) {
  return event?.messageId
    ?? event?.metadata?.messageId
    ?? ctx?.messageId
    ?? event?.message?.id
    ?? event?.id
    ?? null;
}

/** When the type is a media placeholder we don't want to record "<media:image>"
 *  as the message text — only real user text should land in cs_messages.text. */
function extractTextNonMedia(event) {
  const content = event?.content ?? event?.body;
  if (typeof content !== "string") return null;
  if (content.startsWith("<media:")) return null;
  return content;
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
  ).then((res) => {
    if (!res.ok) console.warn(`[business-hours-gate] cs-event mirror returned ${res.status}`);
  }).catch((err) => {
    console.warn(`[business-hours-gate] cs-event mirror error: ${err?.message ?? err}`);
  });
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
    // message_received fires earlier than before_dispatch and crucially
    // exposes the LINE messageId — without that we can't pull media
    // binary back from LINE Content API. We use it as the canonical
    // inbound mirror hook and reduce before_dispatch to only the
    // pause-gate check below.
    api.on("message_received", async (event, ctx) => {
      try {
        const cfg = api.pluginConfig ?? {};
        const mccBaseUrl = cfg.mccBaseUrl ?? "http://127.0.0.1:3737";
        const userId = extractUserId(event, ctx);
        if (!userId || !mccBaseUrl) return;
        mirrorInbound(mccBaseUrl, {
          userId,
          direction: "user",
          type: extractType(event),
          text: extractTextNonMedia(event),
          lineMessageId: extractMessageId(event, ctx),
          channelId: ctx?.channelId ?? event?.channel ?? null,
          rawEvent: event,
        });
      } catch { /* best-effort, never block */ }
    });

    // Outbound bot reply mirror — fires when openclaw is about to send a
    // message to the channel (LINE, Telegram, etc). Capture text content
    // so the Conversations tab shows what the agent answered.
    api.on("message_sending", async (event, ctx) => {
      try {
        const cfg = api.pluginConfig ?? {};
        const mccBaseUrl = cfg.mccBaseUrl ?? "http://127.0.0.1:3737";
        const userId = extractUserId(event, ctx);
        if (!userId || !mccBaseUrl) return;
        mirrorInbound(mccBaseUrl, {
          userId,
          direction: "bot",
          type: extractType(event),
          text: extractText(event),
          lineMessageId: extractMessageId(event),
          channelId: ctx?.channelId ?? event?.channel ?? null,
        });
      } catch {
        // best-effort — never block the send
      }
    });

    api.on("before_dispatch", async (event, ctx) => {
      try {
        const cfg = api.pluginConfig ?? {};
        const mccBaseUrl = cfg.mccBaseUrl ?? "http://127.0.0.1:3737";
        const channelId = ctx?.channelId ?? event?.channel ?? null;
        const userId = extractUserId(event, ctx);

        // Inbound mirroring lives in message_received above (it has the
        // messageId we need for LINE Content API). before_dispatch only
        // exists to enforce slash-command blocking and per-user operator
        // pause.

        // Block customer-initiated openclaw slash commands (/status,
        // /reset, /help, /think, /model, …). Without this, anything a
        // LINE customer sends starting with "/" gets parsed by openclaw's
        // built-in command dispatcher and the response (often internal
        // status info) goes back to the customer. We swallow the message
        // entirely — the inbound was already mirrored in message_received
        // above, so it still shows up in the Conversations tab and the
        // operator can decide whether to reply manually.
        const inboundText = extractTextNonMedia(event);
        if (typeof inboundText === "string" && /^\s*\//.test(inboundText)) {
          return { handled: true };
        }

        // Per-user operator pause — silences the agent on this turn. MCC
        // owns the resume schedule; we just consult it here. Runs regardless
        // of channel filter so a paused user is always honoured.
        if (userId && (await checkPause(mccBaseUrl, userId))) {
          return { handled: true };
        }

        // Channel filter scopes only the *gating* behaviour (hours / pauseAi)
        // below. Mirroring + per-user pause check above were applied
        // unconditionally so the Conversations tab always sees real traffic.
        if (cfg.channels && cfg.channels.length > 0) {
          if (!channelId || !cfg.channels.includes(channelId)) return;
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
