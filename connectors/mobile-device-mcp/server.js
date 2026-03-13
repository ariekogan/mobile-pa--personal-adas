#!/usr/bin/env node
// mobile-device-mcp — Mock device data for Personal Adas
// Simulates calendar, contacts, location, and messaging from a mobile device.
// All data is in-memory mock data — will be replaced with real device APIs later.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Mock Data ───

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function dayAfterTomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

const CONTACTS = [
  {
    id: "c1", name: "Sarah Johnson", relationship: "wife", phone: "+1-555-0101",
    email: "sarah.j@gmail.com", birthday: "1991-06-15",
    notes: "Loves Italian food. Anniversary is March 6.",
  },
  {
    id: "c2", name: "Mark Chen", relationship: "boss", phone: "+1-555-0102",
    email: "mark.chen@company.com", birthday: "1985-11-22",
    notes: "VP of Engineering. Prefers Slack for quick messages.",
  },
  {
    id: "c3", name: "Dorothy Kogan", relationship: "mother", phone: "+1-555-0103",
    email: "dorothy.k@gmail.com", birthday: "1958-04-10",
    notes: "Lives in Brooklyn. Call every Sunday.",
  },
  {
    id: "c4", name: "Dr. Adam Smith", relationship: "dentist", phone: "+1-555-0104",
    email: "office@downtowndental.com", birthday: null,
    notes: "Downtown Dental, 450 Main St. Regular cleanings every 6 months.",
  },
  {
    id: "c5", name: "Lisa Park", relationship: "colleague", phone: "+1-555-0105",
    email: "lisa.park@company.com", birthday: "1992-08-30",
    notes: "Frontend lead. Working on the dashboard redesign together.",
  },
  {
    id: "c6", name: "Jake", relationship: "son", phone: null,
    email: null, birthday: "2018-09-12",
    notes: "Goes to St. Mary's Elementary. Loves dinosaurs.",
  },
  {
    id: "c7", name: "Emma", relationship: "daughter", phone: null,
    email: null, birthday: "2016-03-28",
    notes: "Goes to St. Mary's Elementary. Soccer practice on Tuesdays and Thursdays.",
  },
  {
    id: "c8", name: "David Kim", relationship: "friend", phone: "+1-555-0108",
    email: "david.k@gmail.com", birthday: "1990-07-04",
    notes: "College friend. Lives nearby. Monthly poker night.",
  },
];

function getTodayEvents() {
  return [
    {
      id: "e1", title: "Team standup", date: todayStr(),
      start: "09:00", end: "09:30", location: "Office - Room 4B",
      attendees: ["Mark Chen", "Lisa Park"],
      notes: "Sprint review + blockers discussion",
    },
    {
      id: "e2", title: "Dentist appointment", date: todayStr(),
      start: "11:00", end: "12:00", location: "Downtown Dental, 450 Main St",
      attendees: [], notes: "Regular cleaning with Dr. Smith",
    },
    {
      id: "e3", title: "1:1 with Mark", date: todayStr(),
      start: "14:00", end: "14:30", location: "Mark's office",
      attendees: ["Mark Chen"], notes: "Q2 planning discussion",
    },
    {
      id: "e4", title: "School pickup - Emma & Jake", date: todayStr(),
      start: "15:30", end: "16:00", location: "St. Mary's Elementary, 200 Oak Ave",
      attendees: [], notes: "Emma needs her soccer bag today",
    },
    {
      id: "e5", title: "Dinner with Sarah", date: todayStr(),
      start: "19:00", end: "21:00", location: "Trattoria Milano, 88 Harbor Blvd",
      attendees: ["Sarah Johnson"], notes: "Anniversary dinner — reservation under Kogan",
    },
  ];
}

