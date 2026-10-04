#!/usr/bin/env node
// 오리 기자 릴스 레이아웃 계약 — 실제 렌더(reels/layout-cli.mjs)에서 글자 위치를 재서 인스타그램 안전 영역 안인지 판정한다.
// 사용법: node scripts/layout-check.mjs <data.json> [--stills <dir>] [--log <path>]
//         [--core-bottom N] [--require-el NAME] [--min-font N]   ← 음성 대조군용(비교기가 실제로 FAIL을 내는지 시험)
// stdout: 첫 줄 PASS|FAIL, 이어서 fonts/frame0/cover/zones/overlap/font-size/required 줄. 상세는 로그 파일.
// exit: PASS 0, FAIL 1, 사용법 오류 2.

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { issueDuration } from "../reels/src/timing.js";
import { ZONES as BASE_ZONES, COVER as BASE_COVER, MARGIN } from "../reels/src/safeArea.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REELS = join(ROOT, "reels");

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const valued = new Set(["--stills", "--log", "--core-bottom", "--require-el", "--min-font"]);
const dataArg = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
if (!dataArg) {
  console.error("사용법: node scripts/layout-check.mjs <data.json> [--stills <dir>] [--log <path>]");
  process.exit(2);
}
const dataPath = resolve(dataArg);
const stem = basename(dataPath, ".json");
const logPath = resolve(opt("--log") ?? join(tmpdir(), `layout-check-${stem}.log`));

// 영역·표지 범위·판정 여유는 reels/src/safeArea.js(CardNewsReel.jsx와 공유). --core-bottom은 음성 대조군용 덮어쓰기다.
// 판정 여유(MARGIN): 글자는 영역 경계에서 MARGIN 안쪽까지만 허용한다.
const CORE_BOTTOM = Number(opt("--core-bottom") ?? BASE_ZONES.core.bottom);
const ZONES = { ...BASE_ZONES, core: { ...BASE_ZONES.core, bottom: CORE_BOTTOM } };
const COVER = { top: BASE_COVER.top, bottom: Math.min(BASE_COVER.bottom, CORE_BOTTOM) };
const MIN_FONT = Number(opt("--min-font") ?? 28);
const VISIBLE = 0.05; // 실효 불투명도 이 미만은 안 보이는 요소로 보고 영역·겹침 판정에서 뺀다
// 글자 크기 규칙에서 빼는 장식 요소 — 도장 안의 "확인"·아웃트로 로고는 글자가 아니다.
const FONT_EXEMPT = new Set(["stamp", "outro-logo"]);

const HOOK_ELS = ["hook", "hook-brand", "hook-sub"];
const ISSUE_ELS = ["rank", "kicker", "title", "stat-label", "stat", "quote", "duck", "stamp"];
const OUTRO_ELS = ["outro-logo", "outro-eyebrow", "outro-closing", "outro-follow", "outro-handle"];
const extraRequired = opt("--require-el");

const data = JSON.parse(readFileSync(dataPath, "utf-8"));
const issueCount = (data.issues || []).length;
const outroStart = issueCount * issueDuration;
// 검사 프레임과 프레임별 필수 요소 — layout-cli.mjs의 프레임 목록과 같은 순서다.
const plan = [
  [0, HOOK_ELS],
  [27, HOOK_ELS],
  ...Array.from({ length: issueCount }, (_, i) => [i * issueDuration + 140, ISSUE_ELS]),
  [outroStart + 40, OUTRO_ELS],
].map(([frame, els]) => ({ frame, required: extraRequired ? [...els, extraRequired] : els }));

