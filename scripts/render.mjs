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
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { generateNarration } from "./tts.mjs";

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

// A/B 팔 결정: 강제 오버라이드 → 전역 킬스위치 → 일(DD) 짝/홀 카운터밸런싱
function resolveArm(stem, slot) {
  const forced = process.env.REELS_ARM;
  if (forced === "tts" || forced === "control") return forced;
  if (process.env.TTS_ENABLED !== "1") return "control";
  const even = Number(stem.slice(8, 10)) % 2 === 0;
  // pm은 am과 반대 배정. slot이 null이면 am과 동일 규칙.
  if (slot === "pm") return even ? "control" : "tts";
  return even ? "tts" : "control";
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
  const issues = data.issues || [];
  const totalFrames = COVER_D + ISSUE_D * issues.length + OUTRO_D;
  const expectedSec = totalFrames / FPS;

  // 1) 이슈 이미지 확인 (커버 폐지 — 이슈 5장만)
  const imgDir = join(ROOT, "assets", "img", stem);
  const needed = issues.map((i) => `issue-${i.rank}`);
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
  };
  console.log("Remotion 렌더 시작…");
  run(
    "node",
    [
      "render-cli.mjs",
      "HotIssueReelPhoto",
      silentMp4,
      JSON.stringify(inputProps),
    ],
    { cwd: REELS, stdio: ["ignore", "inherit", "inherit"] }
  );

  // 3) 음악 합성: 영상 길이에 맞춰 컷 + loudnorm + 끝 2초 페이드 + volume 0.4
  const music = join(REELS, "assets", "music", "pure_attitude.mp3");
  const videosDir = join(ROOT, "docs", "videos");
  mkdirSync(videosDir, { recursive: true });
  const finalMp4 = join(videosDir, `${stem}.mp4`);
  const fadeStart = Math.max(0, expectedSec - 2).toFixed(2);

  // TTS 나레이션 A/B — 팔 결정 후, tts 팔이면 세그먼트 생성(실패 시 control 폴백)
  const arm = resolveArm(stem, slot);
  let armRecord = arm;
  let segments = null;
  if (arm === "tts") {
    try {
      segments = await generateNarration(data, join(REELS, "out", `tts-${stem}`));
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

  // 팔 기록물 — A/B 평가의 진실원
  const armsDir = join(ROOT, "docs", "arms");
  mkdirSync(armsDir, { recursive: true });
  writeFileSync(join(armsDir, `${stem}.txt`), `${armRecord}\n`, "utf-8");
  console.log(`팔: ${armRecord}`);

  // 4) 프레임 캡처 (hook / issue1 / outro)
  const prevDir = join(ROOT, "docs", "previews");
  mkdirSync(prevDir, { recursive: true });
  const hookT = (HOOK_D / 2) / FPS; // 훅 오버레이 중반
  const issue1T = (HOOK_D + (ISSUE_D - HOOK_D) / 2) / FPS; // 훅 걷힌 뒤 이슈1
  const outroT = (ISSUE_D * issues.length + OUTRO_D / 2) / FPS;
  const shots = [
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
    let narOk = true;
    for (let i = 0; i < segments.length; i++) {
      const t = (segments[i].delayMs / 1000).toFixed(2);
      const err = runStderr("ffmpeg", [
        "-hide_banner",
        "-nostats",
        "-ss", t,
        "-t", "1",
        "-i", finalMp4,
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
    if (!narOk) {
      console.error("나레이션 검증 실패");
      process.exit(1);
    }
  }

  console.log("render: PASS");
}

main();
