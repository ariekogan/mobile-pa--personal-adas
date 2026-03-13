#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new Server(
  { name: "personal-assistant-ui-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

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
        }),
      }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
