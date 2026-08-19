#!/usr/bin/env node
// 보존 기간 경과 산출물 정리 — published/ 마커(실발행 확인)를 전수 순회해
// 지정 보존일보다 오래된 회차의 영상·프리뷰·이미지를 삭제한다.
// 사용법: node scripts/cleanup.mjs [--dry-run]
//   env: CLEANUP_RETENTION_DAYS (기본 14)
//
// 배경: 영상은 발행 순간 인스타가 한 번 가져가면 이후 불필요 — docs/videos·assets/img
// 누적이 GitHub Pages 배포를 지연시켜 발행 프리플라이트를 타임아웃시킨다(2026-08-19 실장애).
// data/, published/ 마커 자체, docs/arms/, contracts/, metrics/, reports/는 건드리지 않는다.

import { readdirSync, readFileSync, statSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const RETENTION_DAYS = Number(process.env.CLEANUP_RETENTION_DAYS ?? "14");
const DRY_RUN = process.argv.includes("--dry-run");

// stem 파싱: (ai-)?YYYY-MM-DD(-am|pm)? — 매치 안 되면(예: sample) 보존
const STEM_RE = /^(ai-)?(\d{4}-\d{2}-\d{2})(-(am|pm))?$/;

function kstToday() {
  // en-CA 로케일은 기본으로 YYYY-MM-DD를 낸다.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function daysAgo(dateStr, todayStr) {
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const [dy, dm, dd] = dateStr.split("-").map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  const dateUtc = Date.UTC(dy, dm - 1, dd);
  return Math.round((todayUtc - dateUtc) / 86400000);
}

function dirSize(path) {
  let total = 0;
  for (const name of readdirSync(path)) {
    const p = join(path, name);
    const st = statSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

// stem에 딸린 산출물 경로 목록(존재 여부는 호출부에서 확인)
function targetsFor(stem) {
  return {
    files: [
      join(ROOT, "docs", "videos", `${stem}.mp4`),
      join(ROOT, "docs", "previews", `${stem}-hook.jpg`),
      join(ROOT, "docs", "previews", `${stem}-issue1.jpg`),
      join(ROOT, "docs", "previews", `${stem}-outro.jpg`),
    ],
    dir: join(ROOT, "assets", "img", stem),
  };
}

function main() {
  const publishedDir = join(ROOT, "published");
  const today = kstToday();
  const names = readdirSync(publishedDir);

  const candidates = [];
  for (const name of names) {
    const path = join(publishedDir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) continue; // 초기 회차 일부가 디렉토리 — 보존

    const content = readFileSync(path, "utf8").trim();
    if (content === "" || content === "pending") continue; // 실발행 안 된 회차 — 보존

    const m = STEM_RE.exec(name);
    if (!m) continue; // sample 등 파싱 불가 — 보존

    const stem = name;
    const dateStr = m[2];
    if (daysAgo(dateStr, today) > RETENTION_DAYS) {
      candidates.push(stem);
    }
  }

  let stemCount = 0;
  let fileCount = 0;
  let byteTotal = 0;

  for (const stem of candidates) {
    const { files, dir } = targetsFor(stem);
    const existingFiles = files.filter((f) => existsSync(f));
    const dirExists = existsSync(dir);
    if (existingFiles.length === 0 && !dirExists) continue; // 이미 정리됨 — 조용히 스킵

    let stemBytes = 0;
    for (const f of existingFiles) stemBytes += statSync(f).size;
    if (dirExists) stemBytes += dirSize(dir);

    if (DRY_RUN) {
      console.log(
        `[DRY-RUN] ${stem}: 파일 ${existingFiles.length}개${dirExists ? " + img 디렉토리" : ""} (${mb(stemBytes)}MB)`,
      );
    } else {
      for (const f of existingFiles) unlinkSync(f);
      if (dirExists) rmSync(dir, { recursive: true, force: true });
    }

    stemCount += 1;
    fileCount += existingFiles.length + (dirExists ? 1 : 0);
    byteTotal += stemBytes;
  }

  const verb = DRY_RUN ? "삭제 예정" : "정리 완료";
  console.log(`${verb}: ${stemCount}회차, ${fileCount}개 항목, ${mb(byteTotal)}MB ${DRY_RUN ? "확보 예정" : "확보"}`);
}

main();