function getUpcomingEvents() {
  return [
    {
      id: "e6", title: "All-hands meeting", date: tomorrowStr(),
      start: "10:00", end: "11:00", location: "Main conference room",
      attendees: ["Mark Chen", "Lisa Park"],
      notes: "Q1 results presentation",
    },
    {
      id: "e7", title: "Lunch with Mom", date: tomorrowStr(),
      start: "12:30", end: "14:00", location: "Café Deluxe, 33 Park Ave",
      attendees: ["Dorothy Kogan"],
      notes: "Mom's birthday lunch — she turns 68!",
    },
    {
      id: "e8", title: "Emma's soccer practice", date: tomorrowStr(),
      start: "16:00", end: "17:30", location: "Riverside Park Field 3",
      attendees: [], notes: "Bring water bottles and snacks",
    },
    {
      id: "e9", title: "Poker night", date: dayAfterTomorrowStr(),
      start: "20:00", end: "23:00", location: "David's place",
      attendees: ["David Kim"],
      notes: "Monthly poker night — David is hosting",
    },
  ];
}

// Dynamic created events (in-memory)
const createdEvents = [];

// Sent messages log
const sentMessages = [];

// ─── Mock Notifications ───

function getNotifications() {
  const now = new Date();
  const mins = (m) => new Date(now - m * 60000).toISOString();
  return [
    {
      id: "n1", app: "iMessage", title: "Sarah Johnson",
      body: "Hey, can you pick up flowers on the way home? 💐",
      timestamp: mins(3), sender: "Sarah Johnson", priority: "high", read: false,
    },
    {
      id: "n2", app: "Slack", title: "Mark Chen in #engineering",
      body: "Can you review the PR before standup?",
      timestamp: mins(12), sender: "Mark Chen", priority: "high", read: false,
    },
    {
      id: "n3", app: "Gmail", title: "Q1 Report - Final Draft",
      body: "Hi team, attached is the final Q1 report for your review...",
      timestamp: mins(25), sender: "lisa.park@company.com", priority: "medium", read: false,
    },
    {
      id: "n4", app: "Calendar", title: "Reminder: Dentist at 11:00",
      body: "Dentist appointment in 1 hour — Downtown Dental, 450 Main St",
      timestamp: mins(30), sender: null, priority: "medium", read: true,
    },
    {
      id: "n5", app: "Amazon", title: "Your package is arriving today",
      body: "Your order of 'Wireless Charger Stand' will be delivered by 5 PM",
      timestamp: mins(45), sender: null, priority: "low", read: true,
    },
    {
      id: "n6", app: "News", title: "Breaking: Tech stocks rally",
      body: "S&P 500 tech sector up 3.2% in early trading...",
      timestamp: mins(60), sender: null, priority: "low", read: false,
    },
    {
      id: "n7", app: "WhatsApp", title: "Family Group",
      body: "Mom: Don't forget lunch tomorrow! I made your favorite dessert 🍰",
      timestamp: mins(90), sender: "Dorothy Kogan", priority: "medium", read: false,
    },
    {
      id: "n8", app: "System", title: "iOS Update Available",
      body: "iOS 19.4 is now available. Update tonight?",
      timestamp: mins(120), sender: null, priority: "low", read: true,
    },
    {
      id: "n9", app: "Slack", title: "#design-review",
      body: "Lisa Park shared a new mockup for the dashboard redesign",
      timestamp: mins(150), sender: "Lisa Park", priority: "medium", read: false,
    },
    {
      id: "n10", app: "iMessage", title: "Mom",
      body: "Call me when you get a chance, sweetie. Nothing urgent ❤️",
      timestamp: mins(180), sender: "Dorothy Kogan", priority: "medium", read: false,
    },
  ];
}

// Mutable notification state (for dismiss)
let dismissedNotifications = new Set();

// DND state (mutable)
let dndState = {
  enabled: false,
  schedule: { start: "22:00", end: "07:00" },
  allowlist: ["Sarah Johnson", "Dorothy Kogan"],
};

// ─── MCP Server ───

const server = new McpServer({
  name: "mobile-device-mcp",
  version: "2.0.0",
});

