import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {chromium} from 'playwright';

const cwd = process.cwd();
const entryPoint = path.join(cwd, 'src/index.jsx');
const outDir = path.join(cwd, 'out');
const compositionId = process.argv[2] ?? 'HotIssueReel';
const requestedOutput = process.argv[3];
const outputLocation = requestedOutput
  ? path.resolve(cwd, requestedOutput)
  : path.join(outDir, 'reel.mp4');

await mkdir(outDir, {recursive: true});
await mkdir(path.dirname(outputLocation), {recursive: true});

const bundled = await bundle({
  entryPoint,
  webpackOverride: (config) => config,
});

const inputProps = {};

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
