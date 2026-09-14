// 단일 이슈 18초 포맷(물어오리 전용)의 공유 상수.
// jsx(화면)와 scripts/tts.mjs(나레이션)가 같은 값을 써야 하므로 한 곳에 모은다.
// React·Remotion 의존이 없어야 한다 — scripts/*.mjs가 직접 import하기 때문이다.

// 비트 경계(프레임, 30fps). 0/4.5/9.0/14.0/18.0초.
//   B1 0~135   훅 문장
//   B2 135~270 kicker + title
//   B3 270~420 summary
//   B4 420~540 CTA + 브랜드
export const SINGLE_BEATS = [0, 135, 270, 420, 540];

// 컴포지션 길이 고정값 = 마지막 비트 경계(18.0초).
export const singleTotalFrames = 540;

// B4 고정 CTA — 화면 문구와 낭독 대본이 같은 문자열을 쓴다(드리프트 방지).
export const SINGLE_CTA = '이 소식이 필요한 사람에게 보내 주세요';

// 비트 끝에 남기는 여백(초). 낭독 예산 = 비트 길이 − 이 값.
// scripts/tts.mjs(예산 계산)와 scripts/render.mjs(드리프트 감지 단언)가 같은 값을 써야 한다.
export const BEAT_TAIL_SEC = 0.3;
