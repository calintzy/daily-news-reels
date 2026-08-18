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
import { basename, dirname, join } from "node:path";
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
const MAX_NARRATION_LEN = 30; // TTS 낭독 대본 상한 — hookLine 30자 게이트와 동일 기준
const MIN_ISSUES = 4;
const MAX_ISSUES = 6;
const MUSIC_CREDIT = "Music: Kevin MacLeod (incompetech.com), CC BY 4.0";
// 계정(account) 허용값 — 없으면 "muleori"(물어오리)로 간주한다(하위 호환).
const ACCOUNTS = ["muleori", "aibrief"];

// 사실성 게이트: issue 단위 어댑터. 공유 모듈의 checkFactuality를 [사실성] 라벨로 감싼다.
function checkFactuality(issue, label, violations) {
  const source = `${issue.sourceTitle || ""} ${issue.sourceDesc || ""}`;
  sharedCheckFactuality(issue.title, issue.summary, source, violations, `[사실성] ${label}`);
}

// ─── 핵심 검증 ───────────────────────────────────────────────────
// warnings: FAIL이 아닌 경고를 담는 배열(호출부가 출력). 도입기 필드(narration)의 부재 알림용.
// stem: 파일명 stem(예: "2026-08-18-am", "ai-2026-08-18"). 파일 경로로 실행할 때만 주어지며,
//       계정(account)과 파일명 접두의 정합을 교차 검증하는 데 쓴다(없으면 그 검사만 생략).
function validate(json, warnings = [], stem = null) {
  const v = [];

  // (1) 구조: account(계정)는 선택 — 없으면 "muleori"(물어오리). 기존 데이터는 전부 무경고 통과한다.
  const account = json.account ?? null;
  if (account != null && !ACCOUNTS.includes(account)) {
    v.push(`[구조] account="${account}" — "muleori" 또는 "aibrief"만 허용`);
  }
  // 계정-파일명 정합: ai- 접두 stem ⟺ account "aibrief". 어긋나면 산출물 키와 발행 계정이
  // 엇갈려 잘못된 계정으로 게시될 수 있으므로 FAIL로 막는다.
  if (stem) {
    const isAiStem = stem.startsWith("ai-");
    if (isAiStem && account !== "aibrief") {
      v.push(
        `[계정] 파일명 stem "${stem}"은 ai- 접두(오리 기자)인데 account=${account == null ? "없음" : `"${account}"`} — account: "aibrief" 필요`
      );
    }
    if (account === "aibrief" && !isAiStem) {
      v.push(
        `[계정] account="aibrief"(오리 기자)인데 파일명 stem "${stem}"이 ai- 접두가 아님 — data/ai-YYYY-MM-DD.json 이어야 함`
      );
    }
  }

  // (1) 구조: 최상위 필수 필드
  if (!json.date) v.push("[구조] date 누락");
  // 2026-08-08 훅 수술: todayOneLiner(커버용) → hookLine(0초 결론형 훅 문장)
  if (!json.hookLine) v.push("[구조] hookLine 누락");
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

  // (2) 문체: hookLine 존댓말 + 30자 하드 게이트(훅은 한눈에 읽혀야 한다)
  if (json.hookLine) {
    checkHonorific(json.hookLine, "hookLine", v);
    if ([...json.hookLine].length > 30) {
      v.push(`[구조] hookLine ${[...json.hookLine].length}자 — 30자 이내여야 함`);
    }
    // 사실성: hookLine은 rank1 이슈 원문과 대조 — 훅이 낚시가 되는 것 방지
    if (Array.isArray(json.issues) && json.issues[0]) {
      const src1 = `${json.issues[0].sourceTitle || ""} ${json.issues[0].sourceDesc || ""}`;
      sharedCheckFactuality(json.hookLine, "", src1, v, "[사실성] hookLine(rank1 대조)");
    }
  }

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

    // narration(TTS 낭독 대본, 2026-08-17 훅 수술 2단계):
    //   존재하면 hookLine과 동일한 공유 프로브로 게이트한다 — 30자·존댓말·문장 1개·해당 이슈 원문 대조.
    //   부재 시 FAIL이 아니라 경고만 남긴다(도입기 — 새 스펙 반영 전 데이터·과거 데이터의 발행을 막지 않는다).
    const narration = typeof issue.narration === "string" ? issue.narration.trim() : "";
    if (narration) {
      // (1) 구조: 길이·문장 수
      if (charLen(narration) > MAX_NARRATION_LEN) {
        v.push(`[구조] ${label}.narration ${charLen(narration)}자 > ${MAX_NARRATION_LEN}자`);
      }
      const nsc = splitSentences(narration).length;
      if (nsc > 1) v.push(`[구조] ${label}.narration 문장 ${nsc}개 > 1개`);

      // (2) 문체: 존댓말 종결 — hookLine과 동일 판정
      checkHonorific(narration, `${label}.narration`, v);

      // (3) 사실성: 그 이슈의 sourceTitle+sourceDesc 대조 — hookLine의 rank1 대조와 동일 방식
      if (issue.sourceTitle != null && issue.sourceDesc != null) {
        const src = `${issue.sourceTitle || ""} ${issue.sourceDesc || ""}`;
        sharedCheckFactuality(narration, "", src, v, `[사실성] ${label}.narration(원문 대조)`);
      }
    } else if ((issue.rank ?? i + 1) >= 2) {
      warnings.push(`경고: rank ${issue.rank ?? i + 1} narration 없음 — TTS 팔이면 대조군 폴백됨`);
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

  // account-none: account 없음(물어오리 간주) → stem이 숫자여도 PASS(하위 호환)
  const accountNone = clone();

  // bad-account: 허용값 밖 계정 → 구조 FAIL
  const badAccount = clone();
  badAccount.account = "duckpress";

  // bad-account-stem: aibrief인데 숫자 stem → 계정 FAIL
  const badAccountStem = clone();
  badAccountStem.account = "aibrief";

  return { katago, number, hangulPrompt, slotAm, slotPm, badSlot, accountNone, badAccount, badAccountStem };
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
    // 계정 계약 (2026-08-18 멀티 계정화)
    {
      name: "PASS — account 없음 + 숫자 stem(물어오리 하위 호환)",
      fixture: bad.accountNone,
      stem: "2026-08-18-am",
      expectPass: true,
    },
    { name: "FAIL — bad-account(허용값 밖 계정)", fixture: bad.badAccount, expectPass: false },
    {
      name: "FAIL — bad-account-stem(aibrief인데 숫자 stem)",
      fixture: bad.badAccountStem,
      stem: "2026-08-18-am",
      expectPass: false,
    },
  ];

  let allOk = true;
  for (const { name, fixture, expectPass, stem = null } of cases) {
    const violations = validate(fixture, [], stem);
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
  // 산출물 키는 파일명 stem(예: 2026-08-18-am, ai-2026-08-18) — 계정 정합 검사에 쓴다.
  const stem = basename(fileArg, ".json");
  const warnings = [];
  const violations = validate(json, warnings, stem);
  for (const w of warnings) console.error(w);
  if (violations.length === 0) {
    console.log("validate: PASS");
    process.exit(0);
  }
  console.error(`validate: FAIL (위반 ${violations.length}건)`);
  for (const x of violations) console.error(x);
  process.exit(1);
}

main();
