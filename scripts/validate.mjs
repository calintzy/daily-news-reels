#!/usr/bin/env node
// 릴스 데이터 계약 이진 게이트
// 사용법: node scripts/validate.mjs data/sample.json   → validate: PASS / FAIL(exit 1)
//        node scripts/validate.mjs --self-test         → 내장 픽스처 전체 검증
//
// 검증 범주는 세 가지로 분리한다 (코드 주석으로 명시):
//   (1) 구조 계약   — 필수 필드·개수·길이·연속성
//   (2) 문체 계약   — 존댓말 종결어미 (사실성과는 별개 범주. 말투만 본다)
//   (3) 사실성 게이트(카타고 게이트) — summary/title의 토큰이 원문(sourceTitle+sourceDesc)에
//        문자열로 존재하는지 결정론적으로 대조. 원문에 없는 고유명사·수치 유입을 차단한다.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "test", "fixtures");

// 기사 단위 규칙은 계약 프로브(contracts/rewrite/asserts.js)와 공유하는 CJS 모듈에서 가져온다.
// 규칙을 복사하지 않으므로 이중화 드리프트가 없다 (PROBES.md 단일 모듈 패턴).
const require = createRequire(import.meta.url);
const {
  MAX_TITLE_LEN,
  MAX_SUMMARY_LEN,
  charLen,
  splitSentences,
  checkHonorific,
  checkFactuality: sharedCheckFactuality,
  checkImagePrompt,
} = require("./rewrite-probes.cjs");

// ─── 상수 (최상위 구조·캡션 전용 — 공유 모듈 밖) ─────────────────
const MAX_CAPTION_LEN = 2200;
const MIN_ISSUES = 4;
const MAX_ISSUES = 6;
const MUSIC_CREDIT = "Music: Kevin MacLeod (incompetech.com), CC BY 4.0";

// 사실성 게이트: issue 단위 어댑터. 공유 모듈의 checkFactuality를 [사실성] 라벨로 감싼다.
function checkFactuality(issue, label, violations) {
  const source = `${issue.sourceTitle || ""} ${issue.sourceDesc || ""}`;
  sharedCheckFactuality(issue.title, issue.summary, source, violations, `[사실성] ${label}`);
}

// ─── 핵심 검증 ───────────────────────────────────────────────────
function validate(json) {
  const v = [];

  // (1) 구조: 최상위 필수 필드
  if (!json.date) v.push("[구조] date 누락");
  if (!json.todayOneLiner) v.push("[구조] todayOneLiner 누락");
  if (json.caption == null) v.push("[구조] caption 누락");

  // (1) 구조: slot(회차)은 선택 — 있으면 "am"|"pm"만 허용(없으면 하위 호환 통과)
  if (json.slot != null && json.slot !== "am" && json.slot !== "pm") {
    v.push(`[구조] slot="${json.slot}" — "am" 또는 "pm"만 허용`);
  }

  if (!Array.isArray(json.issues)) {
    v.push("[구조] issues 배열 누락");
    return v;
  }
  if (json.issues.length < MIN_ISSUES || json.issues.length > MAX_ISSUES) {
    v.push(`[구조] issues ${json.issues.length}개 — ${MIN_ISSUES}~${MAX_ISSUES}개여야 함`);
  }

  // (2) 문체: todayOneLiner 존댓말
  if (json.todayOneLiner) checkHonorific(json.todayOneLiner, "todayOneLiner", v);

  json.issues.forEach((issue, i) => {
    const label = `issue[${i + 1}]`;

    // (1) 구조: rank 연속(1부터)
    if (issue.rank !== i + 1) {
      v.push(`[구조] ${label} rank=${issue.rank} — ${i + 1}이어야 함(연속)`);
    }

    // (1) 구조: 필수 필드
    for (const f of ["category", "kicker", "title", "summary", "sourceTitle", "sourceDesc", "imagePrompt"]) {
      if (!issue[f]) v.push(`[구조] ${label}.${f} 누락`);
    }

    // (1) 구조: title 길이
    if (issue.title && charLen(issue.title) > MAX_TITLE_LEN) {
      v.push(`[구조] ${label}.title ${charLen(issue.title)}자 > ${MAX_TITLE_LEN}자`);
    }

    // (1) 구조: summary 길이·문장 수(2개 이하)
    if (issue.summary) {
      if (charLen(issue.summary) > MAX_SUMMARY_LEN) {
        v.push(`[구조] ${label}.summary ${charLen(issue.summary)}자 > ${MAX_SUMMARY_LEN}자`);
      }
      const sc = splitSentences(issue.summary).length;
      if (sc > 2) v.push(`[구조] ${label}.summary 문장 ${sc}개 > 2개`);
    }

    // (2) 문체: summary 존댓말
    if (issue.summary) checkHonorific(issue.summary, `${label}.summary`, v);

    // (3) 사실성 게이트
    if (issue.summary && issue.title && issue.sourceTitle != null && issue.sourceDesc != null) {
      checkFactuality(issue, label, v);
    }

    // 이미지 프롬프트: 영문만(한글 유입 차단), no people·no text 필수, 500자 이내
    if (issue.imagePrompt) {
      checkImagePrompt(issue.imagePrompt, v, `[프롬프트] ${label}`);
    }
  });

  // 캡션: 음악 크레딧 필수, http 링크 0건, 2200자 이내
  if (json.caption != null) {
    const c = json.caption;
    if (!c.includes(MUSIC_CREDIT)) {
      v.push(`[캡션] 음악 크레딧("${MUSIC_CREDIT}") 누락`);
    }
    if (/http/i.test(c)) v.push("[캡션] http 링크 포함 — 링크 금지");
    if (charLen(c) > MAX_CAPTION_LEN) {
      v.push(`[캡션] ${charLen(c)}자 > ${MAX_CAPTION_LEN}자`);
    }
  }

  return v;
}

