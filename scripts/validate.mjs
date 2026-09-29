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
// 신선도 게이트 시행일 — 이전 회차(sourceDate 없음)를 재빌드해도 반려되지 않게 한다.
const FRESHNESS_SINCE = "2026-09-30";
const MUSIC_CREDIT = "Music: Kevin MacLeod (incompetech.com), CC BY 4.0";
// 계정(account) 허용값 — 없으면 "muleori"(물어오리)로 간주한다(하위 호환).
const ACCOUNTS = ["muleori", "aibrief"];

// ─── 신선도 게이트 (2026-09-29: 9/27 22시 기사가 9/29-am에 편입된 사고 대응) ───
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
// 허용 창: json.date(D)의 KST 00:00 기준 시간 오프셋 [하한, 상한] (양끝 포함)
const FRESHNESS_WINDOWS = {
  am: { from: -9, to: 10, text: "D-1 15:00 ~ D 10:00" },
  pm: { from: 6, to: 20, text: "D 06:00 ~ D 20:00" },
};

// KST 오프셋(또는 Z)이 붙은 ISO 8601만 받는다(초 선택). 파싱 불가·오프셋 없음이면 null.
function parseSourceDate(str) {
  if (typeof str !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(str)) return null;
  const t = Date.parse(str);
  return Number.isNaN(t) ? null : t;
}

const kstDateStr = (ms) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);

// 유효한 달력 날짜면 UTC 자정 epoch(ms), 아니면 null.
function ymdToMs(y, m, d) {
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? t : null;
}

// sourceLink에서 날짜 패턴을 찾아 UTC 자정 epoch(ms)로 반환한다. 없으면 null.
// 패턴: /YYYY/MM/DD  ·  /YYYY-MM-DD  ·  20YYMMDD로 시작하는 연속 숫자열(유효한 날짜만)
function urlDateMs(url) {
  if (typeof url !== "string") return null;
  const patterns = [
    /\/(20\d{2})\/(\d{2})\/(\d{2})(?!\d)/g,
    /\/(20\d{2})-(\d{2})-(\d{2})(?!\d)/g,
    /(?<!\d)(20\d{2})(\d{2})(\d{2})\d*/g,
  ];
  for (const re of patterns) {
    for (const m of url.matchAll(re)) {
      const t = ymdToMs(+m[1], +m[2], +m[3]);
      if (t != null) return t;
    }
  }
  return null;
}

// 신선도 게이트: 기준은 현재 시각이 아니라 json.date라서 옛 회차 재빌드에도 결정론적이다.
function checkFreshness(issue, label, json, violations) {
  // 날짜만(YYYY-MM-DD): 클라우드 루틴은 기사 페이지를 거의 못 연다(2026-09-29 실측 — 뉴스 도메인 전부 EGRESS_BLOCKED).
  // 이때는 URL에 박힌 날짜가 sourceDate와 같을 때만 인정하고 날짜 단위로 판정한다(am=D-1·D, pm=D).
  if (typeof issue.sourceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(issue.sourceDate)) {
    const u = urlDateMs(issue.sourceLink);
    const ud = u == null ? null : new Date(u).toISOString().slice(0, 10);
    if (ud !== issue.sourceDate) {
      violations.push(
        `[신선도] ${label} sourceDate ${issue.sourceDate}(날짜만) — sourceLink URL 날짜(${ud ?? "없음"})와 일치해야 날짜만 허용`
      );
      return;
    }
    const allowed = json.slot === "am" ? [kstDateStr(Date.parse(`${json.date}T00:00:00+09:00`) - DAY_MS), json.date] : [json.date];
    if (!allowed.includes(issue.sourceDate)) {
      violations.push(`[신선도] ${label} sourceDate ${issue.sourceDate}(날짜만) — ${json.slot} 허용 날짜 ${allowed.join("·")} 밖`);
    }
    return;
  }
  const t = parseSourceDate(issue.sourceDate);
  if (t == null) {
    violations.push(
      issue.sourceDate == null || issue.sourceDate === ""
        ? `[신선도] ${label}.sourceDate 누락 — KST 오프셋 포함 ISO 8601 필수 (예: 2026-09-28T21:30:00+09:00)`
        : `[신선도] ${label}.sourceDate "${issue.sourceDate}" — 파싱 불가 또는 오프셋 없음 (예: 2026-09-28T21:30:00+09:00)`
    );
    return;
  }
  const win = FRESHNESS_WINDOWS[json.slot];
  const d0 = /^\d{4}-\d{2}-\d{2}$/.test(json.date ?? "") ? Date.parse(`${json.date}T00:00:00+09:00`) : NaN;
  if (!Number.isNaN(d0) && (t < d0 + win.from * HOUR_MS || t > d0 + win.to * HOUR_MS)) {
    violations.push(
      `[신선도] ${label} sourceDate ${issue.sourceDate} — ${json.slot} 창 ${win.text}(KST, D=${json.date}) 밖`
    );
  }
  // URL 날짜 교차 대조: 루틴이 sourceDate를 지어내는 것 방지. 패턴이 없으면 생략.
  const u = urlDateMs(issue.sourceLink);
  if (u != null) {
    const diffDays = Math.abs(Date.parse(`${kstDateStr(t)}T00:00:00Z`) - u) / DAY_MS;
    if (diffDays > 1) {
      violations.push(
        `[신선도] ${label} sourceLink 날짜(${new Date(u).toISOString().slice(0, 10)})와 sourceDate(${kstDateStr(t)}) 차이 ${diffDays}일 > 1일 — sourceDate 불일치`
      );
    }
  }
}

