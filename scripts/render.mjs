#!/usr/bin/env node
// 통합 렌더: 이미지 확인 → Remotion 렌더 → 음악 합성 → 캡처 → 검증
// 사용법: node scripts/render.mjs data/DATE.json
//   산출: docs/videos/<date>.mp4 + docs/previews/<date>-{hook,issue1,outro}.jpg
//   전제: assets/img/<date>/issue-1..N.png (없으면 exit 1)

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { generateNarration } from "./tts.mjs";
import { SINGLE_BEATS, singleTotalFrames, BEAT_TAIL_SEC } from "../reels/src/singleFormat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REELS = join(ROOT, "reels");

const FPS = 30;
// 2026-08-08 훅 수술: 커버 폐지(0f), 아웃트로 84f→45f. reels/src/timing.js와 동기 유지.
const COVER_D = 0;
const ISSUE_D = 159;
const OUTRO_D = 45;
const HOOK_D = 54; // 훅 오버레이 구간 — 프리뷰 캡처용

function run(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  // stdio가 inherit면 out이 null이므로 방어
  return out ? out.toString().trim() : "";
}

// stderr가 필요한 도구용(ffmpeg volumedetect는 측정값을 info 레벨 stderr로만 낸다)
function runStderr(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  return r.stderr || "";
}

// 계정별 브랜드 — 아웃트로(로고·문구·색)와 텔레그램 표기를 결정한다.
// muleori 값은 reels/src/HotIssueReelPhoto.jsx의 하드코딩 기본값과 **정확히 동일**해야 한다
// (물어오리 렌더 결과 불변이 하위 호환 조건 — 값이 갈리면 화면이 달라진다).
const BRANDS = {
  muleori: {
    name: "물어오리",
    handle: "@muleori.news",
    logo: "brand/duck.png",
    accent: "#FF3B3B",
    eyebrow: "내일 아침에도", // 아웃트로 상단 시간 표현
    closing: "뉴스 다섯 개", // 아웃트로 대문 문구(아래 줄이 name)
  },
  aibrief: {
    name: "오리 기자",
    handle: "@todays.ai.brief",
    logo: "brand/duck-news-t.png",
    // daily-briefing/cardnews/template.mjs의 브랜드 옐로우(#F5B82E) — 카드뉴스와 색을 맞춘다.
    accent: "#F5B82E",
    // AI 릴스는 낮 발행이라 "내일 아침에도"가 맞지 않는다 — 시간 표현을 brand로 파라미터화한 이유.
    eyebrow: "내일도 물어오는",
    closing: "AI 뉴스",
  },
};

// A/B 팔 결정: 강제 오버라이드 → 계정(오리 기자 고정) → 전역 킬스위치 → 일(DD) 짝/홀 카운터밸런싱
function resolveArm(stem, slot, account) {
  const forced = process.env.REELS_ARM;
  if (forced === "tts" || forced === "control") return forced;
  // 오리 기자(aibrief)는 A/B 대상이 아니라 TTS 고정이다.
  // TTS_ENABLED 킬스위치·짝홀 카운터밸런싱은 물어오리 A/B 전용이므로 그 위에서 갈라진다.
  if (account === "aibrief") return "tts";
  if (process.env.TTS_ENABLED !== "1") return "control";
  const even = Number(stem.slice(8, 10)) % 2 === 0;
  // pm은 am과 반대 배정. slot이 null이면 am과 동일 규칙.
  if (slot === "pm") return even ? "control" : "tts";
  return even ? "tts" : "control";
}

// 포맷 결정: 'single'(단일 이슈 18초 실험) | 'digest'(기존 5이슈 28초).
// REEL_FORMAT_MULEORI는 물어오리 전용 레버다 — 오리 기자(aibrief)는 값이 켜져 있어도 무시한다.
export function resolveFormat(account) {
  const raw = process.env.REEL_FORMAT_MULEORI;
  if (!raw) return "digest";
  if (raw !== "single") {
    console.warn(`경고: REEL_FORMAT_MULEORI="${raw}" 알 수 없는 값 — digest 유지`);
    return "digest";
  }
  if (account !== "muleori") {
    console.warn("경고: REEL_FORMAT_MULEORI=single은 물어오리 전용 — 오리 기자는 digest 유지");
    return "digest";
  }
  return "single";
}

