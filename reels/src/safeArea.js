// 인스타그램 안전 영역(1080x1920 기준) — 그리드·피드 크롭과 릴스 UI가 가리지 않는 범위.
// CardNewsReel.jsx(배치)와 scripts/layout-check.mjs(판정)가 같은 값을 쓴다.
// CORE: 훅·배지·제목·키 스탯·풀쿼트, SECONDARY: 말풍선·도장.
export const ZONES = {
  core: {left: 72, right: 1008, top: 290, bottom: 1250},
  secondary: {left: 72, right: 1008, top: 290, bottom: 1500},
};

// 표지(thumb_offset 27f)의 훅 블록 범위 — CORE와 1:1 크롭(y 420~1500)의 교집합.
export const COVER = {top: 420, bottom: 1250};

// 판정 여유 — 글자는 영역 경계에서 이만큼 안쪽까지만 허용한다.
export const MARGIN = 12;