// Tool: device.calendar.today
server.tool(
  "device.calendar.today",
  "Get all calendar events for today. Returns titles, times, locations, attendees, and notes.",
  {},
  async () => {
    const events = [...getTodayEvents(), ...createdEvents.filter(e => e.date === todayStr())];
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        date: todayStr(),
        day_of_week: new Date().toLocaleDateString("en-US", { weekday: "long" }),
        event_count: events.length,
        events: events.sort((a, b) => a.start.localeCompare(b.start)),
      }) }],
    };
  }
);

// Tool: device.calendar.upcoming
server.tool(
  "device.calendar.upcoming",
  "Get upcoming calendar events for the next N days (tomorrow and beyond). Does NOT include today.",
  {
    days: z.number().optional().describe("Number of days to look ahead (default 3, max 14)"),
  },
  async ({ days }) => {
    const lookAhead = Math.min(days || 3, 14);
    const upcoming = getUpcomingEvents();
    const futureCreated = createdEvents.filter(e => e.date > todayStr());
    const allEvents = [...upcoming, ...futureCreated].sort((a, b) =>
      a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)
    );
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        from: tomorrowStr(),
        days_ahead: lookAhead,
        event_count: allEvents.length,
        events: allEvents,
      }) }],
    };
  }
);

// Tool: device.calendar.create
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
  async ({ title, date, start_time, end_time, location, attendees, notes }) => {
    const event = {
      id: `e_new_${Date.now()}`,
      title,
      date,
      start: start_time,
      end: end_time || "",
      location: location || "",
      attendees: attendees || [],
      notes: notes || "",
    };
    createdEvents.push(event);
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        message: "Event created successfully",
        event,
      }) }],
    };
  }
);

// Tool: device.contacts.search
server.tool(
  "device.contacts.search",
  "Search contacts by name, relationship, or keyword. Searches across name, relationship, email, and notes.",
  {
    query: z.string().describe("Search query — matches name, relationship, email, notes"),
  },
  async ({ query }) => {
    const q = query.toLowerCase();
    const matches = CONTACTS.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.relationship.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.notes && c.notes.toLowerCase().includes(q))
    );
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        query,
        count: matches.length,
        contacts: matches,
      }) }],
    };
  }
);

// Tool: device.contacts.get
server.tool(
  "device.contacts.get",
  "Get full contact details by name or ID.",
  {
    contact_id: z.string().describe("Contact name or ID (e.g., 'Sarah' or 'c1')"),
  },
  async ({ contact_id }) => {
    const q = contact_id.toLowerCase();
    const contact = CONTACTS.find(c =>
      c.id === contact_id || c.name.toLowerCase().includes(q)
    );
    if (!contact) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: false,
          error: `Contact "${contact_id}" not found`,
        }) }],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, contact }) }],
    };
  }
);

// Tool: device.location.current
server.tool(
  "device.location.current",
  "Get user's current location based on time of day. Returns place name, address, and coordinates.",
  {},
  async () => {
    const hour = new Date().getHours();
    let location;
    if (hour >= 8 && hour < 17) {
      location = {
        place: "Office",
        address: "100 Tech Park Drive, Suite 500",
        lat: 37.7749, lng: -122.4194,
        type: "work",
      };
    } else if (hour >= 17 && hour < 20) {
      location = {
        place: "Commuting / Errands",
        address: "En route",
        lat: 37.7849, lng: -122.4094,
        type: "transit",
      };
    } else {
      location = {
        place: "Home",
        address: "42 Maple Lane",
        lat: 37.7949, lng: -122.3994,
        type: "home",
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        location,
      }) }],
    };
  }
);

