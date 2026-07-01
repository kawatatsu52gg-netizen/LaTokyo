/**
 * Standalone CLI to verify meeting creation without going through MCP/Claude.
 *
 *   npm run test-meeting -- "2026-07-10T15:00:00" 60 "テスト"
 *
 * args: <start_time> [duration=60] [topic="ミーティング"]
 */

import "dotenv/config";
import { createMeeting, ZoomApiError } from "./zoom.js";

async function main() {
  const [startTime, durationArg, topicArg] = process.argv.slice(2);

  if (!startTime) {
    console.error(
      'Usage: npm run test-meeting -- "YYYY-MM-DDTHH:mm:ss" [duration] [topic]',
    );
    process.exit(1);
  }

  const duration = durationArg ? Number(durationArg) : 60;
  if (!Number.isFinite(duration) || duration <= 0) {
    console.error(`Invalid duration: ${durationArg}`);
    process.exit(1);
  }
  const topic = topicArg ?? "ミーティング";

  try {
    const meeting = await createMeeting({ start_time: startTime, duration, topic });
    console.log("✅ ミーティングを作成しました\n");
    console.log(`join_url:   ${meeting.join_url}`);
    console.log(`meeting_id: ${meeting.id}`);
    console.log(`password:   ${meeting.password}`);
    console.log(`start_time: ${meeting.start_time} (Asia/Tokyo)`);
    console.log(`duration:   ${meeting.duration} 分`);
    // start_url はホスト専用。共有しないが、ローカル確認用にのみ表示。
    console.log(`\n(host only) start_url: ${meeting.start_url}`);
  } catch (err) {
    if (err instanceof ZoomApiError) {
      console.error("❌ Zoom API エラー:\n" + err.message);
    } else {
      console.error("❌ エラー:", err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

main();
