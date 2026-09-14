import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {SINGLE_BEATS, SINGLE_CTA} from './singleFormat.js';
import {
  DEFAULT_BRAND,
  PhotoBackground,
  fontFamily,
  splitSentences,
} from './HotIssueReelPhoto.jsx';
import {nowrapNumbers} from './nowrapNumbers.jsx';

// 단일 이슈 18초 포맷(물어오리 실험, 2026-09-14).
// props 계약은 HotIssueReelPhoto와 동일하다 — issues를 5개 받아도 rank1만 쓴다.
// 비트: B1 훅 / B2 kicker+title / B3 summary / B4 CTA. 경계마다 텍스트 교체 + 이미지 스케일 점프.

const imgSrc = (imageDir, name) => staticFile(`${imageDir}/${name}.png`);

// 비트별 배경 스케일 — 경계에서 한 단계씩 점프시켜 정지 화면처럼 보이지 않게 한다.
// B4(CTA)는 사진을 쓰지 않으므로 세 값만 있으면 된다.
const BEAT_SCALE = [1, 1.05, 1.1];

// 현재 프레임이 속한 비트 인덱스(0~3).
const currentBeat = (frame) => {
  for (let i = SINGLE_BEATS.length - 2; i >= 0; i--) {
    if (frame >= SINGLE_BEATS[i]) return i;
  }
  return 0;
};

// title 2줄 분리는 HotIssueReelPhoto와 같은 규칙. B2에서 title은 kicker 아래 보조 역할이라
// 기준 크기를 본편보다 낮춘다(24자 초과 시 축소).
const wrapTitle = (title) => {
  const words = String(title).trim().split(/\s+/);
  if (words.length <= 1) return [title];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
};
const titleFontSize = (title) => ([...String(title)].length > 24 ? 52 : 62);

// kicker는 B2의 주인공이라 길이에 따라 크게 키운다. validate에 kicker 길이 게이트가 없으므로
// 렌더 쪽에서 축소 + maxWidth/overflow로 잘림을 막는다(긴 kicker가 화면을 넘지 않게).
const kickerFontSize = (kicker) => {
  const len = [...String(kicker)].length;
  if (len <= 6) return 120;
  if (len <= 10) return 96;
  return 72;
};

// 아래로 갈수록 짙어지는 기본 스크림 — 사진 위 텍스트 가독성 확보.
const Scrim = ({strength = 1}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: `linear-gradient(180deg, rgba(0,0,0,${0.06 * strength}) 0%, rgba(0,0,0,${
        0.18 * strength
      }) 28%, rgba(0,0,0,${0.5 * strength}) 60%, rgba(0,0,0,${0.9 * strength}) 100%)`,
    }}
  />
);

// B1 0~4.5s — 미완결형 훅 한 문장. 화면 전체를 덮어 첫 프레임부터 문장만 읽히게 한다.
const HookBeat = ({hookLine, localFrame}) => {
  const {fps} = useVideoConfig();
  const enter = spring({frame: localFrame, fps, config: {damping: 14, stiffness: 170}});
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(5,6,8,0.5) 0%, rgba(5,6,8,0.84) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 72px',
          textAlign: 'center',
          fontFamily,
        }}
      >
        <div
          style={{
            fontSize: 100,
            fontWeight: 900,
            lineHeight: 1.24,
            letterSpacing: '-0.01em',
            color: '#ffffff',
            textShadow: '0 6px 40px rgba(0,0,0,0.6)',
            wordBreak: 'keep-all',
            opacity: enter,
            transform: `translateY(${interpolate(enter, [0, 1], [46, 0])}px)`,
          }}
        >
          {nowrapNumbers(hookLine)}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// B2 4.5~9.0s — kicker를 큰 키워드로 먼저 던지고 title을 받는다.
const HeadlineBeat = ({issue, localFrame}) => {
  const {fps, width} = useVideoConfig();
  const kickerIn = spring({frame: localFrame, fps, config: {damping: 18, stiffness: 150}});
  const headlineIn = spring({frame: localFrame - 6, fps, config: {damping: 15, stiffness: 150}});
  const titleLines = wrapTitle(issue.title);
  const fontSize = titleFontSize(issue.title);
  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        right: 76,
        bottom: 330,
        fontFamily,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 24,
          marginBottom: 30,
          maxWidth: 860,
          maxHeight: 420,
          overflow: 'hidden',
          opacity: kickerIn,
          transform: `translateX(${interpolate(kickerIn, [0, 1], [-60, 0])}px)`,
        }}
      >
        <div style={{width: 16, background: '#d61f29', flexShrink: 0}} />
        <div
          style={{
            fontSize: kickerFontSize(issue.kicker),
            fontWeight: 900,
            lineHeight: 1.1,
            letterSpacing: '-0.045em',
            color: '#ffffff',
            textShadow: '0 12px 28px rgba(0,0,0,0.45)',
            wordBreak: 'keep-all',
          }}
        >
          {nowrapNumbers(issue.kicker)}
        </div>
      </div>
      <div
        style={{
          width: 920,
          maxHeight: 220,
          overflow: 'hidden',
          transform: `translate3d(${interpolate(headlineIn, [0, 1], [width * 0.14, 0])}px, ${interpolate(
            headlineIn,
            [0, 1],
            [46, 0]
          )}px, 0)`,
        }}
      >
        {titleLines.map((line, index) => (
          <div
            key={`title-${index}`}
            style={{
              fontSize,
              fontWeight: 800,
              lineHeight: 1.16,
              letterSpacing: '-0.045em',
              color: 'rgba(255,255,255,0.9)',
              textShadow: '0 12px 24px rgba(0,0,0,0.4)',
              wordBreak: 'keep-all',
              opacity: headlineIn,
            }}
          >
            {nowrapNumbers(line)}
          </div>
        ))}
      </div>
    </div>
  );
};