// Tool: device.message.send
server.tool(
  "device.message.send",
  "Send an SMS/iMessage to a contact. Looks up the contact by name, composes and 'sends' the message. Always confirm with user before sending.",
  {
    contact_name: z.string().describe("Contact name to message"),
    message: z.string().describe("Message text to send"),
  },
  async ({ contact_name, message }) => {
    const q = contact_name.toLowerCase();
    const contact = CONTACTS.find(c => c.name.toLowerCase().includes(q));
    if (!contact) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: false,
          error: `Contact "${contact_name}" not found`,
        }) }],
      };
    }
    if (!contact.phone) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: false,
          error: `${contact.name} doesn't have a phone number`,
        }) }],
      };
    }
    const record = {
      to: contact.name,
      phone: contact.phone,
      message,
      sent_at: new Date().toISOString(),
      status: "delivered",
    };
    sentMessages.push(record);
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        message: `Message sent to ${contact.name}`,
        details: record,
      }) }],
    };
  }
);

// Tool: device.weather.current
server.tool(
  "device.weather.current",
  "Get current weather conditions for the user's location. Returns temperature, conditions, humidity, wind, and UV index.",
  {},
  async () => {
    const hour = new Date().getHours();
    // Simulate time-based weather variation
    const baseTemp = 62;
    const tempVariation = hour < 12 ? (hour - 6) * 2 : (18 - hour) * 2;
    const temp = Math.round(baseTemp + tempVariation);

    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        location: "San Francisco, CA",
        current: {
          temp_f: temp,
          temp_c: Math.round((temp - 32) * 5 / 9),
          condition: hour >= 6 && hour <= 10 ? "Partly Cloudy" : hour <= 16 ? "Sunny" : "Clear",
          humidity: 65,
          wind_mph: 12,
          wind_direction: "W",
          uv_index: hour >= 10 && hour <= 15 ? 7 : 3,
          feels_like_f: temp - 2,
        },
        alerts: [],
      }) }],
    };
  }
);

// Tool: device.weather.forecast
server.tool(
  "device.weather.forecast",
  "Get weather forecast for the next N days. Returns daily highs, lows, conditions, and rain probability.",
  {
    days: z.number().optional().describe("Number of days to forecast (default 3, max 7)"),
  },
  async ({ days }) => {
    const forecastDays = Math.min(days || 3, 7);
    const forecast = [];
    for (let i = 0; i < forecastDays; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "long" });
      const dateStr = d.toISOString().slice(0, 10);
      // Vary conditions across days
      const conditions = ["Sunny", "Partly Cloudy", "Mostly Sunny", "Cloudy", "Sunny", "Partly Cloudy", "Sunny"];
      const rainChance = [5, 15, 10, 40, 5, 20, 10];
      forecast.push({
        date: dateStr,
        day_of_week: dayOfWeek,
        high_f: 68 + Math.round(Math.sin(i) * 5),
        low_f: 52 + Math.round(Math.cos(i) * 3),
        condition: conditions[i % conditions.length],
        rain_probability: rainChance[i % rainChance.length],
        sunrise: "06:45",
        sunset: "18:30",
      });
    }
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        location: "San Francisco, CA",
        days: forecastDays,
        forecast,
      }) }],
    };
  }
);

