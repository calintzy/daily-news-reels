#!/usr/bin/env node
// 릴스 게시 — public video_url → Instagram Reels (Graph API)
// 사용법: [DRY_RUN=1] node scripts/publish.mjs data/DATE.json
//   env: IG_ACCESS_TOKEN, IG_USER_ID, DRY_RUN
//   DRY_RUN=1: 컨테이너 생성 + status FINISHED 확인까지 (media_publish 미호출)
//
// 멱등 2단계: containers/<date>(컨테이너 id 재사용) + published/<date>(pending→media id)
// critic 반영:
//   C1: 프리플라이트 HEAD로 로컬 mp4 크기와 서버 content-length 일치 대기(Pages 배포 지연)
//   C2: 컨테이너 status_code 폴링(FINISHED 대기). 인스타는 video_url을 비동기로 가져간다.

import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
// Instagram Login 경로 토큰(IGAA…)은 graph.instagram.com 전용 — graph.facebook.com에
// 보내면 "Cannot parse access token"(2026-07-22 실측). cardnews publish.mjs와 동일 호스트.
const GRAPH = "https://graph.instagram.com";
const DRY = process.env.DRY_RUN === "1";

async function api(path, params, method = "GET") {
  const url = new URL(GRAPH + path);
  const opts = { method };
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else {
    opts.body = new URLSearchParams(params);
  }
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API ${res.status} ${path}: ${JSON.stringify(json)}`);
  return json;
}

// C1: HEAD 요청 지수 백오프 — 200 + content-length가 로컬 크기와 일치할 때까지(최대 5분)
async function waitUrl(url, expectedBytes, { maxMs = 300000 } = {}) {
  const start = Date.now();
  let delay = 5000;
  let attempt = 0;
  while (Date.now() - start < maxMs) {
    attempt++;
    let r;
    try {
      r = await fetch(url, { method: "HEAD", cache: "no-store" });
    } catch (e) {
      console.log(`프리플라이트 ${attempt}: 요청 실패(${e.message}) 재시도`);
      await sleep(delay);
      delay = Math.min(delay * 1.4, 30000);
      continue;
    }
    if (r.status === 200) {
      const len = Number(r.headers.get("content-length"));
      if (!r.headers.get("accept-ranges")?.includes("bytes")) {
        console.log("경고: accept-ranges: bytes 없음 — 인스타 fetch가 실패할 수 있음");
      }
      if (expectedBytes == null || len === expectedBytes) {
        console.log(`프리플라이트 OK: ${url} (${len}B)`);
        return;
      }
      console.log(`프리플라이트 ${attempt}: 서버 ${len}B ≠ 로컬 ${expectedBytes}B (배포 대기) 재시도`);
    } else {
      console.log(`프리플라이트 ${attempt}: HTTP ${r.status} 재시도`);
    }
    await sleep(delay);
    delay = Math.min(delay * 1.4, 30000);
  }
  throw new Error(`프리플라이트 5분 초과: ${url}`);
}

// C2: status_code 폴링 — FINISHED 대기(최대 5분), 15초→최대 60초 점증
async function pollStatus(containerId, token, { maxMs = 300000 } = {}) {
  const start = Date.now();
  let delay = 15000;
  while (Date.now() - start < maxMs) {
    const s = await api(`/${containerId}`, {
      fields: "status_code,status",
      access_token: token,
    });
    console.log(`컨테이너 상태: ${s.status_code} (${s.status || ""})`);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new Error(`컨테이너 처리 실패: ${JSON.stringify(s)}`);
    }
    await sleep(delay);
    delay = Math.min(delay + 15000, 60000);
  }
  throw new Error("status 폴링 5분 초과 — FINISHED 미도달");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 발행 완료 텔레그램 알림 — 실패해도 게시 자체는 성공이므로 throw하지 않는다(best-effort).
async function notifyTelegram(text) {
  const token = process.env.TG_BOT_TOKEN;
  const chat = process.env.TG_CHAT_ID;
  if (!token || !chat) {
    console.log("TG 자격증명 없음 — 발행 완료 알림 생략");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) console.log(`발행 완료 알림 실패: ${JSON.stringify(json)}`);
    else console.log(`발행 완료 알림 전송 OK: message_id=${json.result.message_id}`);
  } catch (e) {
    console.log(`발행 완료 알림 예외: ${e.message}`);
  }
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("사용법: [DRY_RUN=1] node scripts/publish.mjs data/DATE.json");
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
  // 산출물 키는 파일명 stem(예: 2026-07-23-am). 슬롯 없는 기존 파일은 stem=date로 동일 동작.
  const stem = basename(jsonPath, ".json");
  const caption = data.caption;

  const token = process.env.IG_ACCESS_TOKEN;
  const igUser = process.env.IG_USER_ID;
  if (!token || !igUser) {
    console.error("IG_ACCESS_TOKEN·IG_USER_ID 필요 (Meta 셋업 후 GitHub Secrets)");
    process.exit(1);
  }

  const publishedMarker = join(ROOT, "published", stem);
  const containerMarker = join(ROOT, "containers", stem);

  // 게시 완료 멱등 체크
  if (!DRY && existsSync(publishedMarker)) {
    const content = readFileSync(publishedMarker, "utf-8").trim();
    if (content === "pending") {
      console.error(
        `published/${stem} 가 pending — 이전 실행이 media_publish 전 중단됨. 재시도하려면 마커 삭제 필요`
      );
      process.exit(1);
    }
    // 조용한 스킵 금지 — 2026-07-23-am 미발행 사고: 스템 오판으로 전날 마커에 걸려
    // 스킵됐는데 알림이 없어 발견이 늦었다. 스킵도 반드시 텔레그램으로 보인다.
    console.log(`이미 게시됨: published/${stem} (id=${content}) — 스킵(멱등)`);
    await notifyTelegram(
      `[물어오리] publish 스킵: ${stem} 은(는) 이미 게시됨(id=${content}). 의도한 재실행이 아니면 스템 오판·중복 실행을 점검하세요.`
    );
    process.exit(0);
  }

  const videoUrl = `https://calintzy.github.io/daily-news-reels/videos/${stem}.mp4`;

  // C1: 프리플라이트 — 로컬 mp4 크기 대조
  const localMp4 = join(ROOT, "docs", "videos", `${stem}.mp4`);
  let expectedBytes = null;
  try {
    expectedBytes = statSync(localMp4).size;
  } catch {
    console.log("로컬 mp4 없음 — content-length 대조 생략(200만 확인)");
  }
  await waitUrl(videoUrl, expectedBytes);

  // 토큰 유효성
  const me = await api("/me", { fields: "id", access_token: token });
  console.log(`토큰 유효: id=${me.id}`);

  // 컨테이너 멱등 — containers/<date> 있으면 재사용
  let containerId;
  if (existsSync(containerMarker)) {
    containerId = readFileSync(containerMarker, "utf-8").trim();
    console.log(`컨테이너 재사용: ${containerId}`);
  } else {
    const c = await api(
      `/${igUser}/media`,
      { media_type: "REELS", video_url: videoUrl, caption, access_token: token },
      "POST"
    );
    containerId = c.id;
    mkdirSync(dirname(containerMarker), { recursive: true });
    writeFileSync(containerMarker, `${containerId}\n`);
    console.log(`컨테이너 생성: ${containerId} → containers/${stem}`);
  }

  // C2: FINISHED 대기 (인스타가 video_url을 실제로 fetch·인코딩)
  await pollStatus(containerId, token);

  if (DRY) {
    console.log("DRY_RUN=1 — media_publish 미호출 (컨테이너 FINISHED 확인 완료)");
    process.exit(0);
  }

  // 실게시 2단계: published/<stem> pending 선기록 → media_publish → media id 갱신
  mkdirSync(dirname(publishedMarker), { recursive: true });
  writeFileSync(publishedMarker, "pending\n");
  console.log(`published/${stem} pending 선기록`);

  const pub = await api(
    `/${igUser}/media_publish`,
    { creation_id: containerId, access_token: token },
    "POST"
  );
  writeFileSync(publishedMarker, `${pub.id}\n`);
  console.log(`게시 완료: media id=${pub.id} → published/${stem}`);

  // 발행 완료 텔레그램 알림 — media id로 permalink 조회 후 한 줄 전송(best-effort)
  let permalink = "";
  try {
    const meta = await api(`/${pub.id}`, { fields: "permalink", access_token: token });
    permalink = meta.permalink || "";
  } catch (e) {
    console.log(`permalink 조회 실패: ${e.message}`);
  }
  await notifyTelegram(`[물어오리] 발행 완료 (${stem})${permalink ? `\n${permalink}` : ""}`);
}

main();
