// inputProps 주입형 Remotion 렌더 CLI (scripts/render.mjs가 호출)
// 사용법: node render-cli.mjs <compositionId> <outputPath> <inputPropsJson>
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {chromium} from 'playwright';

const cwd = process.cwd();
const entryPoint = path.join(cwd, 'src/index.jsx');
const compositionId = process.argv[2] ?? 'HotIssueReelPhoto';
const outputLocation = path.resolve(cwd, process.argv[3] ?? 'out/reel.mp4');
const inputProps = process.argv[4] ? JSON.parse(process.argv[4]) : {};

await mkdir(path.dirname(outputLocation), {recursive: true});

const bundled = await bundle({entryPoint, webpackOverride: (c) => c});

const composition = await selectComposition({
  serveUrl: bundled,
  id: compositionId,
  inputProps,
});

await renderMedia({
  composition,
  serveUrl: bundled,
  codec: 'h264',
  outputLocation,
  chromiumOptions: {
    executablePath: chromium.executablePath(),
    gl: 'angle',
  },
  inputProps,
});

console.log(outputLocation);
