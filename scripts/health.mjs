#!/usr/bin/env node
// 입력 건강 감시 — 신호 수집·결방·신선도 반려·텔레그램·실험 정체·큐·수집 잡 상태를 하루 1회 점검해
// GitHub 이슈 1개(라벨 health)로 모은다. 열린 동안은 본문 갱신으로 재사용하고 상태가 바뀔 때만 코멘트,
// 전부 정상이면 코멘트 후 닫는다.
//
// 사용법:
//   node scripts/health.mjs [--dry-run] [--now ISO] [--root DIR]   → 점검 결과 출력(+ 이슈 갱신, dry-run이면 생략)
//   node scripts/health.mjs --self-test [--only 이름] [--cases 파일]
//
// env: PUBLISH_LIVE, PUBLISH_LIVE_AIBRIEF(미설정이면 켜진 것으로 본다), TG_BOT_TOKEN, TG_CHAT_ID,
//      COLLECT_RESULT(insights collect 잡 결과), EXPERIMENT_OUTCOME(판정기 스텝 outcome), GH_TOKEN
// 알려진 경보는 experiments/health-ack.json({acks:[{check, until:"YYYY-MM-DD", note}]})로 만료일까지 ACK 처리한다.
// 점검 자체는 절대 exit 1로 끝나지 않는다(self-test 제외).

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEntries, snapshotTimeFromPath } from "./kpi.mjs";
import { collectSamples, gitRebuiltFn, kstDate, lint, loadExperiments, stemAccount } from "./experiment.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

const SIGNAL_WINDOW = 10; // 최근 물어오리 회차 수
const SIGNAL_ALERT_RATIO = 0.5; // fail 포함 비율 초과 시 ALERT
const MISSED_DAYS = 7;
const FRESHNESS_GATE_STEM = "2026-09-30-am"; // 신선도 게이트 도입 회차 — 이전 회차는 신선도 분류 제외
const CONTAMINATION_RATIO = 0.3;
const CONTAMINATION_MIN = 3; // 고려 회차가 이보다 적으면 비율 경고를 내지 않는다
const PENDING_STALL_HOURS = 48; // 판정 후 적용이 이보다 늦으면 정체
const SLOTS_PER_DAY = { muleori: 2, aibrief: 1 };

// ─── 유틸 ───────────────────────────────────────────────────────
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readText(path) {
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return null;
  }
}

function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function listDir(path) {
  return existsSync(path) ? readdirSync(path) : [];
}

// ─── 점검 ───────────────────────────────────────────────────────
function checkSignals(root, out) {
  const stems = listDir(join(root, "data"))
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -5))
    .filter((s) => stemAccount(s) === "muleori")
    .sort()
    .slice(-SIGNAL_WINDOW);
  let fail = 0;
  let known = 0;
  let unparsable = 0;
  for (const s of stems) {
    let d;
    try {
      d = readJson(join(root, "data", `${s}.json`));
    } catch {
      unparsable++;
      continue;
    }
    const src = d?.selection?.signalSources;
    if (!src || typeof src !== "object" || Object.keys(src).length === 0) continue; // 기록 없음 — 분모 제외
    known++;
    if (Object.values(src).includes("fail")) fail++;
  }
  const extra = unparsable ? ` (파싱 불가 ${unparsable}건 건너뜀)` : "";
  if (known === 0) return out.push({ level: "INFO", check: "signals", msg: `최근 ${stems.length}회차 신호 기록 없음${extra}` });
  const ratio = fail / known;
  const msg = `최근 물어오리 ${known}회차 중 ${fail}회차 signalSources fail (${(ratio * 100).toFixed(0)}%)${extra}`;
  out.push({ level: ratio > SIGNAL_ALERT_RATIO ? "ALERT" : "OK", check: "signals", msg });
}

