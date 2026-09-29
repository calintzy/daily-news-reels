// hookLine(물어오리 전용 v2) 프롬프트용 결정적 프로브. 훅 문장 한 줄을 채점한다.
// 규칙은 scripts/rewrite-probes.cjs를 공유한다(프로덕션 게이트 validate.mjs와 동일 모듈).
// 규칙을 복사하지 않으므로 이중화 드리프트가 없다 (PROBES.md 단일 모듈 패턴).
// promptfoo가 이 파일을 계약 디렉토리에서 로드하므로 require 경로는 이 파일 기준 상대경로다.
//
// contracts/hook(오리 기자 전용)과의 차이: dupWithTitle 프로브가 추가됐다.
// 물어오리는 화면에 카드 제목(title)이 따로 뜨므로 훅이 그 제목의 축약이면 같은 정보가 두 번 나간다.
const { charLen, checkHonorific, checkFactuality } = require("../../scripts/rewrite-probes.cjs");

// validate.mjs의 hookLine 하드 게이트(30자)와 동일 값을 여기서만 상수화한다.
// (rewrite-probes.cjs의 MAX_TITLE_LEN/MAX_SUMMARY_LEN과는 별개 게이트라 공유 모듈에 없음)
const MAX_HOOK_LEN = 30;

// 제목 중복 판정용 정규화 — 공백·문장부호·따옴표를 모두 제거해 표기 차이를 무시한다.
// (validate.mjs의 경고 게이트와 동일 규칙을 쓴다. 규칙이 세 줄이라 공유 모듈 대신 각자 둔다.)
function normalizeForDup(s) {
  return String(s)
    .replace(/\s+/g, "")
    .replace(/["'`“”‘’「」『』《》〈〉]/g, "")
    .replace(/[.,!?…·、。，！？:;~\-–—()[\]{}]/g, "");
}

/**
 * dupWithTitle — 훅이 화면 카드 제목(vars.title)과 중복되는지 본다.
 * 정규화 후 동일하거나 한쪽이 다른 쪽을 포함하면 실패("제목 중복").
 * title이 없으면(오래된 케이스) 판정을 건너뛴다 — 없는 정보로 FAIL을 만들지 않는다.
 */
function dupWithTitle(output, title, fails) {
  const a = normalizeForDup(output);
  const b = normalizeForDup(title || "");
  if (!a || !b) return;
  if (a === b || a.includes(b) || b.includes(a)) {
    fails.push("제목 중복");
  }
}

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

  const vars = context.vars || {};

  // 사실성: rank1 원문(sourceTitle+sourceDesc)과 대조 (validate.mjs의 rank1 대조와 동일)
  const source = `${vars.sourceTitle || ""} ${vars.sourceDesc || ""}`;
  checkFactuality(raw, "", source, fails);

  // 제목 중복(v2 신설): 화면 카드 제목과 같은 문장이면 훅이 아니다
  dupWithTitle(raw, vars.title, fails);

  return fails.length
    ? { pass: false, score: Math.max(0, 1 - fails.length * 0.25), reason: fails.join(" / ") }
    : { pass: true, score: 1, reason: "ok" };
};
