#!/usr/bin/env node
// OpenAI Images(gpt-image-1.5)로 커버 + 이슈 이미지 생성
// 사용법: node scripts/genimages.mjs data/DATE.json [--dry-run]
//   출력: assets/img/<date>/cover.png, issue-1.png ~ issue-N.png
//   장별 멱등(파일 있으면 스킵), 실패 장 1회 재시도, 그래도 실패면 전체 exit 1
//   --dry-run: API 호출 없이 프롬프트 6건 출력만
//   env: OPENAI_API_KEY, IMAGE_QUALITY(기본 medium)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const IMAGES_ENDPOINT = "https://api.openai.com/v1/images/generations";
const MODEL = "gpt-image-1.5";
const SIZE = "1024x1536";

// 커버 프롬프트 기본값 (데이터에 coverPrompt 없을 때)
const DEFAULT_COVER_PROMPT =
  "photojournalism, pre-dawn city skyline with a lit newsroom mood, cool blue hour tones, soft haze over the buildings, cinematic wide angle, no people, no text, vertical 9:16 composition";

function buildPrompts(data) {
  const cover = data.coverPrompt || DEFAULT_COVER_PROMPT;
  const prompts = [{ name: "cover", prompt: cover }];
  for (const issue of data.issues) {
    prompts.push({ name: `issue-${issue.rank}`, prompt: issue.imagePrompt });
  }
  return prompts;
}

async function generateOne(prompt, apiKey, quality) {
  const res = await fetch(IMAGES_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODEL, prompt, size: SIZE, quality, n: 1 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 키를 로그에 절대 노출하지 않는다 — 에러 본문만
    const msg = json?.error?.message || JSON.stringify(json);
    throw new Error(`Images API ${res.status}: ${msg}`);
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("응답에 b64_json 없음");
  return Buffer.from(b64, "base64");
}

async function main() {
  const jsonPath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!jsonPath) {
    console.error("사용법: node scripts/genimages.mjs data/DATE.json [--dry-run]");
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
  // 산출물 키는 파일명 stem(예: 2026-07-23-am). 슬롯 없는 기존 파일은 stem=date로 동일 동작.
  const stem = basename(jsonPath, ".json");
  const prompts = buildPrompts(data);

  if (dryRun) {
    console.log(`--dry-run: 프롬프트 ${prompts.length}건 (${stem})`);
    for (const { name, prompt } of prompts) {
      console.log(`\n[${name}]`);
      console.log(prompt);
    }
    process.exit(0);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY 환경변수 필요");
    process.exit(1);
  }
  const quality = process.env.IMAGE_QUALITY || "medium";
  const outDir = join(ROOT, "assets", "img", stem);
  mkdirSync(outDir, { recursive: true });

  let ok = 0;
  let skipped = 0;
  const failed = [];

  for (const { name, prompt } of prompts) {
    const outPath = join(outDir, `${name}.png`);
    if (existsSync(outPath)) {
      skipped++;
      console.log(`스킵(존재): ${name}.png`);
      continue;
    }
    let buf = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        buf = await generateOne(prompt, apiKey, quality);
        break;
      } catch (e) {
        console.error(`${name} 생성 실패(시도 ${attempt}/2): ${e.message}`);
      }
    }
    if (buf) {
      writeFileSync(outPath, buf);
      ok++;
      console.log(`생성: ${name}.png`);
    } else {
      failed.push(name);
    }
  }

  console.log(`결과: 생성 ${ok} / 스킵 ${skipped} / 실패 ${failed.length}`);
  if (failed.length > 0) {
    // 부분 산출물로 렌더 진입 금지 — 전체 exit 1
    console.error(`실패 장: ${failed.join(", ")} — 렌더 진입 차단(exit 1)`);
    process.exit(1);
  }
}

main();
