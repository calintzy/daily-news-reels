#!/usr/bin/env node
// 실험 판정기 — experiments/queue.json(사람 소유)의 사전등록 임계값으로 활성 실험을 판정하고,
// 판정 다음 실행에서 flags 전환·롤백·다음 실험 활성화를 적용한다(24시간 거부권 창).
//
// 사용법:
//   node scripts/experiment.mjs --snapshot metrics/DATE.json [--dry-run] [--now ISO] [--root DIR]
//   node scripts/experiment.mjs --lint [--root DIR]            → queue OK / 오류 목록(exit 1)
//   node scripts/experiment.mjs --self-test [--only 이름] [--cases 파일]
//
// 파일 역할:
//   experiments/queue.json  사람 소유(PR로만 변경). 판정기는 절대 쓰지 않는다.
//   experiments/state.json  판정기 소유 — 활성 실험·판정 대기(pending)·이력
//   experiments/flags.json  판정기 소유 — 렌더가 읽는 실험 플래그(scripts/flags.mjs)
//
// 실행 모드는 lint 실패 시 판정·전환 없이 exit 0으로 끝난다(경보는 health.mjs가 같은 lint로 낸다).

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { aggregate, loadEntries, snapshotTimeFromPath } from "./kpi.mjs";
import { ACCOUNTS, checkFlags } from "./flags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const HOUR_MS = 3600 * 1000;
const KST_OFFSET_MS = 9 * HOUR_MS;
const MATURITY_HOURS = 24; // kpi.mjs와 같은 성숙 기준
// 시간이 지나면 뒤집힐 수 있는 사유(미발행·미수집·지표 오류)는 예상 발행 후 이 시간까지 제외하지 않고 기다린다.
// 판정 당일 일시 오류 하나로 "앞에서 window개" 창 구성이 바뀌는 것을 막는다.
const GRACE_HOURS = 72;
const VETO_HOURS = 20; // 판정 후 적용까지 최소 간격 — 매일 1회 실행(실측 07:00~09:15 시작) 기준 다음 실행
const CONTAMINATION_RATIO = 0.3; // 고려 회차 중 제외 비율 경고선
const CO_DROP_RATIO = 0.7; // 동시 대조군(aibrief) avg_watch가 직전 대비 이 비율 미만이면 동반 급락 기록
const KPI_KEYS = ["sharesPer1000Reach", "savedPer1000Reach", "avgWatchMedian", "viewsMedian"];
const OPS = {
  ">=": (a, b) => a >= b,
  ">": (a, b) => a > b,
  "<=": (a, b) => a <= b,
  "<": (a, b) => a < b,
};
const VERDICTS = ["adopt", "reject", "inconclusive"];
// 예상 발행 시각(KST) — 미발행 회차를 "아직 기다릴지/제외할지" 가르는 데만 쓴다.
const SLOT_HHMM = { am: "07:30", pm: "17:30", ai: "12:00" };

