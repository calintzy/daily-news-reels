#!/usr/bin/env node
// 실험 플래그 해석 — experiments/flags.json이 유일한 진실원이다(저장소 변수 폴백 없음).
// 사용법:
//   node scripts/flags.mjs data/<stem>.json      → 계정별 최종값을 $GITHUB_OUTPUT에 쓴다(렌더 스텝 env로 전달)
//   node scripts/flags.mjs --check <flags.json>  → 파일 계약 검사(허용 키 외 키·형식 오류면 exit 1)
//   node scripts/flags.mjs --hook-prompt         → 물어오리 hookLine 프롬프트 경로와 프레임 한 줄(루틴용, 항상 exit 0)
//
// 해석 모드는 절대 exit 1로 발행을 막지 않는다. flags.json이 없거나 손상되면 기본값(digest, TTS 0)과 경고,
// 허용되지 않은 키(PUBLISH_LIVE 등)는 그 키만 무시한다. 킬스위치는 사람의 안전장치라 여기서 다루지 않는다.

import { appendFileSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { accountOf } from "./insights.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// 허용 키(화이트리스트)와 기본값. 기본값은 "실험 없음" 상태(render.mjs 기준 digest + control)다.
// HOOK_FRAME_MULEORI: ""(훅 v2) | "action"(행동 번역 훅). 루틴이 --hook-prompt로 읽는다(렌더는 쓰지 않음).
export const FLAG_DEFAULTS = { REEL_FORMAT_MULEORI: "", TTS_ENABLED: "0", HOOK_FRAME_MULEORI: "" };
export const ALLOWED_KEYS = Object.keys(FLAG_DEFAULTS);
export const ACCOUNTS = ["muleori", "aibrief"];

// flags.json 객체의 계약 위반 목록을 돌려준다(빈 배열이면 정상).
export function checkFlags(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return ["최상위가 객체가 아니다"];
  for (const [account, flags] of Object.entries(obj)) {
    if (!ACCOUNTS.includes(account)) {
      errors.push(`알 수 없는 계정 키 "${account}"`);
      continue;
    }
    if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
      errors.push(`${account}: 객체가 아니다`);
      continue;
    }
    for (const [k, v] of Object.entries(flags)) {
      if (!ALLOWED_KEYS.includes(k)) errors.push(`${account}.${k}: 허용되지 않은 키(허용: ${ALLOWED_KEYS.join(", ")})`);
      else if (typeof v !== "string" || /[\r\n]/.test(v)) errors.push(`${account}.${k}: 값은 한 줄 문자열이어야 한다`);
    }
  }
  return errors;
}

// data 파일의 계정 판정 — render.mjs와 같은 규칙(data.account === "aibrief"만 오리 기자).
// 파싱이 안 되면 스템 접두사로 판정한다(ai- → aibrief).
function accountOfData(dataPath) {
  try {
    const data = JSON.parse(readFileSync(dataPath, "utf-8"));
    return data.account === "aibrief" ? "aibrief" : "muleori";
  } catch {
    return accountOf(basename(dataPath, ".json"));
  }
}

// 계정의 최종 플래그를 정한다. 반환: { values, source, warnings }
export function resolveFlags(flagsPath, account) {
  const warnings = [];
  let obj;
  try {
    obj = JSON.parse(readFileSync(flagsPath, "utf-8"));
  } catch (e) {
    warnings.push(`경고: ${flagsPath} 읽기/파싱 실패 — 기본값 사용 (${e.message.split("\n")[0]})`);
    return { values: { ...FLAG_DEFAULTS }, source: "default", warnings };
  }
  const own = obj && typeof obj === "object" && !Array.isArray(obj) ? obj[account] : null;
  if (!own || typeof own !== "object" || Array.isArray(own)) {
    warnings.push(`경고: ${flagsPath}에 계정 "${account}" 항목 없음 — 기본값 사용`);
    return { values: { ...FLAG_DEFAULTS }, source: "default", warnings };
  }
  const values = { ...FLAG_DEFAULTS };
  for (const [k, v] of Object.entries(own)) {
    if (!ALLOWED_KEYS.includes(k)) {
      warnings.push(`경고: 허용되지 않은 키 "${k}" 무시`);
      continue;
    }
    // 개행이 든 값은 GITHUB_OUTPUT에 다른 키를 주입할 수 있으므로 거부한다.
    if (typeof v !== "string" || /[\r\n]/.test(v)) {
      warnings.push(`경고: ${k} 값이 한 줄 문자열이 아님 — 기본값 "${FLAG_DEFAULTS[k]}" 유지`);
      continue;
    }
    values[k] = v;
  }
  return { values, source: "file", warnings };
}

function runCheck(path) {
  let obj;
  try {
    obj = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    console.error(`flags check: FAIL — 파싱 실패 ${e.message}`);
    process.exit(1);
  }
  const errors = checkFlags(obj);
  if (errors.length) {
    console.error(`flags check: FAIL (${errors.length}건)`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log("flags check: PASS");
}

function runResolve(dataPath) {
  const flagsPath = process.env.FLAGS_FILE || join(ROOT, "experiments", "flags.json");
  const account = accountOfData(dataPath);
  const { values, source, warnings } = resolveFlags(flagsPath, account);
  for (const w of warnings) console.warn(w);

  const lines = ALLOWED_KEYS.map((k) => `${k}=${values[k]}`);
  for (const k of ALLOWED_KEYS) console.log(`${k}=${values[k]} (source=${source}, account=${account})`);
  // 허용 키만 쓴다(resolveFlags가 화이트리스트·한 줄 값을 보장).
  try {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### 실험 플래그 (${account}, source=${source})\n\n${lines.map((l) => `- \`${l}\``).join("\n")}\n\n`,
      );
    }
  } catch (e) {
    // 출력 파일 쓰기 실패여도 발행은 막지 않는다 — 렌더 스텝은 빈 값(기본 동작)으로 진행한다.
    console.warn(`경고: 출력 쓰기 실패 — ${e.message}`);
  }
}

// 훅 프레임별 프롬프트 정본. 알 수 없는 값·파일 손상은 v2로 떨어진다(fail-safe, 경고는 stderr로만).
const HOOK_PROMPTS = {
  "": ["contracts/hook-muleori/prompt.txt", "v2"],
  action: ["contracts/hook-muleori-action/prompt.txt", "action"],
};

function runHookPrompt() {
  const flagsPath = process.env.FLAGS_FILE || join(ROOT, "experiments", "flags.json");
  const { values, warnings } = resolveFlags(flagsPath, "muleori");
  for (const w of warnings) console.warn(w);
  const known = Object.hasOwn(HOOK_PROMPTS, values.HOOK_FRAME_MULEORI);
  if (!known) console.warn(`경고: HOOK_FRAME_MULEORI 값 "${values.HOOK_FRAME_MULEORI}" 알 수 없음 — v2 사용`);
  const [promptPath, frame] = HOOK_PROMPTS[known ? values.HOOK_FRAME_MULEORI : ""];
  console.log(`${promptPath} frame=${frame}`);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--hook-prompt") {
    runHookPrompt();
    return;
  }
  if (args[0] === "--check") {
    if (!args[1]) {
      console.error("사용법: node scripts/flags.mjs --check <flags.json>");
      process.exit(2);
    }
    runCheck(args[1]);
    return;
  }
  if (!args[0]) {
    console.error("사용법: node scripts/flags.mjs <data.json> | --check <flags.json> | --hook-prompt");
    process.exit(2);
  }
  runResolve(args[0]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
