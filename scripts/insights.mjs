#!/usr/bin/env node
// 릴스 인사이트 수집 — published/ 마커(회차 stem→IG media id)를 전수 조회해 Graph API 인사이트를 저장
// 사용법: node scripts/insights.mjs
//   env: IG_ACCESS_TOKEN
//
// 훅 수술(2026-08-08) 전후 성과 평가용 일회성 수집. publish.mjs와 동일하게
// Instagram Login 경로 토큰(graph.instagram.com)을 쓴다.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
// Instagram Login 경로 토큰(IGAA…)은 graph.instagram.com 전용 — publish.mjs와 동일 호스트.
const GRAPH = "https://graph.instagram.com";

const METRICS_FULL =
  "views,reach,likes,comments,saved,shares,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time";
const METRICS_REDUCED = "views,reach,ig_reels_avg_watch_time";

async function api(path, params) {
  const url = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  // Graph API는 HTTP 200에도 body.error를 실어 보낼 수 있어 함께 확인한다.
  if (!res.ok || json.error) {
    throw new Error(`API ${res.status} ${path}: ${JSON.stringify(json)}`);
  }
  return json;
}

// insights 응답 {data:[{name, values:[{value}]}]} → {name: value} 평탄화
function flattenInsights(json) {
  const out = {};
  for (const item of json.data || []) {
    out[item.name] = item.values?.[0]?.value;
  }
  return out;
}

// 전체 메트릭 세트 실패 시 축소 세트로 1회 재시도. 그래도 실패하면 throw(호출부에서 error 기록).
async function fetchInsights(mediaId, token) {
  try {
    const json = await api(`/${mediaId}/insights`, { metric: METRICS_FULL, access_token: token });
    return flattenInsights(json);
  } catch (e) {
    console.error(`  → 전체 세트 실패(${e.message}) — 축소 세트 재시도`);
    const json = await api(`/${mediaId}/insights`, { metric: METRICS_REDUCED, access_token: token });
    return flattenInsights(json);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) {
    console.error("IG_ACCESS_TOKEN 필요 (Meta 셋업 후 GitHub Secrets)");
    process.exit(1);
  }

  const publishedDir = join(ROOT, "published");
  const names = readdirSync(publishedDir);

  const results = [];
  let failCount = 0;

  for (const name of names) {
    const path = join(publishedDir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) continue; // 초기 회차 일부가 디렉토리 — 스킵
    if (name === "sample") continue;

    const content = readFileSync(path, "utf-8").trim();
    if (!/^\d+$/.test(content)) {
      console.error(`${name}: 미디어 id 아님(${content || "빈 파일"}) — 스킵`);
      continue;
    }
    const mediaId = content;

    const entry = { stem: name, mediaId, timestamp: null, permalink: null, metrics: {} };

    try {
      const meta = await api(`/${mediaId}`, { fields: "id,timestamp,permalink", access_token: token });
      entry.timestamp = meta.timestamp;
      entry.permalink = meta.permalink;
    } catch (e) {
      entry.error = `메타 조회 실패: ${e.message}`;
    }

    try {
      entry.metrics = await fetchInsights(mediaId, token);
    } catch (e) {
      entry.error = entry.error ? `${entry.error}; 인사이트 실패: ${e.message}` : `인사이트 실패: ${e.message}`;
    }

    if (entry.error) failCount++;
    results.push(entry);

    await sleep(250); // rate limit 완충
  }

  results.sort((a, b) => a.stem.localeCompare(b.stem));

  writeFileSync(join(ROOT, "insights.json"), `${JSON.stringify(results, null, 2)}\n`);

  console.log("stem                 views      avg_watch(s)");
  for (const r of results) {
    const views = r.metrics.views ?? "-";
    const avgWatch =
      r.metrics.ig_reels_avg_watch_time != null ? (r.metrics.ig_reels_avg_watch_time / 1000).toFixed(1) : "-";
    const errTag = r.error ? "  [ERROR]" : "";
    console.log(`${r.stem.padEnd(20)} ${String(views).padEnd(10)} ${avgWatch}${errTag}`);
  }

  console.log(`총 ${results.length}회차 / 실패 ${failCount}`);
}

main();
