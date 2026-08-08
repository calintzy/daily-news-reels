import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {issueDuration, hookDuration} from './timing.js';

const fontFamily =
  '"Noto Sans CJK KR","Apple SD Gothic Neo","SF Pro Display","Helvetica Neue",sans-serif';

// 이미지 경로: 렌더 전에 스크립트가 reels/public/img/current/ 로 복사한다.
// imageDir(inputProps)는 public 기준 상대 경로(기본 'img/current').
const imgSrc = (imageDir, name) => staticFile(`${imageDir}/${name}.png`);

// title(문자열)을 2줄로 나눈다: 공백 기준 균형 분리. 공백 없으면 한 줄.
// 렌더 폭 방어는 폰트 자동 축소가 담당한다.
const wrapTitle = (title) => {
  const words = String(title).trim().split(/\s+/);
  if (words.length <= 1) return [title];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
};

// title 길이별 폰트 크기: 24자 초과 시 88→72px 자동 축소.
const titleFontSize = (title) => ([...String(title)].length > 24 ? 72 : 88);

const splitSentences = (text) => {
  const matches = String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return matches ? matches.map((part) => part.trim()) : [text];
};

const PhotoBackground = ({src, frame, startFrame, panBias = 0}) => {
  const localFrame = frame - startFrame;
  const zoom = interpolate(localFrame, [0, issueDuration], [1.02, 1.12], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const x = interpolate(localFrame, [0, issueDuration], [-26 + panBias, 26 + panBias], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const y = interpolate(localFrame, [0, issueDuration], [18, -18], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Img
      src={src}
      style={{
        position: 'absolute',
        inset: -90,
        width: 1260,
        height: 2100,
        objectFit: 'cover',
        transform: `translate3d(${x}px, ${y}px, 0) scale(${zoom})`,
      }}
    />
  );
};

// 훅 오버레이 — 커버 폐지 후 0초부터 이슈1 위에 결론형 한 문장(2026-08-08 리텐션 훅 수술).
// hookDuration 프레임 동안 노출 후 페이드아웃 → 아래 깔린 이슈1 레이아웃이 드러난다.
const HookOverlay = ({hookLine}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 14, stiffness: 170}});
  const fadeOut = interpolate(frame, [hookDuration - 14, hookDuration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{opacity: fadeOut}}>
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
            fontSize: 96,
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
          {hookLine}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// textDelay: 훅 오버레이가 걷힐 때까지 텍스트 진입을 늦춘다(이슈1 전용 — 훅과 제목이 겹치는 것 방지).
const IssueSlide = ({issue, imageSrc, startFrame, textDelay = 0}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const localFrame = frame - startFrame;
  const textFrame = localFrame - textDelay;
  const headlineIn = spring({
    frame: textFrame,
    fps,
    config: {damping: 15, stiffness: 150},
  });
  const bodyIn = spring({
    frame: textFrame - 12,
    fps,
    config: {damping: 16, stiffness: 120},
  });
  const tagIn = spring({
    frame: textFrame - 4,
    fps,
    config: {damping: 18, stiffness: 150},
  });
  // 사선 와이프 전환은 제거 — 하드컷이 숏폼 템포에 맞다 (2026-08-08 훅 수술 후속).
  const rankNum = Number(issue.rank);
  const headlineX = interpolate(headlineIn, [0, 1], [width * 0.14, 0]);
  const headlineY = interpolate(headlineIn, [0, 1], [46, 0]);
  const bodyY = interpolate(bodyIn, [0, 1], [70, 0]);
  const sentences = splitSentences(issue.summary);
  const rankLabel = String(issue.rank).padStart(2, '0');
  const titleLines = wrapTitle(issue.title);
  const fontSize = titleFontSize(issue.title);

  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#050608', color: '#ffffff'}}>
      <PhotoBackground
        src={imageSrc}
        frame={frame}
        startFrame={startFrame}
        panBias={(rankNum - 3) * 4}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.14) 28%, rgba(0,0,0,0.42) 60%, rgba(0,0,0,0.88) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(130deg, rgba(0,0,0,0.36) 0%, transparent 32%, transparent 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 72,
          left: 72,
          display: 'flex',
          alignItems: 'stretch',
          gap: 16,
          transform: `translateX(${interpolate(tagIn, [0, 1], [-60, 0])}px)`,
          opacity: tagIn,
          fontFamily,
        }}
      >
        <div
          style={{
            backgroundColor: '#d61f29',
            color: '#ffffff',
            padding: '16px 20px',
            fontSize: 42,
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1,
          }}
        >
          {rankLabel}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 22px',
            background: 'rgba(11,13,18,0.48)',
            border: '1px solid rgba(255,255,255,0.18)',
            backdropFilter: 'blur(12px)',
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: '0.08em',
          }}
        >
          {issue.category}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 76,
          // 인스타 릴스 하단 UI(계정명·캡션, 프레임 하단 ~360px)가 요약 박스를 가리지 않도록
          // 세이프존 위로 올린다 (07-24 실기기 스크린샷에서 가림 확인).
          bottom: 330,
          paddingTop: 156,
          paddingBottom: 32,
          fontFamily,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            width: 950,
            height: 600,
            background:
              'linear-gradient(180deg, rgba(8,10,14,0) 0%, rgba(8,10,14,0.16) 18%, rgba(8,10,14,0.82) 46%, rgba(8,10,14,0.96) 100%)',
            borderRadius: 34,
            transform: 'translateY(30px)',
          }}
        />
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            width: 920,
            transform: `translate3d(${headlineX}px, ${headlineY}px, 0)`,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 22,
              color: '#ff6b74',
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: '0.18em',
              opacity: headlineIn,
            }}
          >
            <div style={{width: 56, height: 6, background: '#d61f29'}} />
            {issue.kicker}
          </div>
          {titleLines.map((line, index) => {
            const lineIn = spring({
              frame: textFrame - index * 4,
              fps,
              config: {damping: 15, stiffness: 145},
            });
            return (
              <div
                key={`${issue.rank}-${index}`}
                style={{
                  fontSize,
                  fontWeight: 900,
                  lineHeight: 1.02,
                  letterSpacing: '-0.06em',
                  textShadow: '0 12px 24px rgba(0,0,0,0.3)',
                  transform: `translateX(${interpolate(lineIn, [0, 1], [100, 0])}px)`,
                  opacity: lineIn,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            width: 874,
            marginTop: 30,
            padding: '28px 34px 34px',
            background: 'rgba(10,12,16,0.44)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(16px)',
            transform: `translateY(${bodyY}px)`,
            opacity: bodyIn,
            maxHeight: 320,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              fontSize: 39,
              lineHeight: 1.42,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.92)',
              letterSpacing: '-0.03em',
            }}
          >
            {sentences.map((sentence, index) => (
              <div key={`${issue.rank}-sentence-${index}`}>{sentence}</div>
            ))}
          </div>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 48,
          bottom: 38,
          fontFamily,
          fontSize: 21,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'rgba(255,255,255,0.36)',
        }}
      >
        AI 생성 이미지
      </div>
    </AbsoluteFill>
  );
};