// 결방: 최근 7일(어제까지) 기대 회차 중 발행 마커가 없거나 pending인 회차. 데이터가 있으면 validate로 사유를 분류한다.
function checkMissed(root, nowMs, env, out) {
  const today = kstDate(nowMs);
  const muleoriOn = (env.PUBLISH_LIVE ?? "1") === "1";
  const aibriefOn = (env.PUBLISH_LIVE_AIBRIEF ?? "1") === "1";
  const expected = [];
  for (let i = MISSED_DAYS; i >= 1; i--) {
    const d = addDays(today, -i);
    if (muleoriOn) expected.push(`${d}-am`, `${d}-pm`);
    if (aibriefOn) expected.push(`ai-${d}`);
  }
  const missed = [];
  for (const stem of expected) {
    const marker = readText(join(root, "published", stem));
    if (marker && marker !== "pending") continue;
    const dataPath = join(root, "data", `${stem}.json`);
    let reason;
    if (!existsSync(dataPath)) reason = "no-data";
    else if (stemAccount(stem) === "muleori" && stem < FRESHNESS_GATE_STEM) reason = "미분류(신선도 게이트 도입 전)";
    else {
      try {
        execFileSync(process.execPath, [join(REPO_ROOT, "scripts", "validate.mjs"), dataPath], { stdio: "pipe" });
        reason = "build/publish"; // 데이터는 통과 — 빌드·발행 단계 문제
      } catch (e) {
        const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
        reason = text.includes("[신선도]") ? "freshness" : "validate";
      }
    }
    missed.push({ stem, reason });
  }
  const list = missed.map((m) => `${m.stem}(${m.reason})`).join(", ");
  const level = missed.length >= 2 ? "ALERT" : missed.length === 1 ? "WARN" : "OK";
  out.push({ level, check: "missed", msg: missed.length ? `최근 ${MISSED_DAYS}일 결방 ${missed.length}건: ${list}` : `최근 ${MISSED_DAYS}일 결방 없음` });
  const fresh = missed.filter((m) => m.reason === "freshness");
  if (fresh.length) {
    out.push({ level: "WARN", check: "freshness", msg: `신선도 반려로 결방 ${fresh.length}건: ${fresh.map((m) => m.stem).join(", ")}` });
  }
}