// ─── 시간·스템 유틸 ─────────────────────────────────────────────
export const kstDate = (ms) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
const kstHHMM = (ms) => new Date(ms + KST_OFFSET_MS).toISOString().slice(11, 16);
const isoKst = (ms) => `${new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;

// 스템 → 계정. 물어오리는 YYYY-MM-DD-am|pm, 오리 기자는 ai-YYYY-MM-DD. 그 외(sample·레거시)는 null.
export function stemAccount(stem) {
  if (/^\d{4}-\d{2}-\d{2}-(am|pm)$/.test(stem)) return "muleori";
  if (/^ai-\d{4}-\d{2}-\d{2}$/.test(stem)) return "aibrief";
  return null;
}

function stemPublishMs(stem) {
  const m = stem.match(/^(?:ai-)?(\d{4}-\d{2}-\d{2})(?:-(am|pm))?$/);
  const slot = stem.startsWith("ai-") ? "ai" : m[2];
  return Date.parse(`${m[1]}T${SLOT_HHMM[slot]}:00+09:00`);
}

function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 24 * HOUR_MS).toISOString().slice(0, 10);
}

function listStems(root, dir, suffix) {
  const p = join(root, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((n) => n.endsWith(suffix))
    .map((n) => (suffix ? n.slice(0, -suffix.length) : n))
    .filter((s) => stemAccount(s));
}

// flags 적용 직후 그 값으로 빌드될 첫 회차. 이미 data가 커밋된 회차는 이전 flags 트리에서 빌드됐으므로 그다음이다.
export function nextStem(root, account, nowMs) {
  const stems = listStems(root, "data", ".json").filter((s) => stemAccount(s) === account).sort();
  const last = stems[stems.length - 1];
  if (account === "aibrief") {
    return last ? `ai-${addDays(last.slice(3), 1)}` : `ai-${kstDate(nowMs)}`;
  }
  if (!last) return `${kstDate(nowMs)}-am`;
  return last.endsWith("-am") ? `${last.slice(0, 10)}-pm` : `${addDays(last.slice(0, 10), 1)}-am`;
}

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

function getPath(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ─── lint (queue·state·flags 교차 검증) ───────────────────────────
export function loadExperiments(root) {
  const dir = join(root, "experiments");
  const out = { errors: [] };
  for (const name of ["queue", "state", "flags"]) {
    try {
      out[name] = readJson(join(dir, `${name}.json`));
    } catch (e) {
      out.errors.push(`${name}.json 읽기/파싱 실패: ${e.message.split("\n")[0]}`);
    }
  }
  return out;
}

function lintCond(c, where, errors) {
  if (!c || typeof c !== "object") return errors.push(`${where}: 조건이 객체가 아니다`);
  if (!KPI_KEYS.includes(c.kpi)) errors.push(`${where}: kpi "${c.kpi}" 알 수 없음(허용: ${KPI_KEYS.join(", ")})`);
  if (!OPS[c.op]) errors.push(`${where}: op "${c.op}" 알 수 없음`);
  if (typeof c.value !== "number") errors.push(`${where}: value는 숫자여야 한다`);
}

export function lint({ queue, state, flags }) {
  const errors = [];
  if (!queue || queue.version !== 1 || !Array.isArray(queue.items)) {
    errors.push("queue.json: version 1과 items 배열이 필요하다");
    return errors;
  }
  const byId = new Map();
  for (const [i, it] of queue.items.entries()) {
    const where = `queue.items[${i}]`;
    if (!it || typeof it.id !== "string" || !/^[a-z0-9-]+$/.test(it.id)) {
      errors.push(`${where}: id는 소문자·숫자·하이픈 문자열이어야 한다`);
      continue;
    }
    if (byId.has(it.id)) errors.push(`${where}: id "${it.id}" 중복`);
    byId.set(it.id, it);
    if (!ACCOUNTS.includes(it.account)) errors.push(`${it.id}: account "${it.account}" 알 수 없음`);
    if (!["ready", "draft"].includes(it.status)) errors.push(`${it.id}: status는 ready|draft`);
  }
  for (const it of byId.values()) {
    if (it.status !== "ready") continue;
    const w = it.id;
    if (!it.flags || typeof it.flags !== "object") errors.push(`${w}: flags 객체 필요`);
    else for (const e of checkFlags({ [it.account]: it.flags })) errors.push(`${w}.flags: ${e}`);
    if (!Array.isArray(it.evidence) || it.evidence.length === 0) errors.push(`${w}: evidence 1개 이상 필요`);
    else {
      it.evidence.forEach((ev, j) => {
        const okPath = typeof ev?.path === "string" && ev.path.includes("{stem}") && typeof ev.equals === "string";
        const okData = typeof ev?.data === "string" && ev.nonEmpty === true;
        if (!okPath && !okData) errors.push(`${w}.evidence[${j}]: {path(“{stem}” 포함), equals} 또는 {data, nonEmpty:true}`);
      });
    }
    if (!Number.isInteger(it.samples) || it.samples < 1) errors.push(`${w}: samples는 양의 정수`);
    if (it.extendTo != null && (!Number.isInteger(it.extendTo) || it.extendTo <= it.samples)) {
      errors.push(`${w}: extendTo는 samples보다 큰 정수`);
    }
    if (!Array.isArray(it.adopt) || it.adopt.length === 0) errors.push(`${w}: adopt 조건 1개 이상 필요`);
    else it.adopt.forEach((c, j) => lintCond(c, `${w}.adopt[${j}]`, errors));
    if (!Array.isArray(it.reject)) errors.push(`${w}: reject 배열 필요(비어도 됨)`);
    else it.reject.forEach((c, j) => lintCond(c, `${w}.reject[${j}]`, errors));
    if (it.next != null) {
      for (const [k, v] of Object.entries(it.next)) {
        if (!VERDICTS.includes(k)) errors.push(`${w}.next: 키 "${k}" 알 수 없음`);
        else if (v != null && !byId.has(v)) errors.push(`${w}.next.${k}: "${v}"가 큐에 없다`);
        else if (v != null && byId.get(v).account !== it.account) errors.push(`${w}.next.${k}: 계정이 다르다`);
      }
    }
    if (it.applyBefore != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(it.applyBefore)) {
      errors.push(`${w}: applyBefore는 KST "HH:MM"`);
    }
  }

  if (!state || typeof state !== "object") {
    errors.push("state.json: 객체가 아니다");
  } else {
    for (const k of Object.keys(state)) {
      if (!["version", "history", ...ACCOUNTS].includes(k)) errors.push(`state.json: 알 수 없는 키 "${k}"`);
    }
    if (!Array.isArray(state.history)) errors.push("state.json: history 배열 필요");
    const activeCount = {};
    for (const acct of ACCOUNTS) {
      const run = state[acct];
      if (!run || typeof run !== "object") {
        errors.push(`state.${acct}: 객체 필요`);
        continue;
      }
      if (run.hold != null && typeof run.hold !== "boolean") errors.push(`state.${acct}.hold는 true/false`);
      if (run.waitingFor != null && !byId.has(run.waitingFor)) errors.push(`state.${acct}.waitingFor "${run.waitingFor}"가 큐에 없다`);
      if (run.active == null) {
        if (run.pending) errors.push(`state.${acct}: 활성 실험 없이 pending이 있다`);
        continue;
      }
      if (typeof run.active !== "string") {
        errors.push(`state.${acct}.active: 실험 id 문자열 하나만 허용`);
        continue;
      }
      const it = byId.get(run.active);
      if (!it) {
        errors.push(`state.${acct}.active "${run.active}"가 큐에 없다`);
        continue;
      }
      if (it.status !== "ready") errors.push(`state.${acct}.active "${it.id}"가 ready가 아니다(draft는 활성 불가)`);
      if (it.account !== acct) errors.push(`state.${acct}.active "${it.id}"의 계정은 ${it.account}다`);
      activeCount[it.account] = (activeCount[it.account] ?? 0) + 1;
      if (typeof run.startStem !== "string" || stemAccount(run.startStem) !== acct) {
        errors.push(`state.${acct}.startStem 형식 오류`);
      }
      if (!Number.isInteger(run.window) || run.window < 1) errors.push(`state.${acct}.window는 양의 정수`);
      if (run.pending != null) {
        if (!VERDICTS.includes(run.pending.verdict)) errors.push(`state.${acct}.pending.verdict 오류`);
        if (Number.isNaN(Date.parse(run.pending.decidedAt))) errors.push(`state.${acct}.pending.decidedAt 오류`);
        // veto는 사람이 손으로 쓰는 안전장치 — "true" 같은 문자열 오타가 그대로 적용되지 않게 막는다.
        if ("veto" in run.pending && typeof run.pending.veto !== "boolean") {
          errors.push(`state.${acct}.pending.veto는 true/false(따옴표 없이)`);
        }
      }
    }
    for (const [acct, n] of Object.entries(activeCount)) {
      if (n > 1) errors.push(`계정 ${acct}에 활성 실험 ${n}개 — 계정당 하나만 허용`);
    }
  }

  if (flags) for (const e of checkFlags(flags)) errors.push(`flags.json: ${e}`);
  return errors;
}

// ─── 표본 수집 (고정 창) ──────────────────────────────────────────
// startStem 이후 회차를 스템 순으로 보며 앞에서 window개의 유효 표본만 쓴다(날마다 재판정해도 창이 같다).
// 기다려야 하는 회차(미성숙·미수집)를 만나면 거기서 멈춘다 — 뒤 회차로 건너뛰면 창이 흔들린다.
export function collectSamples({ root, item, run, rows, entries, snapshotTime, isRebuilt }) {
  const account = item.account;
  const stems = [
    ...new Set([...listStems(root, "data", ".json"), ...listStems(root, "published", "")]),
  ]
    .filter((s) => stemAccount(s) === account && s >= run.startStem)
    .sort();
  const rowByStem = new Map(rows.map((r) => [r.stem, r]));
  const entryByStem = new Map(entries.map((e) => [e.stem, e]));
  const valid = [];
  const excluded = {};
  const details = [];
  let waiting = null;
  const exclude = (stem, reason, note = "") => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
    details.push({ stem, status: `제외:${reason}`, note });
  };
  const tooRecent = (stem) => stemPublishMs(stem) + GRACE_HOURS * HOUR_MS > snapshotTime.getTime();

  for (const stem of stems) {
    if (valid.length >= run.window) break;
    const marker = readText(join(root, "published", stem));
    if (!marker || !/^\d+$/.test(marker)) {
      if (tooRecent(stem)) {
        waiting = stem;
        break;
      }
      exclude(stem, "unpublished", marker ?? "마커 없음");
      continue;
    }
    let bad = null;
    for (const ev of item.evidence) {
      if (ev.path) {
        const p = ev.path.replaceAll("{stem}", stem);
        const actual = readText(join(root, p));
        if (actual == null) bad = ["evidence-missing", p];
        else if (actual !== ev.equals) bad = ["evidence", `${p}=${actual}`];
      } else {
        let v;
        try {
          v = getPath(readJson(join(root, "data", `${stem}.json`)), ev.data);
        } catch {
          v = undefined;
        }
        if (!(typeof v === "string" ? v.trim() : v)) bad = ["data", `${ev.data} 비어 있음`];
      }
      if (bad) break;
    }
    if (bad) {
      exclude(stem, bad[0], bad[1]);
      continue;
    }
    if (isRebuilt(stem)) {
      exclude(stem, "rebuild", "발행 후 재빌드로 기록 덮어씀");
      continue;
    }
    const row = rowByStem.get(stem);
    if (!row) {
      if (tooRecent(stem)) {
        waiting = stem;
        break;
      }
      exclude(stem, "no-metrics", "스냅샷에 행 없음");
      continue;
    }
    if (row.error) {
      if (tooRecent(stem)) {
        waiting = stem;
        break;
      }
      exclude(stem, "metrics-error", String(row.error).slice(0, 60));
      continue;
    }
    const entry = entryByStem.get(stem);
    if (!entry) {
      if (!row.timestamp || Number.isNaN(Date.parse(row.timestamp))) {
        exclude(stem, "no-metrics", "발행 시각 없음·파싱 불가");
        continue;
      }
      waiting = stem; // 발행 24시간 미만
      break;
    }
    valid.push(entry);
    details.push({ stem, status: "유효", note: "" });
  }
  const excludedTotal = Object.values(excluded).reduce((a, b) => a + b, 0);
  return { valid, excluded, excludedTotal, details, waiting, considered: valid.length + excludedTotal };
}

// 조건 목록은 AND다(전부 충족해야 참). 값이 null(분모 0 등)이면 거짓.
function evaluate(conds, stats) {
  const results = conds.map((c) => {
    const v = stats[c.kpi];
    return { ...c, actual: v, ok: v != null && OPS[c.op](v, c.value) };
  });
  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}

// 판정: reject를 먼저 본다(보수적). 둘 다 아니면 중간 구간.
export function decide(item, stats) {
  const rej = evaluate(item.reject ?? [], stats);
  const ado = evaluate(item.adopt, stats);
  if (rej.ok) return { verdict: "reject", rej, ado };
  if (ado.ok) return { verdict: "adopt", rej, ado };
  return { verdict: "middle", rej, ado };
}

// ─── 판정 문서 ──────────────────────────────────────────────────
const f1 = (v) => (v == null ? "-" : Number(v).toFixed(1));

function renderVerdictDoc({ item, run, verdict, stats, dec, samples, control, coDrop, nowMs }) {
  const L = [];
  L.push(`# 판정: ${item.id} — ${verdict}`);
  L.push("");
  L.push(`- 판정 시각: ${isoKst(nowMs)}`);
  L.push(`- 계정: ${item.account} / 창: ${run.startStem}부터 유효 표본 ${run.window}개${run.extended ? " (연장)" : ""}`);
  L.push(`- 가설: ${item.hypothesis ?? "-"}`);
  L.push(`- 사전등록: ${item.prereg ?? "-"}${item.addendum ? ` / 부록: ${item.addendum}` : ""}`);
  L.push(`- 적용: 다음 insights 실행(판정 후 ${VETO_HOURS}시간 이상 경과)에서 적용한다. 거부하려면 그 전에 \`experiments/state.json\`의 \`${item.account}.pending.veto\`를 true로 바꾸는 커밋을 main에 올린다.`);
  L.push("");
  L.push("## 조건 (각 목록은 AND)");
  L.push("");
  L.push("| 구분 | kpi | 조건 | 실측 | 충족 |");
  L.push("|---|---|---|---|---|");
  for (const [label, ev] of [["adopt", dec.ado], ["reject", dec.rej]]) {
    for (const r of ev.results) L.push(`| ${label} | ${r.kpi} | ${r.op} ${r.value} | ${f1(r.actual)} | ${r.ok ? "O" : "X"} |`);
  }
  L.push("");
  L.push(`집계: n=${stats.n}, reach 합 ${stats.reachSum}, shares 합 ${stats.sharesSum}, saved 합 ${stats.savedSum}, views 중앙값 ${f1(stats.viewsMedian)}`);
  L.push("");
  L.push("## 회차별");
  L.push("");
  L.push("| 스템 | 상태 | reach | shares | avg_watch(초) | 비고 |");
  L.push("|---|---|---|---|---|---|");
  const byStem = new Map(samples.valid.map((e) => [e.stem, e]));
  for (const d of samples.details) {
    const m = byStem.get(d.stem)?.metrics ?? {};
    const aw = m.ig_reels_avg_watch_time != null ? (m.ig_reels_avg_watch_time / 1000).toFixed(1) : "-";
    L.push(`| ${d.stem} | ${d.status} | ${m.reach ?? "-"} | ${m.shares ?? "-"} | ${aw} | ${d.note} |`);
  }
  L.push("");
  const ex = Object.entries(samples.excluded).map(([k, v]) => `${k} ${v}`).join(", ") || "없음";
  L.push(`제외: ${ex} (고려 ${samples.considered}회차 중 ${samples.excludedTotal})`);
  if (samples.considered > 0 && samples.excludedTotal / samples.considered > CONTAMINATION_RATIO) {
    L.push("");
    L.push(`**오염 경고**: 제외 비율 ${((samples.excludedTotal / samples.considered) * 100).toFixed(0)}% > ${CONTAMINATION_RATIO * 100}%`);
  }
  L.push("");
  L.push("## 동시 대조군 (aibrief, 같은 기간)");
  L.push("");
  L.push(`- 창 기간: n=${control.window.n}, shares/1000reach ${f1(control.window.sharesPer1000Reach)}, avg_watch 중앙값 ${f1(control.window.avgWatchMedian)}초`);
  L.push(`- 창 직전 14일: n=${control.before.n}, avg_watch 중앙값 ${f1(control.before.avgWatchMedian)}초`);
  if (coDrop) L.push("- **두 계정 동반 급락 의심** — 외생 충격일 수 있다. 자동 강등은 하지 않는다(기록만).");
  L.push("");
  return `${L.join("\n")}\n`;
}

