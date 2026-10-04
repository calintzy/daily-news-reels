// 레이아웃 검사용 스틸 렌더 CLI (scripts/layout-check.mjs가 cwd: reels로 호출)
// 사용법: node layout-cli.mjs <data.json> [--no-probe] [--stills <dir>]
//   검사 프레임마다 CardNewsReel 스틸을 렌더하고, 브라우저 로그의 'LAYOUT '·'LAYOUT_ERROR ' 줄을 그대로 stdout에 낸다.
//   끝에 duration: <총 프레임>, layout-lines: <LAYOUT 줄 수>를 낸다.
//   --no-probe: layoutProbe 없이 0프레임만 렌더한다(프로덕션 props에서 probe가 꺼져 있는지 확인용).
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {issueDuration} from './src/timing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const noProbe = args.includes('--no-probe');
const stillsIdx = args.indexOf('--stills');
const stillsDir = stillsIdx >= 0 ? path.resolve(args[stillsIdx + 1]) : null;
const dataPath = args.find((a, i) => !a.startsWith('--') && (stillsIdx < 0 || i !== stillsIdx + 1));
if (!dataPath) {
  console.error('사용법: node layout-cli.mjs <data.json> [--no-probe] [--stills <dir>]');
  process.exit(2);
}

const data = JSON.parse(readFileSync(path.resolve(dataPath), 'utf-8'));
// 인자 경로를 해석한 뒤 reels/로 옮긴다 — Remotion은 cwd 기준 package.json을 찾아 브라우저 캐시 위치를 정하므로,
// 리포 루트에서 실행하면 package.json이 없어 루트에 .remotion/(약 190MB)을 새로 받는다.
process.chdir(here);
const stem = path.basename(dataPath, '.json');
const issues = data.issues || [];

// scripts/render.mjs의 BRANDS.aibrief와 같은 값이어야 한다 — 생략하면 Root.jsx의 defaultProps(물어오리 브랜드)가 채워진다.
const AIBRIEF_BRAND = {
  name: '오리 기자',
  handle: '@todays.ai.brief',
  logo: 'brand/duck-news-t.png',
  accent: '#F5B82E',
  eyebrow: '내일도 물어오는',
  closing: 'AI 뉴스',
};

// scripts/render.mjs의 aibrief inputProps와 같은 모양.
const inputProps = {
  date: data.date,
  slot: data.slot ?? null,
  hookLine: data.hookLine,
  issues: issues.map((i) => ({
    rank: i.rank,
    category: i.category,
    kicker: i.kicker,
    title: i.title,
    summary: i.summary,
  })),
  imageDir: 'img/current',
  brand: AIBRIEF_BRAND,
  noPhotos: true,
  ...(noProbe ? {} : {layoutProbe: true}),
};

// 검사 프레임: 0(훅 가시성), 27(표지 — publish.mjs thumb_offset 900ms), 이슈별 i*159+140, 아웃트로 +40.
const outroStart = issues.length * issueDuration;
const frames = noProbe
  ? [0]
  : [0, 27, ...issues.map((_, i) => i * issueDuration + 140), outroStart + 40];

const serveUrl = await bundle({entryPoint: path.join(here, 'src/index.jsx'), webpackOverride: (c) => c});
const composition = await selectComposition({serveUrl, id: 'CardNewsReel', inputProps});
const chromiumOptions = {gl: 'angle'};
const browser = await openBrowser('chrome', {chromiumOptions});
if (stillsDir) await mkdir(stillsDir, {recursive: true});

let layoutLines = 0;
for (const frame of frames) {
  await renderStill({
    composition,
    serveUrl,
    frame,
    inputProps,
    imageFormat: 'png',
    output: stillsDir ? path.join(stillsDir, `${stem}-f${String(frame).padStart(3, '0')}.png`) : null,
    overwrite: true,
    puppeteerInstance: browser,
    chromiumOptions,
    logLevel: 'error',
    onBrowserLog: (log) => {
      if (log.text.startsWith('LAYOUT_ERROR ')) console.log(log.text);
      if (!log.text.startsWith('LAYOUT ')) return;
      layoutLines += 1;
      console.log(log.text);
    },
  });
}
await browser.close({silent: true});

console.log(`duration: ${composition.durationInFrames}`);
console.log(`layout-lines: ${layoutLines}`);
