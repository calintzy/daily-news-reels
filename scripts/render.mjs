#!/usr/bin/env node
// 통합 렌더: 이미지 확인 → Remotion 렌더 → 음악 합성 → 캡처 → 검증
// 사용법: node scripts/render.mjs data/DATE.json
//   산출: docs/videos/<date>.mp4 + docs/previews/<date>-{cover,issue1,outro}.jpg
//   전제: assets/img/<date>/{cover,issue-1..N}.png 6장(없으면 exit 1)

import {
  readFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REELS = join(ROOT, "reels");

const FPS = 30;
const COVER_D = 90;
const ISSUE_D = 114;
const OUTRO_D = 84;

function run(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  // stdio가 inherit면 out이 null이므로 방어
  return out ? out.toString().trim() : "";
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("사용법: node scripts/render.mjs data/DATE.json");
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const date = data.date;
  const issues = data.issues || [];
  const totalFrames = COVER_D + ISSUE_D * issues.length + OUTRO_D;
  const expectedSec = totalFrames / FPS;

  // 1) 이미지 6장(커버 + 이슈) 확인
  const imgDir = join(ROOT, "assets", "img", date);
  const needed = ["cover", ...issues.map((i) => `issue-${i.rank}`)];
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
  const silentMp4 = join(tmpDir, `${date}-silent.mp4`);
  const inputProps = {
    date,
    todayOneLiner: data.todayOneLiner,
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
  const finalMp4 = join(videosDir, `${date}.mp4`);
  const fadeStart = Math.max(0, expectedSec - 2).toFixed(2);
  console.log("음악 합성…");
  run("ffmpeg", [
    "-y",
    "-i", silentMp4,
    "-i", music,
    "-filter_complex",
    `[1:a]atrim=0:${expectedSec.toFixed(3)},loudnorm=I=-16,afade=t=out:st=${fadeStart}:d=2,volume=0.4[a]`,
    "-map", "0:v",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-shortest",
    finalMp4,
  ]);
  console.log(`영상 산출: docs/videos/${date}.mp4`);

  // 4) 프레임 캡처 (cover / issue1 / outro)
  const prevDir = join(ROOT, "docs", "previews");
  mkdirSync(prevDir, { recursive: true });
  const coverT = 1.0 / 1; // 커버 중반
  const issue1T = (COVER_D + ISSUE_D / 2) / FPS;
  const outroT = (COVER_D + ISSUE_D * issues.length + OUTRO_D / 2) / FPS;
  const shots = [
    ["cover", (COVER_D / 2 / FPS).toFixed(2)],
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
      join(prevDir, `${date}-${name}.jpg`),
    ]);
  }
  console.log(`프리뷰 3장: docs/previews/${date}-{cover,issue1,outro}.jpg`);

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
  console.log("render: PASS");
}

main();