// aibrief를 동시 대조군으로 본다(물어오리 실험 판정 시). 창 기간과 그 직전 14일을 비교한다.
function concurrentControl(entries, account, valid) {
  const other = ACCOUNTS.find((a) => a !== account);
  const empty = { window: aggregate([]), before: aggregate([]) };
  if (valid.length === 0) return empty;
  const t0 = Math.min(...valid.map((e) => e.timestamp.getTime()));
  const t1 = Math.max(...valid.map((e) => e.timestamp.getTime()));
  const own = entries.filter((e) => e.account === other);
  return {
    window: aggregate(own.filter((e) => e.timestamp.getTime() >= t0 && e.timestamp.getTime() <= t1)),
    before: aggregate(own.filter((e) => e.timestamp.getTime() < t0 && e.timestamp.getTime() >= t0 - 14 * 24 * HOUR_MS)),
  };
}

// ─── 엔진 ───────────────────────────────────────────────────────
// 파일을 쓰지 않는다. 새 state·flags와 판정 문서·이슈 작업 목록을 돌려준다(쓰기는 main이 한다).
export function runEngine({ root, nowMs, snapshotPath, isRebuilt = () => false }) {
  const { queue, state: state0, flags: flags0 } = loadExperiments(root);
  const state = structuredClone(state0);
  const flags = structuredClone(flags0);
  const byId = new Map(queue.items.map((it) => [it.id, it]));
  const docs = {};
  const ops = [];
  const log = [];
  const report = {};
  const nowIso = isoKst(nowMs);

  // 스냅샷: 당일(KST) 파일이 아니면 판정은 건너뛴다(pending 적용은 스냅샷과 무관하게 진행).
  let snap = null;
  if (snapshotPath && existsSync(snapshotPath)) {
    const date = basename(snapshotPath, ".json");
    if (date === kstDate(nowMs)) {
      // 손상된 스냅샷이 pending 적용(1단계)까지 막지 않도록 로드 실패는 "판정 생략"으로 처리한다.
      try {
        const snapshotTime = snapshotTimeFromPath(snapshotPath);
        const rows = readJson(snapshotPath).filter((r) => r && typeof r.stem === "string");
        snap = { rows, snapshotTime, entries: loadEntries(snapshotPath, snapshotTime).entries };
      } catch (e) {
        log.push(`스냅샷 로드 실패(${e.message.split("\n")[0]}) — 판정 생략`);
      }
    } else {
      log.push(`스냅샷 ${basename(snapshotPath)}이 당일(${kstDate(nowMs)})이 아니다 — 판정 생략`);
    }
  } else {
    log.push(`당일 스냅샷 없음(${snapshotPath ?? "미지정"}) — 판정 생략`);
  }

  const historyIds = () => new Set(state.history.map((h) => h.id));

  const activate = (acct, item) => {
    const prev = state[acct] ?? {};
    const flagsBefore = { ...(flags[acct] ?? {}) };
    const merged = { ...flagsBefore, ...item.flags }; // 기존 flags 위에 병합(adopt로 유지된 값 보존)
    const changed = JSON.stringify(merged) !== JSON.stringify(flagsBefore);
    flags[acct] = merged;
    const start = nextStem(root, acct, nowMs);
    state[acct] = {
      active: item.id,
      startedAt: nowIso,
      startStem: start,
      window: item.samples,
      extended: false,
      issue: null,
      flagsBefore, // rollback 기준 — 실험 시작 직전 flags 스냅샷
      flagsSince: changed ? start : (prev.flagsSince ?? null),
      pending: null,
    };
    report[acct].actions.push("activate");
    log.push(`${acct}: ${item.id} 활성화 — startStem ${start}, flags ${JSON.stringify(merged)}`);
  };

  // applyBefore(KST HH:MM)가 있는 항목은 그 시각 이전 실행에서만 flags를 바꾼다(선정 기준 변경 실험용).
  const gateBlocked = (items) => {
    const hhmm = kstHHMM(nowMs);
    const blocked = items.find((it) => it?.applyBefore && hhmm >= it.applyBefore);
    return blocked ? `${blocked.id}.applyBefore ${blocked.applyBefore} (현재 ${hhmm} KST)` : null;
  };

  for (const acct of ACCOUNTS) {
    report[acct] = { actions: [] };
    const run = state[acct];
    const R = report[acct];

    // 1) 이전 실행의 판정 적용(24시간 거부권 창 경과 후)
    if (run?.active && run.pending) {
      const item = byId.get(run.active);
      const p = run.pending;
      const ageH = (nowMs - Date.parse(p.decidedAt)) / HOUR_MS;
      if (ageH < VETO_HOURS) {
        R.actions.push("veto-wait");
        log.push(`${item.id}: 판정 ${p.verdict} 적용 대기 — 거부권 창 ${ageH.toFixed(1)}h/${VETO_HOURS}h`);
      } else {
        const vetoed = p.veto === true;
        const nextId = vetoed ? null : (item.next?.[p.verdict] ?? null);
        const nextItem = nextId ? byId.get(nextId) : null;
        const nextReady = nextItem && nextItem.status === "ready" && !historyIds().has(nextId);
        const blocked = vetoed ? null : gateBlocked([p.verdict === "reject" ? item : null, nextReady ? nextItem : null]);
        if (blocked) {
          R.actions.push("defer");
          log.push(`${item.id}: 적용 연기 — ${blocked}`);
        } else {
          let flagsChanged = false;
          if (!vetoed && p.verdict === "reject") {
            flagsChanged = JSON.stringify(run.flagsBefore ?? {}) !== JSON.stringify(flags[acct] ?? {});
            flags[acct] = { ...(run.flagsBefore ?? {}) };
          }
          state.history.push({
            id: item.id,
            account: acct,
            verdict: p.verdict,
            ...(vetoed ? { vetoed: true } : {}),
            decidedAt: p.decidedAt,
            appliedAt: nowIso,
            file: p.file ?? null,
          });
          const tail = vetoed
            ? "사람이 거부(veto) — flags 유지, 다음 실험 활성화 안 함"
            : p.verdict === "reject"
              ? `rollback 적용: ${JSON.stringify(flags[acct])}`
              : "flags 유지";
          if (run.issue) ops.push({ type: "close", issue: run.issue, body: `판정 ${p.verdict} 적용 (${nowIso}) — ${tail}` });
          R.actions.push(vetoed ? "vetoed" : "apply");
          log.push(`${item.id}: ${p.verdict} 적용 — ${tail}`);
          // 유휴 전환 시 자동 활성화 제한: veto·next 없음이면 hold(사람이 state에서 풀 때까지 멈춤),
          // next가 draft면 waitingFor(그 항목이 ready가 될 때만 활성화). 큐의 다른 ready 항목이 next 라우팅을 우회하지 못하게 한다.
          const idleGuard = vetoed || !nextId ? { hold: true } : nextReady ? {} : { waitingFor: nextId };
          state[acct] = {
            active: null,
            flagsSince: flagsChanged ? nextStem(root, acct, nowMs) : (run.flagsSince ?? null),
            pending: null,
            ...idleGuard,
          };
          if (nextReady) activate(acct, nextItem);
          else if (!vetoed) {
            R.actions.push("next-not-ready");
            log.push(`${acct}: 다음 실험 미준비(next.${p.verdict}=${nextId ?? "없음"}${nextItem ? `, status=${nextItem.status}` : ""}) — 대기`);
          }
        }
      }
    }

    // 2) 유휴 계정: hold면 멈춤, waitingFor면 그 항목만, 둘 다 없으면 이력에 없는 첫 ready 항목을 활성화
    //    (큐에 PR로 넣기만 하면 시작된다)
    const idle = state[acct];
    if (!idle?.active && idle?.hold === true) {
      if (!R.actions.length) {
        R.actions.push("hold");
        log.push(`${acct}: hold — 자동 활성화 정지(state.${acct}.hold를 지우면 재개)`);
      }
    } else if (!idle?.active) {
      const isCand = (it) => it.account === acct && it.status === "ready" && !historyIds().has(it.id);
      const cand = idle?.waitingFor
        ? queue.items.find((it) => it.id === idle.waitingFor && isCand(it))
        : queue.items.find(isCand);
      if (!cand && idle?.waitingFor && !R.actions.length) {
        R.actions.push("waiting-for");
        log.push(`${acct}: ${idle.waitingFor}가 ready가 되기를 대기`);
      }
      if (cand) {
        const blocked = gateBlocked([cand]);
        if (blocked) {
          R.actions.push("defer");
          log.push(`${cand.id}: 활성화 연기 — ${blocked}`);
        } else activate(acct, cand);
      } else if (!R.actions.length) R.actions.push("idle");
    }

    // 3) 판정(판정 대기 중이 아닌 활성 실험만)
    const cur = state[acct];
    if (!cur?.active || cur.pending || R.actions.includes("activate")) continue;
    const item = byId.get(cur.active);
    if (!snap) {
      R.actions.push("skip-snapshot");
      continue;
    }
    const samples = collectSamples({ root, item, run: cur, ...snap, isRebuilt });
    R.valid = samples.valid.length;
    R.excluded = samples.excluded;
    R.window = cur.window;
    const exText = Object.entries(samples.excluded).map(([k, v]) => `${k}×${v}`).join(", ");
    const progress = `${item.id}: 유효 표본 ${samples.valid.length}/${cur.window}${exText ? ` (제외 ${exText})` : ""}${samples.waiting ? ` — 대기 ${samples.waiting}` : ""}`;
    if (samples.valid.length < cur.window) {
      R.actions.push("wait");
      log.push(progress);
      continue;
    }
    const stats = aggregate(samples.valid);
    const dec = decide(item, stats);
    log.push(`${progress} → ${dec.verdict} (shares/1000reach ${f1(stats.sharesPer1000Reach)}, avg_watch ${f1(stats.avgWatchMedian)}초)`);
    if (dec.verdict === "middle" && !cur.extended && item.extendTo) {
      state[acct] = { ...cur, extended: true, window: item.extendTo };
      R.actions.push("extend");
      if (cur.issue) ops.push({ type: "comment", issue: cur.issue, body: `중간 구간 — 창을 ${item.extendTo}회차로 1회 연장 (${nowIso})` });
      continue;
    }
    const verdict = dec.verdict === "middle" ? "inconclusive" : dec.verdict;
    const control = concurrentControl(snap.entries, acct, samples.valid);
    const coDrop =
      control.window.avgWatchMedian != null &&
      control.before.avgWatchMedian != null &&
      control.window.avgWatchMedian < control.before.avgWatchMedian * CO_DROP_RATIO;
    const file = `experiments/verdicts/${item.id}.md`;
    docs[file] = renderVerdictDoc({ item, run: cur, verdict, stats, dec, samples, control, coDrop, nowMs });
    state[acct] = {
      ...cur,
      pending: {
        verdict,
        decidedAt: nowIso,
        file,
        stats: {
          n: stats.n,
          sharesPer1000Reach: stats.sharesPer1000Reach,
          avgWatchMedian: stats.avgWatchMedian,
        },
        veto: false,
      },
    };
    R.actions.push("verdict");
    R.verdict = verdict;
    if (cur.issue) {
      ops.push({
        type: "comment",
        issue: cur.issue,
        body: `판정: **${verdict}** (${nowIso}) — 문서 \`${file}\`. 다음 insights 실행(${VETO_HOURS}시간 이상 뒤)에서 적용한다. 거부하려면 그 전에 state.json의 \`${acct}.pending.veto\`를 true로 커밋.`,
      });
    }
  }
  return { state, flags, docs, ops, log, report };
}