// 사실성 게이트: issue 단위 어댑터. 공유 모듈의 checkFactuality를 [사실성] 라벨로 감싼다.
function checkFactuality(issue, label, violations) {
  const source = `${issue.sourceTitle || ""} ${issue.sourceDesc || ""}`;
  sharedCheckFactuality(issue.title, issue.summary, source, violations, `[사실성] ${label}`);
}

// ─── 핵심 검증 ───────────────────────────────────────────────────
// 제목 중복 판정용 정규화 — 공백·문장부호·따옴표를 모두 제거해 표기 차이를 무시한다.
// (contracts/hook-muleori/asserts.js의 normalizeForDup과 동일 규칙. 규칙이 세 줄이라 각자 둔다.)
function normalizeForDup(s) {
  return String(s)
    .replace(/\s+/g, "")
    .replace(/["'`“”‘’「」『』《》〈〉]/g, "")
    .replace(/[.,!?…·、。，！？:;~\-–—()[\]{}]/g, "");
}

// 정규화 후 동일하거나 한쪽이 다른 쪽을 포함하면 중복으로 본다. 한쪽이 비면 판정하지 않는다.
function isDupWithTitle(hookLine, title) {
  const a = normalizeForDup(hookLine || "");
  const b = normalizeForDup(title || "");
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// warnings: FAIL이 아닌 경고를 담는 배열(호출부가 출력). 도입기 필드(narration)의 부재 알림용.
// stem: 파일명 stem(예: "2026-08-18-am", "ai-2026-08-18"). 파일 경로로 실행할 때만 주어지며,
//       계정(account)과 파일명 접두의 정합을 교차 검증하는 데 쓴다(없으면 그 검사만 생략).
function validate(json, warnings = [], stem = null, { freshnessSince = FRESHNESS_SINCE } = {}) {
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

      // 제목 중복(2026-09-14 훅 v2): rank1 title은 화면에 따로 뜨므로 훅이 그 축약이면 같은 정보가 두 번 나간다.
      // 계약 프로브는 contracts/hook-muleori/asserts.js의 dupWithTitle(동일 규칙, FAIL 판정).
      // 여기서는 warnings로만 남긴다 — 과거 72회차 중 8.3% 발생이라 FAIL로 올리면 결방이 난다.
      if (isDupWithTitle(json.hookLine, json.issues[0].title)) {
        warnings.push("[훅] hookLine이 rank1 제목과 중복 — 미완결형으로 재작성 권장");
      }
    }
  }

  const isMuleoriSlot =
    (json.slot === "am" || json.slot === "pm") && account !== "aibrief" && String(json.date ?? "") >= freshnessSince;

  json.issues.forEach((issue, i) => {
    const label = `issue[${i + 1}]`;

    // (1) 구조: rank 연속(1부터)
    if (issue.rank !== i + 1) {
      v.push(`[구조] ${label} rank=${issue.rank} — ${i + 1}이어야 함(연속)`);
    }

    // (1) 구조: 필수 필드. imagePrompt는 aibrief(오리 기자·무료 버전, 이미지 미사용)만 선택.
    for (const f of ["category", "kicker", "title", "summary", "sourceTitle", "sourceDesc", "imagePrompt"]) {
      if (f === "imagePrompt" && account === "aibrief") continue;
      if (!issue[f]) v.push(`[구조] ${label}.${f} 누락`);
    }

    // (4) 신선도: 물어오리 회차(slot am|pm + aibrief 아님)만. slot 없는 레거시·sample·aibrief는 무검사.
    if (isMuleoriSlot) checkFreshness(issue, label, json, v);

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

  // slot-am / slot-pm: slot 필드 정상값 → PASS (물어오리 회차라 신선도 창 안 sourceDate 필요. sample date=2026-07-21)
  const setSourceDate = (fx, iso) => {
    for (const issue of fx.issues) issue.sourceDate = iso;
  };
  const slotAm = clone();
  slotAm.slot = "am";
  setSourceDate(slotAm, "2026-07-20T21:30:00+09:00");
  const slotPm = clone();
  slotPm.slot = "pm";
  setSourceDate(slotPm, "2026-07-21T12:00:00+09:00");

  // 신선도 음성 대조군 (반드시 FAIL해야 하는 표본)
  // fresh-missing: sourceDate 누락
  const freshMissing = clone();
  freshMissing.slot = "am";
  // fresh-out-of-window: 9/29-am에 9/27 22:06 기사 (2026-09-29-am 야구 결승 사고 재현)
  const freshOut = clone();
  freshOut.date = "2026-09-29";
  freshOut.slot = "am";
  setSourceDate(freshOut, "2026-09-29T07:00:00+09:00");
  freshOut.issues[1].sourceDate = "2026-09-27T22:06:00+09:00";
  // fresh-url-mismatch: URL은 7/17인데 sourceDate는 창 안(지어낸 날짜)
  const freshUrl = clone();
  freshUrl.slot = "am";
  setSourceDate(freshUrl, "2026-07-20T21:30:00+09:00");
  freshUrl.issues[0].sourceLink = "https://www.example.com/news/2026/07/17/20260717000123";
  // fresh-no-offset: 오프셋 없는 sourceDate
  const freshNoOffset = clone();
  freshNoOffset.slot = "am";
  setSourceDate(freshNoOffset, "2026-07-20T21:30:00");

  // 날짜만 sourceDate(2026-09-29 — 루틴이 기사 페이지를 못 여는 환경): URL 날짜와 일치할 때만 날짜 단위 판정
  const dateOnly = (slot, dates) => {
    const j = clone();
    j.slot = slot;
    j.issues.forEach((it, i) => {
      const d = dates[i] ?? dates[0];
      it.sourceDate = d;
      it.sourceLink = `https://www.example.com/news/${d.replace(/-/g, "")}000123`;
    });
    return j;
  };
  const freshDateOnly = dateOnly("am", ["2026-07-21", "2026-07-20"]);
  const freshDateOnlyNoUrl = dateOnly("am", ["2026-07-21"]);
  freshDateOnlyNoUrl.issues[0].sourceLink = "https://www.example.com/sports/final-match";
  const freshDateOnlyOld = dateOnly("am", ["2026-07-21", "2026-07-19"]);
  const freshDateOnlyPmPrev = dateOnly("pm", ["2026-07-21", "2026-07-20"]);

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

  // aibrief-no-image-prompt: account=aibrief + imagePrompt 부재 → PASS(무료 버전, 이미지 미사용)
  const aibriefNoImagePrompt = clone();
  aibriefNoImagePrompt.account = "aibrief";
  for (const issue of aibriefNoImagePrompt.issues) delete issue.imagePrompt;

  // 훅 v2 제목 중복 게이트(2026-09-14). 두 픽스처 모두 위반 0건(PASS)이고 warnings로만 갈린다.
  // narration을 전 이슈에 채워 "narration 없음" 경고를 없앤다 — 훅 경고만 남겨 대조를 선명하게 한다
  // (동시에 rank 1 narration 선택 필드가 기존 30자·1문장·존댓말 규칙으로 그대로 채점되는지 확인한다).
  const withNarration = () => {
    const c = clone();
    const scripts = [
      "신진서 9단이 바둑 AI를 이겼습니다.",
      "로봇청소기에서 불이 났습니다.",
      "후티 반군이 해상봉쇄를 선언했습니다.",
      "대통령이 부동산 불로소득을 비판했습니다.",
      "오세훈 시장직 선고가 생중계됩니다.",
    ];
    c.issues.forEach((issue, i) => {
      if (scripts[i]) issue.narration = scripts[i];
    });
    return c;
  };

  // hook-dup-title: hookLine이 rank1 title과 정규화 후 동일 → PASS + 훅 경고 1건
  const hookDupTitle = withNarration();
  hookDupTitle.issues[0].title = hookDupTitle.hookLine;

  // hook-no-dup: hookLine이 rank1 title과 겹치지 않음 → PASS + 경고 0건
  const hookNoDup = withNarration();
  hookNoDup.hookLine = "바둑 AI가 사람에게 졌습니다";

  return {
    katago,
    number,
    hangulPrompt,
    hookDupTitle,
    hookNoDup,
    slotAm,
    slotPm,
    badSlot,
    accountNone,
    badAccount,
    badAccountStem,
    aibriefNoImagePrompt,
    freshMissing,
    freshOut,
    freshUrl,
    freshNoOffset,
    freshDateOnly,
    freshDateOnlyNoUrl,
    freshDateOnlyOld,
    freshDateOnlyPmPrev,
  };
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
  // 훅 v2 경고 게이트는 단독 실행으로도 확인할 수 있게 파일로 남긴다(ISC-2.1).
  writeFileSync(
    join(FIXTURE_DIR, "hook-dup-title.json"),
    JSON.stringify(bad.hookDupTitle, null, 2) + "\n"
  );
  writeFileSync(join(FIXTURE_DIR, "hook-no-dup.json"), JSON.stringify(bad.hookNoDup, null, 2) + "\n");

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
    {
      name: "PASS — aibrief + imagePrompt 부재(무료 버전, 이미지 미사용)",
      fixture: bad.aibriefNoImagePrompt,
      stem: "ai-2026-08-18",
      expectPass: true,
    },
    // 훅 v2 제목 중복 경고 게이트 (2026-09-14) — 위반이 아니라 warnings로만 갈린다.
    {
      name: "PASS+경고 — hook-dup-title(hookLine이 rank1 제목과 중복)",
      fixture: bad.hookDupTitle,
      expectPass: true,
      expectWarnings: 1,
    },
    {
      name: "PASS — hook-no-dup(훅과 rank1 제목이 다름)",
      fixture: bad.hookNoDup,
      expectPass: true,
      expectWarnings: 0,
    },
    // 신선도 게이트 (2026-09-29)
    { name: "FAIL — fresh-missing(sourceDate 누락)", fixture: bad.freshMissing, expectPass: false },
    { name: "FAIL — fresh-out-of-window(9/29-am에 9/27 22:06 기사)", fixture: bad.freshOut, expectPass: false },
    { name: "FAIL — fresh-url-mismatch(URL 날짜와 sourceDate 불일치)", fixture: bad.freshUrl, expectPass: false },
    { name: "FAIL — fresh-no-offset(오프셋 없는 sourceDate)", fixture: bad.freshNoOffset, expectPass: false },
    { name: "PASS — fresh-date-only(URL 날짜와 일치하는 날짜만, am D-1·D)", fixture: bad.freshDateOnly, expectPass: true },
    { name: "FAIL — fresh-date-only-no-url(URL에 날짜 없는데 날짜만)", fixture: bad.freshDateOnlyNoUrl, expectPass: false },
    { name: "FAIL — fresh-date-only-old(am에 D-2 날짜)", fixture: bad.freshDateOnlyOld, expectPass: false },
    { name: "FAIL — fresh-date-only-pm-prev(pm에 D-1 날짜)", fixture: bad.freshDateOnlyPmPrev, expectPass: false },
    // 시행일 이전 회차는 sourceDate 없이 통과(재빌드 보호) — 이 케이스만 기본 시행일로 판정한다.
    { name: "PASS — fresh-before-since(시행일 이전 회차 면제)", fixture: bad.freshMissing, expectPass: true, since: FRESHNESS_SINCE },
  ];

  let allOk = true;
  for (const { name, fixture, expectPass, stem = null, expectWarnings = null, since = "0000" } of cases) {
    const warnings = [];
    // 픽스처는 7월 날짜라 시행일을 해제("0000")하고 판정한다.
    const violations = validate(fixture, warnings, stem, { freshnessSince: since });
    const passed = violations.length === 0;
    // expectWarnings가 지정된 케이스만 경고 건수를 함께 채점한다(기존 케이스 판정은 불변).
    const warnOk = expectWarnings === null || warnings.length === expectWarnings;
    const ok = passed === expectPass && warnOk;
    console.error(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) {
      console.error(`  기대: ${expectPass ? "PASS" : "FAIL"}, 실제: ${passed ? "PASS" : "FAIL"}`);
      if (!warnOk) console.error(`  기대 경고: ${expectWarnings}건, 실제: ${warnings.length}건`);
      for (const x of violations) console.error(`    ${x}`);
      for (const w of warnings) console.error(`    ${w}`);
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
