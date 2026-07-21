import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {coverDuration, issueDuration, outroDuration, issues} from './hotIssueData.js';

import coverImage from '../assets/cover-city-newsroom.png';
import issue1Image from '../assets/issue-01-baduk-closeup.png';
import issue2Image from '../assets/issue-02-apartment-fire.png';
import issue3Image from '../assets/issue-03-red-sea-blockade.png';
import issue4Image from '../assets/issue-04-seoul-apartments-sunset.png';
import issue5Image from '../assets/issue-05-court-verdict.png';

const fontFamily =
  '"Apple SD Gothic Neo","SF Pro Display","Helvetica Neue",sans-serif';

const coverMeta = {
  eyebrow: 'MORNING NEWS REELS',
  titleLines: ['오늘의', '핫이슈', 'TOP 5'],
  subhead: ['2026.07.21 (화)', '지금 대한민국이 주목하는 다섯 가지'],
};

const photoAssets = [
  issue1Image,
  issue2Image,
  issue3Image,
  issue4Image,
  issue5Image,
];

const splitSentences = (text) => {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
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

const Cover = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const titleEnter = spring({
    frame,
    fps,
    config: {damping: 17, stiffness: 140},
  });
  const stripEnter = spring({
    frame: frame - 10,
    fps,
    config: {damping: 15, stiffness: 130},
  });
  const exit = interpolate(frame, [58, coverDuration], [0, 1], {
    easing: Easing.bezier(0.78, 0, 0.22, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#0b0d11', color: '#ffffff'}}>
      <PhotoBackground src={coverImage} frame={frame} startFrame={0} panBias={-12} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(6,8,11,0.18) 0%, rgba(6,8,11,0.48) 52%, rgba(6,8,11,0.92) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(120deg, rgba(176,17,24,0.34) 0%, rgba(176,17,24,0.08) 26%, transparent 44%)',
          opacity: 1 - exit,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 86,
          padding: '16px 22px',
          border: '1px solid rgba(255,255,255,0.34)',
          background: 'rgba(9,12,16,0.28)',
          fontFamily,
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '0.22em',
          backdropFilter: 'blur(12px)',
        }}
      >
        {coverMeta.eyebrow}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 74,
          bottom: 238,
          width: 860,
          transform: `translateX(${interpolate(titleEnter, [0, 1], [110, 0])}px)`,
          opacity: 1 - exit,
          fontFamily,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            marginBottom: 30,
          }}
        >
          <div
            style={{
              height: 16,
              width: interpolate(stripEnter, [0, 1], [0, 140]),
              background: '#d61f29',
            }}
          />
          <div
            style={{
              fontSize: 34,
              letterSpacing: '0.1em',
              fontWeight: 800,
              color: 'rgba(255,255,255,0.74)',
            }}
          >
            2026.07.21
          </div>
        </div>
        <div style={{fontSize: 154, fontWeight: 900, lineHeight: 0.86, letterSpacing: '-0.08em'}}>
          {coverMeta.titleLines[0]}
        </div>
        <div
          style={{
            display: 'inline-block',
            marginTop: 6,
            padding: '8px 22px 20px',
            backgroundColor: '#ffffff',
            color: '#0a0d11',
            fontSize: 182,
            fontWeight: 900,
            lineHeight: 0.84,
            letterSpacing: '-0.1em',
          }}
        >
          {coverMeta.titleLines[1]}
        </div>
        <div style={{fontSize: 190, fontWeight: 900, lineHeight: 0.82, letterSpacing: '-0.11em'}}>
          {coverMeta.titleLines[2]}
        </div>
        <div
          style={{
            marginTop: 38,
            fontSize: 46,
            lineHeight: 1.32,
            color: 'rgba(255,255,255,0.86)',
            fontWeight: 700,
          }}
        >
          {coverMeta.subhead[0]}
          <br />
          {coverMeta.subhead[1]}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: -120 + interpolate(stripEnter, [0, 1], [180, 0]),
          top: -160,
          width: 380,
          height: 2450,
          transform: 'rotate(14deg)',
          background:
            'linear-gradient(180deg, rgba(214,31,41,0.95) 0%, rgba(214,31,41,0.72) 40%, rgba(214,31,41,0.08) 100%)',
          opacity: 1 - exit,
        }}
      />
    </AbsoluteFill>
  );
};

