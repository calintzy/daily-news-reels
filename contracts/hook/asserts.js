// hookLine 프롬프트용 결정적 프로브. 훅 문장 한 줄을 채점한다.
// 규칙은 scripts/rewrite-probes.cjs를 공유한다(프로덕션 게이트 validate.mjs와 동일 모듈).
// 규칙을 복사하지 않으므로 이중화 드리프트가 없다 (PROBES.md 단일 모듈 패턴).
// promptfoo가 이 파일을 계약 디렉토리에서 로드하므로 require 경로는 이 파일 기준 상대경로다.
const { charLen, checkHonorific, checkFactuality } = require("../../scripts/rewrite-probes.cjs");

// validate.mjs의 hookLine 하드 게이트(30자)와 동일 값을 여기서만 상수화한다.
// (rewrite-probes.cjs의 MAX_TITLE_LEN/MAX_SUMMARY_LEN과는 별개 게이트라 공유 모듈에 없음)
const MAX_HOOK_LEN = 30;

module.exports = (output, context) => {
  const fails = [];
  let raw = String(output).trim();

  // 코드펜스 방어: 감싸져 있으면 위반 기록 후 벗겨서 계속
  const fenced = raw.match(/^```(?:\w*)?\s*([\s\S]*?)\s*```$/);
  if (fenced) {
    fails.push("코드펜스 출력(금지)");
    raw = fenced[1].trim();
  }

  if (!raw) {
    return { pass: false, score: 0, reason: "빈 출력" };
  }

  // 한 줄 검사: trim 후에도 개행이 남아있으면 여러 줄
  if (/\r?\n/.test(raw)) {
    fails.push("훅 문장이 한 줄이 아님(개행 포함)");
  }

  // 30자 하드 게이트 (validate.mjs와 동일)
  if (charLen(raw) > MAX_HOOK_LEN) {
    fails.push(`hookLine ${charLen(raw)}자 > ${MAX_HOOK_LEN}자`);
  }

  // 존댓말 종결
  checkHonorific(raw, "hookLine", fails);

  // 사실성: rank1 원문(sourceTitle+sourceDesc)과 대조 (validate.mjs의 rank1 대조와 동일)
  const vars = context.vars || {};
  const source = `${vars.sourceTitle || ""} ${vars.sourceDesc || ""}`;
  checkFactuality(raw, "", source, fails);

  return fails.length
    ? { pass: false, score: Math.max(0, 1 - fails.length * 0.25), reason: fails.join(" / ") }
    : { pass: true, score: 1, reason: "ok" };
};