// ─── GitHub 이슈 (gh CLI) ────────────────────────────────────────
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function issueBody(item, run) {
  const conds = (list) => (list ?? []).map((c) => `${c.kpi} ${c.op} ${c.value}`).join(" AND ") || "-";
  return [
    `가설: ${item.hypothesis ?? "-"}`,
    "",
    `- flags: \`${JSON.stringify(item.flags)}\``,
    `- 창: ${run.startStem}부터 유효 표본 ${run.window}회차 (중간 구간이면 ${item.extendTo ?? "-"}회차로 1회 연장)`,
    `- adopt: ${conds(item.adopt)}`,
    `- reject: ${conds(item.reject)}`,
    `- 사전등록: ${item.prereg ?? "-"}${item.addendum ? ` / 부록: ${item.addendum}` : ""}`,
    "",
    "판정은 insights 워크플로가 매일 기록하고, 적용은 다음 실행에서 한다(24시간 거부권 창).",
  ].join("\n");
}

function applyIssueOps({ state, ops, byId, dryRun }) {
  const out = [];
  const tryGh = (args, label) => {
    if (dryRun) {
      out.push(`[dry-run] gh ${label}`);
      return null;
    }
    try {
      return gh(args);
    } catch (e) {
      out.push(`경고: gh ${label} 실패 — ${String(e.stderr || e.message).split("\n")[0]}`);
      return null;
    }
  };
  for (const op of ops) {
    if (op.type === "comment") tryGh(["issue", "comment", String(op.issue), "--body", op.body], `issue comment #${op.issue}`);
    if (op.type === "close") tryGh(["issue", "close", String(op.issue), "--comment", op.body], `issue close #${op.issue}`);
  }
  for (const acct of ACCOUNTS) {
    const run = state[acct];
    if (!run?.active || run.issue) continue;
    const item = byId.get(run.active);
    const title = `[실험] ${item.id} (${acct})`;
    // 이전 실행이 이슈를 만든 뒤 state push에 실패했을 수 있다 — 같은 제목의 열린 이슈가 있으면 재사용한다.
    const listed = tryGh(
      ["issue", "list", "--label", "experiment", "--state", "open", "--json", "number,title", "--limit", "50"],
      "issue list experiment",
    );
    let existing = null;
    try {
      existing = JSON.parse(listed || "[]").find((i) => i.title === title) ?? null;
    } catch {
      existing = null;
    }
    if (existing) {
      run.issue = existing.number;
      out.push(`${item.id}: 기존 이슈 #${existing.number} 재사용`);
      continue;
    }
    tryGh(["label", "create", "experiment", "--color", "1D76DB", "--force"], "label create experiment");
    const url = tryGh(
      ["issue", "create", "--title", title, "--label", "experiment", "--body", issueBody(item, run)],
      `issue create ${item.id}`,
    );
    const num = url?.match(/\/issues\/(\d+)/)?.[1];
    if (num) {
      run.issue = Number(num);
      out.push(`${item.id}: 이슈 #${num} 생성`);
    }
  }
  return out;
}