// single 포맷의 팔 결정 — 짝홀 카운터밸런싱 없이 킬스위치만 본다(포맷 실험과 나레이션은 별개 레버).
function resolveSingleArm() {
  const forced = process.env.REELS_ARM;
  if (forced === "tts" || forced === "control") return forced;
  return process.env.TTS_ENABLED === "1" ? "tts" : "control";
}

// 비트 예산 드리프트 감지 단언.
// 실방어선은 tts.mjs의 ATEMPO_MAX throw다 — tts는 atempo=durSec/budget로 예산에 정확히 맞추므로
// 정상 경로에서 이 단언은 절대 걸리지 않는다. 이 함수의 목적은 두 파일의 예산 공식(비트 경계·
// BEAT_TAIL_SEC·fps)이 갈라졌을 때를 잡는 것이다. 위반이면 throw → 호출부(generateNarration
// try 블록)에서 control 폴백으로 떨어진다.
export function assertSegmentBudgets(segments, beatsFrames, fps = 30) {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    // 이 세그먼트가 시작하는 비트의 다음 경계를 찾는다(delayMs 기준).
    const startSec = s.delayMs / 1000;
    const nextBoundary = beatsFrames.map((f) => f / fps).find((sec) => sec > startSec + 1e-6);
    if (nextBoundary === undefined) {
      throw new Error(`seg-${i + 1} 시작 ${startSec.toFixed(2)}s가 비트 경계 밖`);
    }
    const budget = nextBoundary - startSec - BEAT_TAIL_SEC;
    const played = s.durSec / (s.atempo || 1);
    if (played > budget + 1e-6) {
      throw new Error(
        `seg-${i + 1} 실재생 ${played.toFixed(2)}s > 비트 예산 ${budget.toFixed(2)}s (시작 ${startSec.toFixed(2)}s)`
      );
    }
  }
  return true;
}

// 나레이션 창 검사 — 세그먼트 시작 1초 구간의 평균 음량으로 낭독 존재를 확인한다.
// 판정 줄은 그대로 stdout에 남기고 전체 통과 여부만 boolean으로 돌려준다.
export function checkNarrationWindows(mp4, segments) {
  let narOk = true;
  for (let i = 0; i < segments.length; i++) {
    const t = (segments[i].delayMs / 1000).toFixed(2);
    const err = runStderr("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-ss", t,
      "-t", "1",
      "-i", mp4,
      "-map", "a:0",
      "-af", "volumedetect",
      "-f", "null",
      "-",
    ]);
    const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(err);
    const mean = m ? Number(m[1]) : -Infinity;
    const ok = mean >= -28;
    if (!ok) narOk = false;
    console.log(`창${i + 1}: ${m ? mean.toFixed(1) : "-inf"}dB ${ok ? "OK" : "FAIL"}`);
  }
  return narOk;
}

