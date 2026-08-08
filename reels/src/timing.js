// 릴스 타이밍 상수 (하드코딩 데이터에서 분리 — 데이터 주입형 컴포지션이 공유)
// 2026-08-08 훅 수술: 커버 폐지(리텐션 진단 — 평균 시청 1~4초, 커버 단계 전원 이탈).
// 0초부터 이슈1 + hookLine 오버레이로 시작. coverDuration은 파생 수식 호환용으로 0 유지.
export const coverDuration = 0;
export const issueDuration = 159;
export const outroDuration = 45;
export const hookDuration = 54; // 이슈1 위 훅 오버레이 노출 구간 (~1.8초)

// calculateMetadata용: durationInFrames = 159*이슈수 + 45
export function totalFrames(issueCount) {
  return coverDuration + issueDuration * issueCount + outroDuration;
}

export const palette = {
  paper: '#f6f1e8',
  ink: '#111111',
  red: '#ef3e36',
  blue: '#2457ff',
  teal: '#0c8f7f',
  gold: '#ffb100',
  slate: '#425067',
  cream: '#fff9ef',
};
