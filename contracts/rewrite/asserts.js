// scripts/validate.mjs 규칙을 기사 단위 재작성 프롬프트용으로 이식한 결정적 프로브.
// title·summary·imagePrompt 하나를 채점한다. validate.mjs의 상수·정규식·로직을 그대로 복사했다.

const MAX_TITLE_LEN = 32;
const MAX_SUMMARY_LEN = 120; // 스펙: 데이터는 110자 권장, 게이트는 120자 상한(validate.mjs와 동일)
const MAX_PROMPT_LEN = 500;

// 문체 계약: 존댓말 종결어미 화이트리스트 (validate.mjs HONORIFIC_RE 복사)
const HONORIFIC_RE =
  /(습니다|합니다|입니다|됩니다|있습니다|없습니다|니다|세요|해요|어요|아요|이에요|예요|에요|요)(\([^)]*\))?[.!?]?$/;

function charLen(s) {
  return [...String(s)].length;
}

// 문장 분리 (validate.mjs splitSentences 복사)
function splitSentences(text) {
  const clean = String(text).trim();
  const parts = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (parts ? parts.map((s) => s.trim()) : [clean]).filter(Boolean);
}

// 사실성 토큰 추출 (validate.mjs extractNumberTokens/extractLatinTokens/extractQuotedHangulTokens 복사)
function extractNumberTokens(text) {
  const found = new Set();
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

// 사실성 대조 (validate.mjs checkFactuality 복사 — probe=title+summary, source=sourceTitle+sourceDesc)
function checkFactuality(title, summary, source, fails) {
  const probe = `${title || ""} ${summary || ""}`;
  const sourceNoComma = String(source).replace(/,/g, "");
  const sourceLower = sourceNoComma.toLowerCase();

  for (const num of extractNumberTokens(probe)) {
    if (!sourceNoComma.includes(num)) fails.push(`숫자 "${num}" 원문에 없음`);
  }
  for (const lat of extractLatinTokens(probe)) {
    if (!sourceLower.includes(lat)) fails.push(`라틴 토큰 "${lat}" 원문에 없음`);
  }
  for (const hg of extractQuotedHangulTokens(probe)) {
    if (!String(source).includes(hg)) fails.push(`인용 한글 "${hg}" 원문에 없음`);
  }
}

module.exports = (output, context) => {
  const fails = [];
  let raw = String(output).trim();

  // 코드펜스 방어: 감싸져 있으면 위반 기록 후 벗겨서 파싱 시도
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) {
    fails.push("코드펜스 출력(금지)");
    raw = fenced[1];
  }

  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return { pass: false, score: 0, reason: "JSON 파싱 실패" };
  }

  // 필수 필드 존재·비어있지 않음
  for (const k of ["title", "summary", "imagePrompt"]) {
    if (!j[k] || typeof j[k] !== "string" || !j[k].trim()) fails.push(`필수 필드 누락/빈값: ${k}`);
  }

  // title 길이
  if (j.title && charLen(j.title) > MAX_TITLE_LEN) {
    fails.push(`title ${charLen(j.title)}자 > ${MAX_TITLE_LEN}자`);
  }

  // summary 길이·문장 수(2개 이하)·존댓말 종결
  if (j.summary) {
    if (charLen(j.summary) > MAX_SUMMARY_LEN) {
      fails.push(`summary ${charLen(j.summary)}자 > ${MAX_SUMMARY_LEN}자`);
    }
    const sentences = splitSentences(j.summary);
    if (sentences.length > 2) fails.push(`summary 문장 ${sentences.length}개 > 2개`);
    for (const s of sentences) {
      if (!HONORIFIC_RE.test(s)) fails.push(`summary 존댓말 종결 아님: "${s.slice(0, 30)}…"`);
    }
  }

  // 사실성: title+summary 토큰이 원문(sourceTitle+sourceDesc)에 존재하는지 대조
  const vars = context.vars || {};
  const source = `${vars.sourceTitle || ""} ${vars.sourceDesc || ""}`;
  if (j.title && j.summary) {
    checkFactuality(j.title, j.summary, source, fails);
  }

  // imagePrompt: 한글 포함 FAIL, no people·no text 필수, 500자 이내
  if (j.imagePrompt) {
    const p = j.imagePrompt;
    if (/[가-힣]/.test(p)) fails.push("imagePrompt 한글 포함(영문만 허용)");
    if (!/no people/i.test(p)) fails.push("imagePrompt 'no people' 누락");
    if (!/no text/i.test(p)) fails.push("imagePrompt 'no text' 누락");
    if (charLen(p) > MAX_PROMPT_LEN) fails.push(`imagePrompt ${charLen(p)}자 > ${MAX_PROMPT_LEN}자`);
  }

  return fails.length
    ? { pass: false, score: Math.max(0, 1 - fails.length * 0.25), reason: fails.join(" / ") }
    : { pass: true, score: 1, reason: "ok" };
};
