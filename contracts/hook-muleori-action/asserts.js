// hookLine(물어오리 전용 행동 번역형, action-hook-v1) 프롬프트용 결정적 프로브. 훅 문장 한 줄을 채점한다.
// contracts/hook-muleori(v2)의 프로브(30자·존댓말·rank1 사실성·제목 중복)를 그대로 가져오고 actionFrame 프로브를 더했다.
// 공유 규칙은 scripts/rewrite-probes.cjs를 require만 한다(수정하면 계약 3종의 depsHash가 깨진다).
// promptfoo가 이 파일을 계약 디렉토리에서 로드하므로 require 경로는 이 파일 기준 상대경로다.
const { charLen, checkHonorific, checkFactuality } = require("../../scripts/rewrite-probes.cjs");

// validate.mjs의 hookLine 하드 게이트(30자)와 같은 값.
const MAX_HOOK_LEN = 30;

// 제목 중복 판정용 정규화 — contracts/hook-muleori/asserts.js와 같은 규칙.
function normalizeForDup(s) {
  return String(s)
    .replace(/\s+/g, "")
    .replace(/["'`“”‘’「」『』《》〈〉]/g, "")
    .replace(/[.,!?…·、。，！？:;~\-–—()[\]{}]/g, "");
}

function dupWithTitle(output, title, fails) {
  const a = normalizeForDup(output);
  const b = normalizeForDup(title || "");
  if (!a || !b) return;
  if (a === b || a.includes(b) || b.includes(a)) {
    fails.push("제목 중복");
  }
}

// actionFrame 판정 규칙(계획 docs/plans/2026-10-06-action-hook-v1.md 결정 4, 확정).
// 공백을 정규화한 문장이 아래 둘 중 하나를 만족하면 PASS.
//   1. 의문형: "?"로 끝나고 의문사 또는 "~야 할/해" 의무 표지가 있다.
//      종결 어미 자체(까요/나요/가요/어요)는 존댓말 프로브가 판정하고 "~죠?"는 거기서 FAIL한다.
//   2. 평서형: 의무("~야 합니다/해요/됩니다/돼요"), 가능("~수 있/없습니다·어요"), 권유("~세요") 종결.
// 변화 동사만 있는 문장(사라집니다·오릅니다·바뀝니다·달라집니다)과 의문사 없는 예/아니오 질문은 FAIL.
//
// 기대 판정 표(계획 결정 4):
// | 문장                                      | 기대                              |
// |-------------------------------------------|-----------------------------------|
// | 고소장, 이제 어디에 내야 할까요?          | PASS (의문형, 어디)               |
// | 내 대출 한도, 얼마나 줄어들까요?          | PASS (의문형, 얼마)               |
// | 이제 고소장은 경찰서에 내야 합니다.       | PASS (평서형, 의무)               |
// | 내일 검찰청이 사라집니다.                 | FAIL (변화 동사만)                |
// | 주유소 가격, 곧 오릅니다.                 | FAIL (v2 당사자형, 변화 동사만)   |
// | 검찰청이 사라질까요?                      | FAIL (의문사·행동 표지 없음)      |
// | 검찰청 없어지면 고소장 어디에 내야 되죠?  | FAIL (존댓말 프로브, 죠)          |
const ACTION_QUESTION_RE = /(어디|언제|누가|누구|무엇|뭘|뭐|어떻게|얼마|몇|왜)|야 ?(할|합|하|해|돼|되|됩)/;
const ACTION_STATEMENT_RE = /야 ?(합니다|해요|됩니다|돼요)|수 (있|없)(습니다|어요)|세요[.!]?$/;

function actionFrame(output, fails) {
  const s = String(output).replace(/\s+/g, " ").trim();
  const question = s.endsWith("?") && ACTION_QUESTION_RE.test(s);
  const statement = ACTION_STATEMENT_RE.test(s);
  if (!question && !statement) fails.push("행동 번역 없음");
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

  if (/\r?\n/.test(raw)) {
    fails.push("훅 문장이 한 줄이 아님(개행 포함)");
  }

  // 30자 하드 게이트 (validate.mjs와 동일)
  if (charLen(raw) > MAX_HOOK_LEN) {
    fails.push(`hookLine ${charLen(raw)}자 > ${MAX_HOOK_LEN}자`);
  }

  // 존댓말 종결 — "~죠?"는 여기서 떨어진다
  checkHonorific(raw, "hookLine", fails);

  const vars = context.vars || {};

  // 사실성: rank1 원문(sourceTitle+sourceDesc)과 대조 (validate.mjs의 rank1 대조와 동일)
  const source = `${vars.sourceTitle || ""} ${vars.sourceDesc || ""}`;
  checkFactuality(raw, "", source, fails);

  dupWithTitle(raw, vars.title, fails);

  // 행동 번역 프레임(action-hook-v1 신설)
  actionFrame(raw, fails);

  return fails.length
    ? { pass: false, score: Math.max(0, 1 - fails.length * 0.2), reason: fails.join(" / ") }
    : { pass: true, score: 1, reason: "ok" };
};
