import React from 'react';
import {
  AbsoluteFill,
  Img,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {loadFont, fontFamily as notoSerifKRFamily} from '@remotion/google-fonts/NotoSerifKR';
import {issueDuration, hookDuration} from './timing.js';
import {nowrapNumbers} from './nowrapNumbers.jsx';
import {extractKeyStat} from './keyStat.js';
import {ZONES, COVER, MARGIN} from './safeArea.js';

// Noto Serif KR — CI(ubuntu headless Chromium)에는 기본 설치돼 있지 않으므로 렌더 전에 로드해 대기한다.
// (Noto Sans CJK KR과 달리 이 서체는 컨테이너 이미지에 없다 — 폴백이면 고딕으로 뭉개진다.)
const {waitUntilDone: waitForNotoSerifKR} = loadFont('normal', {
  weights: ['400', '600', '700', '900'],
  subsets: ['korean'],
});
const notoSerifKRHandle = delayRender('Noto Serif KR 로딩');
waitForNotoSerifKR()
  .then(() => continueRender(notoSerifKRHandle))
  .catch(() => continueRender(notoSerifKRHandle));

const serif = `"${notoSerifKRFamily}","Noto Serif KR","나눔명조",Georgia,serif`;
// Noto Sans CJK KR 폴백 체인은 HotIssueReelPhoto.jsx에서 CI 렌더로 이미 검증됐다 — 그대로 재사용.
const sans =
  '"Noto Sans CJK KR","Apple SD Gothic Neo","Noto Sans KR","SF Pro Display","Helvetica Neue",sans-serif';

const INK = '#1A1A1A';
const PAPER = '#FAF7F0';

const imgSrc = (imageDir, name) => staticFile(`${imageDir}/${name}.png`);

// 오리 기자(aibrief) 기본값 — 이 컴포지션은 오리 기자 전용이라 브랜드 기본값도 그쪽으로 맞춘다.
const DEFAULT_BRAND = {
  name: '오리 기자',
  handle: '@todays.ai.brief',
  logo: 'brand/duck-news-t.png',
  accent: '#F5B82E',
  eyebrow: '내일도 물어오는',
  closing: 'AI 뉴스',
};

const accentRgb = (hex) => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

// 발행 호수 — daily-briefing/cardnews/template.mjs의 issueNo와 동일 기산일(2025-10-01).
function issueNo(dateStr) {
  const start = new Date('2025-10-01');
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 1;
  return Math.max(1, Math.round((d - start) / 86400000));
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
// ISO 날짜 문자열은 UTC 자정으로 파싱되는데 .getDay()는 로컬 타임존 기준이라
// 렌더 서버 TZ가 UTC보다 느리면 요일이 하루 밀릴 수 있다 — UTC 접근자로 고정해 방지.
const weekdayOf = (dateStr) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return '';
  const utcDay = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return WEEKDAYS[utcDay];
};

// 숫자 사이 마침표(소수점, 예: "100.01")는 문장 종결부호가 아니다 — 문장 경계 판정 전에
// 임시 치환해 분리 대상에서 제외한 뒤 복원한다(2026-09-13: "100.01달러"가 "100."/"01달러"로
// 서로 다른 <div>에 쪼개져 줄바꿈되는 버그의 root cause).
const DECIMAL_POINT_PLACEHOLDER = '';
const splitSentences = (text) => {
  const masked = String(text).replace(/(\d)\.(?=\d)/g, `$1${DECIMAL_POINT_PLACEHOLDER}`);
  const matches = masked.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  const restore = (part) => part.replace(new RegExp(DECIMAL_POINT_PLACEHOLDER, 'g'), '.');
  return matches ? matches.map((p) => restore(p.trim())).filter(Boolean) : [String(text)];
};

// 제목 길이별 폰트 크기: 26자 초과 시 74→62px 자동 축소.
const titleFontSize = (title) => ([...String(title)].length > 26 ? 62 : 74);
// noPhotos 카드 제목 — CORE 스택 예산(최대 3줄, 높이 208 이하) 안에 들도록 길이 구간별로 줄인다.
const cardTitleFontSize = (title) => {
  const len = [...String(title)].length;
  if (len <= 20) return 68;
  if (len <= 26) return 62;
  return 56;
};

// 배치 상자 — 판정 한계(안전 영역 경계에서 MARGIN 안쪽)보다 4px 더 안쪽에 둔다.
// CI(리눅스) 폰트에서 글자 위치가 1~2px 달라져도 판정에 걸리지 않게 하는 여유다.
const INSET = MARGIN + 4;
const CORE = {
  left: ZONES.core.left + INSET,
  right: 1080 - ZONES.core.right + INSET,
  top: ZONES.core.top + INSET,
  height: ZONES.core.bottom - ZONES.core.top - 2 * INSET,
};

// 26px 모눈 텍스처 — template.mjs 신문 질감 그대로 재현.
const gridBg = {
  backgroundImage:
    'linear-gradient(rgba(26,26,26,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(26,26,26,0.025) 1px, transparent 1px)',
  backgroundSize: '26px 26px',
};

const InkFrame = ({color = INK}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      border: `4px solid ${color}`,
      pointerEvents: 'none',
      zIndex: 30,
    }}
  />
);

