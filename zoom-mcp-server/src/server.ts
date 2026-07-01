#!/usr/bin/env node
/**
 * MCP server exposing a single tool, `create_zoom_meeting`, over stdio.
 * Connect it to Claude Desktop via claude_desktop_config.json (see README).
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createMeeting, ZoomApiError } from "./zoom.js";

const server = new McpServer({
  name: "zoom-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "create_zoom_meeting",
  {
    title: "Create Zoom Meeting",
    description:
      "指定した日時（JSTローカル時刻）で Zoom ミーティングを作成し、共有用の join_url を発行します。",
    inputSchema: {
      start_time: z
        .string()
        .regex(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
          "start_time は 'YYYY-MM-DDTHH:mm:ss' 形式（JSTローカル時刻）で指定してください",
        )
        .describe("開始日時。JSTローカル時刻 'YYYY-MM-DDTHH:mm:ss' 形式"),
      duration: z
        .number()
        .int()
        .positive()
        .default(60)
        .describe("所要時間（分）。デフォルト 60"),
      topic: z
        .string()
        .default("ミーティング")
        .describe("ミーティングのトピック。デフォルト 'ミーティング'"),
    },
  },
  async ({ start_time, duration, topic }) => {
    try {
      const meeting = await createMeeting({ start_time, duration, topic });

      // start_url はホスト専用のため共有しない。join_url のみ返す。
      const text = [
        "Zoom ミーティングを作成しました。",
        "",
        `join_url:   ${meeting.join_url}`,
        `meeting_id: ${meeting.id}`,
        `password:   ${meeting.password}`,
        `start_time: ${meeting.start_time} (Asia/Tokyo)`,
        `duration:   ${meeting.duration} 分`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (err) {
      // Zoom のレスポンス本文をそのまま表示（デバッグしやすく）。
      const message =
        err instanceof ZoomApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `ミーティング作成に失敗しました:\n${message}` }],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the MCP protocol; log to stderr only.
  console.error("zoom-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting zoom-mcp-server:", err);
  process.exit(1);
});
