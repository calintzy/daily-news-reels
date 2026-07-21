import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {coverDuration, issueDuration, outroDuration, issues, palette} from './hotIssueData.js';

const fontFamily =
  '"Apple SD Gothic Neo","SF Pro Display","Helvetica Neue",sans-serif';

const splitWords = (line) => line.split(' ');

const WordLine = ({line, lineIndex, frame, accent, y}) => {
  const words = splitWords(line);
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 18,
        position: 'absolute',
        left: 78,
        top: y,
        width: 900,
      }}
    >
      {words.map((word, wordIndex) => {
        const delay = lineIndex * 5 + wordIndex * 3;
        const progress = spring({
          frame: frame - delay,
          fps: 30,
          config: {damping: 14, stiffness: 160},
        });
        const lift = interpolate(progress, [0, 1], [70, 0]);
        const opacity = interpolate(progress, [0, 0.4, 1], [0, 0.5, 1]);
        const scale = interpolate(progress, [0, 1], [0.82, 1]);
        return (
          <div
            key={`${line}-${word}-${wordIndex}`}
            style={{
              fontSize: 108,
              fontWeight: 800,
              letterSpacing: '-0.06em',
              lineHeight: 0.95,
              color: palette.ink,
              transform: `translateY(${lift}px) scale(${scale})`,
              opacity,
              padding: '8px 12px 14px',
              background:
                wordIndex === words.length - 1 && lineIndex === 2
                  ? accent
                  : 'transparent',
            }}
          >
            {word}
          </div>
        );
      })}
    </div>
  );
};