// B3 9.0~14.0s — summary 문장1을 크게, 있으면 문장2를 작게. 3문장 이상은 앞 2개만 쓴다.
const SummaryBeat = ({issue, localFrame}) => {
  const {fps} = useVideoConfig();
  const bodyIn = spring({frame: localFrame, fps, config: {damping: 16, stiffness: 130}});
  const sentences = splitSentences(issue.summary).slice(0, 2);
  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        right: 76,
        bottom: 330,
        fontFamily,
        transform: `translateY(${interpolate(bodyIn, [0, 1], [70, 0])}px)`,
        opacity: bodyIn,
      }}
    >
      <div
        style={{
          width: 900,
          padding: '34px 38px 38px',
          background: 'rgba(10,12,16,0.5)',
          border: '1px solid rgba(255,255,255,0.12)',
          backdropFilter: 'blur(16px)',
          // 긴 summary가 상단 세이프존을 침범하지 않게 자른다(HotIssueReelPhoto 요약 박스와 같은 가드).
          maxHeight: 420,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontSize: 54,
            lineHeight: 1.34,
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.03em',
            wordBreak: 'keep-all',
          }}
        >
          {nowrapNumbers(sentences[0])}
        </div>
        {sentences[1] ? (
          <div
            style={{
              marginTop: 22,
              fontSize: 36,
              lineHeight: 1.4,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.78)',
              letterSpacing: '-0.03em',
              wordBreak: 'keep-all',
            }}
          >
            {nowrapNumbers(sentences[1])}
          </div>
        ) : null}
      </div>
    </div>
  );
};

// B4 14.0~18.0s — 공유 CTA 고정문 + 브랜드. 고정문은 singleFormat.js가 정본(낭독 대본과 공유).
const SingleOutro = ({brand, localFrame}) => {
  const {fps} = useVideoConfig();
  const b = {...DEFAULT_BRAND, ...(brand || {})};
  const titleIn = spring({frame: localFrame - 2, fps, config: {damping: 15, stiffness: 140}});
  const pillIn = spring({frame: localFrame - 12, fps, config: {damping: 13, stiffness: 160}});
  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#050608', color: '#ffffff'}}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 46,
          padding: '0 84px',
          textAlign: 'center',
          fontFamily,
        }}
      >
        <Img
          src={staticFile(b.logo)}
          style={{
            width: 190,
            height: 190,
            objectFit: 'contain',
            opacity: titleIn,
            transform: `rotate(-4deg) scale(${interpolate(titleIn, [0, 1], [0.7, 1])})`,
          }}
        />
        <div
          style={{
            fontSize: 78,
            fontWeight: 900,
            lineHeight: 1.24,
            letterSpacing: '-0.02em',
            wordBreak: 'keep-all',
            opacity: titleIn,
            transform: `translateY(${interpolate(titleIn, [0, 1], [40, 0])}px)`,
          }}
        >
          {SINGLE_CTA}
        </div>
        <div
          style={{
            marginTop: 6,
            background: b.accent,
            borderRadius: 999,
            padding: '22px 56px',
            fontSize: 44,
            fontWeight: 900,
            letterSpacing: '0.02em',
            opacity: pillIn,
            transform: `scale(${interpolate(pillIn, [0, 1], [0.8, 1])})`,
          }}
        >
          {b.name}
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: 'rgba(255,255,255,0.5)',
            opacity: pillIn,
          }}
        >
          {b.handle}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const SingleIssueReel = ({hookLine, issues, imageDir = 'img/current', brand}) => {
  const frame = useCurrentFrame();
  // rank 정렬 후 첫 이슈를 쓴다 — scripts/tts.mjs의 대본 선택과 같은 기준이어야
  // 화면과 낭독이 다른 이슈를 가리키지 않는다.
  const issueList = [...(issues || [])].sort((a, b) => a.rank - b.rank);
  const issue = issueList[0];
  const beat = currentBeat(frame);
  const localFrame = frame - SINGLE_BEATS[beat];

  // 이슈가 없으면(빈 배열·잘못된 데이터) 사진 비트를 그릴 수 없다 — CTA 카드만 낸다.
  if (beat === 3 || !issue) {
    return <SingleOutro brand={brand} localFrame={localFrame} />;
  }

  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#050608', color: '#ffffff'}}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${BEAT_SCALE[beat]})`}}>
        <PhotoBackground
          src={imgSrc(imageDir, `issue-${issue.rank}`)}
          frame={frame}
          startFrame={0}
        />
      </div>
      <Scrim strength={beat === 0 ? 1 : 1.05} />
      {beat === 0 ? <HookBeat hookLine={hookLine || issue.title} localFrame={localFrame} /> : null}
      {beat === 1 ? <HeadlineBeat issue={issue} localFrame={localFrame} /> : null}
      {beat === 2 ? <SummaryBeat issue={issue} localFrame={localFrame} /> : null}
    </AbsoluteFill>
  );
};