const IssueSlide = ({issue, imageSrc, startFrame, isLast}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const localFrame = frame - startFrame;
  const headlineIn = spring({
    frame: localFrame,
    fps,
    config: {damping: 15, stiffness: 150},
  });
  const bodyIn = spring({
    frame: localFrame - 12,
    fps,
    config: {damping: 16, stiffness: 120},
  });
  const tagIn = spring({
    frame: localFrame - 4,
    fps,
    config: {damping: 18, stiffness: 150},
  });
  // 사선 와이프 2단계 — 기울어진(skewX -16deg) 밴드는 세로 1920 기준 수평으로
  // 최대 ±height*tan(16°)≈550px 어긋나므로, 화면 폭만큼만 이동하면 끝까지 못 덮는다.
  // 밴드 폭을 화면의 4배로 잡고 [진입: 우하단→화면 전체 덮음] → 컷 →
  // [다음 슬라이드에서 좌상단으로 완전 퇴장]으로 이어지는 연속 동작으로 처리한다.
  const wipeInX = interpolate(localFrame, [86, issueDuration], [width * 1.6, -width * 1.5], {
    easing: Easing.bezier(0.83, 0, 0.17, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const wipeInY = interpolate(localFrame, [86, issueDuration], [height * 0.1, 0], {
    easing: Easing.bezier(0.83, 0, 0.17, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const wipeOutX = interpolate(localFrame, [0, 16], [-width * 1.5, -width * 4.7], {
    easing: Easing.bezier(0.55, 0, 0.45, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const wipeOutY = interpolate(localFrame, [0, 16], [0, -height * 0.1], {
    easing: Easing.bezier(0.55, 0, 0.45, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rankNum = parseInt(issue.rank, 10);
  const showWipeOut = rankNum > 1 && localFrame < 18;
  const wipeBandStyle = {
    position: 'absolute',
    top: '-30%',
    bottom: '-30%',
    left: 0,
    width: width * 4,
    background:
      'linear-gradient(90deg, rgba(214,31,41,0) 0%, rgba(214,31,41,0.4) 5%, rgba(214,31,41,0.98) 10%, rgba(11,13,18,0.97) 22%, rgba(11,13,18,0.97) 78%, rgba(214,31,41,0.98) 88%, rgba(214,31,41,0.4) 95%, rgba(214,31,41,0) 100%)',
  };
  const headlineX = interpolate(headlineIn, [0, 1], [width * 0.14, 0]);
  const headlineY = interpolate(headlineIn, [0, 1], [46, 0]);
  const bodyY = interpolate(bodyIn, [0, 1], [70, 0]);
  const sentences = splitSentences(issue.body);

  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#050608', color: '#ffffff'}}>
      <PhotoBackground
        src={imageSrc}
        frame={frame}
        startFrame={startFrame}
        panBias={(parseInt(issue.rank, 10) - 3) * 4}
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
          {issue.rank}
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
          bottom: 78,
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
            }}
          >
            <div style={{width: 56, height: 6, background: '#d61f29'}} />
            {issue.kicker}
          </div>
          {issue.titleLines.map((line, index) => {
            const lineIn = spring({
              frame: localFrame - index * 4,
              fps,
              config: {damping: 15, stiffness: 145},
            });
            return (
              <div
                key={`${issue.rank}-${line}`}
                style={{
                  fontSize: 108,
                  fontWeight: 900,
                  lineHeight: 0.94,
                  letterSpacing: '-0.08em',
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
      {showWipeOut ? (
        <div
          style={{
            ...wipeBandStyle,
            transform: `translateX(${wipeOutX}px) translateY(${wipeOutY}px) skewX(-16deg)`,
          }}
        />
      ) : null}
      {!isLast ? (
        <div
          style={{
            ...wipeBandStyle,
            transform: `translateX(${wipeInX}px) translateY(${wipeInY}px) skewX(-16deg)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

// 리텐션 아웃트로 — 팔로우 약속(매일 TOP5) + 저장 유도. 마지막 이슈의 사선 와이프를
// 이어받아 시작하므로 IssueSlide와 동일한 밴드 상수를 쓴다.
const PhotoOutro = ({startFrame}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const localFrame = frame - startFrame;

  const wipeOutX = interpolate(localFrame, [0, 16], [-width * 1.5, -width * 4.7], {
    easing: Easing.bezier(0.55, 0, 0.45, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const wipeOutY = interpolate(localFrame, [0, 16], [0, -height * 0.1], {
    easing: Easing.bezier(0.55, 0, 0.45, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const titleIn = spring({frame: localFrame - 8, fps, config: {damping: 15, stiffness: 140}});
  const pillIn = spring({frame: localFrame - 20, fps, config: {damping: 13, stiffness: 160}});
  const saveIn = spring({frame: localFrame - 30, fps, config: {damping: 16, stiffness: 140}});
  const pillPulse = 1 + Math.sin(Math.max(0, localFrame - 34) / 9) * 0.02;

  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#050608', color: '#ffffff'}}>
      <PhotoBackground src={coverImage} frame={frame} startFrame={startFrame} panBias={0} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(5,6,8,0.72)',
        }}
      />
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
          국내 뉴스 TOP 5
          <br />
          <span style={{color: '#FF3B3B'}}>1분</span>이면 끝
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
            fontSize: 30,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.72)',
            opacity: saveIn,
            transform: `translateY(${interpolate(saveIn, [0, 1], [24, 0])}px)`,
          }}
        >
          지금 저장해 두면 다시 보기 편해요
        </div>
      </div>
      {localFrame < 18 ? (
        <div
          style={{
            position: 'absolute',
            top: '-30%',
            bottom: '-30%',
            left: 0,
            width: width * 4,
            background:
              'linear-gradient(90deg, rgba(214,31,41,0) 0%, rgba(214,31,41,0.4) 5%, rgba(214,31,41,0.98) 10%, rgba(11,13,18,0.97) 22%, rgba(11,13,18,0.97) 78%, rgba(214,31,41,0.98) 88%, rgba(214,31,41,0.4) 95%, rgba(214,31,41,0) 100%)',
            transform: `translateX(${wipeOutX}px) translateY(${wipeOutY}px) skewX(-16deg)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const HotIssueReelPhoto = () => {
  const frame = useCurrentFrame();
  const issueIndex = Math.floor((frame - coverDuration) / issueDuration);
  const outroStart = coverDuration + issues.length * issueDuration;

  if (frame < coverDuration) {
    return <Cover />;
  }
  if (frame >= outroStart) {
    return <PhotoOutro startFrame={outroStart} />;
  }

  return (
    <IssueSlide
      issue={issues[issueIndex]}
      imageSrc={photoAssets[issueIndex]}
      startFrame={coverDuration + issueIndex * issueDuration}
      isLast={false}
    />
  );
};
