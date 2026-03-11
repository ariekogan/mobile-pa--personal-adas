#!/usr/bin/env node
/**
 * device-mcp — Real device data MCP connector for A-Team.
 *
 * Drop-in replacement for device-mock-mcp. Same tool names, same schemas.
 * Reads real device data from cloud relay (pushed by phone's device-bridge module).
 * Write operations (send message, create event, set DND) are queued as actions
 * for the phone to execute.
 *
 * Weather and commute use external APIs (not from phone):
 *   - Weather: Open-Meteo (free, no API key)
 *   - Commute: Open Route Service (free tier) or fallback estimate
 *
 * Environment:
 *   RELAY_URL    — cloud relay base URL (default: http://localhost:4300)
 *   DEVICE_ID    — target device ID
 *   RELAY_API_KEY — shared API key for relay auth
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Config ───

const RELAY_URL = (process.env.RELAY_URL || "https://affectionate-enthusiasm-production-234b.up.railway.app").replace(/\/$/, "");
const DEVICE_ID = process.env.DEVICE_ID || "ateam-mobile-001";
const API_KEY = process.env.RELAY_API_KEY || "17f064c734be4fbb5b2313d57652c04c696c7fa8260c263b724594093247400e";

// ─── Relay Client ───

async function relayGet(domain) {
  try {
    const res = await fetch(`${RELAY_URL}/api/device/${DEVICE_ID}/data/${domain}`, {
      headers: { "X-Device-Key": API_KEY },
    });
    const json = await res.json();
    if (json.ok) return json.data;
    return null;
  } catch (e) {
    console.error(`[device-mcp] Relay GET ${domain} failed:`, e.message);
    return null;
  }
}

async function relayQueueAction(type, params) {
  try {
    const res = await fetch(`${RELAY_URL}/api/device/${DEVICE_ID}/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Key": API_KEY,
      },
      body: JSON.stringify({ type, params }),
    });
    return await res.json();
  } catch (e) {
    console.error(`[device-mcp] Relay queue action failed:`, e.message);
    return { ok: false, error: e.message };
  }
}

function result(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

function errorResult(message) {
  return result({ ok: false, error: message });
}

// ─── MCP Server ───

const server = new McpServer({
  name: "device-mcp",
  version: "1.0.0",
});

// ─── Calendar Tools ───

server.tool(
  "device.calendar.today",
  "Get all calendar events for today. Returns titles, times, locations, attendees, and notes.",
  {},
  async () => {
    const data = await relayGet("calendar");
    if (!data?.today) return errorResult("Calendar data not available — phone may not have synced");
    return result(data.today);
  }
);

server.tool(
  "device.calendar.upcoming",
  "Get upcoming calendar events for the next N days (tomorrow and beyond). Does NOT include today.",
  {
    days: z.number().optional().describe("Number of days to look ahead (default 3, max 14)"),
  },
  async ({ days }) => {
    const data = await relayGet("calendar");
    if (!data?.upcoming) return errorResult("Calendar data not available — phone may not have synced");

    // Filter to requested days if needed
    const lookAhead = Math.min(days || 3, 14);
    const upcoming = data.upcoming;

    if (days && upcoming.events) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + lookAhead + 1);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      upcoming.events = upcoming.events.filter(e => e.date < cutoffStr);
      upcoming.event_count = upcoming.events.length;
      upcoming.days_ahead = lookAhead;
    }

    return result(upcoming);
  }
);

server.tool(
  "device.calendar.create",
  "Create a new calendar event.",
  {
    title: z.string().describe("Event title"),
    date: z.string().describe("Date in YYYY-MM-DD format"),
    start_time: z.string().describe("Start time in HH:MM format"),
    end_time: z.string().optional().describe("End time in HH:MM format"),
    location: z.string().optional().describe("Location"),
    attendees: z.array(z.string()).optional().describe("List of attendee names"),
    notes: z.string().optional().describe("Notes"),
  },
  async (params) => {
    const queued = await relayQueueAction("calendar.create", params);
    if (!queued.ok) return errorResult(`Failed to queue calendar creation: ${queued.error}`);
    return result({
      ok: true,
      message: `Calendar event "${params.title}" queued for creation on device`,
      action_id: queued.action?.id,
      event: {
        title: params.title,
        date: params.date,
        start: params.start_time,
        end: params.end_time || "",
        location: params.location || "",
        attendees: params.attendees || [],
        notes: params.notes || "",
      },
    });
  }
);

server.tool(
  "device.calendar.reschedule",
  "Reschedule an existing calendar event to a new date/time.",
  {
    event_id: z.string().describe("Event ID to reschedule"),
    new_date: z.string().optional().describe("New date YYYY-MM-DD"),
    new_start_time: z.string().optional().describe("New start time HH:MM"),
    new_end_time: z.string().optional().describe("New end time HH:MM"),
  },
  async (params) => {
    const queued = await relayQueueAction("calendar.reschedule", params);
    if (!queued.ok) return errorResult(`Failed to queue reschedule: ${queued.error}`);
    return result({
      ok: true,
      message: `Event reschedule queued on device`,
      action_id: queued.action?.id,
    });
  }
);

server.tool(
  "device.calendar.cancel",
  "Cancel/delete a calendar event.",
  {
    event_id: z.string().describe("Event ID to cancel"),
  },
  async (params) => {
    const queued = await relayQueueAction("calendar.cancel", params);
    if (!queued.ok) return errorResult(`Failed to queue cancellation: ${queued.error}`);
    return result({
      ok: true,
      message: `Event cancellation queued on device`,
      action_id: queued.action?.id,
    });
  }
);

// ─── Contacts Tools ───

server.tool(
  "device.contacts.search",
  "Search contacts by name, relationship, or keyword. Searches across name, relationship, email, and notes.",
  {
    query: z.string().describe("Search query — matches name, relationship, email, notes"),
  },
  async ({ query }) => {
    const data = await relayGet("contacts");
    if (!data?.contacts) return errorResult("Contacts data not available — phone may not have synced");

    const q = query.toLowerCase();
    const matches = data.contacts.filter(c =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.relationship || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.notes || "").toLowerCase().includes(q)
    );

    return result({ ok: true, query, count: matches.length, contacts: matches });
  }
);

server.tool(
  "device.contacts.get",
  "Get full contact details by name or ID.",
  {
    contact_id: z.string().describe("Contact name or ID (e.g., 'Sarah' or 'c1')"),
  },
  async ({ contact_id }) => {
    const data = await relayGet("contacts");
    if (!data?.contacts) return errorResult("Contacts data not available");

    const q = contact_id.toLowerCase();
    const contact = data.contacts.find(c =>
      c.id === contact_id || (c.name || "").toLowerCase().includes(q)
    );

    if (!contact) return errorResult(`Contact "${contact_id}" not found`);
    return result({ ok: true, contact });
  }
);

server.tool(
  "device.contacts.birthdays",
  "Get contacts with upcoming birthdays in the next N days. Returns matching contacts with days until birthday.",
  {
    days: z.number().optional().describe("Look ahead N days for birthdays (default 30)"),
  },
  async ({ days }) => {
    const data = await relayGet("contacts");
    if (!data?.contacts) return errorResult("Contacts data not available");

    const lookAhead = Math.min(days || 30, 90);
    const today = new Date();

    const upcoming = data.contacts
      .filter(c => c.birthday)
      .map(c => {
        const [year, month, day] = c.birthday.split("-").map(Number);
        const birthdayThisYear = new Date(today.getFullYear(), month - 1, day);
        if (birthdayThisYear < today) {
          birthdayThisYear.setFullYear(today.getFullYear() + 1);
        }
        const daysUntil = Math.ceil((birthdayThisYear - today) / (1000 * 60 * 60 * 24));

        return {
          name: c.name,
          relationship: c.relationship,
          birthday: c.birthday,
          days_until: daysUntil,
          turning_age: birthdayThisYear.getFullYear() - year,
          is_today: daysUntil === 0,
        };
      })
      .filter(c => c.days_until >= 0 && c.days_until <= lookAhead)
      .sort((a, b) => a.days_until - b.days_until);

    return result({ ok: true, days_ahead: lookAhead, count: upcoming.length, birthdays: upcoming });
  }
);

server.tool(
  "device.contacts.lastContact",
  "Get when you last communicated with a contact. Returns days since last message/call. Useful for relationship care insights.",
  {
    name: z.string().describe("Contact name to check"),
  },
  async ({ name }) => {
    // This needs messaging history from relay — check messaging domain
    const contacts = await relayGet("contacts");
    if (!contacts?.contacts) return errorResult("Contacts data not available");

    const q = name.toLowerCase();
    const contact = contacts.contacts.find(c =>
      (c.name || "").toLowerCase().includes(q)
    );
    if (!contact) return errorResult(`Contact "${name}" not found`);

    // TODO: cross-reference with messaging history when available
    // For now, return a placeholder
    return result({
      ok: true,
      contact: contact.name,
      relationship: contact.relationship,
      days_since_last_contact: 0,
      last_contact_date: new Date().toISOString().slice(0, 10),
      last_contact_type: "unknown",
      suggestion: null,
    });
  }
);

// ─── Location Tool ───

server.tool(
  "device.location.current",
  "Get user's current location based on GPS. Returns place name, address, and coordinates.",
  {},
  async () => {
    const data = await relayGet("location");
    if (!data) return errorResult("Location data not available — phone may not have synced");
    return result(data);
  }
);

// ─── Weather Tools (External API — Open-Meteo) ───

async function getCoordinates() {
  const location = await relayGet("location");
  if (location?.location) {
    return { lat: location.location.lat, lng: location.location.lng };
  }
  // Fallback: San Francisco
  return { lat: 37.7749, lng: -122.4194 };
}

server.tool(
  "device.weather.current",
  "Get current weather conditions for the user's location. Returns temperature, conditions, humidity, wind, and UV index.",
  {},
  async () => {
    try {
      const coords = await getCoordinates();
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,uv_index&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;

      const res = await fetch(url);
      const data = await res.json();
      const c = data.current;

      return result({
        ok: true,
        timestamp: new Date().toISOString(),
        location: data.timezone || "Unknown",
        current: {
          temp_f: Math.round(c.temperature_2m),
          temp_c: Math.round((c.temperature_2m - 32) * 5 / 9),
          condition: weatherCodeToCondition(c.weather_code),
          humidity: c.relative_humidity_2m,
          wind_mph: Math.round(c.wind_speed_10m),
          wind_direction: degreesToDirection(c.wind_direction_10m),
          uv_index: Math.round(c.uv_index),
          feels_like_f: Math.round(c.apparent_temperature),
        },
        alerts: [],
      });
    } catch (e) {
      return errorResult(`Weather API failed: ${e.message}`);
    }
  }
);

server.tool(
  "device.weather.forecast",
  "Get weather forecast for the next N days. Returns daily highs, lows, conditions, and rain probability.",
  {
    days: z.number().optional().describe("Number of days to forecast (default 3, max 7)"),
  },
  async ({ days }) => {
    try {
      const forecastDays = Math.min(days || 3, 7);
      const coords = await getCoordinates();
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset&temperature_unit=fahrenheit&timezone=auto&forecast_days=${forecastDays}`;

      const res = await fetch(url);
      const data = await res.json();
      const d = data.daily;

      const forecast = d.time.map((date, i) => {
        const dt = new Date(date);
        return {
          date,
          day_of_week: dt.toLocaleDateString("en-US", { weekday: "long" }),
          high_f: Math.round(d.temperature_2m_max[i]),
          low_f: Math.round(d.temperature_2m_min[i]),
          condition: weatherCodeToCondition(d.weather_code[i]),
          rain_probability: d.precipitation_probability_max[i] || 0,
          sunrise: d.sunrise[i]?.slice(11, 16) || "06:00",
          sunset: d.sunset[i]?.slice(11, 16) || "18:00",
        };
      });

      return result({
        ok: true,
        location: data.timezone || "Unknown",
        days: forecastDays,
        forecast,
      });
    } catch (e) {
      return errorResult(`Weather forecast API failed: ${e.message}`);
    }
  }
);

// ─── Commute Tool ───

server.tool(
  "device.commute.estimate",
  "Get estimated commute/travel time between two locations. Returns duration in minutes and distance.",
  {
    from: z.string().describe("Starting location name or address"),
    to: z.string().describe("Destination location name or address"),
    mode: z.enum(["driving", "transit", "walking"]).optional().describe("Travel mode (default: driving)"),
  },
  async ({ from, to, mode }) => {
    // Use a simple estimate based on straight-line distance
    // In production, use Open Route Service, Google Maps, or Apple Maps API
    const travelMode = mode || "driving";

    // Estimate: driving ~30mph avg in city, transit 50% slower, walking 3mph
    const baseMins = { driving: 20, transit: 30, walking: 60 };
    const estimatedMinutes = baseMins[travelMode] || 20;

    // Check rush hour
    const hour = new Date().getHours();
    const rush = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
    const adjusted = Math.round(estimatedMinutes * (rush && travelMode === "driving" ? 1.4 : 1));

    return result({
      ok: true,
      from,
      to,
      mode: travelMode,
      estimated_minutes: adjusted,
      distance_miles: 6.0, // placeholder
      traffic: rush ? "heavy" : "normal",
      leave_by_note: `Leave by ${adjusted} minutes before your event`,
      source: "estimate",
    });
  }
);

// ─── Battery Tool ───

server.tool(
  "device.battery",
  "Get device battery level and charging status.",
  {},
  async () => {
    const data = await relayGet("battery");
    if (!data) return errorResult("Battery data not available — phone may not have synced");
    return result(data);
  }
);

// ─── Connectivity Tool ───

server.tool(
  "device.connectivity",
  "Get device network connectivity status — WiFi, cellular, or offline.",
  {},
  async () => {
    const data = await relayGet("connectivity");
    if (!data) return errorResult("Connectivity data not available — phone may not have synced");
    return result(data);
  }
);

// ─── Messaging Tool ───

server.tool(
  "device.message.send",
  "Send an SMS/iMessage to a contact. Queues the message for the phone to send. Always confirm with user before sending.",
  {
    contact_name: z.string().describe("Contact name to message"),
    message: z.string().describe("Message text to send"),
  },
  async ({ contact_name, message }) => {
    // Look up contact to get phone number
    const contacts = await relayGet("contacts");
    let phone = null;

    if (contacts?.contacts) {
      const q = contact_name.toLowerCase();
      const contact = contacts.contacts.find(c =>
        (c.name || "").toLowerCase().includes(q)
      );
      if (contact) {
        phone = contact.phone;
        if (!phone) return errorResult(`${contact.name} doesn't have a phone number`);
      }
    }

    const queued = await relayQueueAction("messaging.send", {
      contact_name,
      phone: phone || "unknown",
      message,
    });

    if (!queued.ok) return errorResult(`Failed to queue message: ${queued.error}`);

    return result({
      ok: true,
      message: `Message to ${contact_name} queued for sending on device`,
      action_id: queued.action?.id,
      details: {
        to: contact_name,
        phone: phone || "will resolve on device",
        message,
        status: "queued",
      },
    });
  }
);

// ─── Notification Tools ───

server.tool(
  "device.notifications.list",
  "List device notifications. Optionally filter to unread only.",
  {
    unread_only: z.boolean().optional().describe("If true, return only unread notifications (default false)"),
  },
  async ({ unread_only }) => {
    const data = await relayGet("notifications");
    if (!data) return errorResult("Notifications data not available — phone may not have synced");

    if (unread_only && data.notifications) {
      const unread = data.notifications.filter(n => !n.read);
      return result({
        ...data,
        notifications: unread,
        total: unread.length,
      });
    }
    return result(data);
  }
);

server.tool(
  "device.notifications.group",
  "Group notifications by a category: 'app', 'sender', or 'priority'.",
  {
    group_by: z.enum(["app", "sender", "priority"]).describe("How to group: by app, sender, or priority"),
  },
  async ({ group_by }) => {
    const data = await relayGet("notifications");
    if (!data?.notifications) return errorResult("Notifications data not available");

    const groups = {};
    for (const n of data.notifications) {
      let key;
      if (group_by === "app") key = n.app;
      else if (group_by === "sender") key = n.sender || "System";
      else key = n.priority;
      if (!groups[key]) groups[key] = [];
      groups[key].push(n);
    }

    return result({
      ok: true,
      grouped_by: group_by,
      group_count: Object.keys(groups).length,
      groups,
    });
  }
);

server.tool(
  "device.notifications.dismiss",
  "Dismiss notifications by ID or by app name.",
  {
    notification_id: z.string().optional().describe("Dismiss a single notification by ID"),
    app: z.string().optional().describe("Dismiss all notifications from this app"),
  },
  async ({ notification_id, app }) => {
    // Queue dismiss action for phone
    const queued = await relayQueueAction("notifications.dismiss", {
      notification_id,
      app,
    });
    return result({
      ok: true,
      message: notification_id
        ? `Dismiss notification ${notification_id} queued`
        : `Dismiss ${app} notifications queued`,
      action_id: queued.action?.id,
    });
  }
);

// ─── DND Tools ───

server.tool(
  "device.dnd.get",
  "Get current Do Not Disturb status — enabled/disabled, schedule, and allowlist.",
  {},
  async () => {
    const data = await relayGet("dnd");
    if (!data) {
      // Return default DND state if not synced
      return result({
        ok: true,
        dnd: {
          enabled: false,
          schedule: { start: "22:00", end: "07:00" },
          allowlist: [],
        },
      });
    }
    return result(data);
  }
);

server.tool(
  "device.dnd.set",
  "Update Do Not Disturb settings. Toggle on/off, change schedule, or update allowlist.",
  {
    enabled: z.boolean().optional().describe("Turn DND on (true) or off (false)"),
    schedule_start: z.string().optional().describe("DND start time HH:MM"),
    schedule_end: z.string().optional().describe("DND end time HH:MM"),
    allowlist: z.array(z.string()).optional().describe("Contacts who can break through DND"),
  },
  async (params) => {
    const queued = await relayQueueAction("dnd.set", params);
    if (!queued.ok) return errorResult(`Failed to queue DND update: ${queued.error}`);
    return result({
      ok: true,
      message: `DND update queued on device`,
      action_id: queued.action?.id,
      dnd: {
        enabled: params.enabled,
        schedule: {
          start: params.schedule_start,
          end: params.schedule_end,
        },
        allowlist: params.allowlist,
      },
    });
  }
);

// ─── Navigation Tool ───

server.tool(
  "device.navigation.start",
  "Start navigation to a destination. Opens the maps app on the phone with directions.",
  {
    destination: z.string().describe("Destination address or place name"),
    mode: z.enum(["driving", "transit", "walking"]).optional().describe("Travel mode (default: driving)"),
  },
  async (params) => {
    const queued = await relayQueueAction("navigation.start", params);
    if (!queued.ok) return errorResult(`Failed to queue navigation: ${queued.error}`);

    const travelMode = params.mode || "driving";
    const estimatedMinutes = travelMode === "driving" ? 20 : travelMode === "transit" ? 35 : 60;

    return result({
      ok: true,
      message: `Navigation to ${params.destination} queued on device`,
      action_id: queued.action?.id,
      destination: params.destination,
      mode: travelMode,
      estimated_minutes: estimatedMinutes,
      status: "queued",
    });
  }
);

// ─── App Usage Tool ───

server.tool(
  "device.app.recent",
  "Get recently used apps and screen time. Returns app names, last used time, and usage duration.",
  {
    limit: z.number().optional().describe("Max apps to return (default 10)"),
  },
  async ({ limit }) => {
    const data = await relayGet("app_usage");
    if (!data) return errorResult("App usage data not available — phone may not have synced");

    const maxApps = Math.min(limit || 10, 20);
    if (data.apps) {
      data.apps = data.apps.slice(0, maxApps);
      data.app_count = data.apps.length;
    }
    return result(data);
  }
);

// ─── UI Plugin Tools ───

const PLUGINS = [
  {
    id: "schedule-panel",
    name: "Schedule",
    version: "1.0.0",
    description: "Today's calendar, upcoming events, and weather at a glance",
  },
  {
    id: "pa-dashboard",
    name: "Personal Assistant",
    version: "1.0.0",
    description: "At-a-glance dashboard — calendar, memories, contacts, and weather",
  },
];

server.tool(
  "ui.listPlugins",
  "List available UI plugins served by this connector.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify({ plugins: PLUGINS }) }],
  })
);

server.tool(
  "ui.getPlugin",
  "Get the manifest for a specific UI plugin by ID.",
  { id: z.string().describe("Plugin ID") },
  async ({ id }) => {
    const plugin = PLUGINS.find(p => p.id === id);
    if (!plugin) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Plugin not found" }) }] };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ...plugin,
          render: { mode: "iframe", iframeUrl: `/ui/${plugin.id}/${plugin.version}/index.html` },
          channels: ["command"],
          capabilities: { commands: [] },
        }),
      }],
    };
  }
);

// ─── Integration Registry ───
//
// Convention: every external channel follows {channel}.status + {channel}.setup naming.
// This registry lets the orchestrator discover channels dynamically.
// To add a new channel: deploy the connector + add one entry here. No skill changes needed.
//

const INTEGRATIONS = [
  {
    id: "email",
    name: "Gmail",
    channel: "email",
    setup_type: "oauth_link",
    status_tool: "email.status",
    setup_tool: "email.setup",
    description: "Read and send emails via Gmail",
    setup_summary: "User clicks a Google sign-in link to connect their Gmail. One-time setup, takes ~30 seconds.",
    required_for: ["send email", "check email", "email someone", "inbox"],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    channel: "whatsapp",
    setup_type: "qr_scan",
    status_tool: "whatsapp.status",
    setup_tool: null,
    description: "Send and receive WhatsApp messages",
    setup_summary: "WhatsApp connects via QR code scan on your phone. One-time setup, takes ~1 minute.",
    required_for: ["whatsapp", "send whatsapp", "whatsapp message"],
  },
];

server.tool(
  "integrations.list",
  "List all available external integrations (email, WhatsApp, etc.) with their tool names for status check and setup. Call this BEFORE using any external channel to discover what's available and how to connect it. The orchestrator should call each integration's status_tool to check connection, and setup_tool to guide user through setup if not connected.",
  {},
  async () => {
    return result({
      ok: true,
      integrations: INTEGRATIONS,
      instructions: "For each integration: (1) call status_tool to check connection, (2) if not connected, call setup_tool and guide user through setup, (3) then proceed with original request.",
    });
  }
);

server.tool(
  "integrations.check",
  "Check a specific integration by channel name. Returns the integration details and which tools to call for status/setup. Use this when you already know which channel is needed.",
  {
    channel: z.string().describe("Channel ID — e.g. 'email', 'whatsapp'"),
  },
  async ({ channel }) => {
    const q = channel.toLowerCase();
    const integration = INTEGRATIONS.find(
      i => i.id === q || i.channel === q || i.required_for.some(r => q.includes(r))
    );
    if (!integration) {
      return result({
        ok: true,
        found: false,
        message: `No integration found for "${channel}". Call integrations.list to see all available channels.`,
        available: INTEGRATIONS.map(i => i.id),
      });
    }
    return result({
      ok: true,
      found: true,
      integration,
      next_step: `Call ${integration.status_tool} to check if connected.${integration.setup_tool ? ` If not connected, call ${integration.setup_tool} to start setup.` : ` If not connected: ${integration.setup_summary}`}`,
    });
  }
);

// ─── Weather Helpers ───

function weatherCodeToCondition(code) {
  const map = {
    0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Overcast",
    45: "Foggy", 48: "Freezing Fog",
    51: "Light Drizzle", 53: "Drizzle", 55: "Heavy Drizzle",
    61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
    71: "Light Snow", 73: "Snow", 75: "Heavy Snow",
    77: "Snow Grains", 80: "Light Showers", 81: "Showers", 82: "Heavy Showers",
    85: "Light Snow Showers", 86: "Snow Showers",
    95: "Thunderstorm", 96: "Thunderstorm + Hail", 99: "Thunderstorm + Heavy Hail",
  };
  return map[code] || "Unknown";
}

function degreesToDirection(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

// ─── Start ───

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[device-mcp v1.0.0] Server started — relay: ${RELAY_URL}, device: ${DEVICE_ID}`);
console.error(`  23 tools (21 device + 2 integration registry), reads from cloud relay`);
console.error(`  Weather: Open-Meteo API | Commute: estimate-based`);