async function checkTelegram(root, env, out, fetchImpl) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) {
    out.push({ level: "INFO", check: "telegram", msg: "TG 시크릿 없음 — getChat 확인 생략" });
  } else {
    try {
      const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(env.TG_CHAT_ID)}`;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
      const body = await res.json().catch(() => ({}));
      if (body.ok === true) out.push({ level: "OK", check: "telegram", msg: "Bot API getChat 정상" });
      else out.push({ level: "ALERT", check: "telegram", msg: `getChat 실패: ${body.description ?? `HTTP ${res.status}`}` });
    } catch (e) {
      out.push({ level: "ALERT", check: "telegram", msg: `getChat 네트워크 오류: ${String(e.message).slice(0, 80)}` });
    }
  }
  const latest = latestReport(root);
  if (latest && /텔레그램[^\n]{0,40}(실패|fail)/i.test(latest.text)) {
    out.push({
      level: "WARN",
      check: "telegram-report",
      msg: `최신 점검 보고서(${latest.path})에 텔레그램 실패 기록 — daily-briefing 쪽 실행 환경 문제일 수 있다`,
    });
  }
}

function latestReport(root) {
  const names = listDir(join(root, "reports")).filter((n) => n.endsWith(".md")).sort();
  if (!names.length) return null;
  const path = `reports/${names[names.length - 1]}`;
  const text = readText(join(root, path)) ?? "";
  return { path, text, firstLine: text.split("\n")[0] };
}

function latestSnapshot(root) {
  const names = listDir(join(root, "metrics")).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  return names.length ? join(root, "metrics", names[names.length - 1]) : null;
}

// render.mjs 규칙으로 flags가 켜야 할 기록값을 구한다. arm이 null이면 짝홀 A/B라 비교하지 않는다.
function expectedRecord(flags) {
  const single = flags.REEL_FORMAT_MULEORI === "single";
  const tts = flags.TTS_ENABLED === "1";
  if (single) return { format: "single", arm: tts ? "tts" : "control" };
  return { format: "digest", arm: tts ? null : "control" };
}

function checkExperiments(root, nowMs, out) {
  const loaded = loadExperiments(root);
  const errors = loaded.errors.length ? loaded.errors : lint(loaded);
  if (errors.length) {
    out.push({ level: "ALERT", check: "queue-lint", msg: `실험 파일 lint 실패 ${errors.length}건 — 판정·전환 중단: ${errors.slice(0, 3).join(" / ")}` });
    return;
  }
  const { queue, state, flags } = loaded;
  const byId = new Map(queue.items.map((it) => [it.id, it]));
  const today = kstDate(nowMs);
  const snapPath = latestSnapshot(root);
  let snap = null;
  if (snapPath) {
    try {
      const snapshotTime = snapshotTimeFromPath(snapPath);
      snap = { rows: readJson(snapPath), snapshotTime, entries: loadEntries(snapPath, snapshotTime).entries };
    } catch {
      snap = null;
    }
  }

  for (const acct of ["muleori", "aibrief"]) {
    const run = state[acct];
    if (!run?.active) {
      if (acct === "muleori") out.push({ level: "WARN", check: "queue", msg: "물어오리 활성 실험 없음 — 큐에 ready 항목이 필요하다" });
      continue;
    }
    const item = byId.get(run.active);
    // 정체: 창을 채우는 데 필요한 일수 + 성숙 2일 + 여유 3일
    const days = Math.ceil(run.window / SLOTS_PER_DAY[acct]) + 2 + 3;
    const due = addDays(run.startStem.replace(/^ai-/, "").slice(0, 10), days);
    if (today > due) out.push({ level: "ALERT", check: "experiment-stall", msg: `${item.id} 예상 종료일 ${due} 경과(창 ${run.window}, 시작 ${run.startStem})` });
    if (run.pending && nowMs - Date.parse(run.pending.decidedAt) > PENDING_STALL_HOURS * HOUR_MS) {
      out.push({ level: "ALERT", check: "experiment-stall", msg: `${item.id} 판정 ${run.pending.verdict}이 ${PENDING_STALL_HOURS}시간 넘게 미적용` });
    }
    if (snap) {
      const s = collectSamples({ root, item, run, ...snap, isRebuilt: gitRebuiltFn(root) });
      const ex = Object.entries(s.excluded).map(([k, v]) => `${k}×${v}`).join(", ");
      out.push({ level: "INFO", check: "experiment", msg: `${item.id}: 유효 표본 ${s.valid.length}/${run.window}${ex ? ` (제외 ${ex})` : ""}${run.pending ? ` — 판정 ${run.pending.verdict} 적용 대기` : ""}` });
      if (s.considered >= CONTAMINATION_MIN && s.excludedTotal / s.considered > CONTAMINATION_RATIO) {
        out.push({ level: "WARN", check: "contamination", msg: `${item.id} 제외 비율 ${((s.excludedTotal / s.considered) * 100).toFixed(0)}% (${ex})` });
      }
    }
    const nexts = [...new Set(Object.values(item.next ?? {}).filter(Boolean))];
    const readyNext = nexts.filter((id) => byId.get(id)?.status === "ready");
    if (readyNext.length === 0) {
      out.push({ level: "WARN", check: "queue", msg: `${item.id}의 다음 후보(${nexts.join(", ") || "없음"})가 전부 draft/없음 — 판정 후 계정이 유휴가 된다` });
    }
  }

  // 플래그 미적용: 물어오리만(ai- 제외). flagsSince 이후 최근 2회차의 실제 기록과 flags.json을 대조한다.
  const want = expectedRecord({ REEL_FORMAT_MULEORI: "", TTS_ENABLED: "0", ...(flags.muleori ?? {}) });
  const since = state.muleori?.flagsSince ?? "";
  const stems = listDir(join(root, "docs", "formats"))
    .filter((n) => n.endsWith(".txt"))
    .map((n) => n.slice(0, -4))
    .filter((s) => stemAccount(s) === "muleori" && s >= since)
    .sort()
    .slice(-2);
  const bad = [];
  const fallback = [];
  for (const s of stems) {
    const format = readText(join(root, "docs", "formats", `${s}.txt`));
    const arm = readText(join(root, "docs", "arms", `${s}.txt`));
    if (format !== want.format) bad.push(`${s} format=${format}`);
    else if (want.arm && arm === "control-fallback") fallback.push(s);
    else if (want.arm && arm !== want.arm) bad.push(`${s} arm=${arm}`);
  }
  if (bad.length) {
    out.push({ level: "ALERT", check: "flags-applied", msg: `flags.json(기대 ${want.format}/${want.arm ?? "A/B"})와 실제 기록 불일치: ${bad.join(", ")}` });
  } else if (stems.length) {
    out.push({ level: "OK", check: "flags-applied", msg: `최근 ${stems.length}회차 기록이 flags.json과 일치` });
  }
  if (fallback.length) out.push({ level: "WARN", check: "tts-fallback", msg: `TTS 생성 실패로 control 폴백: ${fallback.join(", ")}` });
}

function checkJobs(env, out) {
  if (env.COLLECT_RESULT && env.COLLECT_RESULT !== "success") {
    out.push({ level: "ALERT", check: "collect", msg: `insights collect 잡 결과 ${env.COLLECT_RESULT}` });
  }
  if (env.EXPERIMENT_OUTCOME && env.EXPERIMENT_OUTCOME !== "success" && env.EXPERIMENT_OUTCOME !== "skipped") {
    out.push({ level: "ALERT", check: "experiment-run", msg: `판정기 스텝 outcome ${env.EXPERIMENT_OUTCOME}` });
  }
}

function applyAcks(root, today, out) {
  let acks = [];
  try {
    acks = readJson(join(root, "experiments", "health-ack.json")).acks ?? [];
  } catch {
    acks = [];
  }
  for (const r of out) {
    if (r.level !== "ALERT" && r.level !== "WARN") continue;
    const ack = acks.find((a) => a.check === r.check && typeof a.until === "string" && today <= a.until);
    if (ack) {
      r.msg = `[${r.level} 인지됨, ~${ack.until}${ack.note ? `: ${ack.note}` : ""}] ${r.msg}`;
      r.level = "ACK";
    }
  }
  for (const a of acks) {
    if (typeof a.until === "string" && today > a.until) out.push({ level: "INFO", check: "ack", msg: `ack 만료: ${a.check} (~${a.until})` });
  }
}

export async function runChecks({ root, nowMs, env, fetchImpl = fetch }) {
  const out = [];
  const guard = (check, fn) => {
    try {
      return fn();
    } catch (e) {
      out.push({ level: "WARN", check, msg: `점검 자체 오류: ${String(e.message).slice(0, 100)}` });
    }
  };
  guard("signals", () => checkSignals(root, out));
  guard("missed", () => checkMissed(root, nowMs, env, out));
  try {
    await checkTelegram(root, env, out, fetchImpl);
  } catch (e) {
    out.push({ level: "WARN", check: "telegram", msg: `점검 자체 오류: ${e.message}` });
  }
  guard("experiment", () => checkExperiments(root, nowMs, out));
  checkJobs(env, out);
  applyAcks(root, kstDate(nowMs), out);
  return out;
}

// ─── 이슈 ───────────────────────────────────────────────────────
const signature = (results) =>
  results
    .filter((r) => r.level === "ALERT" || r.level === "WARN")
    .map((r) => `${r.level} ${r.check}`)
    .sort()
    .join(", ");

function renderBody(results, root, nowMs) {
  const rep = latestReport(root);
  const order = { ALERT: 0, WARN: 1, ACK: 2, INFO: 3, OK: 4 };
  const rows = [...results].sort((a, b) => order[a.level] - order[b.level]);
  return [
    `<!-- health-sig: ${signature(results)} -->`,
    `점검 시각: ${new Date(nowMs + 9 * HOUR_MS).toISOString().slice(0, 16).replace("T", " ")} KST`,
    "",
    "| 수준 | 항목 | 내용 |",
    "|---|---|---|",
    ...rows.map((r) => `| ${r.level} | ${r.check} | ${r.msg.replaceAll("|", "/")} |`),
    "",
    rep ? `최신 점검 보고서: \`${rep.path}\` — ${rep.firstLine}` : "최신 점검 보고서 없음",
    "",
    "알려진 경보는 `experiments/health-ack.json`에 만료일과 함께 적으면 ACK로 내려간다.",
  ].join("\n");
}