// ─── 재빌드 감지 (git) ───────────────────────────────────────────
// 발행 마커 커밋 이후에 그 회차의 formats/arms 기록을 바꾼 커밋이 있으면, 기록이 실제 발행 영상을 대변하지 않는다.
export function gitRebuiltFn(root) {
  return (stem) => {
    try {
      const first = execFileSync("git", ["-C", root, "log", "--format=%H", "--reverse", "--", `published/${stem}`], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split("\n")[0];
      if (!first) return false;
      const after = execFileSync(
        "git",
        ["-C", root, "log", "--format=%H", `${first}..HEAD`, "--", `docs/formats/${stem}.txt`, `docs/arms/${stem}.txt`, `docs/arms/ai/${stem}.txt`, `docs/hooks/${stem}.txt`],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return after.length > 0;
    } catch {
      return false; // git 없음·얕은 클론 — 재빌드 판정 불가면 제외하지 않는다
    }
  };
}

// ─── 실행 모드 ──────────────────────────────────────────────────
function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function summary(text) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  } catch {
    // 요약은 보조 출력 — 실패해도 무시
  }
}

function runLint(root) {
  const loaded = loadExperiments(root);
  const errors = loaded.errors.length ? loaded.errors : lint(loaded);
  if (errors.length) {
    console.error(`queue lint FAIL (${errors.length}건)`);
    for (const e of errors) console.error(`  ${e}`);
    return false;
  }
  console.log("queue OK");
  return true;
}

