// 기사 단위 재작성 규칙의 유일한 진실(single source of truth).
// 프로덕션 게이트(scripts/validate.mjs, ESM)와 계약 프로브(contracts/rewrite/asserts.js, CJS)가
// 이 모듈 하나를 공유한다. 규칙을 두 곳에 복사하지 않으므로 이중화 드리프트가 없다.
// replay-fidelity 등 프로브를 직접 로드하는 경로 때문에 CJS로 require 가능해야 한다.

// ─── 상수 ────────────────────────────────────────────────────────
const MAX_TITLE_LEN = 32;
const MAX_SUMMARY_LEN = 120; // 스펙: 데이터는 110자 이내 권장, 게이트는 120자 상한
const MAX_PROMPT_LEN = 500;

// 문체 계약: 존댓말 종결어미 화이트리스트.
// 문장이 아래 어미 중 하나로 끝나야 한다 (습니다/니다/세요/어요/아요/해요/이에요/예요 계열).
// 마침표·물음표·느낌표, 그리고 종결어미 뒤 괄호 보충까지 허용.
const HONORIFIC_RE =
  /(습니다|합니다|입니다|됩니다|있습니다|없습니다|니다|세요|해요|어요|아요|이에요|예요|에요|요)(\([^)]*\))?[.!?]?$/;

// ─── 유틸 ────────────────────────────────────────────────────────
function charLen(s) {
  return [...String(s)].length;
}

// 문장 분리 — 소수점("3.0%")·약어("U.S.")의 마침표를 문장 경계로 오인하지 않는다.
// PROBES.md 참조 구현(FIELD-FEEDBACK-2026-07-23 항목 7).
function splitSentences(text) {
  const ABBREV = /\b(?:U\.S|U\.K|e\.g|i\.e|etc|vs|Mr|Ms|Dr|Inc|Ltd|Corp)\.$/i;
  const out = [];
  let buf = "";
  // 문장부호(.?!) 뒤에 공백/끝이 오는 지점을 후보 경계로 훑는다.
  const parts = String(text).trim().split(/([.?!])(\s+|$)/);
  for (let i = 0; i < parts.length; i += 3) {
    const chunk = parts[i] ?? "";
    const punct = parts[i + 1] ?? "";
    const space = parts[i + 2] ?? "";
    buf += chunk + punct;
    if (!punct) continue;
    // 소수점: 마침표 앞뒤가 모두 숫자면 경계 아님 (3.0, 1.5%)
    const beforeDigit = /\d$/.test(chunk);
    const afterDigit = /^\d/.test(parts[i + 3] ?? "");
    if (punct === "." && beforeDigit && afterDigit) {
      buf += space;
      continue;
    }
    // 약어: 마침표로 끝나는 알려진 약어면 경계 아님 (U.S., etc.)
    if (punct === "." && ABBREV.test(buf.trimEnd())) {
      buf += space;
      continue;
    }
    out.push(buf.trim());
    buf = "";
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [String(text).trim()];
}

function checkHonorific(text, label, violations) {
  const sentences = splitSentences(text);
  for (const s of sentences) {
    if (!HONORIFIC_RE.test(s)) {
      violations.push(`[문체] ${label}: "${s.slice(0, 40)}…" — 존댓말 종결어미 아님`);
    }
  }
}

// ─── 사실성 게이트: 토큰 추출 ─────────────────────────────────────
// probe(title+summary)에서 다음 세 종류 토큰을 뽑는다.
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

// 사실성 대조 — probe(title+summary)의 토큰이 원문(source)에 문자열로 존재하는지 결정론적으로 대조.
// 원문에 없는 고유명사·수치 유입을 차단한다.
function checkFactuality(title, summary, source, violations, label) {
  const probe = `${title || ""} ${summary || ""}`;
  const sourceNoComma = String(source).replace(/,/g, "");
  const sourceLower = sourceNoComma.toLowerCase();
  const prefix = label ? `${label}: ` : "";

  for (const num of extractNumberTokens(probe)) {
    if (!sourceNoComma.includes(num)) violations.push(`${prefix}숫자 "${num}" 원문에 없음`);
  }
  for (const lat of extractLatinTokens(probe)) {
    if (!sourceLower.includes(lat)) violations.push(`${prefix}라틴 토큰 "${lat}" 원문에 없음`);
  }
  for (const hg of extractQuotedHangulTokens(probe)) {
    if (!String(source).includes(hg)) violations.push(`${prefix}인용 한글 "${hg}" 원문에 없음`);
  }
}

// ─── imagePrompt 검사 ────────────────────────────────────────────
// 영문만(한글 유입 차단), no people·no text 필수, 500자 이내.
function checkImagePrompt(p, violations, label) {
  const prefix = label ? `${label}.imagePrompt ` : "imagePrompt ";
  if (/[가-힣]/.test(p)) violations.push(`${prefix}한글 포함 — 영문만 허용`);
  if (!/no people/i.test(p)) violations.push(`${prefix}'no people' 누락`);
  if (!/no text/i.test(p)) violations.push(`${prefix}'no text' 누락`);
  if (charLen(p) > MAX_PROMPT_LEN) violations.push(`${prefix}${charLen(p)}자 > ${MAX_PROMPT_LEN}자`);
}

module.exports = {
  MAX_TITLE_LEN,
  MAX_SUMMARY_LEN,
  MAX_PROMPT_LEN,
  HONORIFIC_RE,
  charLen,
  splitSentences,
  checkHonorific,
  extractNumberTokens,
  extractLatinTokens,
  extractQuotedHangulTokens,
  checkFactuality,
  checkImagePrompt,
};