// Tool: device.commute.estimate
server.tool(
  "device.commute.estimate",
  "Get estimated commute/travel time between two locations. Returns duration in minutes and distance. Use for travel time between events.",
  {
    from: z.string().describe("Starting location name or address"),
    to: z.string().describe("Destination location name or address"),
    mode: z.enum(["driving", "transit", "walking"]).optional().describe("Travel mode (default: driving)"),
  },
  async ({ from, to, mode }) => {
    const travelMode = mode || "driving";
    // Mock commute data based on known locations
    const knownRoutes = {
      "home-office": { driving: 25, transit: 40, walking: 90, miles: 8.2 },
      "office-downtown dental": { driving: 12, transit: 20, walking: 35, miles: 3.5 },
      "office-st. mary": { driving: 18, transit: 30, walking: 55, miles: 5.1 },
      "office-trattoria milano": { driving: 15, transit: 25, walking: 45, miles: 4.3 },
      "home-café deluxe": { driving: 10, transit: 18, walking: 30, miles: 2.8 },
      "home-riverside park": { driving: 8, transit: 15, walking: 25, miles: 2.1 },
      "home-david": { driving: 14, transit: 22, walking: 40, miles: 3.9 },
    };

    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();

    // Try to find a matching route
    let routeData = null;
    for (const [key, data] of Object.entries(knownRoutes)) {
      const [a, b] = key.split("-");
      if ((fromLower.includes(a) && toLower.includes(b)) ||
          (fromLower.includes(b) && toLower.includes(a))) {
        routeData = data;
        break;
      }
    }

    if (!routeData) {
      // Generic estimate
      routeData = { driving: 20, transit: 35, walking: 60, miles: 6.0 };
    }

    const minutes = routeData[travelMode];
    // Add traffic factor during rush hours
    const hour = new Date().getHours();
    const trafficMultiplier = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18) ? 1.4 : 1.0;
    const adjustedMinutes = Math.round(minutes * (travelMode === "driving" ? trafficMultiplier : 1));

    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        from,
        to,
        mode: travelMode,
        estimated_minutes: adjustedMinutes,
        distance_miles: routeData.miles,
        traffic: trafficMultiplier > 1 ? "heavy" : "normal",
        leave_by_note: `Leave by ${adjustedMinutes} minutes before your event`,
      }) }],
    };
  }
);

// Tool: device.contacts.birthdays
server.tool(
  "device.contacts.birthdays",
  "Get contacts with upcoming birthdays in the next N days. Returns matching contacts with days until birthday.",
  {
    days: z.number().optional().describe("Look ahead N days for birthdays (default 30)"),
  },
  async ({ days }) => {
    const lookAhead = Math.min(days || 30, 90);
    const today = new Date();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();

    const upcoming = CONTACTS
      .filter(c => c.birthday)
      .map(c => {
        const [, month, day] = c.birthday.split("-").map(Number);
        // Calculate days until birthday this year
        const birthdayThisYear = new Date(today.getFullYear(), month - 1, day);
        if (birthdayThisYear < today) {
          birthdayThisYear.setFullYear(today.getFullYear() + 1);
        }
        const diffMs = birthdayThisYear - today;
        const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const age = today.getFullYear() - parseInt(c.birthday.split("-")[0]) +
          (daysUntil === 0 ? 0 : daysUntil <= 0 ? 1 : 0);

        return {
          name: c.name,
          relationship: c.relationship,
          birthday: c.birthday,
          days_until: daysUntil,
          turning_age: birthdayThisYear.getFullYear() - parseInt(c.birthday.split("-")[0]),
          is_today: daysUntil === 0,
        };
      })
      .filter(c => c.days_until >= 0 && c.days_until <= lookAhead)
      .sort((a, b) => a.days_until - b.days_until);

    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        days_ahead: lookAhead,
        count: upcoming.length,
        birthdays: upcoming,
      }) }],
    };
  }
);

// ─── Notification & DND Tools ───

// Tool: device.notifications.list
server.tool(
  "device.notifications.list",
  "List device notifications. Optionally filter to unread only. Returns app, sender, body, priority, and read status.",
  {
    unread_only: z.boolean().optional().describe("If true, return only unread notifications (default false)"),
  },
  async ({ unread_only }) => {
    let notifs = getNotifications().filter(n => !dismissedNotifications.has(n.id));
    if (unread_only) {
      notifs = notifs.filter(n => !n.read);
    }
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        total: notifs.length,
        unread: notifs.filter(n => !n.read).length,
        notifications: notifs,
      }) }],
    };
  }
);