function runMain(args) {
  const root = argValue(args, "--root") ?? REPO_ROOT;
  const dryRun = args.includes("--dry-run");
  const nowArg = argValue(args, "--now");
  const nowMs = nowArg ? Date.parse(nowArg) : Date.now();
  if (Number.isNaN(nowMs)) {
    console.error(`--now 파싱 실패: ${nowArg}`);
    process.exit(2);
  }
  const snapshotArg = argValue(args, "--snapshot");
  const snapshotPath = snapshotArg ? resolve(snapshotArg) : undefined;

  if (!runLint(root)) {
    console.error("lint 실패 — 판정·전환을 하지 않는다(health가 ALERT queue-lint로 보고)");
    summary("### 실험 판정기\n\nlint 실패 — 판정·전환 생략");
    process.exit(0);
  }

  const res = runEngine({
    root,
    nowMs,
    snapshotPath,
    isRebuilt: gitRebuiltFn(root),
  });
  for (const l of res.log) console.log(l);

  const { queue } = loadExperiments(root);
  const byId = new Map(queue.items.map((it) => [it.id, it]));
  const ghLog = applyIssueOps({ state: res.state, ops: res.ops, byId, dryRun });
  for (const l of ghLog) console.log(l);

  summary(`### 실험 판정기${dryRun ? " (dry-run)" : ""}\n\n${[...res.log, ...ghLog].map((l) => `- ${l}`).join("\n")}\n`);
  if (dryRun) {
    console.log("[dry-run] state·flags·판정 문서 쓰기 생략");
    return;
  }
  const dir = join(root, "experiments");
  writeFileSync(join(dir, "state.json"), `${JSON.stringify(res.state, null, 2)}\n`);
  writeFileSync(join(dir, "flags.json"), `${JSON.stringify(res.flags, null, 2)}\n`);
  for (const [rel, body] of Object.entries(res.docs)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
}

// ─── self-test ──────────────────────────────────────────────────
// 케이스 파일(JSON 배열)의 각 케이스로 임시 리포 트리를 만들고 엔진·lint 결과를 기대값과 대조한다.
// 기대값을 일부러 틀리게 적은 케이스 파일(test/fixtures/experiments/negative-cases.json)은 반드시 exit 1이어야 한다.
function buildSeries(series, overrides = {}) {
  const out = [];
  let [date, slot] = [series.start.slice(0, 10), series.start.slice(11)];
  for (let i = 0; i < series.count; i++) {
    const stem = `${date}-${slot}`;
    out.push({ stem, i, ...series, ...(overrides[stem] ?? {}) });
    if (slot === "am") slot = "pm";
    else {
      slot = "am";
      date = addDays(date, 1);
    }
  }
  return out;
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function buildCaseRoot(c, fixtureBase) {
  const root = mkdtempSync(join(tmpdir(), "experiment-selftest-"));
  const queue = readJson(join(fixtureBase, "queue.json"));
  const state = readJson(join(fixtureBase, "state.json"));
  const flags = readJson(join(fixtureBase, "flags.json"));
  const main = queue.items.find((it) => it.id === "single-issue-v1");
  Object.assign(main, c.itemPatch ?? {});
  queue.items.push(...(c.queueExtra ?? []));
  for (const [k, v] of Object.entries(c.state ?? {})) {
    state[k] = k === "history" ? v : { ...(state[k] ?? {}), ...v };
  }
  writeJson(join(root, "experiments", "queue.json"), queue);
  writeJson(join(root, "experiments", "state.json"), state);
  writeJson(join(root, "experiments", "flags.json"), c.flags ?? flags);

  const nowMs = Date.parse(c.now);
  const snapDate = c.snapshotDate ?? kstDate(nowMs);
  const rows = [];
  for (const s of c.series ? buildSeries(c.series, c.overrides) : []) {
    writeJson(join(root, "data", `${s.stem}.json`), {
      date: s.stem.slice(0, 10),
      slot: s.stem.slice(11),
      issues: [{ rank: 1, narration: s.narration }],
    });
    mkdirSync(join(root, "docs", "arms"), { recursive: true });
    mkdirSync(join(root, "docs", "formats"), { recursive: true });
    writeFileSync(join(root, "docs", "formats", `${s.stem}.txt`), `${s.format}\n`);
    writeFileSync(join(root, "docs", "arms", `${s.stem}.txt`), `${s.arm}\n`);
    if (s.hook) {
      mkdirSync(join(root, "docs", "hooks"), { recursive: true });
      writeFileSync(join(root, "docs", "hooks", `${s.stem}.txt`), `${s.hook}\n`);
    }
    if (s.published === false) continue;
    mkdirSync(join(root, "published"), { recursive: true });
    writeFileSync(join(root, "published", s.stem), `${17900000000000000 + s.i}\n`);
    rows.push({
      stem: s.stem,
      account: "muleori",
      timestamp: new Date(stemPublishMs(s.stem)).toISOString(),
      ...(s.error ? { error: s.error } : {}),
      metrics: {
        views: 100,
        reach: s.reach,
        shares: s.shares,
        saved: 0,
        ig_reels_avg_watch_time: s.avgWatchMs,
      },
    });
  }
  for (const [stem, body] of Object.entries(c.data ?? {})) writeJson(join(root, "data", `${stem}.json`), body);
  const snapshotPath = join(root, "metrics", `${snapDate}.json`);
  writeJson(snapshotPath, rows);
  return { root, nowMs, snapshotPath };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkCase(c, fixtureBase) {
  const { root, nowMs, snapshotPath } = buildCaseRoot(c, fixtureBase);
  const fails = [];
  const e = c.expect;
  const loaded = loadExperiments(root);
  const lintOk = lint(loaded).length === 0;
  if ("lint" in e && e.lint !== lintOk) fails.push(`lint 기대 ${e.lint}, 실제 ${lintOk}`);
  if (!lintOk) return fails;
  const rebuilt = new Set(c.rebuilt ?? []);
  const res = runEngine({ root, nowMs, snapshotPath, isRebuilt: (s) => rebuilt.has(s) });
  const acct = c.account ?? "muleori";
  const R = res.report[acct];
  const st = res.state[acct];
  const actual = {
    action: R.actions,
    verdict: R.verdict ?? null,
    valid: R.valid ?? null,
    excluded: R.excluded ?? {},
    flags: res.flags[acct],
    active: st?.active ?? null,
    pendingVerdict: st?.pending?.verdict ?? null,
    extended: st?.extended ?? null,
    window: st?.window ?? null,
    startStem: st?.startStem ?? null,
    flagsBefore: st?.flagsBefore ?? null,
    hold: st?.hold ?? null,
    waitingFor: st?.waitingFor ?? null,
    historyLast: res.state.history[res.state.history.length - 1] ?? null,
  };
  for (const [k, want] of Object.entries(e)) {
    if (k === "lint") continue;
    if (k === "action") {
      if (!actual.action.includes(want)) fails.push(`action ${want} 없음 (실제 ${actual.action.join(",")})`);
    } else if (k === "historyLast" && want === null) {
      if (actual.historyLast !== null) fails.push(`historyLast 기대 null, 실제 ${JSON.stringify(actual.historyLast)}`);
    } else if (k === "historyLast") {
      for (const [hk, hv] of Object.entries(want)) {
        if (!deepEqual(actual.historyLast?.[hk], hv)) fails.push(`historyLast.${hk} 기대 ${JSON.stringify(hv)}, 실제 ${JSON.stringify(actual.historyLast?.[hk])}`);
      }
    } else if (k === "docWritten") {
      if (Boolean(Object.keys(res.docs).length) !== want) fails.push(`판정 문서 기대 ${want}`);
    } else if (!deepEqual(actual[k], want)) {
      fails.push(`${k} 기대 ${JSON.stringify(want)}, 실제 ${JSON.stringify(actual[k])}`);
    }
  }
  return fails;
}

function runSelfTest(args) {
  const casesFile = argValue(args, "--cases") ?? join(REPO_ROOT, "test", "fixtures", "experiments", "cases.json");
  const only = argValue(args, "--only");
  const fixtureBase = join(REPO_ROOT, "test", "fixtures", "experiments", "base");
  let cases = readJson(casesFile);
  if (only) cases = cases.filter((c) => c.name === only);
  if (cases.length === 0) {
    console.error(`self-test: 케이스 없음 (${only ?? casesFile})`);
    process.exit(1);
  }
  let pass = 0;
  for (const c of cases) {
    const fails = checkCase(c, fixtureBase);
    if (fails.length === 0) {
      pass++;
      console.error(`PASS  ${c.name}`);
    } else {
      console.error(`FAIL  ${c.name}`);
      for (const f of fails) console.error(`  ${f}`);
    }
  }
  if (pass === cases.length) {
    console.error(`self-test ${pass}/${cases.length} PASS`);
    return;
  }
  console.error(`self-test 실패 (${pass}/${cases.length} PASS)`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return runSelfTest(args);
  if (args.includes("--lint")) {
    if (!runLint(argValue(args, "--root") ?? REPO_ROOT)) process.exit(1);
    return;
  }
  runMain(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
