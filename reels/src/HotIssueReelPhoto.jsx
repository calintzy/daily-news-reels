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
import {coverDuration, issueDuration} from './timing.js';

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

// 회차(slot) → 커버 날짜 라벨. slot 없으면 date만.
const slotLabel = (date, slot) =>
  slot === 'am' ? `${date} · 아침 브리핑` : slot === 'pm' ? `${date} · 저녁 브리핑` : date;

const Cover = ({date, slot, todayOneLiner, coverSrc}) => {
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
      <PhotoBackground src={coverSrc} frame={frame} startFrame={0} panBias={-12} />
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
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 22px 12px 14px',
          border: '1px solid rgba(255,255,255,0.34)',
          background: 'rgba(9,12,16,0.28)',
          fontFamily,
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: '0.2em',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Img
          src={staticFile('brand/duck.png')}
          style={{width: 54, height: 54, objectFit: 'contain'}}
        />
        물어오리 뉴스
      </div>
      <div
        style={{
          position: 'absolute',
          left: 74,
          // 릴스 하단 UI 세이프존: 마지막 요소(todayOneLiner)가 계정명 줄에 가리지 않게.
          bottom: 340,
          width: 900,
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
            {slotLabel(date, slot)}
          </div>
        </div>
        <div style={{fontSize: 154, fontWeight: 900, lineHeight: 1.0, letterSpacing: '-0.08em'}}>
          오늘의
        </div>
        <div
          style={{
            display: 'inline-block',
            marginTop: 10,
            marginBottom: 14,
            padding: '10px 26px 16px',
            backgroundColor: '#ffffff',
            color: '#0a0d11',
            fontSize: 182,
            fontWeight: 900,
            lineHeight: 1.0,
            letterSpacing: '-0.1em',
          }}
        >
          뉴스
        </div>
        <div style={{fontSize: 190, fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.11em'}}>
          TOP 5
        </div>
        <div
          style={{
            marginTop: 38,
            fontSize: 42,
            lineHeight: 1.32,
            color: 'rgba(255,255,255,0.86)',
            fontWeight: 700,
            maxHeight: 168,
            overflow: 'hidden',
          }}
        >
          {todayOneLiner}
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
  // 사선 와이프 2단계 — 원본 프로토타입과 동일 (기울어진 밴드 진입→퇴장 연속 동작).
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
  const rankNum = Number(issue.rank);
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
            }}
          >
            <div style={{width: 56, height: 6, background: '#d61f29'}} />
            {issue.kicker}
          </div>
          {titleLines.map((line, index) => {
            const lineIn = spring({
              frame: localFrame - index * 4,
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

// 리텐션 아웃트로 — 원본 문구 그대로 유지 ("국내 뉴스 TOP 5 / 1분이면 끝").
const PhotoOutro = ({startFrame, coverSrc}) => {
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
      <PhotoBackground src={coverSrc} frame={frame} startFrame={startFrame} panBias={0} />
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
            fontSize: 30,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.72)',
            opacity: saveIn,
            transform: `translateY(${interpolate(saveIn, [0, 1], [24, 0])}px)`,
          }}
        >
          지금 저장해 두면 다시 보기 편해요
        </div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: 'rgba(255,255,255,0.5)',
            opacity: saveIn,
          }}
        >
          @muleori.news
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

export const HotIssueReelPhoto = ({date, slot = null, todayOneLiner, issues, imageDir = 'img/current'}) => {
  const frame = useCurrentFrame();
  const issueList = issues || [];
  const issueIndex = Math.floor((frame - coverDuration) / issueDuration);
  const outroStart = coverDuration + issueList.length * issueDuration;
  const coverSrc = imgSrc(imageDir, 'cover');

  if (frame < coverDuration) {
    return <Cover date={date} slot={slot} todayOneLiner={todayOneLiner} coverSrc={coverSrc} />;
  }
  if (frame >= outroStart) {
    return <PhotoOutro startFrame={outroStart} coverSrc={coverSrc} />;
  }

  const issue = issueList[issueIndex];
  return (
    <IssueSlide
      issue={issue}
      imageSrc={imgSrc(imageDir, `issue-${issue.rank}`)}
      startFrame={coverDuration + issueIndex * issueDuration}
      isLast={issueIndex === issueList.length - 1}
    />
  );
};
