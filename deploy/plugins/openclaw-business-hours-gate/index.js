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
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
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

export default definePluginEntry({
  id: "business-hours-gate",
  name: "Business Hours Gate",
  description:
    "Claims inbound messages during configured business hours so human staff handles them; AI is silenced or sends a canned reply.",
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
    },
  },
  register(api) {
    api.on("before_dispatch", async (event, ctx) => {
      try {
        const cfg = api.pluginConfig ?? {};

        if (cfg.channels && cfg.channels.length > 0) {
          const channelId = ctx.channelId ?? event.channel;
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