function syncIssue(results, root, nowMs) {
  const gh = (args) => execFileSync("gh", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const sig = signature(results);
  const body = renderBody(results, root, nowMs);
  const open = JSON.parse(gh(["issue", "list", "--label", "health", "--state", "open", "--json", "number,body", "--limit", "10"]) || "[]");
  open.sort((a, b) => a.number - b.number);
  const cur = open[0]; // 중복이 있어도 가장 오래된 하나만 쓴다
  if (!cur) {
    if (!sig) return "정상 — 열린 health 이슈 없음, 생성 안 함";
    try {
      gh(["label", "create", "health", "--color", "D93F0B", "--force"]);
    } catch {
      // 라벨이 이미 있거나 권한 부족 — 이슈 생성에서 다시 드러난다
    }
    const url = gh(["issue", "create", "--title", "[health] 입력 건강 경보", "--label", "health", "--body", body]);
    return `health 이슈 생성: ${url}`;
  }
  const prevSig = cur.body?.match(/<!-- health-sig: (.*?) -->/)?.[1] ?? null;
  gh(["issue", "edit", String(cur.number), "--body", body]);
  if (!sig) {
    gh(["issue", "close", String(cur.number), "--comment", "전부 정상 — 이슈를 닫는다"]);
    return `health 이슈 #${cur.number} 닫음(전부 정상)`;
  }
  if (prevSig !== sig) {
    gh(["issue", "comment", String(cur.number), "--body", `상태 변경: ${prevSig ?? "(없음)"} → ${sig}`]);
    return `health 이슈 #${cur.number} 갱신 + 상태 변경 코멘트`;
  }
  return `health 이슈 #${cur.number} 본문 갱신(상태 동일)`;
}

// ─── self-test ──────────────────────────────────────────────────
// 케이스: {name, root(픽스처 디렉토리 이름), now, env, write:{상대경로: 문자열|객체}, remove:[상대경로],
//          expect:{alerts:[...], warns:[...], acks:[...]}} — 배열은 check 이름 집합으로 정확히 비교한다.
function buildCaseRoot(c, fixtureDir) {
  const root = mkdtempSync(join(tmpdir(), "health-selftest-"));
  cpSync(join(fixtureDir, c.root), root, { recursive: true });
  for (const rel of c.remove ?? []) rmSync(join(root, rel), { force: true });
  for (const [rel, body] of Object.entries(c.write ?? {})) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
  }
  return root;
}

