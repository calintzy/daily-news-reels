// keyStat 추출기 계약 — node --test reels/src/keyStat.test.mjs
// 동결 사례(ISC-2.1), 구 추출기 음성 대조군(ISC-2.2), 실데이터 부분 문자열 단언(ISC-2.3).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {extractKeyStat} from './keyStat.js';

const ARGON_SUMMARY =
  "구글이 코딩·사이버 보안 벤치마크를 석권한 모델 '제미나이 4 아르곤'을 공개했습니다. 출력 한도가 100만 토큰으로 확대되어 장시간 코딩과 사이버 방어에 초점을 맞췄습니다.";

const stat = (text) => ({text, isStat: true});
const kicker = (text) => ({text, isStat: false});

// [이름, 입력, 기대값] — 입력은 {title, summary, kicker} 전체, 기대값은 결정적이다.
const CASES = [
  ['10/02 이슈1 — 100만 토큰', {title: "구글, '제미나이 4 아르곤' 공개", summary: ARGON_SUMMARY, kicker: '7개월 만의 신모델'}, stat('100만 토큰')],
  ['제미나이 4 아르곤 — 요약에 수치 없음', {title: "구글, '제미나이 4 아르곤' 공개", summary: "구글이 코딩·사이버 보안 벤치마크를 석권한 모델 '제미나이 4 아르곤'을 공개했습니다.", kicker: '7개월 만의 신모델'}, kicker('7개월 만의 신모델')],
  ['10월 시작 — 월은 수치가 아님', {title: "애플 'Siri AI' 한국어 지원 10월 시작", summary: "애플이 'Siri AI'의 한국어 지원을 10월부터 확정했습니다. 현재 영어 버전 베타로 제공 중입니다.", kicker: '한국어 지원 시작'}, kicker('한국어 지원 시작')],
  ['2027년 — 연도 제외', {title: '우주 스타트업, 위성 발사 계획 공개', summary: '이 회사는 2027년 초 위성 2기를 발사할 계획입니다.', kicker: '위성 발사'}, kicker('위성 발사')],
  ['44.6%', {title: 'AI 반도체 수출 급증', summary: 'AI 반도체 수출이 전년보다 44.6% 급증했습니다.', kicker: '수출 급증'}, stat('44.6%')],
  ['27조', {title: '엔비디아·소프트뱅크, 오픈AI에 27조 투자 완료', summary: '두 회사가 투자금을 최종 집행했습니다.', kicker: '투자 완료'}, stat('27조')],
  ['45일 연장', {title: '공정위, 합병 심사 연장', summary: '공정위가 심사 기간을 45일 연장했습니다.', kicker: '심사 연장'}, stat('45일')],
  ['9개월 만에', {title: '오픈AI, AI가 설계한 칩 완성', summary: "오픈AI가 추론 칩 '할라페뇨'를 9개월 만에 완성했습니다.", kicker: '칩 완성'}, stat('9개월')],
  ['100억달러', {title: '오픈AI 투자 집행', summary: '두 회사가 각각 100억달러씩 집행했습니다.', kicker: '투자 집행'}, stat('100억달러')],
  ['2000억 위안', {title: '중국, AI 펀드 조성', summary: '중국 정부가 2000억 위안을 AI 펀드에 투입합니다.', kicker: '펀드 조성'}, stat('2000억 위안')],
  ['128,536명', {title: 'AI 자격시험 응시자 급증', summary: '올해 응시자는 128,536명으로 집계됐습니다.', kicker: '응시자 급증'}, stat('128,536명')],
  ['26만8000개', {title: '앱 장터 AI 앱 급증', summary: '등록된 AI 앱이 26만8000개를 넘었습니다.', kicker: '앱 급증'}, stat('26만8000개')],
  ['Opus 5 대비 — 공백 뒤 단위 제외', {title: '새 모델, 성능 개선', summary: 'Opus 5 대비 추론 속도가 빨라졌습니다.', kicker: '성능 개선'}, kicker('성능 개선')],
  ['15일 발효 — 날짜 제외', {title: 'AI 기본법 시행', summary: '새 법령이 15일 발효됩니다.', kicker: '법 시행'}, kicker('법 시행')],
  ['23~24일 — 범위 제외', {title: 'AI 정상회의 개최', summary: '정상회의가 9월 23~24일 열립니다.', kicker: '정상회의'}, kicker('정상회의')],
  ['31개국 — 단위 뒤 글자 제외', {title: 'AI 협약 체결', summary: '31개국이 협약에 서명했습니다.', kicker: '협약 체결'}, kicker('협약 체결')],
  ['10월 2일부터 — 날짜 제외', {title: '새 요금제 시행', summary: '새 요금제는 10월 2일부터 적용됩니다.', kicker: '요금제 시행'}, kicker('요금제 시행')],
  ['300만 명 — 수량 복합이 금액보다 먼저', {title: '챗봇 이용자 급증', summary: '국내 이용자가 300만 명을 넘어섰습니다.', kicker: '이용자 급증'}, stat('300만 명')],
  ['2조각 — 단위 뒤 글자 제외', {title: '반도체 웨이퍼 분할 신공정', summary: '웨이퍼를 2조각으로 나누는 공정입니다.', kicker: '신공정'}, kicker('신공정')],
  ['15일 간담회 — "간"은 붙여 쓸 때만', {title: 'AI 업계 간담회 개최', summary: '과기정통부는 15일 간담회를 열고 업계 의견을 들었습니다.', kicker: '업계 간담회'}, kicker('업계 간담회')],
  ['20일간', {title: 'AI 체험 행사 개최', summary: '체험 행사는 20일간 진행됩니다.', kicker: '체험 행사'}, stat('20일')],
  ['100만 2주 — 공백 뒤 숫자를 잇지 않음', {title: '새 앱 흥행', summary: '가입자 100만 2주 만에 돌파했습니다.', kicker: '가입자 돌파'}, kicker('가입자 돌파')],
  ['1조 3개 — 공백 뒤 숫자를 잇지 않음', {title: '정부 AI 투자', summary: '투자 1조 3개 기업에 집행됩니다.', kicker: '투자 집행'}, kicker('투자 집행')],
  ['1위 — 순위 제외', {title: '구글 새 모델 공개', summary: '벤치마크에서 1위를 주장합니다.', kicker: '새 모델'}, kicker('새 모델')],
  ['3대 분야 — 제외', {title: '정부 AI 육성 계획', summary: '반도체 등 3대 분야를 집중 지원합니다.', kicker: '육성 계획'}, kicker('육성 계획')],
  ['제3회 — 서수 제외', {title: 'AI 엑스포 개막', summary: '제3회 AI 엑스포가 개막했습니다.', kicker: '엑스포 개막'}, kicker('엑스포 개막')],
  ['kicker 1M 토큰 출력 폴백', {title: '구글, 제미나이 4 아르곤 공개…1M 토큰 출력', summary: '구글이 제미나이 4의 첫 모델 아르곤을 공개했습니다.', kicker: '1M 토큰 출력'}, kicker('1M 토큰 출력')],
];

