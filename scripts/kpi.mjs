#!/usr/bin/env node
// KPI 집계 — metrics/YYYY-MM-DD.json 누적 스냅샷을 계정별·기간별로 요약한다.
// 사용법: node scripts/kpi.mjs [metrics/DATE.json]  (인자 없으면 metrics/ 최신 파일)
//
// KPI는 views가 아니라 shares·saved per reach다 — views는 0.1초 노출 카운트라 배급 신호가 못 된다.
// 배급을 결정하는 신호는 shares(sends)·saved per reach·시청시간이다.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { accountOf } from "./insights.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const METRICS_DIR = join(ROOT, "metrics");

const ACCOUNTS = ["muleori", "aibrief"];
const WINDOWS = [
  { label: "최근 7일", days: 7 },
  { label: "최근 14일", days: 14 },
  { label: "전체", days: Infinity },
];
const MATURITY_HOURS = 24;

// metrics/ 디렉터리에서 YYYY-MM-DD.json 형식 스냅샷 중 가장 최신 파일 경로를 찾는다.
function findLatestSnapshot() {
  const names = readdirSync(METRICS_DIR).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n));
  if (names.length === 0) {
    throw new Error(`${METRICS_DIR}에 YYYY-MM-DD.json 스냅샷이 없다`);
  }
  names.sort(); // ISO 날짜 문자열은 사전순 정렬이 곧 시간순 정렬
  return join(METRICS_DIR, names[names.length - 1]);
}

// 파일명(YYYY-MM-DD)에서 스냅샷 기준 시각(해당 날짜 05:00 KST)을 구한다.
function snapshotTimeFromPath(path) {
  const stem = basename(path, ".json");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stem)) {
    throw new Error(`스냅샷 파일명이 YYYY-MM-DD.json 형식이 아니다: ${basename(path)}`);
  }
  return new Date(`${stem}T05:00:00+09:00`);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

// 스냅샷 로드 + 계정 판정 + 성숙도(24h) 필터. {entries, excludedByAccount}를 반환.
function loadEntries(path, snapshotTime) {
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw);

  const excludedByAccount = { muleori: 0, aibrief: 0 };
  const entries = [];

  for (const r of data) {
    if (r.error) continue; // error 있는 행은 대상 제외
    const account = r.account ?? accountOf(r.stem);
    const ts = r.timestamp ? new Date(r.timestamp) : null;
    if (!ts || Number.isNaN(ts.getTime())) continue; // 발행 시각 없으면 기간 판정 불가 — 스킵

    const ageHours = (snapshotTime.getTime() - ts.getTime()) / (1000 * 60 * 60);
    if (ageHours < MATURITY_HOURS) {
      if (excludedByAccount[account] !== undefined) excludedByAccount[account]++;
      continue; // 발행 24시간 미만 — 미성숙 제외
    }

    entries.push({ account, timestamp: ts, metrics: r.metrics ?? {} });
  }

  return { entries, excludedByAccount };
}

// 주어진 entries 중 계정==account, 기간(days)이내인 것으로 통계 산출.
function computeStats(entries, account, windowDays, snapshotTime) {
  const cutoffMs = windowDays === Infinity ? Infinity : windowDays * 24 * 60 * 60 * 1000;
  const filtered = entries.filter((e) => {
    if (e.account !== account) return false;
    if (windowDays === Infinity) return true;
    return snapshotTime.getTime() - e.timestamp.getTime() <= cutoffMs;
  });

  const n = filtered.length;
  const views = filtered.map((e) => e.metrics.views).filter((v) => typeof v === "number");
  const reach = filtered.map((e) => e.metrics.reach).filter((v) => typeof v === "number");
  const shares = filtered.map((e) => e.metrics.shares).filter((v) => typeof v === "number");
  const saved = filtered.map((e) => e.metrics.saved).filter((v) => typeof v === "number");
  const avgWatch = filtered
    .map((e) => e.metrics.ig_reels_avg_watch_time)
    .filter((v) => typeof v === "number")
    .map((ms) => ms / 1000);

  const reachSum = sum(reach);
  const sharesSum = sum(shares);
  const savedSum = sum(saved);

  return {
    n,
    viewsMedian: median(views),
    reachSum,
    sharesSum,
    savedSum,
    sharesPer1000Reach: reachSum > 0 ? (sharesSum / reachSum) * 1000 : null,
    savedPer1000Reach: reachSum > 0 ? (savedSum / reachSum) * 1000 : null,
    avgWatchMedian: median(avgWatch),
  };
}

function fmt(v, digits = 1) {
  return v == null ? "-" : v.toFixed(digits);
}

function fmtInt(v) {
  return v == null ? "-" : String(Math.round(v));
}

// GitHub 마크다운 표 + 상단 요약 라인을 문자열로 렌더링한다.
export function renderReport(path) {
  const snapshotTime = snapshotTimeFromPath(path);
  const { entries, excludedByAccount } = loadEntries(path, snapshotTime);

  const lines = [];
  lines.push(`스냅샷: \`${basename(path)}\``);
  lines.push("");
  lines.push("KPI는 views가 아니라 shares·saved per reach — views는 0.1초 노출 카운트.");
  lines.push("");
  lines.push(
    `발행 24시간 미만 제외: muleori ${excludedByAccount.muleori}건, aibrief ${excludedByAccount.aibrief}건`,
  );
  lines.push("");
  lines.push(
    "| 계정 | 구간 | n | views 중앙값 | reach 합 | shares 합 | saved 합 | shares/1000reach | saved/1000reach | avg_watch 중앙값(초) |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|");

  for (const account of ACCOUNTS) {
    for (const w of WINDOWS) {
      const s = computeStats(entries, account, w.days, snapshotTime);
      lines.push(
        `| ${account} | ${w.label} | ${s.n} | ${fmtInt(s.viewsMedian)} | ${s.reachSum} | ${s.sharesSum} | ${s.savedSum} | ${fmt(s.sharesPer1000Reach)} | ${fmt(s.savedPer1000Reach)} | ${fmt(s.avgWatchMedian)} |`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const argPath = process.argv[2];
  let path;
  try {
    path = argPath ? argPath : findLatestSnapshot();
    if (argPath) readFileSync(argPath, "utf-8"); // 존재 확인(없으면 아래 catch에서 에러 처리)
  } catch (e) {
    console.error(`kpi: 스냅샷 파일을 읽을 수 없다 — ${e.message}`);
    process.exit(1);
  }

  console.log(renderReport(path));
}

// 이 파일이 직접 실행됐을 때만 main()을 돈다 — import 시 사이드이펙트 방지(renderReport 재사용 목적).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