// 리텐션 아웃트로 — 1.5초(45f) 브랜드 컬러 카드 (2026-08-08 훅 수술: 커버 이미지 의존 제거·축소).
const PhotoOutro = ({startFrame}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - startFrame;

  const titleIn = spring({frame: localFrame - 2, fps, config: {damping: 15, stiffness: 140}});
  const pillIn = spring({frame: localFrame - 10, fps, config: {damping: 13, stiffness: 160}});
  const pillPulse = 1 + Math.sin(Math.max(0, localFrame - 18) / 9) * 0.02;

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
          gap: 44,
          padding: '0 90px',
          textAlign: 'center',
          fontFamily,
        }}
      >
        <Img
          src={staticFile('brand/duck.png')}
          style={{
            width: 210,
            height: 210,
            objectFit: 'contain',
            opacity: titleIn,
            transform: `rotate(-4deg) scale(${interpolate(titleIn, [0, 1], [0.7, 1])})`,
          }}
        />
        <div
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '0.32em',
            color: 'rgba(255,255,255,0.62)',
            opacity: titleIn,
          }}
        >
          내일 아침에도
        </div>
        <div
          style={{
            fontSize: 92,
            fontWeight: 900,
            lineHeight: 1.18,
            letterSpacing: '-0.01em',
            opacity: titleIn,
            transform: `translateY(${interpolate(titleIn, [0, 1], [40, 0])}px)`,
          }}
        >
          뉴스 다섯 개
          <br />
          <span style={{color: '#FF3B3B'}}>물어오리</span>
        </div>
        <div
          style={{
            marginTop: 12,
            background: '#FF3B3B',
            borderRadius: 999,
            padding: '26px 64px',
            fontSize: 44,
            fontWeight: 900,
            letterSpacing: '0.02em',
            opacity: pillIn,
            transform: `scale(${interpolate(pillIn, [0, 1], [0.8, 1]) * pillPulse})`,
            boxShadow: '0 18px 60px rgba(255,59,59,0.45)',
          }}
        >
          팔로우하고 매일 받아보기
        </div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: 'rgba(255,255,255,0.5)',
            opacity: pillIn,
          }}
        >
          @muleori.news
        </div>
      </div>
    </AbsoluteFill>
  );
};

// hookLine 없는 구 데이터는 이슈1 제목으로 폴백(하위 호환).
export const HotIssueReelPhoto = ({hookLine, issues, imageDir = 'img/current'}) => {
  const frame = useCurrentFrame();
  const issueList = issues || [];
  const issueIndex = Math.floor(frame / issueDuration);
  const outroStart = issueList.length * issueDuration;

  if (frame >= outroStart) {
    return <PhotoOutro startFrame={outroStart} />;
  }

  const issue = issueList[issueIndex];
  return (
    <AbsoluteFill>
      <IssueSlide
        issue={issue}
        imageSrc={imgSrc(imageDir, `issue-${issue.rank}`)}
        startFrame={issueIndex * issueDuration}
        textDelay={issueIndex === 0 ? hookDuration - 10 : 0}
      />
      {frame < hookDuration ? (
        <HookOverlay hookLine={hookLine || (issueList[0] && issueList[0].title)} />
      ) : null}
    </AbsoluteFill>
  );
};
