// 릴스 타이밍 상수 (하드코딩 데이터에서 분리 — 데이터 주입형 컴포지션이 공유)
export const coverDuration = 90;
export const issueDuration = 114;
export const outroDuration = 84;

// calculateMetadata용: durationInFrames = 90 + 114*이슈수 + 84
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