const cliArgs = ["layout-cli.mjs", dataPath];
if (opt("--stills")) cliArgs.push("--stills", resolve(opt("--stills")));
const r = spawnSync("node", cliArgs, { cwd: REELS, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;

const log = [`data: ${dataPath}`, `layout-cli exit: ${r.status}`];
const results = {};
const fail = (key, msg) => {
  results[key] = "FAIL";
  log.push(`[${key}] ${msg}`);
};
for (const k of ["fonts", "frame0", "cover", "zones", "overlap", "font-size", "required"]) results[k] = "PASS";

if (r.status !== 0) {
  for (const k of Object.keys(results)) results[k] = "FAIL";
  log.push("렌더 실패 — layout-cli 출력:", out);
}

const measured = new Map();
for (const line of out.split("\n")) {
  if (line.startsWith("LAYOUT_ERROR ")) fail("required", `probe 측정 실패: ${line}`);
  if (!line.startsWith("LAYOUT ")) continue;
  try {
    const m = JSON.parse(line.slice("LAYOUT ".length));
    measured.set(m.frame, m);
  } catch {
    // 파싱 실패 줄의 프레임은 아래에서 "LAYOUT 줄 없음"으로도 잡힌다.
    fail("required", `LAYOUT 줄 파싱 실패: ${line.slice(0, 200)}`);
  }
}
const duration = /^duration: (\d+)$/m.exec(out);
log.push(`duration: ${duration ? duration[1] : "?"}`);

const inside = (el, box) =>
  el.left >= box.left + MARGIN &&
  el.right <= box.right - MARGIN &&
  el.top >= box.top + MARGIN &&
  el.bottom <= box.bottom - MARGIN;
const intersects = (a, b) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
const fmt = (e) =>
  `${e.el} [${Math.round(e.left)},${Math.round(e.top)}–${Math.round(e.right)},${Math.round(e.bottom)}] ${e.fontSize}px op=${e.opacity.toFixed(2)}${e.overflow ? " 넘침" : ""}`;

if (r.status === 0) {
  for (const { frame, required } of plan) {
    const m = measured.get(frame);
    if (!m) {
      fail("required", `${frame}f: LAYOUT 줄 없음`);
      continue;
    }
    log.push(`--- ${frame}f`, ...m.els.map((e) => `  ${fmt(e)}`));
    if (!m.fontsOk) fail("fonts", `${frame}f: Noto Serif KR 미로딩`);

    const visible = m.els.filter((e) => e.opacity >= VISIBLE);
    for (const name of required) {
      if (!visible.some((e) => e.el === name)) fail("required", `${frame}f: ${name} 없음(또는 안 보임)`);
    }

    for (const e of visible) {
      const box = ZONES[e.zone];
      if (box && !inside(e, box)) fail("zones", `${frame}f: ${fmt(e)} — ${e.zone} 영역 밖`);
      if (e.overflow) fail("zones", `${frame}f: ${fmt(e)} — 자기 칸을 넘침`);
      if (e.zone && !FONT_EXEMPT.has(e.el) && e.fontSize < MIN_FONT) {
        fail("font-size", `${frame}f: ${fmt(e)} — ${MIN_FONT}px 미만`);
      }
    }

    const core = visible.filter((e) => e.zone === "core");
    for (let i = 0; i < core.length; i++) {
      for (let j = i + 1; j < core.length; j++) {
        if (intersects(core[i], core[j])) fail("overlap", `${frame}f: ${core[i].el} ↔ ${core[j].el}`);
      }
    }

    const hook = m.els.find((e) => e.el === "hook");
    if (frame === 0 && !(hook && hook.opacity >= 0.95 && inside(hook, ZONES.core))) {
      fail("frame0", `0f: 훅 ${hook ? fmt(hook) : "없음"} — 불투명도 0.95 이상·CORE 안이어야 함`);
    }
    if (frame === 27 && !(hook && hook.opacity >= VISIBLE && inside(hook, { ...ZONES.core, ...COVER }))) {
      fail("cover", `27f: 훅 ${hook ? fmt(hook) : "없음"} — y ${COVER.top}~${COVER.bottom} 안이어야 함`);
    }
  }
}

const pass = Object.values(results).every((v) => v === "PASS");
writeFileSync(logPath, `${log.join("\n")}\n`, "utf-8");
console.log(pass ? "PASS" : "FAIL");
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
console.log(`log: ${logPath}`);
process.exit(pass ? 0 : 1);