const Masthead = ({date, weekday, issueNumber, label, accent, dark = false}) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 64,
      borderBottom: `1.5px solid ${dark ? 'rgba(255,255,255,0.3)' : INK}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 52px',
      fontFamily: sans,
      zIndex: 5,
    }}
  >
    <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
      <div
        style={{
          fontSize: 15,
          fontWeight: 900,
          letterSpacing: '0.14em',
          color: dark ? '#FAF7F0' : INK,
        }}
      >
        TODAYS.AI.BRIEF
      </div>
      {label ? (
        <>
          <div style={{fontSize: 11, color: accent}}>✦</div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: dark ? '#FAF7F0' : INK,
              opacity: 0.5,
            }}
          >
            {label}
          </div>
        </>
      ) : null}
    </div>
    <div
      style={{
        fontSize: 14,
        fontWeight: 700,
        color: dark ? '#FAF7F0' : INK,
        opacity: 0.5,
        letterSpacing: '0.02em',
      }}
    >
      제{issueNumber}호 · {date} ({weekday})
    </div>
  </div>
);

// 훅 오버레이 — 이슈1 첫 hookDuration(54f) 동안 다크 지면으로 hookLine을 크게 던진다.
// fadeOut 이후 아래 깔린 이슈1 지면이 드러난다 (물어오리 HookOverlay와 동일한 페이드 메커니즘).
// "호외" 표기는 사용자 피드백으로 제거(무슨 뜻인지 안 읽힘) — 마스트헤드·스티커 둘 다 뺐다.
// 표지(thumb_offset 27f)·그리드 크롭 대응: 브랜드·훅·보조 문구 블록을 CORE와 1:1 크롭의 교집합(COVER, y 420~1250)
// 중앙(y 835)에 두고, 0프레임부터 불투명도 1로 보인다(표지 프레임이 바뀌어도 글자가 비지 않게 이동 스프링만 남겼다).
const HookOverlay = ({hookLine, date, weekday, issueNumber, brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 13, stiffness: 170}});
  const fadeOut = interpolate(frame, [hookDuration - 14, hookDuration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{opacity: fadeOut, backgroundColor: INK, zIndex: 10}}>
      <div style={{position: 'absolute', inset: 0, ...gridBg, opacity: 0.5}} />
      <Masthead date={date} weekday={weekday} issueNumber={issueNumber} accent={brand.accent} dark />

      <div
        style={{
          position: 'absolute',
          left: CORE.left,
          right: CORE.right,
          top: COVER.top + INSET,
          height: COVER.bottom - COVER.top - 2 * INSET,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 32,
          transform: `translateY(${interpolate(enter, [0, 1], [50, 0])}px)`,
        }}
      >
        <div
          data-zone="core"
          data-el="hook-brand"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontFamily: sans,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: '0.04em',
            color: brand.accent,
          }}
        >
          <Img src={staticFile(brand.logo)} style={{width: 64, height: 64, objectFit: 'contain'}} />
          {brand.name}
        </div>

        <div
          data-zone="core"
          data-el="hook"
          style={{
            fontFamily: serif,
            fontSize: 78,
            fontWeight: 900,
            lineHeight: 1.22,
            letterSpacing: '-0.02em',
            color: '#FAF7F0',
            wordBreak: 'keep-all',
          }}
        >
          {nowrapNumbers(hookLine)}
        </div>

        <div
          data-zone="core"
          data-el="hook-sub"
          style={{
            fontFamily: sans,
            fontSize: 30,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.62)',
            letterSpacing: '0.02em',
          }}
        >
          오리 기자가 오늘 가장 먼저 물어온 소식
        </div>
      </div>

      <InkFrame color="rgba(255,255,255,0.4)" />
    </AbsoluteFill>
  );
};

// noPhotos 모드 전용 — 오리 기자 코멘트 말풍선 문구(사실 진술이 아닌 브랜드 보이스 고정 문구,
// 이슈 랭크로 순환 배정해 5장 내내 같은 문장이 반복되지 않게 한다).
const DUCK_COMMENTS = [
  '오리 기자가 오늘 아침 가장 먼저 물어온 소식이에요.',
  '숫자 하나하나 놓치지 않고 확인했습니덬.',
  '짧지만 오늘 꼭 알아야 할 이야기예요.',
  '읽고 나면 대화 소재로 딱이에요 🦆',
  '내용은 실제 뉴스 기준으로 정확하게 압축했습니다.',
];

// 추출된 문자열 길이별 폰트 크기 — 수치는 짧을수록(예: "64%") 더 크게 키운다.
// 8자 이상(주로 kicker 폴백)은 2줄까지 허용 — 라벨 포함 블록 높이 194 이하 예산.
const keyStatFontSize = (text) => {
  const len = [...String(text ?? '')].length;
  if (len <= 3) return 150;
  if (len <= 5) return 130;
  if (len <= 7) return 108;
  return 76;
};

// 요약 길이별 풀쿼트 폰트 크기 — noPhotos 모드에서 사진 자리를 대신하는 확대 인용구용.
const quoteFontSize = (summary) => {
  const len = String(summary ?? '').length;
  if (len > 100) return 40;
  if (len > 70) return 44;
  return 50;
};

// textDelay: 훅 오버레이가 걷힐 때까지 이슈1 텍스트 진입을 늦춘다 (훅·헤드라인 겹침 방지).
// noPhotos: true(또는 imageSrc 미전달)면 사진 인셋 자리를 확대 풀쿼트 + 오리 코멘트로 대체한다.
const NewsIssueSlide = ({issue, imageSrc, startFrame, date, weekday, issueNumber, total, brand, textDelay = 0, noPhotos = false}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - startFrame;
  const textFrame = localFrame - textDelay;

  const stickerIn = spring({frame: textFrame, fps, config: {damping: 13, stiffness: 170}});
  const headlineIn = spring({frame: textFrame - 6, fps, config: {damping: 15, stiffness: 150}});
  const photoIn = spring({frame: textFrame - 16, fps, config: {damping: 16, stiffness: 130}});
  const stampIn = spring({frame: textFrame - 34, fps, config: {damping: 11, stiffness: 200}});

  const rankLabel = String(issue.rank).padStart(2, '0');
  const sentences = splitSentences(issue.summary);
  const fontSize = titleFontSize(issue.title);

  // 본문 형광펜 스윕 — 문장 길이 비례로 구간을 나눠 순차적으로 훑는다(나레이션 리듬과 맞물리게).
  const sweepStart = 70;
  const sweepEnd = issueDuration - 18;
  const totalLen = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
  let cursor = sweepStart;
  const sentenceWindows = sentences.map((s) => {
    const dur = ((sweepEnd - sweepStart) * s.length) / totalLen;
    const win = [cursor, cursor + dur];
    cursor += dur;
    return win;
  });

  // noPhotos 모드 키 스탯 — 숫자를 실제로 뽑았으면 "오늘의 숫자", kicker 폴백이면 "오늘의 키워드".
  const keyStat = extractKeyStat(issue);
  const keyStatLabel = keyStat.isStat ? '오늘의 숫자' : '오늘의 키워드';

  // 랭크 배지 + 카테고리·킥커 스티커 — noPhotos는 CORE 스택의 flex 항목, 사진 모드는 기존 절대 배치 그대로.
  const badgeRow = (
    <div
      style={{
        ...(noPhotos ? {height: 56, flexShrink: 0} : {position: 'absolute', top: 92, left: 52}),
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        opacity: stickerIn,
        transform: `translateY(${interpolate(stickerIn, [0, 1], [18, 0])}px)`,
        zIndex: 4,
      }}
    >
      <div
        data-zone="core"
        data-el="rank"
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: brand.accent,
          border: `3px solid ${INK}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: sans,
          fontSize: noPhotos ? 28 : 24,
          fontWeight: 900,
          color: INK,
          transform: 'rotate(-3deg)',
          boxShadow: '4px 5px 0 rgba(26,26,26,0.16)',
        }}
      >
        {rankLabel}
      </div>
      <div
        data-zone="core"
        data-el="kicker"
        style={{
          background: PAPER,
          border: `2.5px solid ${INK}`,
          borderRadius: 12,
          padding: noPhotos ? '6px 18px' : '9px 18px',
          transform: 'rotate(-1.4deg)',
          fontFamily: sans,
          fontSize: noPhotos ? 28 : 16,
          ...(noPhotos ? {lineHeight: 1.2} : {}),
          fontWeight: 800,
          letterSpacing: '0.03em',
          color: INK,
        }}
      >
        {issue.kicker}
      </div>
    </div>
  );

  // 헤드라인 — noPhotos는 길이 구간별 크기(최대 3줄), 사진 모드는 기존 배치·크기 그대로.
  const headline = (
    <div
      style={{
        ...(noPhotos ? {flexShrink: 0} : {position: 'absolute', top: 176, left: 52, right: 52}),
        opacity: headlineIn,
        transform: `translateY(${interpolate(headlineIn, [0, 1], [34, 0])}px)`,
        zIndex: 3,
      }}
    >
      <div
        data-zone="core"
        data-el="title"
        style={{
          fontFamily: serif,
          fontSize: noPhotos ? cardTitleFontSize(issue.title) : fontSize,
          fontWeight: 900,
          lineHeight: noPhotos ? 1.12 : 1.14,
          letterSpacing: '-0.02em',
          color: INK,
          wordBreak: 'keep-all',
        }}
      >
        {nowrapNumbers(issue.title)}
      </div>
    </div>
  );

  return (
    <AbsoluteFill style={{backgroundColor: PAPER, ...gridBg}}>
      <Masthead date={date} weekday={weekday} issueNumber={issueNumber} label={issue.category} accent={brand.accent} />

      {/* 배경 워터마크 순번 — template.mjs signalHtml의 옅은 배경 숫자 재현 */}
      <div
        style={{
          position: 'absolute',
          right: -18,
          top: 640,
          fontFamily: serif,
          fontSize: 620,
          fontWeight: 900,
          color: INK,
          opacity: 0.03,
          lineHeight: 1,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        {rankLabel}
      </div>

      {noPhotos ? (
        <>
          {/* CORE 스택 — 배지·제목·키 스탯·풀쿼트를 flex column으로 쌓는다. 절대 top 값이 없어서
              제목 줄 수가 달라져도 아래 요소와 겹치지 않고, 풀쿼트가 남은 공간을 쓴다. */}
          <div
            style={{
              position: 'absolute',
              top: CORE.top,
              left: CORE.left,
              right: CORE.right,
              height: CORE.height,
              display: 'flex',
              flexDirection: 'column',
              gap: 24,
              zIndex: 3,
            }}
          >
            {badgeRow}
            {headline}

            {/* 키 스탯 — title/summary에서 뽑은 핵심 수치(없으면 kicker) 대형 인포그래픽 타이포. */}
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'stretch',
                gap: 18,
                opacity: stickerIn,
                transform: `translateY(${interpolate(stickerIn, [0, 1], [22, 0])}px)`,
                zIndex: 2,
              }}
            >
              <div style={{width: 6, background: brand.accent, flexShrink: 0}} />
              {/* 수치 lineHeight 1.3 + 간격 12 — 글리프 영역(약 1.44em)이 라벨과 겹치지 않는 최소값. */}
              <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                <div
                  data-zone="core"
                  data-el="stat-label"
                  style={{
                    fontFamily: sans,
                    fontSize: 28,
                    fontWeight: 900,
                    letterSpacing: '0.18em',
                    color: INK,
                    opacity: 0.4,
                  }}
                >
                  {keyStatLabel}
                </div>
                <div
                  data-zone="core"
                  data-el="stat"
                  style={{
                    fontFamily: serif,
                    fontWeight: 900,
                    fontSize: keyStatFontSize(keyStat.text),
                    lineHeight: 1.3,
                    letterSpacing: '-0.02em',
                    color: INK,
                    wordBreak: 'keep-all',
                  }}
                >
                  {keyStat.text}
                </div>
              </div>
            </div>

            {/* 풀쿼트 — 사진 자리를 대신하는 확대 인용구, 문장 길이 비례 형광펜 스윕 */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                opacity: photoIn,
                transform: `translateY(${interpolate(photoIn, [0, 1], [30, 0])}px)`,
                zIndex: 2,
              }}
            >
              <div
                data-zone="core"
                data-el="quote"
                style={{
                  width: '100%',
                  fontFamily: serif,
                  fontStyle: 'italic',
                  fontWeight: 700,
                  fontSize: quoteFontSize(issue.summary),
                  lineHeight: 1.42,
                  color: INK,
                  wordBreak: 'keep-all',
                }}
              >
                <span
                  style={{
                    fontFamily: 'Georgia,serif',
                    fontStyle: 'normal',
                    fontSize: quoteFontSize(issue.summary) * 1.8,
                    fontWeight: 700,
                    color: `rgba(${accentRgb(brand.accent)},0.55)`,
                    lineHeight: 0.5,
                    marginRight: 6,
                    verticalAlign: '-0.28em',
                  }}
                >
                  “
                </span>
                {sentences.map((s, i) => {
                  const [ws, we] = sentenceWindows[i];
                  const progress = interpolate(localFrame, [ws, we], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                  });
                  return (
                    <span
                      key={i}
                      style={{
                        backgroundImage: `linear-gradient(transparent 54%, rgba(${accentRgb(brand.accent)},0.62) 54%, rgba(${accentRgb(brand.accent)},0.62) 90%, transparent 90%)`,
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: `${progress * 100}% 100%`,
                      }}
                    >
                      {nowrapNumbers(s)}{' '}
                    </span>
                  );
                })}
                <span
                  style={{
                    fontFamily: 'Georgia,serif',
                    fontStyle: 'normal',
                    fontSize: quoteFontSize(issue.summary) * 1.8,
                    fontWeight: 700,
                    color: `rgba(${accentRgb(brand.accent)},0.55)`,
                    lineHeight: 0.5,
                    marginLeft: 4,
                    verticalAlign: '-0.42em',
                  }}
                >
                  ”
                </span>
              </div>
            </div>
          </div>

          {/* 오리 기자 코멘트 말풍선 — SECONDARY 영역(CORE 바로 아래) */}
          <div
            style={{
              position: 'absolute',
              left: CORE.left,
              right: CORE.right,
              top: 1262,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              opacity: stampIn,
              transform: `translateY(${interpolate(stampIn, [0, 1], [20, 0])}px)`,
              zIndex: 2,
            }}
          >
            <Img
              src={staticFile('brand/duck-t.png')}
              style={{width: 56, height: 56, objectFit: 'contain', flexShrink: 0}}
            />
            <div
              data-zone="secondary"
              data-el="duck"
              style={{
                position: 'relative',
                flex: 1,
                background: '#FFFDF7',
                border: `2.5px solid ${INK}`,
                borderRadius: 16,
                padding: '12px 22px',
                fontFamily: sans,
                fontSize: 28,
                lineHeight: 1.3,
                fontWeight: 700,
                color: INK,
              }}
            >
              {DUCK_COMMENTS[(issue.rank - 1) % DUCK_COMMENTS.length]}
              <div
                style={{
                  position: 'absolute',
                  left: -9,
                  top: '50%',
                  transform: 'translateY(-50%) rotate(45deg)',
                  width: 14,
                  height: 14,
                  background: '#FFFDF7',
                  borderLeft: `2.5px solid ${INK}`,
                  borderBottom: `2.5px solid ${INK}`,
                }}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {badgeRow}
          {headline}

          {/* 기사 사진 인셋 — 신문 사진 스타일(검정 보더 + 오프셋 섀도 + 캡션), 풀블리드 금지 */}
          <div
            style={{
              position: 'absolute',
              top: 440,
              left: 66,
              right: 66,
              opacity: photoIn,
              transform: `translateY(${interpolate(photoIn, [0, 1], [40, 0])}px) rotate(-0.6deg)`,
              zIndex: 2,
            }}
          >
            <div
              style={{
                position: 'relative',
                height: 660,
                border: `3px solid ${INK}`,
                borderRadius: 6,
                overflow: 'hidden',
                boxShadow: '10px 12px 0 rgba(26,26,26,0.14)',
              }}
            >
              <Img src={imageSrc} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
            </div>
            <div
              style={{
                marginTop: 12,
                fontFamily: sans,
                fontSize: 15,
                fontWeight: 600,
                color: INK,
                opacity: 0.42,
                letterSpacing: '0.02em',
              }}
            >
              PHOTO · AI 생성 이미지
            </div>
          </div>

          {/* 구분 장식 — template.mjs signalHtml의 3점 구분선 재현 */}
          <div
            style={{
              position: 'absolute',
              top: 1170,
              left: 66,
              right: 66,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              opacity: photoIn,
              zIndex: 2,
            }}
          >
            <div style={{flex: 1, height: 1.5, background: INK, opacity: 0.18}} />
            <div style={{fontFamily: 'Georgia,serif', fontSize: 11, color: INK, opacity: 0.22, letterSpacing: '0.2em'}}>
              ✦ ✦ ✦
            </div>
            <div style={{flex: 1, height: 1.5, background: INK, opacity: 0.18}} />
          </div>

          {/* 무슨 일인가요 — 스티커 섹션 라벨(template.mjs와 동일한 장치) */}
          <div
            style={{
              position: 'absolute',
              top: 1202,
              left: 66,
              display: 'inline-flex',
              background: brand.accent,
              border: `2.5px solid ${INK}`,
              borderRadius: 12,
              padding: '7px 18px',
              transform: 'rotate(-1deg)',
              opacity: photoIn,
              fontFamily: sans,
              fontSize: 15,
              fontWeight: 900,
              letterSpacing: '0.02em',
              color: INK,
              zIndex: 2,
            }}
          >
            무슨 일인가요?
          </div>

          {/* 본문 요약 — 형광펜 스윕 애니메이션 */}
          <div
            style={{
              position: 'absolute',
              top: 1272,
              left: 66,
              right: 66,
              fontFamily: serif,
              fontSize: 37,
              fontWeight: 500,
              lineHeight: 1.64,
              color: INK,
              wordBreak: 'keep-all',
              zIndex: 2,
            }}
          >
            {sentences.map((s, i) => {
              const [ws, we] = sentenceWindows[i];
              const progress = interpolate(localFrame, [ws, we], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
              return (
                <span
                  key={i}
                  style={{
                    backgroundImage: `linear-gradient(transparent 56%, rgba(${accentRgb(brand.accent)},0.62) 56%, rgba(${accentRgb(brand.accent)},0.62) 92%, transparent 92%)`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: `${progress * 100}% 100%`,
                  }}
                >
                  {nowrapNumbers(s)}{' '}
                </span>
              );
            })}
          </div>
        </>
      )}

      {/* 오리 기자 확인 도장 — noPhotos는 SECONDARY 영역(말풍선 아래). right 100이면 정지 상태 x 약 989,
          회전(-9°)과 스프링 오버슈트(최대 약 1.16배)를 포함해도 x 약 1001로 영역(1008) 안이다. 사진 모드는 기존 배치. */}
      <div
        data-zone="secondary"
        data-el="stamp"
        style={{
          position: 'absolute',
          ...(noPhotos ? {right: 100, top: 1344} : {right: 60, bottom: 96}),
          width: 128,
          height: 128,
          opacity: stampIn,
          transform: `scale(${interpolate(stampIn, [0, 1], [0.4, 1])}) rotate(-9deg)`,
          zIndex: 4,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `3px solid ${brand.accent}`,
            background: 'rgba(250,247,240,0.92)',
          }}
        />
        <Img
          src={staticFile('brand/duck-news-t.png')}
          style={{position: 'absolute', width: 92, height: 92, left: 18, top: 10, objectFit: 'contain'}}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily: sans,
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: '0.08em',
            color: INK,
          }}
        >
          확인
        </div>
      </div>

      {/* 하단 서명 바 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 68,
          borderTop: `3px solid ${INK}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 52px',
          fontFamily: sans,
          fontSize: 13.5,
          fontWeight: 700,
          color: INK,
          opacity: 0.4,
          letterSpacing: '0.04em',
          background: PAPER,
          zIndex: 5,
        }}
      >
        <span>오늘의 AI 브리핑 · 핵심만 정확하게</span>
        <span>
          SIGNAL {rankLabel} / {String(total).padStart(2, '0')}
        </span>
      </div>

      <InkFrame />
    </AbsoluteFill>
  );
};

// 리텐션 아웃트로 — 45f(1.5초) 고정. 오리 기자 브랜딩(팔로우 유도)만 짧고 굵게.
const NewsOutro = ({startFrame, brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - startFrame;

  const stampIn = spring({frame: localFrame, fps, config: {damping: 13, stiffness: 170}});
  const textIn = spring({frame: localFrame - 6, fps, config: {damping: 15, stiffness: 150}});
  const pillIn = spring({frame: localFrame - 14, fps, config: {damping: 12, stiffness: 170}});
  const pillPulse = 1 + Math.sin(Math.max(0, localFrame - 20) / 8) * 0.02;

  return (
    <AbsoluteFill style={{backgroundColor: PAPER, ...gridBg}}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 64,
          borderBottom: `1.5px solid ${INK}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 52px',
          fontFamily: sans,
          fontSize: 14,
          fontWeight: 700,
          color: INK,
          opacity: 0.42,
          letterSpacing: '0.08em',
        }}
      >
        <span>TODAYS.AI.BRIEF</span>
        <span>발행인의 말</span>
      </div>

      {/* 콘텐츠 블록 — 그리드·피드 크롭과 릴스 UI를 피하도록 CORE 영역 세로 중앙에 둔다. */}
      <div
        style={{
          position: 'absolute',
          top: CORE.top,
          left: CORE.left,
          right: CORE.right,
          height: CORE.height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 30,
          textAlign: 'center',
        }}
      >
        <div
          data-zone="core"
          data-el="outro-logo"
          style={{
            position: 'relative',
            width: 176,
            height: 176,
            opacity: stampIn,
            transform: `rotate(-4deg) scale(${interpolate(stampIn, [0, 1], [0.5, 1])})`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 34,
              border: `3px solid ${INK}`,
              background: `linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(${accentRgb(brand.accent)},0.24) 100%)`,
              boxShadow: '6px 8px 0 rgba(26,26,26,0.12)',
            }}
          />
          <div style={{position: 'absolute', inset: 14, border: '2px dashed rgba(26,26,26,0.2)', borderRadius: 24}} />
          <Img
            src={staticFile(brand.logo)}
            style={{position: 'absolute', inset: 20, width: 136, height: 136, objectFit: 'contain'}}
          />
        </div>

        <div
          data-zone="core"
          data-el="outro-eyebrow"
          style={{
            fontFamily: sans,
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: '0.22em',
            color: INK,
            opacity: 0.5 * textIn,
          }}
        >
          {brand.eyebrow}
        </div>

        <div
          data-zone="core"
          data-el="outro-closing"
          style={{
            fontFamily: serif,
            fontSize: 66,
            fontWeight: 900,
            lineHeight: 1.16,
            letterSpacing: '-0.02em',
            color: INK,
            opacity: textIn,
            transform: `translateY(${interpolate(textIn, [0, 1], [30, 0])}px)`,
            wordBreak: 'keep-all',
          }}
        >
          {brand.closing}
          <br />
          <span
            style={{
              backgroundImage: `linear-gradient(transparent 58%, rgba(${accentRgb(brand.accent)},0.65) 58%, rgba(${accentRgb(brand.accent)},0.65) 94%, transparent 94%)`,
            }}
          >
            {brand.name}
          </span>
        </div>

        <div
          data-zone="core"
          data-el="outro-follow"
          style={{
            marginTop: 4,
            background: brand.accent,
            border: `3px solid ${INK}`,
            borderRadius: 999,
            padding: '20px 48px',
            fontFamily: sans,
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: '0.04em',
            color: INK,
            opacity: pillIn,
            transform: `scale(${interpolate(pillIn, [0, 1], [0.8, 1]) * pillPulse})`,
            boxShadow: '6px 7px 0 rgba(26,26,26,0.16)',
          }}
        >
          팔로우하고 매일 아침 받기
        </div>

        <div
          data-zone="core"
          data-el="outro-handle"
          style={{
            fontFamily: sans,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: INK,
            opacity: 0.5 * pillIn,
          }}
        >
          {brand.handle}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 68,
          borderTop: `3px solid ${INK}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: sans,
          fontSize: 13.5,
          fontWeight: 700,
          color: INK,
          opacity: 0.4,
          letterSpacing: '0.06em',
        }}
      >
        내일도 물어오는 AI 뉴스
      </div>

      <InkFrame />
    </AbsoluteFill>
  );
};

// 레이아웃 검사 전용(layoutProbe) — data-el 글자 요소의 실제 위치·넘침·글자 크기·실효 불투명도를 재서
// 'LAYOUT {...}' 브라우저 로그 한 줄로 낸다. scripts/layout-check.mjs가 이 줄을 판정한다.
// 측정 전에 웹폰트 로딩과 rAF 2회를 기다려 레이아웃이 확정된 뒤의 값을 잰다.
const LayoutProbe = () => {
  const frame = useCurrentFrame();
  const [handle] = React.useState(() => delayRender('레이아웃 측정'));
  React.useEffect(() => {
    document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          try {
            const nodes = [...document.querySelectorAll('[data-el]')];
            const els = nodes.map((el) => {
              const range = document.createRange();
              range.selectNodeContents(el);
              const r = range.getBoundingClientRect();
              let opacity = 1;
              for (let n = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
              return {
                el: el.dataset.el,
                zone: el.dataset.zone,
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.bottom,
                // 넘침 = 자기 칸(부모 상자)보다 높거나, 줄바꿈 못 한 어절이 가로로 삐져나감.
                // scrollHeight는 쓰지 않는다 — 줄간격이 1.44em보다 좁은 세리프 글자는 글리프 영역이
                // 줄 상자를 넘어서 넘침이 없어도 항상 참이 된다(2026-10-05 probe 실측).
                overflow: el.offsetHeight > el.parentElement.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
                fontSize: parseFloat(getComputedStyle(el).fontSize),
                opacity,
              };
            });
            // 화면 글자를 그대로 넘겨 한글 글리프(unicode-range 조각)까지 로딩됐는지 본다.
            const text = nodes.map((el) => el.textContent).join('');
            const fontsOk = document.fonts.check('900 40px "Noto Serif KR"', text);
            console.log('LAYOUT ' + JSON.stringify({frame, fontsOk, els}));
          } catch (err) {
            console.log('LAYOUT_ERROR ' + JSON.stringify({frame, message: String(err?.message ?? err)}));
          } finally {
            continueRender(handle);
          }
        })
      )
    );
  }, [frame, handle]);
  return null;
};

// hookLine 없으면 이슈1 제목으로 폴백. brand 미전달이면 오리 기자 기본값으로 채운다.
// noPhotos: true 또는 imageDir 미지정(null/undefined/빈 문자열)이면 사진 인셋 없이 렌더한다.
// 기본 경로(imageDir='img/current', noPhotos 미지정)의 카드 배치는 기존 사진 모드와 동일하다 — opt-in.
// 단 훅 오버레이와 아웃트로는 두 모드가 공유하므로 2026-10-05 안전 영역 수정이 사진 모드에도 적용된다.
// layoutProbe: 레이아웃 검사(reels/layout-cli.mjs)에서만 true — 프로덕션 inputProps에는 없다.
export const CardNewsReel = ({date, hookLine, issues, imageDir = 'img/current', brand, noPhotos = false, layoutProbe = false}) => {
  const frame = useCurrentFrame();
  const issueList = issues || [];
  const issueIndex = Math.floor(frame / issueDuration);
  const outroStart = issueList.length * issueDuration;
  const b = {...DEFAULT_BRAND, ...(brand || {})};
  const usePhotos = !noPhotos && Boolean(imageDir);

  if (frame >= outroStart) {
    return (
      <>
        <NewsOutro startFrame={outroStart} brand={b} />
        {layoutProbe ? <LayoutProbe /> : null}
      </>
    );
  }

  const issue = issueList[issueIndex];
  const weekday = weekdayOf(date);
  const issueNumber = issueNo(date);

  return (
    <AbsoluteFill>
      <NewsIssueSlide
        issue={issue}
        imageSrc={usePhotos ? imgSrc(imageDir, `issue-${issue.rank}`) : null}
        noPhotos={!usePhotos}
        startFrame={issueIndex * issueDuration}
        date={date}
        weekday={weekday}
        issueNumber={issueNumber}
        total={issueList.length}
        brand={b}
        textDelay={issueIndex === 0 ? hookDuration - 10 : 0}
      />
      {issueIndex === 0 && frame < hookDuration ? (
        <HookOverlay
          hookLine={hookLine || (issueList[0] && issueList[0].title)}
          date={date}
          weekday={weekday}
          issueNumber={issueNumber}
          brand={b}
        />
      ) : null}
      {layoutProbe ? <LayoutProbe /> : null}
    </AbsoluteFill>
  );
};
