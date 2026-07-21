#!/usr/bin/env node
// 텔레그램 알림 — 운영자 미리보기·실패 알림
// 사용법:
//   node scripts/telegram.mjs preview data/DATE.json   → sendVideo(docs/videos/<date>.mp4)
//   node scripts/telegram.mjs fail "<메시지>"           → sendMessage
//   env: TG_BOT_TOKEN, TG_CHAT_ID
//   전송 성공 판정: 응답 "ok":true

import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const API = "https://api.telegram.org";

function creds() {
  const token = process.env.TG_BOT_TOKEN;
  const chat = process.env.TG_CHAT_ID;
  if (!token || !chat) {
    console.error("TG_BOT_TOKEN·TG_CHAT_ID 필요");
    process.exit(1);
  }
  return { token, chat };
}

async function sendMessage(text) {
  const { token, chat } = creds();
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`sendMessage 실패: ${JSON.stringify(json)}`);
  console.log(`sendMessage OK: message_id=${json.result.message_id}`);
}

async function sendVideo(videoPath, caption) {
  const { token, chat } = creds();
  const buf = readFileSync(videoPath);
  const form = new FormData();
  form.set("chat_id", chat);
  form.set("caption", caption);
  form.set("video", new Blob([buf], { type: "video/mp4" }), basename(videoPath));
  const res = await fetch(`${API}/bot${token}/sendVideo`, { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`sendVideo 실패: ${JSON.stringify(json)}`);
  console.log(`sendVideo OK: message_id=${json.result.message_id}`);
}

// 미리보기 캡션: 날짜 + 이슈 5개 제목 + 원문 링크(사실 검수용) + 승인 안내. 4096자 상한.
function buildPreviewCaption(data) {
  const lines = [`[릴스 미리보기] ${data.date}`, ""];
  for (const i of data.issues) {
    lines.push(`${i.rank}. ${i.title}`);
    if (i.sourceLink) lines.push(`   원문: ${i.sourceLink}`);
  }
  lines.push("");
  lines.push("사실 검수: 각 원문 링크로 요약이 원문과 맞는지 확인하세요.");
  lines.push("승인하려면 Actions에서 publish 워크플로우를 실행하세요.");
  return lines.join("\n").slice(0, 4096);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "preview") {
    const jsonPath = process.argv[3];
    if (!jsonPath) {
      console.error("사용법: node scripts/telegram.mjs preview data/DATE.json");
      process.exit(2);
    }
    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const videoPath = join(ROOT, "docs", "videos", `${data.date}.mp4`);
    if (!existsSync(videoPath)) {
      console.error(`영상 없음: ${videoPath}`);
      process.exit(1);
    }
    // 텔레그램 봇 업로드 상한(50MB) 안내만 — 초과 시 sendVideo가 실패로 알림
    const mb = (statSync(videoPath).size / 1024 / 1024).toFixed(1);
    console.log(`영상 ${mb}MB 전송 시도`);
    await sendVideo(videoPath, buildPreviewCaption(data));
  } else if (mode === "fail") {
    const msg = process.argv[3];
    if (!msg) {
      console.error('사용법: node scripts/telegram.mjs fail "<메시지>"');
      process.exit(2);
    }
    await sendMessage(msg.slice(0, 4096));
  } else {
    console.error("사용법: node scripts/telegram.mjs preview data/DATE.json | fail \"<메시지>\"");
    process.exit(2);
  }
}

main();