// Tool: device.notifications.group
server.tool(
  "device.notifications.group",
  "Group notifications by a category: 'app', 'sender', or 'priority'. Returns grouped structure for triage.",
  {
    group_by: z.enum(["app", "sender", "priority"]).describe("How to group: by app, sender, or priority"),
  },
  async ({ group_by }) => {
    const notifs = getNotifications().filter(n => !dismissedNotifications.has(n.id));
    const groups = {};
    for (const n of notifs) {
      let key;
      if (group_by === "app") key = n.app;
      else if (group_by === "sender") key = n.sender || "System";
      else key = n.priority;
      if (!groups[key]) groups[key] = [];
      groups[key].push(n);
    }
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        grouped_by: group_by,
        group_count: Object.keys(groups).length,
        groups,
      }) }],
    };
  }
);

// Tool: device.notifications.dismiss
server.tool(
  "device.notifications.dismiss",
  "Dismiss notifications by ID or by app name. Dismissed notifications won't appear in future list/group calls.",
  {
    notification_id: z.string().optional().describe("Dismiss a single notification by ID"),
    app: z.string().optional().describe("Dismiss all notifications from this app"),
  },
  async ({ notification_id, app }) => {
    const notifs = getNotifications();
    let dismissed = 0;
    if (notification_id) {
      if (notifs.find(n => n.id === notification_id)) {
        dismissedNotifications.add(notification_id);
        dismissed = 1;
      }
    } else if (app) {
      const appLower = app.toLowerCase();
      for (const n of notifs) {
        if (n.app.toLowerCase() === appLower) {
          dismissedNotifications.add(n.id);
          dismissed++;
        }
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        dismissed_count: dismissed,
        remaining: notifs.filter(n => !dismissedNotifications.has(n.id)).length,
      }) }],
    };
  }
);

// Tool: device.dnd.get
server.tool(
  "device.dnd.get",
  "Get current Do Not Disturb status — enabled/disabled, schedule, and allowlist of contacts who can break through.",
  {},
  async () => {
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        dnd: dndState,
      }) }],
    };
  }
);

// Tool: device.dnd.set
server.tool(
  "device.dnd.set",
  "Update Do Not Disturb settings. Toggle on/off, change schedule, or update allowlist.",
  {
    enabled: z.boolean().optional().describe("Turn DND on (true) or off (false)"),
    schedule_start: z.string().optional().describe("DND start time HH:MM"),
    schedule_end: z.string().optional().describe("DND end time HH:MM"),
    allowlist: z.array(z.string()).optional().describe("Contacts who can break through DND"),
  },
  async ({ enabled, schedule_start, schedule_end, allowlist }) => {
    if (enabled !== undefined) dndState.enabled = enabled;
    if (schedule_start) dndState.schedule.start = schedule_start;
    if (schedule_end) dndState.schedule.end = schedule_end;
    if (allowlist) dndState.allowlist = allowlist;
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        message: `DND ${dndState.enabled ? "enabled" : "disabled"}`,
        dnd: dndState,
      }) }],
    };
  }
);

// ─── Navigation & Activity Tools ───

// Tool: device.navigation.start
server.tool(
  "device.navigation.start",
  "Start navigation to a destination. Opens the maps app with directions. Returns confirmation and estimated arrival time.",
  {
    destination: z.string().describe("Destination address or place name"),
    mode: z.enum(["driving", "transit", "walking"]).optional().describe("Travel mode (default: driving)"),
  },
  async ({ destination, mode }) => {
    const travelMode = mode || "driving";
    // Estimate based on generic distance
    const estimatedMinutes = travelMode === "driving" ? 20 : travelMode === "transit" ? 35 : 60;
    const eta = new Date(Date.now() + estimatedMinutes * 60000);
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        message: `Navigation started to ${destination} via ${travelMode}`,
        destination,
        mode: travelMode,
        estimated_minutes: estimatedMinutes,
        eta: eta.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        status: "navigating",
      }) }],
    };
  }
);