// TTS 필터 그래프 — 입력 0=무음영상, 1=음악, 2..=세그먼트 mp3
// 스트림은 전부 [N:a]로 명시한다(음악 mp3에 커버아트 스트림이 있어 자동 선택 금지).
function buildTtsFilter(segments, expectedSec, fadeStart) {
  const chains = [
    `[1:a]atrim=0:${expectedSec.toFixed(3)},loudnorm=I=-16,afade=t=out:st=${fadeStart}:d=2,volume=0.22[m]`,
  ];
  const labels = [];
  segments.forEach((s, idx) => {
    const k = idx + 1;
    // 순서 고정: atempo(가속) → adelay(시작 위치). 반대면 지연까지 가속돼 위치가 틀어진다.
    const tempo = s.atempo === 1 ? "" : `atempo=${s.atempo.toFixed(3)},`;
    chains.push(`[${idx + 2}:a]${tempo}adelay=${s.delayMs}:all=1[d${k}]`);
    labels.push(`[d${k}]`);
  });
  chains.push(
    `${labels.join("")}amix=inputs=${segments.length}:normalize=0:dropout_transition=0[nar]`
  );
  chains.push(`[nar]loudnorm=I=-16[narn]`);
  chains.push(
    `[m][narn]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95[a]`
  );
  return chains.join(";");
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("사용법: node scripts/render.mjs data/DATE.json");
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const date = data.date;
  // 산출물 키는 파일명 stem(예: 2026-07-23-am). 슬롯 없는 기존 파일은 stem=date로 동일 동작.
  const stem = basename(jsonPath, ".json");
  const slot = data.slot ?? null; // "am" | "pm" | null
  // 계정: account 없거나 "muleori"면 물어오리(하위 호환). "aibrief"만 오리 기자로 분기한다.
  const account = data.account === "aibrief" ? "aibrief" : "muleori";
  const issues = data.issues || [];
  // 포맷: single(단일 이슈 18초 실험, 물어오리 전용) | digest(기존). 플래그 미설정이면 digest.
  const format = resolveFormat(account);
  const totalFrames =
    format === "single" ? singleTotalFrames : COVER_D + ISSUE_D * issues.length + OUTRO_D;
  const expectedSec = totalFrames / FPS;

  // 1) 이슈 이미지 확인 (커버 폐지 — 이슈 5장만)
  // aibrief(오리 기자)는 무료 버전(사진 없는 타이포 지면) — 이미지 게이트·복사를 건너뛴다.
  const imgDir = join(ROOT, "assets", "img", stem);
  const needed = issues.map((i) => `issue-${i.rank}`);
  if (account === "aibrief") {
    console.log("aibrief — 이미지 없이 렌더(noPhotos)");
  } else {
    const missing = needed.filter((n) => !existsSync(join(imgDir, `${n}.png`)));
    if (missing.length > 0) {
      console.error(`이미지 누락(${missing.length}): ${missing.join(", ")} — 렌더 중단(exit 1)`);
      process.exit(1);
    }

    // public/img/current/ 로 복사 (staticFile 사용)
    const pubDir = join(REELS, "public", "img", "current");
    if (existsSync(pubDir)) rmSync(pubDir, { recursive: true, force: true });
    mkdirSync(pubDir, { recursive: true });
    for (const n of needed) copyFileSync(join(imgDir, `${n}.png`), join(pubDir, `${n}.png`));
    console.log(`이미지 ${needed.length}장 → reels/public/img/current/`);
  }

  // 2) Remotion 렌더 (reels/ 안에서 inputProps 전달)
  const tmpDir = join(REELS, "out");
  mkdirSync(tmpDir, { recursive: true });
  const silentMp4 = join(tmpDir, `${stem}-silent.mp4`);
  const inputProps = {
    date,
    slot,
    hookLine: data.hookLine,
    issues: issues.map((i) => ({
      rank: i.rank,
      category: i.category,
      kicker: i.kicker,
      title: i.title,
      summary: i.summary,
    })),
    imageDir: "img/current",
    brand: BRANDS[account],
    // aibrief(오리 기자)만 noPhotos — muleori inputProps는 키가 늘면 안 된다(바이트 불변 원칙).
    ...(account === "aibrief" ? { noPhotos: true } : {}),
  };
  // 계정별 컴포지션: 오리 기자(aibrief)는 신문 에디토리얼 스타일(CardNewsReel),
  // 물어오리는 기존 사진 풀블리드 스타일(HotIssueReelPhoto) 그대로 유지.
  const compositionId =
    format === "single"
      ? "SingleIssueReel"
      : account === "aibrief"
        ? "CardNewsReel"
        : "HotIssueReelPhoto";
  console.log(`Remotion 렌더 시작… (${compositionId})`);
  run(
    "node",
    [
      "render-cli.mjs",
      compositionId,
      silentMp4,
      JSON.stringify(inputProps),
    ],
    { cwd: REELS, stdio: ["ignore", "inherit", "inherit"] }
  );

  // 3) 음악 합성: 영상 길이에 맞춰 컷 + loudnorm + 끝 2초 페이드 + volume 0.4
  // 2026-09-11 음악 교체 실험: 7주간 전 회차 동일 트랙(pure_attitude) → 두 계정 동시 조회수 붕괴의
  // 공유 요소 분리 1차. 되돌리려면 pure_attitude.mp3로 경로만 복원(파일 보존).
  const music = join(REELS, "assets", "music", "digital_lemonade.mp3");
  const videosDir = join(ROOT, "docs", "videos");
  mkdirSync(videosDir, { recursive: true });
  const finalMp4 = join(videosDir, `${stem}.mp4`);
  const fadeStart = Math.max(0, expectedSec - 2).toFixed(2);

  // TTS 나레이션 A/B — 팔 결정 후, tts 팔이면 세그먼트 생성(실패 시 control 폴백)
  const arm = format === "single" ? resolveSingleArm() : resolveArm(stem, slot, account);
  let armRecord = arm;
  let segments = null;
  if (arm === "tts") {
    try {
      segments = await generateNarration(
        data,
        join(REELS, "out", `tts-${stem}`),
        format === "single" ? { beats: SINGLE_BEATS } : {}
      );
      if (format === "single") {
        assertSegmentBudgets(segments, SINGLE_BEATS, FPS);
        console.log(`비트 예산 단언: 세그먼트 ${segments.length}개 OK`);
      }
    } catch (e) {
      segments = null;
      armRecord = "control-fallback";
      const reason = String(e.message || e).split("\n")[0];
      console.error(`TTS 생성 실패 — control 폴백: ${reason}`);
      try {
        run("node", [
          join(ROOT, "scripts", "telegram.mjs"),
          "fail",
          `TTS 폴백: ${stem} — ${reason}`,
        ]);
      } catch {
        // best-effort — TG env 미설정 등으로 실패해도 렌더는 계속한다
      }
    }
  }

  console.log("음악 합성…");
  const ffArgs = ["-y", "-i", silentMp4, "-i", music];
  let filterComplex;
  if (segments) {
    for (const s of segments) ffArgs.push("-i", s.file);
    filterComplex = buildTtsFilter(segments, expectedSec, fadeStart);
  } else {
    filterComplex = `[1:a]atrim=0:${expectedSec.toFixed(3)},loudnorm=I=-16,afade=t=out:st=${fadeStart}:d=2,volume=0.4[a]`;
  }
  ffArgs.push(
    "-filter_complex", filterComplex,
    "-map", "0:v",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-shortest",
    finalMp4
  );
  run("ffmpeg", ffArgs);
  console.log(`영상 산출: docs/videos/${stem}.mp4`);

  // 팔 기록물 — A/B 평가의 진실원.
  // 오리 기자(aibrief)는 하위 디렉토리 docs/arms/ai/ 에 쓴다 — 물어오리 A/B 집계는
  // docs/arms/ 직파일만 읽으므로 AI 회차가 실험 표본을 오염시키지 않는다.
  const armsDir =
    account === "aibrief" ? join(ROOT, "docs", "arms", "ai") : join(ROOT, "docs", "arms");
  mkdirSync(armsDir, { recursive: true });
  writeFileSync(join(armsDir, `${stem}.txt`), `${armRecord}\n`, "utf-8");
  console.log(`팔: ${armRecord}`);

  // 포맷 기록물 — 18초 실험 평가의 진실원. 두 계정 모두 한 디렉토리에 기록한다
  // (스템에 ai- 접두사가 있어 계정 구분이 가능하다). arms와 동일하게 무한 누적·보존.
  const formatsDir = join(ROOT, "docs", "formats");
  mkdirSync(formatsDir, { recursive: true });
  writeFileSync(join(formatsDir, `${stem}.txt`), `${format}\n`, "utf-8");
  console.log(`포맷: ${format}`);

  // 4) 프레임 캡처 (hook / issue1 / outro)
  const prevDir = join(ROOT, "docs", "previews");
  mkdirSync(prevDir, { recursive: true });
  const hookT = (HOOK_D / 2) / FPS; // 훅 오버레이 중반
  const issue1T = (HOOK_D + (ISSUE_D - HOOK_D) / 2) / FPS; // 훅 걷힌 뒤 이슈1
  const outroT = (ISSUE_D * issues.length + OUTRO_D / 2) / FPS;
  // single 포맷은 비트 구조가 달라 캡처 시점을 고정한다: 훅(B1) / 제목(B2) / CTA(B4).
  const shots =
    format === "single"
      ? [
          ["hook", "2.00"],
          ["issue1", "6.50"],
          ["outro", "16.00"],
        ]
      : [
          ["hook", hookT.toFixed(2)],
          ["issue1", issue1T.toFixed(2)],
          ["outro", outroT.toFixed(2)],
        ];
  for (const [name, t] of shots) {
    run("ffmpeg", [
      "-y",
      "-ss", t,
      "-i", finalMp4,
      "-frames:v", "1",
      "-q:v", "3",
      join(prevDir, `${stem}-${name}.jpg`),
    ]);
  }
  console.log(`프리뷰 3장: docs/previews/${stem}-{hook,issue1,outro}.jpg`);

  // 5) ffprobe 검증: 해상도·fps·길이
  const probe = run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    finalMp4,
  ]);
  const lines = probe.split("\n").map((s) => s.trim());
  const width = Number(lines[0]);
  const height = Number(lines[1]);
  const [rn, rd] = (lines[2] || "0/1").split("/").map(Number);
  const fps = rd ? rn / rd : 0;
  const duration = Number(lines[lines.length - 1]);

  const okRes = width === 1080 && height === 1920;
  const okFps = Math.abs(fps - FPS) < 0.1;
  const okDur = Math.abs(duration - expectedSec) <= 0.5;
  console.log(
    `검증: ${width}x${height} ${okRes ? "OK" : "FAIL"} | ${fps.toFixed(2)}fps ${okFps ? "OK" : "FAIL"} | ${duration.toFixed(2)}s (기대 ${expectedSec.toFixed(1)}±0.5) ${okDur ? "OK" : "FAIL"}`
  );
  if (!(okRes && okFps && okDur)) {
    console.error("렌더 검증 실패");
    process.exit(1);
  }

  // 5-1) 오디오 상설 게이트: 스트림 존재 + 길이
  const aLines = run("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=codec_type,duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    finalMp4,
  ])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const hasAudio = aLines[0] === "audio";
  // 스트림 duration이 N/A인 컨테이너도 있어 그때는 컨테이너 길이로 대체
  const aDur = Number.isFinite(Number(aLines[1])) ? Number(aLines[1]) : duration;
  const okADur = Math.abs(aDur - expectedSec) <= 0.5;
  console.log(
    `오디오 검증: 스트림 ${hasAudio ? "OK" : "FAIL"} | ${aDur.toFixed(2)}s (기대 ${expectedSec.toFixed(1)}±0.5) ${okADur ? "OK" : "FAIL"}`
  );
  if (!(hasAudio && okADur)) {
    console.error("오디오 검증 실패");
    process.exit(1);
  }

  // 5-2) tts 팔(폴백 아님)이면 세그먼트 시작 창의 음량으로 나레이션 존재를 확인
  if (armRecord === "tts" && segments) {
    if (!checkNarrationWindows(finalMp4, segments)) {
      console.error("나레이션 검증 실패");
      process.exit(1);
    }
  }

  console.log("render: PASS");
}

// 단독 CLI로 실행할 때만 main 실행 (export한 함수를 import해 프로브할 때는 실행하지 않는다)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
