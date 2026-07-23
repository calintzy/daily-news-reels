// 기사 단위 재작성 프롬프트용 결정적 프로브. title·summary·imagePrompt 하나를 채점한다.
// 규칙은 scripts/rewrite-probes.cjs를 공유한다(프로덕션 게이트 validate.mjs와 동일 모듈).
// 규칙을 복사하지 않으므로 이중화 드리프트가 없다 (PROBES.md 단일 모듈 패턴).
// promptfoo가 이 파일을 계약 디렉토리에서 로드하므로 require 경로는 이 파일 기준 상대경로다.
const {
  MAX_TITLE_LEN,
  MAX_SUMMARY_LEN,
  HONORIFIC_RE,
  charLen,
  splitSentences,
  checkFactuality,
  checkImagePrompt,
} = require("../../scripts/rewrite-probes.cjs");

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
    checkImagePrompt(j.imagePrompt, fails);
  }

  return fails.length
    ? { pass: false, score: Math.max(0, 1 - fails.length * 0.25), reason: fails.join(" / ") }
    : { pass: true, score: 1, reason: "ok" };
};