test('ISC-2.1 동결 사례', () => {
  for (const [name, input, expected] of CASES) {
    assert.deepEqual(extractKeyStat(input), expected, name);
  }
});

// 수정 전(e221101) CardNewsReel.jsx의 extractKeyStat 로직 그대로 — 음성 대조군 전용, 수정 금지.
const LEGACY_PATTERNS = [
  /\d+(?:\.\d+)?%/,
  /\d[\d,]*(?:\.\d+)?\s*(?:조\s*원|억\s*원|만\s*원|조|억)/,
  /\d+\s*년(?:\s*(?:안에|내))?/,
  /\d+(?:\.\d+)?\s*[가-힣]{0,2}/,
];
const legacyExtractKeyStat = (issue) => {
  const haystack = `${issue.title ?? ''} ${issue.summary ?? ''}`;
  for (const pattern of LEGACY_PATTERNS) {
    const m = pattern.exec(haystack);
    if (m) return m[0].trim();
  }
  return issue.kicker;
};

test('ISC-2.2 음성 대조군 — 구 추출기는 같은 사례 표에서 3건 이상 실패한다', () => {
  const failures = CASES.filter(([, input, expected]) => legacyExtractKeyStat(input) !== expected.text);
  assert.ok(failures.length >= 3, `구 추출기 실패 ${failures.length}건 — 사례 표가 회귀를 못 잡는다`);
});

test('ISC-2.3 실데이터 — 추출값은 title/summary의 부분 문자열이고 다른 토큰에 붙어 있지 않다', () => {
  const dataDir = new URL('../../data/', import.meta.url);
  const files = readdirSync(dataDir).filter((f) => /^ai-.*\.json$/.test(f));
  assert.ok(files.length > 0, 'data/ai-*.json 없음');
  for (const f of files) {
    const data = JSON.parse(readFileSync(new URL(f, dataDir), 'utf-8'));
    for (const issue of data.issues ?? []) {
      const {text, isStat} = extractKeyStat(issue);
      if (!isStat) continue;
      const field = [issue.title ?? '', issue.summary ?? ''].find((s) => s.includes(text));
      assert.ok(field, `${f} 이슈${issue.rank}: "${text}"가 title/summary에 없음`);
      const prev = field[field.indexOf(text) - 1] ?? '';
      assert.ok(!/[\d.,A-Za-z\-만억조]/.test(prev), `${f} 이슈${issue.rank}: "${text}" 앞 글자 "${prev}"`);
    }
  }
});
