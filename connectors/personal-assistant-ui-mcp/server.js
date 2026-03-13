#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const UI_PLUGINS = [
  { id: "schedule-panel", name: "Schedule", version: "1.0.0", description: "Today's calendar, upcoming events, and weather at a glance" },
  { id: "pa-dashboard", name: "Personal Assistant", version: "1.0.0", description: "At-a-glance dashboard — calendar, memories, contacts, and weather" },
  { id: "memories-panel", name: "Memories", version: "1.0.0", description: "View, search, and manage stored memories and preferences" },
  { id: "teach-panel", name: "Teach", version: "1.0.0", description: "Create and manage rules, automations, and taught behaviors" },
];

const PLUGIN_MANIFESTS = {
  "schedule-panel": {
    id: "schedule-panel", name: "Schedule", version: "1.0.0",
    description: "Today's calendar, upcoming events, and weather at a glance",
    render: { mode: "iframe", iframeUrl: "/ui/schedule-panel/1.0.0/index.html" },
    channels: ["command"], capabilities: { commands: [] },
  },
  "pa-dashboard": {
    id: "pa-dashboard", name: "Personal Assistant", version: "1.0.0",
    description: "At-a-glance dashboard — calendar, memories, contacts, and weather",
    render: { mode: "iframe", iframeUrl: "/ui/pa-dashboard/1.0.0/index.html" },
    channels: ["command"], capabilities: { commands: [] },
  },
  "memories-panel": {
    id: "memories-panel", name: "Memories", version: "1.0.0",
    description: "View, search, and manage stored memories and preferences",
    render: { mode: "iframe", iframeUrl: "/ui/memories-panel/1.0.0/index.html" },
    channels: ["command"], capabilities: { commands: [] },
  },
  "teach-panel": {
    id: "teach-panel", name: "Teach", version: "1.0.0",
    description: "Create and manage rules, automations, and taught behaviors",
    render: { mode: "iframe", iframeUrl: "/ui/teach-panel/1.0.0/index.html" },
    channels: ["command"], capabilities: { commands: [] },
  },
};

const server = new McpServer({ name: "personal-assistant-ui-mcp", version: "1.0.0" });

server.tool("ui.listPlugins", "List all available UI plugins", {}, async () => {
  return { content: [{ type: "text", text: JSON.stringify({ plugins: UI_PLUGINS }) }] };
});

server.tool("ui.getPlugin", "Get a specific UI plugin by ID", { id: z.string().describe("Plugin ID") }, async ({ id }) => {
  const manifest = PLUGIN_MANIFESTS[id];
  if (!manifest) return { content: [{ type: "text", text: JSON.stringify({ error: `Plugin '${id}' not found` }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(manifest) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