async function runSelfTest(args) {
  const argValue = (n) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
  const fixtureDir = join(REPO_ROOT, "test", "fixtures", "health");
  let cases = readJson(argValue("--cases") ?? join(fixtureDir, "cases.json"));
  const only = argValue("--only");
  if (only) cases = cases.filter((c) => c.name === only);
  if (!cases.length) {
    console.error("self-test: 케이스 없음");
    process.exit(1);
  }
  let pass = 0;
  for (const c of cases) {
    const root = buildCaseRoot(c, fixtureDir);
    const results = await runChecks({ root, nowMs: Date.parse(c.now), env: c.env ?? {}, fetchImpl: () => Promise.reject(new Error("self-test 네트워크 금지")) });
    const got = {
      alerts: [...new Set(results.filter((r) => r.level === "ALERT").map((r) => r.check))].sort(),
      warns: [...new Set(results.filter((r) => r.level === "WARN").map((r) => r.check))].sort(),
      acks: [...new Set(results.filter((r) => r.level === "ACK").map((r) => r.check))].sort(),
    };
    const fails = [];
    for (const k of ["alerts", "warns", "acks"]) {
      if (!(k in c.expect)) continue;
      const want = [...c.expect[k]].sort();
      if (JSON.stringify(want) !== JSON.stringify(got[k])) fails.push(`${k} 기대 [${want}], 실제 [${got[k]}]`);
    }
    if (fails.length === 0) {
      pass++;
      console.error(`PASS  ${c.name}`);
    } else {
      console.error(`FAIL  ${c.name}`);
      for (const f of fails) console.error(`  ${f}`);
      for (const r of results.filter((r) => r.level !== "OK")) console.error(`    ${r.level} ${r.check}: ${r.msg}`);
    }
  }
  if (pass === cases.length) {
    console.error(`self-test ${pass}/${cases.length} PASS`);
    return;
  }
  console.error(`self-test 실패 (${pass}/${cases.length} PASS)`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return runSelfTest(args);
  const argValue = (n) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
  const root = argValue("--root") ?? REPO_ROOT;
  const nowMs = argValue("--now") ? Date.parse(argValue("--now")) : Date.now();
  const dryRun = args.includes("--dry-run");
  const results = await runChecks({ root, nowMs, env: process.env });
  for (const r of results) console.log(`${r.level} ${r.check}: ${r.msg}`);
  const body = renderBody(results, root, nowMs);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### 입력 건강\n\n${body}\n`, { flag: "a" });
    } catch {
      // 요약은 보조 출력
    }
  }
  if (dryRun) {
    console.log("[dry-run] health 이슈 갱신 생략");
    return;
  }
  try {
    console.log(syncIssue(results, root, nowMs));
  } catch (e) {
    console.error(`경고: health 이슈 갱신 실패 — ${String(e.stderr || e.message).split("\n")[0]}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