// Tool: device.app.recent
server.tool(
  "device.app.recent",
  "Get recently used apps and screen time. Returns app names, last used time, and usage duration. Useful for detecting momentum patterns.",
  {
    limit: z.number().optional().describe("Max apps to return (default 10)"),
  },
  async ({ limit }) => {
    const maxApps = Math.min(limit || 10, 20);
    const now = new Date();
    const mins = (m) => new Date(now - m * 60000).toISOString();
    const recentApps = [
      { app: "Slack", last_used: mins(2), usage_minutes_today: 85, category: "work" },
      { app: "Safari", last_used: mins(5), usage_minutes_today: 45, category: "browsing" },
      { app: "iMessage", last_used: mins(8), usage_minutes_today: 20, category: "communication" },
      { app: "Calendar", last_used: mins(15), usage_minutes_today: 10, category: "productivity" },
      { app: "Gmail", last_used: mins(22), usage_minutes_today: 35, category: "work" },
      { app: "VS Code", last_used: mins(30), usage_minutes_today: 120, category: "work" },
      { app: "Spotify", last_used: mins(45), usage_minutes_today: 60, category: "entertainment" },
      { app: "Twitter", last_used: mins(60), usage_minutes_today: 15, category: "social" },
      { app: "Notes", last_used: mins(90), usage_minutes_today: 8, category: "productivity" },
      { app: "Maps", last_used: mins(180), usage_minutes_today: 5, category: "navigation" },
    ].slice(0, maxApps);

    const totalScreenTime = recentApps.reduce((sum, a) => sum + a.usage_minutes_today, 0);
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        timestamp: now.toISOString(),
        total_screen_time_minutes: totalScreenTime,
        app_count: recentApps.length,
        apps: recentApps,
      }) }],
    };
  }
);

// Tool: device.contacts.lastContact
server.tool(
  "device.contacts.lastContact",
  "Get when you last communicated with a contact. Returns days since last message/call. Useful for relationship care insights.",
  {
    name: z.string().describe("Contact name to check"),
  },
  async ({ name }) => {
    const q = name.toLowerCase();
    const contact = CONTACTS.find(c => c.name.toLowerCase().includes(q));
    if (!contact) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: false,
          error: `Contact "${name}" not found`,
        }) }],
      };
    }
    // Mock: simulate varying last contact dates
    const lastContactDays = {
      "sarah johnson": 0,    // talked today
      "mark chen": 1,        // yesterday
      "dorothy kogan": 3,    // 3 days ago
      "lisa park": 1,         // yesterday
      "david kim": 14,        // 2 weeks ago
      "dr. adam smith": 45,   // over a month ago
      "jake": 0,              // today (lives with user)
      "emma": 0,              // today (lives with user)
    };
    const days = lastContactDays[contact.name.toLowerCase()] ?? 7;
    const lastDate = new Date();
    lastDate.setDate(lastDate.getDate() - days);

    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        contact: contact.name,
        relationship: contact.relationship,
        days_since_last_contact: days,
        last_contact_date: lastDate.toISOString().slice(0, 10),
        last_contact_type: days === 0 ? "message" : days <= 3 ? "message" : "call",
        suggestion: days > 10 ? `You haven't talked to ${contact.name} in ${days} days. Consider reaching out.` : null,
      }) }],
    };
  }
);

// ─── UI Plugin Tools ───

const DEVICE_PLUGINS = [
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
    content: [{ type: "text", text: JSON.stringify({ plugins: DEVICE_PLUGINS }) }],
  })
);

server.tool(
  "ui.getPlugin",
  "Get the manifest for a specific UI plugin by ID.",
  { id: z.string().describe("Plugin ID") },
  async ({ id }) => {
    const plugin = DEVICE_PLUGINS.find(p => p.id === id);
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
          // EXPLICIT FOLDER NAME: Tells Core exactly where assets live in mcp-store
          _connectorId: "device-mock-mcp",
        }),
      }],
    };
  }
);

// ─── Start ───

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mobile-device-mcp v2.2.0] Server started with", CONTACTS.length, "contacts,", getTodayEvents().length, "events,", getNotifications().length, "notifications, schedule-panel UI plugin");