// ─── self-test 픽스처 파일 생성·검증 ──────────────────────────────
// bad-katago / bad-number / bad-hangul-prompt 는 실제 파일로 만들어 검사한다.
function buildBadFixtures(sample) {
  const clone = () => JSON.parse(JSON.stringify(sample));

  // bad-katago: summary에 원문에 없는 라틴 토큰 "KataGo" 추가 → 사실성 FAIL
  const katago = clone();
  katago.issues[0].summary = "신진서 9단이 바둑 AI KataGo를 상대로 승리했습니다. 화제가 되고 있습니다.";

  // bad-number: summary에 원문에 없는 수치 "150" 추가 → 사실성 FAIL
  const number = clone();
  number.issues[0].summary = "신진서 9단이 150수 만에 바둑 AI를 꺾었습니다. 화제가 되고 있습니다.";

  // bad-hangul-prompt: imagePrompt에 한글 → 프롬프트 FAIL
  const hangulPrompt = clone();
  hangulPrompt.issues[0].imagePrompt =
    "photojournalism, 바둑판 close-up, no people, no text, vertical 9:16 composition";

  // slot-am / slot-pm: slot 필드 정상값 → PASS
  const slotAm = clone();
  slotAm.slot = "am";
  const slotPm = clone();
  slotPm.slot = "pm";

  // bad-slot: slot 필드 잘못된 값 → 구조 FAIL
  const badSlot = clone();
  badSlot.slot = "morning";

  return { katago, number, hangulPrompt, slotAm, slotPm, badSlot };
}

function runSelfTest() {
  const samplePath = join(__dirname, "..", "data", "sample.json");
  const sample = JSON.parse(readFileSync(samplePath, "utf-8"));

  // 픽스처 파일 실제 생성
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const bad = buildBadFixtures(sample);
  writeFileSync(join(FIXTURE_DIR, "bad-katago.json"), JSON.stringify(bad.katago, null, 2) + "\n");
  writeFileSync(join(FIXTURE_DIR, "bad-number.json"), JSON.stringify(bad.number, null, 2) + "\n");
  writeFileSync(
    join(FIXTURE_DIR, "bad-hangul-prompt.json"),
    JSON.stringify(bad.hangulPrompt, null, 2) + "\n"
  );

  const cases = [
    { name: "PASS — data/sample.json", fixture: sample, expectPass: true },
    { name: "FAIL — bad-katago(원문에 없는 KataGo)", fixture: bad.katago, expectPass: false },
    { name: "FAIL — bad-number(원문에 없는 150)", fixture: bad.number, expectPass: false },
    { name: "FAIL — bad-hangul-prompt(프롬프트 한글)", fixture: bad.hangulPrompt, expectPass: false },
    { name: "PASS — slot-am(정상 회차)", fixture: bad.slotAm, expectPass: true },
    { name: "PASS — slot-pm(정상 회차)", fixture: bad.slotPm, expectPass: true },
    { name: "FAIL — bad-slot(잘못된 회차값)", fixture: bad.badSlot, expectPass: false },
  ];

  let allOk = true;
  for (const { name, fixture, expectPass } of cases) {
    const violations = validate(fixture);
    const passed = violations.length === 0;
    const ok = passed === expectPass;
    console.error(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) {
      console.error(`  기대: ${expectPass ? "PASS" : "FAIL"}, 실제: ${passed ? "PASS" : "FAIL"}`);
      for (const x of violations) console.error(`    ${x}`);
      allOk = false;
    } else if (!passed) {
      for (const x of violations) console.error(`    ${x}`);
    }
  }

  if (allOk) {
    console.error(`self-test ${cases.length}/${cases.length} PASS`);
    process.exit(0);
  }
  console.error("self-test 실패");
  process.exit(1);
}

// ─── 메인 ────────────────────────────────────────────────────────
function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("사용법: node scripts/validate.mjs <data.json> | --self-test");
    process.exit(2);
  }
  let json;
  try {
    json = JSON.parse(readFileSync(fileArg, "utf-8"));
  } catch (e) {
    console.error(`[파싱 오류] ${e.message}`);
    process.exit(1);
  }
  const violations = validate(json);
  if (violations.length === 0) {
    console.log("validate: PASS");
    process.exit(0);
  }
  console.error(`validate: FAIL (위반 ${violations.length}건)`);
  for (const x of violations) console.error(x);
  process.exit(1);
}

main();