const IssuePanel = ({issue, startFrame}) => {
  const frame = useCurrentFrame() - startFrame;
  const {fps, width, height} = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: {damping: 16, stiffness: 150},
  });
  const exitStart = issueDuration - 24;
  const exitProgress = interpolate(frame, [exitStart, issueDuration], [0, 1], {
    easing: Easing.bezier(0.77, 0, 0.18, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const slideX = interpolate(enter, [0, 1], [width * 0.16, 0]) - width * exitProgress;
  const counter = Math.min(Math.max(frame / 14, 0), 1) * parseInt(issue.rank, 10);
  const lineGrow = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bodyOpacity = interpolate(frame, [20, 40, 92], [0, 1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bodyLift = interpolate(frame, [16, 42], [40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const wipe = interpolate(frame, [92, 112], [0, 1], {
    easing: Easing.bezier(0.83, 0, 0.17, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const stripeShift = (frame * 12) % 240;

  return (
    <AbsoluteFill
      style={{
        background: palette.paper,
        overflow: 'hidden',
        fontFamily,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, ${issue.accent}22 0%, transparent 45%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateX(${slideX}px)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 310,
            height,
            background: issue.accent,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 126,
            left: 78,
            display: 'flex',
            alignItems: 'center',
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: issue.accent,
            }}
          >
            {issue.category}
          </div>
          <div
            style={{
              width: 160 * lineGrow,
              height: 6,
              background: issue.accent,
              transformOrigin: 'left center',
            }}
          />
          <div
            style={{
              fontSize: 28,
              color: palette.slate,
              fontWeight: 700,
            }}
          >
            {issue.kicker}
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            top: 242,
            left: 70,
            fontSize: 290,
            lineHeight: 0.8,
            fontWeight: 900,
            letterSpacing: '-0.1em',
            color: '#0000000f',
          }}
        >
          {String(counter).padStart(2, '0')}
        </div>

        {issue.titleLines.map((line, index) => (
          <WordLine
            key={`${issue.rank}-${line}`}
            line={line}
            lineIndex={index}
            frame={frame + index * 2}
            accent={issue.accent}
            y={430 + index * 126}
          />
        ))}

        <div
          style={{
            position: 'absolute',
            left: 78,
            top: 860,
            width: 804,
            padding: '34px 34px 38px',
            background: palette.cream,
            border: `3px solid ${palette.ink}`,
            boxShadow: '18px 18px 0 rgba(17,17,17,0.08)',
            opacity: bodyOpacity,
            transform: `translateY(${bodyLift}px)`,
          }}
        >
          <div
            style={{
              fontSize: 44,
              lineHeight: 1.42,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: palette.ink,
            }}
          >
            {issue.body}
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 176,
            left: -240 + stripeShift,
            width: 1560,
            display: 'flex',
            gap: 20,
            transform: 'rotate(-8deg)',
          }}
        >
          {Array.from({length: 8}).map((_, i) => (
            <div
              key={i}
              style={{
                width: 170,
                height: 26,
                background: i % 2 === 0 ? issue.accent : palette.ink,
                opacity: 0.9,
              }}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: issue.accent,
          clipPath: `inset(${(1 - wipe) * 100}% 0 0 0)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Cover = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const titleIn = spring({
    frame,
    fps,
    config: {damping: 14, stiffness: 170},
  });
  const slashScale = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const dateOpacity = interpolate(frame, [16, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const footerShift = interpolate(frame, [24, 44], [60, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exit = interpolate(frame, [64, coverDuration], [0, 1], {
    easing: Easing.bezier(0.76, 0, 0.24, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: palette.paper,
        color: palette.ink,
        fontFamily,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 15% 10%, rgba(239,62,54,0.2), transparent 25%), radial-gradient(circle at 85% 85%, rgba(36,87,255,0.18), transparent 24%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: -150 + exit * -420,
          left: -40,
          width: 520,
          height: 2400,
          background: palette.red,
          transform: `rotate(${12 + 10 * slashScale}deg) scaleX(${slashScale})`,
          transformOrigin: 'top center',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 250,
          left: 120 - exit * 160,
          opacity: 1 - exit,
        }}
      >
        <div
          style={{
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: palette.red,
            marginBottom: 34,
          }}
        >
          MORNING REELS / 2026.07.21
        </div>
        <div
          style={{
            fontSize: 164,
            lineHeight: 0.88,
            fontWeight: 900,
            letterSpacing: '-0.09em',
            transform: `translateY(${interpolate(titleIn, [0, 1], [100, 0])}px)`,
          }}
        >
          오늘의
        </div>
        <div
          style={{
            fontSize: 220,
            lineHeight: 0.84,
            fontWeight: 900,
            letterSpacing: '-0.1em',
            marginTop: 8,
            transform: `translateX(${interpolate(titleIn, [0, 1], [180, 0])}px)`,
            background: palette.ink,
            color: palette.paper,
            display: 'inline-block',
            padding: '10px 18px 22px',
          }}
        >
          핫이슈
        </div>
        <div
          style={{
            fontSize: 250,
            lineHeight: 0.8,
            fontWeight: 900,
            letterSpacing: '-0.12em',
            color: palette.blue,
            marginTop: 14,
            transform: `translateX(${interpolate(titleIn, [0, 1], [-120, 0])}px)`,
          }}
        >
          TOP 5
        </div>
        <div
          style={{
            marginTop: 56,
            fontSize: 50,
            lineHeight: 1.35,
            fontWeight: 700,
            opacity: dateOpacity,
            transform: `translateY(${footerShift}px)`,
          }}
        >
          2026.07.21 (화)
          <br />
          지금 대한민국이 주목하는 다섯 가지
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 104,
          bottom: 168,
          width: 280,
          opacity: 1 - exit,
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: palette.slate,
            marginBottom: 16,
          }}
        >
          QUICK SWEEP
        </div>
        {Array.from({length: 5}).map((_, i) => (
          <div
            key={i}
            style={{
              height: 28,
              background: i % 2 === 0 ? palette.red : palette.blue,
              marginBottom: 14,
              width: `${180 + i * 20}px`,
              transform: `translateX(${interpolate(frame, [i * 3, 24 + i * 2], [220, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })}px)`,
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Outro = ({startFrame}) => {
  const frame = useCurrentFrame() - startFrame;
  const {fps} = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: {damping: 15, stiffness: 160},
  });

  return (
    <AbsoluteFill
      style={{
        background: palette.ink,
        color: palette.paper,
        fontFamily,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 80% 20%, rgba(255,177,0,0.35), transparent 22%), radial-gradient(circle at 15% 80%, rgba(36,87,255,0.25), transparent 24%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 86,
          top: 280,
          transform: `translateY(${interpolate(enter, [0, 1], [90, 0])}px)`,
        }}
      >
        <div
          style={{
            fontSize: 42,
            color: palette.gold,
            fontWeight: 800,
            letterSpacing: '0.12em',
            marginBottom: 30,
          }}
        >
          FOLLOW THE PULSE
        </div>
        <div
          style={{
            fontSize: 132,
            lineHeight: 0.94,
            letterSpacing: '-0.08em',
            fontWeight: 900,
          }}
        >
          매일 아침,
          <br />
          핫이슈 5개
        </div>
        <div
          style={{
            marginTop: 46,
            fontSize: 56,
            lineHeight: 1.35,
            fontWeight: 700,
            width: 860,
            color: '#f6f1e8dd',
          }}
        >
          가장 뜨거운 이슈만 빠르게.
          <br />
          다음 아침 브리핑도 놓치지 마세요.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 140,
          left: 86,
          right: 86,
          display: 'flex',
          gap: 18,
        }}
      >
        {Array.from({length: 7}).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 22 + (i % 3) * 18,
              background: i % 2 === 0 ? palette.red : palette.blue,
              transform: `translateY(${interpolate(frame, [i * 2, 20 + i * 2], [100, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })}px)`,
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const HotIssueReel = () => {
  const frame = useCurrentFrame();
  const issueIndex = Math.floor((frame - coverDuration) / issueDuration);

  if (frame < coverDuration) {
    return <Cover />;
  }

  if (frame >= coverDuration + issues.length * issueDuration) {
    return <Outro startFrame={coverDuration + issues.length * issueDuration} />;
  }

  return (
    <IssuePanel
      issue={issues[issueIndex]}
      startFrame={coverDuration + issueIndex * issueDuration}
    />
  );
};
