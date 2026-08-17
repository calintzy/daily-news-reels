#!/usr/bin/env node
// TTS 나레이션 세그먼트 생성 — edge-tts CLI 래퍼
// 사용법: node scripts/tts.mjs data/DATE.json <outDir>
//   산출: <outDir>/seg-1..N.mp3 (+ 낭독 원문 seg-N.txt)
//   대본: 세그먼트 1 = hookLine(이슈1 낭독 겸함), 세그먼트 k = rank k 이슈의 title
//   전제: edge-tts CLI가 PATH에 있어야 한다(없으면 예외 → 호출부가 폴백)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// 2026-08-17 보이스 비교 청취(후보 5종)에서 선정 — SunHi는 AI 티 과다로 교체
const VOICE = "ko-KR-HyunsuMultilingualNeural";
const SLIDE_MS = 5300; // 이슈 슬라이드 1장 = 159f/30fps
const BUDGET_SEC = 5.0; // 세그먼트 1개에 허용하는 낭독 예산
const ATEMPO_MAX = 1.4;
const MIN_SEC = 0.5; // 이보다 짧으면 무음 의심

function run(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  // stdio가 inherit면 out이 null이므로 방어
  return out ? out.toString().trim() : "";
}

// 낭독 정규화 — 기호를 TTS가 오독하지 않게 말로 바꾼다.
export function normalizeForSpeech(text) {
  return String(text)
    .replace(/·/g, ", ")
    .replace(/…/g, ". ")
    .replace(/%/g, "퍼센트")
    .replace(/[“”‘’"'「」『』]/g, "")
    .replace(/↑/g, " 상승")
    .replace(/↓/g, " 하락")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateNarration(data, outDir) {
  mkdirSync(outDir, { recursive: true });
  const issues = [...(data.issues || [])].sort((a, b) => a.rank - b.rank);

  // 대본 구성: 1번은 hookLine(= rank1 결론이라 이슈1 title은 낭독하지 않는다)
  const scripts = issues.map((issue, idx) =>
    idx === 0 ? data.hookLine : issue.title
  );

  const segments = [];
  for (let idx = 0; idx < scripts.length; idx++) {
    const k = idx + 1;
    const spoken = normalizeForSpeech(scripts[idx]);
    console.log(`정규화 seg-${k}: ${spoken}`);

    // 인자 파싱 사고 방지 — 텍스트는 파일로 넘긴다
    const txtPath = join(outDir, `seg-${k}.txt`);
    const mp3Path = join(outDir, `seg-${k}.mp3`);
    writeFileSync(txtPath, spoken, "utf-8");
    run("edge-tts", ["--voice", VOICE, "--file", txtPath, "--write-media", mp3Path]);

    const durSec = Number(
      run("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        mp3Path,
      ])
    );
    if (!Number.isFinite(durSec) || durSec < MIN_SEC) {
      throw new Error(`seg-${k} 길이 이상(${durSec}s) — 무음 의심`);
    }

    let atempo = 1;
    if (durSec > BUDGET_SEC) {
      const need = durSec / BUDGET_SEC;
      if (need > ATEMPO_MAX) {
        console.warn(
          `경고: seg-${k} ${durSec.toFixed(2)}s — 필요 atempo ${need.toFixed(2)}가 상한 ${ATEMPO_MAX} 초과, ${ATEMPO_MAX} 적용(넘침 허용)`
        );
        atempo = ATEMPO_MAX;
      } else {
        atempo = need;
      }
    }
    // ponytail: 상한 1.4 초과분은 넘침 허용 — 실데이터 최악 6.85s도 1.4 내 수용, 문제 생기면 절단으로

    segments.push({ file: mp3Path, delayMs: idx * SLIDE_MS, durSec, atempo });
  }

  return segments;
}

async function main() {
  const jsonPath = process.argv[2];
  const outDir = process.argv[3];
  if (!jsonPath || !outDir) {
    console.error("사용법: node scripts/tts.mjs data/DATE.json <outDir>");
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const segments = await generateNarration(data, outDir);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    console.log(
      `seg-${i + 1}  raw ${s.durSec.toFixed(1)}s  atempo ${s.atempo.toFixed(2)}`
    );
  }
  const longest = Math.max(...segments.map((s) => s.durSec));
  const sped = segments.filter((s) => s.atempo > 1).length;
  console.log(
    `요약: 세그먼트 ${segments.length}개, 최장 ${longest.toFixed(2)}s, 가속 ${sped}개 → ${outDir}`
  );
}

// 단독 CLI로 실행할 때만 main 실행 (render.mjs가 import할 때는 실행하지 않는다)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
