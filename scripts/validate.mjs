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

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "test", "fixtures");

// ─── 상수 ────────────────────────────────────────────────────────
const MAX_TITLE_LEN = 32;
const MAX_SUMMARY_LEN = 120; // 스펙: 데이터는 110자 이내 권장, 게이트는 120자 상한
const MAX_PROMPT_LEN = 500;
const MAX_CAPTION_LEN = 2200;
const MIN_ISSUES = 4;
const MAX_ISSUES = 6;
const MUSIC_CREDIT = "Music: Kevin MacLeod (incompetech.com), CC BY 4.0";

// (2) 문체 계약: 존댓말 종결어미 화이트리스트.
// 문장이 아래 어미 중 하나로 끝나야 한다 (습니다/니다/세요/어요/아요/해요/이에요/예요 계열).
// 마침표·물음표·느낌표, 그리고 종결어미 뒤 괄호 보충까지 허용.
const HONORIFIC_RE =
  /(습니다|합니다|입니다|됩니다|있습니다|없습니다|니다|세요|해요|어요|아요|이에요|예요|에요|요)(\([^)]*\))?[.!?]?$/;

// ─── 유틸 ────────────────────────────────────────────────────────
function charLen(s) {
  return [...String(s)].length;
}

// 문장 분리: 마침표·물음표·느낌표 + 공백 기준. 마지막 단편 포함.
function splitSentences(text) {
  const clean = String(text).trim();
  const parts = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (parts ? parts.map((s) => s.trim()) : [clean]).filter(Boolean);
}

function checkHonorific(text, label, violations) {
  const sentences = splitSentences(text);
  for (const s of sentences) {
    if (!HONORIFIC_RE.test(s)) {
      violations.push(`[문체] ${label}: "${s.slice(0, 40)}…" — 존댓말 종결어미 아님`);
    }
  }
}

// ─── (3) 사실성 게이트: 토큰 추출 ─────────────────────────────────
// summary+title에서 다음 세 종류 토큰을 뽑는다.
//   ① 아라비아 숫자 토큰 (콤마 제거 후 비교)
//   ② 라틴문자 토큰 (2자 이상, 소문자化 substring 매칭)
//   ③ 괄호·따옴표 안의 한글 토큰
function extractNumberTokens(text) {
  const found = new Set();
  // 콤마 포함 숫자(1,000)까지 잡고 콤마 제거. 소수점도 하나의 토큰으로.
  const matches = String(text).match(/\d[\d,]*(?:\.\d+)?/g) || [];
  for (const m of matches) found.add(m.replace(/,/g, ""));
  return [...found];
}

function extractLatinTokens(text) {
  const found = new Set();
  const matches = String(text).match(/[A-Za-z]{2,}/g) || [];
  for (const m of matches) found.add(m.toLowerCase());
  return [...found];
}

function extractQuotedHangulTokens(text) {
  const found = new Set();
  const s = String(text);
  // 괄호 (), 따옴표 "" '' “” ‘’ 안의 내용에서 한글 토큰(2자 이상 연속 한글)을 추출
  const containers = [
    ...(s.match(/\(([^)]*)\)/g) || []),
    ...(s.match(/"([^"]*)"/g) || []),
    ...(s.match(/'([^']*)'/g) || []),
    ...(s.match(/“([^”]*)”/g) || []),
    ...(s.match(/‘([^’]*)’/g) || []),
  ];
  for (const c of containers) {
    const inner = c.slice(1, -1);
    const hangul = inner.match(/[가-힣]+/g) || [];
    for (const h of hangul) if (charLen(h) >= 2) found.add(h);
  }
  return [...found];
}

// 원문(source) 정규화: 콤마 제거·소문자化한 형태를 substring 대조에 쓴다.
function checkFactuality(issue, label, violations) {
  const probe = `${issue.title || ""} ${issue.summary || ""}`;
  const source = `${issue.sourceTitle || ""} ${issue.sourceDesc || ""}`;
  const sourceNoComma = source.replace(/,/g, "");
  const sourceLower = sourceNoComma.toLowerCase();

  for (const num of extractNumberTokens(probe)) {
    if (!sourceNoComma.includes(num)) {
      violations.push(`[사실성] ${label}: 숫자 "${num}" 이(가) 원문에 없음`);
    }
  }
  for (const lat of extractLatinTokens(probe)) {
    if (!sourceLower.includes(lat)) {
      violations.push(`[사실성] ${label}: 라틴 토큰 "${lat}" 이(가) 원문에 없음`);
    }
  }
  for (const hg of extractQuotedHangulTokens(probe)) {
    if (!source.includes(hg)) {
      violations.push(`[사실성] ${label}: 인용 한글 "${hg}" 이(가) 원문에 없음`);
    }
  }
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
      const p = issue.imagePrompt;
      if (/[가-힣]/.test(p)) {
        v.push(`[프롬프트] ${label}.imagePrompt 한글 포함 — 영문만 허용`);
      }
      if (!/no people/i.test(p)) v.push(`[프롬프트] ${label}.imagePrompt 'no people' 누락`);
      if (!/no text/i.test(p)) v.push(`[프롬프트] ${label}.imagePrompt 'no text' 누락`);
      if (charLen(p) > MAX_PROMPT_LEN) {
        v.push(`[프롬프트] ${label}.imagePrompt ${charLen(p)}자 > ${MAX_PROMPT_LEN}자`);
      }
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
