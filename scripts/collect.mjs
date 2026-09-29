#!/usr/bin/env node
// 신호 수집기 — 의존성 없이 fetch + 정규식 파서
// 사용법
//   node scripts/collect.mjs [--out result.json]            구글뉴스 KR RSS 배열 출력(기존 동작, 하위 호환)
//   node scripts/collect.mjs --stem <YYYY-MM-DD-am|pm> --out <file> [--root <dir>] [--now <ISO>]
//       signals 모드: 구글뉴스+구글트렌드+네이트 랭킹을 수집해 <file>에 {stem,sources,news,trends,nate} 저장.
//       <file>이 이미 있으면 새 결과의 ok 소스 수가 기존 이상일 때만 덮어쓴다(동률이면 덮어씀).
//       컷오프(am 07:00·pm 17:10 KST) 이후이거나 <root>/data/<stem>.json이 있으면 "건너뜀"으로 exit 0.
//   --from-dir <dir>    네트워크 대신 저장 응답(gn.xml·tr.xml·nate.html) 파싱
//   --self-test [--cases <file>] [--only <name>]   픽스처 기반 자체 시험(실패 시 exit 1)
//   수집 실패(기존 모드) 또는 세 소스 전부 실패(signals 모드) 시 exit 1

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GN_URL = "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko";
const TR_URL = "https://trends.google.co.kr/trending/rss?geo=KR";
const NATE_URL = "https://news.nate.com/rank/?mid=n1000";
const UA = "Mozilla/5.0 (daily-news-reels collect)";

// ─── 창·컷오프 상수 ───
const HOUR_MS = 3600 * 1000;
const KST_OFFSET_MS = 9 * HOUR_MS;
// 기사 창 하한: 슬롯 날짜(D) KST 00:00 기준 시간 오프셋, 하한 포함(>=).
// scripts/validate.mjs FRESHNESS_WINDOWS의 from 값과 같아야 한다(am D-1 15:00, pm D 06:00).
const WINDOW_FROM_HOURS = { am: -9, pm: 6 };
// 슬롯 컷오프(KST 시각): 이후엔 루틴 push와 겹치지 않도록 수집하지 않는다.
const CUTOFF_HOURS = { am: 7, pm: 17 + 10 / 60 };
// 소스 ok 기준(파서 게이트)
const MIN_NEWS = 5;
const MIN_TRENDS = 5;
const MIN_NATE = 10;
const NATE_TOP = 20;
const MAX_FFFD_RATIO = 0.001; // 네이트 디코딩 결과 중 U+FFFD 비율 상한(모지바케 판정)
const SOURCE_NAMES = ["news", "trends", "nate"];

// CDATA/엔티티 정리
function decode(s) {
  if (s == null) return "";
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// <tag>...</tag> 첫 매치 추출 (item 블록 내부)
function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decode(m[1]) : "";
}

// 구글뉴스 RSS → {title, source, link, pubDate, description}[] (pubDate 원문 유지)
function parseGoogleNews(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const title = pick(b, "title");
    // 구글뉴스 title은 "제목 - 언론사" 형태. source 태그가 별도로 있으면 우선.
    const sourceTag = pick(b, "source");
    let cleanTitle = title;
    let source = sourceTag;
    if (!source) {
      const dash = title.lastIndexOf(" - ");
      if (dash !== -1) {
        source = title.slice(dash + 3);
        cleanTitle = title.slice(0, dash);
      }
    } else {
      // title 끝의 " - 언론사" 제거
      const suffix = ` - ${source}`;
      if (cleanTitle.endsWith(suffix)) cleanTitle = cleanTitle.slice(0, -suffix.length);
    }
    items.push({
      title: cleanTitle,
      source: source || "",
      link: pick(b, "link"),
      pubDate: pick(b, "pubDate"),
      description: pick(b, "description"),
    });
  }
  return items;
}

// ─── signals 모드 ───
const pad = (n) => String(n).padStart(2, "0");

// epoch(ms) → "YYYY-MM-DDTHH:mm:ss+09:00"
function toKstIso(ms) {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`;
}

// RFC 2822 날짜(GMT·-0700 등) → epoch(ms), 파싱 불가면 null
function parseRfcDate(str) {
  const t = Date.parse(str);
  return Number.isNaN(t) ? null : t;
}

function parseStem(stem) {
  const m = typeof stem === "string" && stem.match(/^(\d{4})-(\d{2})-(\d{2})-(am|pm)$/);
  if (!m) throw new Error(`stem 형식 오류: ${stem} (YYYY-MM-DD-am|pm)`);
  const d0 = Date.UTC(+m[1], +m[2] - 1, +m[3]) - KST_OFFSET_MS; // D 00:00 KST
  return { d0, slot: m[4] };
}

function parseTrends(xml) {
  const out = [];
  for (const b of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const term = pick(b, "title");
    const t = parseRfcDate(pick(b, "pubDate"));
    if (!term || t == null) continue;
    const newsItems = [];
    for (const n of b.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/g) || []) {
      newsItems.push({
        title: pick(n, "ht:news_item_title"),
        snippet: pick(n, "ht:news_item_snippet"),
        url: pick(n, "ht:news_item_url"),
        source: pick(n, "ht:news_item_source"),
      });
    }
    out.push({ term, pubDate: toKstIso(t), newsItems });
  }
  return out;
}

// 응답 바이트 → 문자열. charset은 응답 헤더 → meta 순, 없으면 utf-8. 알 수 없는 라벨이면 throw.
function decodeHtml(buf, headerCharset) {
  let cs = headerCharset;
  if (!cs) {
    const head = Buffer.from(buf.subarray(0, 4096)).toString("latin1");
    const m = head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i);
    cs = m ? m[1] : "utf-8";
  }
  return new TextDecoder(cs.toLowerCase()).decode(buf);
}

// 네이트 랭킹 HTML → {rank, title, link}[] (순위 오름차순, 상위 NATE_TOP)
function parseNate(html) {
  const byRank = new Map();
  const re = /<dl class="mduRank rank(\d+)">[\s\S]*?href="([^"]*\/view\/[^"?]+)[^"]*"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/g;
  for (const m of html.matchAll(re)) {
    const rank = +m[1];
    const title = decode(m[3]);
    if (!title || byRank.has(rank)) continue;
    const path = m[2].startsWith("//") ? `https:${m[2]}` : m[2];
    byRank.set(rank, { rank, title, link: path });
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank).slice(0, NATE_TOP);
}

const fffdRatio = (s) => (s.length ? (s.match(/\uFFFD/g) || []).length / s.length : 0);

// 네트워크/저장본에서 원문을 읽는다. 소스별로 {ok, ...}가 아니라 값 또는 예외.
async function fetchBytes(url) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cs = (res.headers.get("content-type") || "").match(/charset=([\w-]+)/i);
  return { buf: new Uint8Array(await res.arrayBuffer()), charset: cs ? cs[1] : null };
}

const readRaw = (dir, name, override) => {
  const p = override?.[name] ?? join(dir, name);
  return { buf: new Uint8Array(readFileSync(p)), charset: null };
};

// 세 소스 원문을 읽어 파서 게이트까지 적용한 결과를 만든다.
// raw: {news, trends, nate} 각각 () => Promise<{buf, charset}> — 실패는 throw.
async function buildSignals({ stem, raw, nowMs }) {
  const { d0, slot } = parseStem(stem);
  const windowStart = d0 + WINDOW_FROM_HOURS[slot] * HOUR_MS;
  const result = {
    stem,
    collectedAt: toKstIso(nowMs),
    sources: {},
    errors: {},
    news: [],
    trends: [],
    nate: [],
  };
  const fail = (name, msg) => {
    result.sources[name] = "fail";
    result.errors[name] = msg;
  };

  try {
    const { buf } = await raw.news();
    const items = [];
    for (const it of parseGoogleNews(new TextDecoder().decode(buf))) {
      const t = parseRfcDate(it.pubDate);
      if (t == null || t < windowStart) continue; // 파싱 불가·창 밖(하한 포함) 제거
      items.push({ title: it.title, source: it.source, link: it.link, pubDate: toKstIso(t) });
    }
    if (items.length < MIN_NEWS) throw new Error(`창 안 item ${items.length}개 < ${MIN_NEWS}`);
    result.news = items;
    result.sources.news = "ok";
  } catch (e) {
    fail("news", e.message);
  }

  try {
    const { buf } = await raw.trends();
    const items = parseTrends(new TextDecoder().decode(buf));
    if (items.length < MIN_TRENDS) throw new Error(`유효 item ${items.length}개 < ${MIN_TRENDS}`);
    result.trends = items;
    result.sources.trends = "ok";
  } catch (e) {
    fail("trends", e.message);
  }

  try {
    const { buf, charset } = await raw.nate();
    const html = decodeHtml(buf, charset);
    const ratio = fffdRatio(html);
    if (ratio > MAX_FFFD_RATIO) throw new Error(`디코딩 깨짐 U+FFFD 비율 ${ratio.toFixed(4)}`);
    const items = parseNate(html);
    if (items.length < MIN_NATE) throw new Error(`제목 ${items.length}개 < ${MIN_NATE}`);
    if (!items.some((i) => /[가-힣]/.test(i.title))) throw new Error("제목에 한글 없음");
    result.nate = items;
    result.sources.nate = "ok";
  } catch (e) {
    fail("nate", e.message);
  }

  if (Object.keys(result.errors).length === 0) delete result.errors;
  return result;
}

const okCount = (r) => SOURCE_NAMES.filter((n) => r?.sources?.[n] === "ok").length;

function summaryLine(r) {
  const cnt = { news: r.news.length, trends: r.trends.length, nate: r.nate.length };
  return `signals: ${r.stem} ` + SOURCE_NAMES.map((n) => `${n}=${r.sources[n]}${r.sources[n] === "ok" ? `(${cnt[n]})` : ""}`).join(" ");
}

// 슬롯 컷오프·data 존재를 확인하고 수집 결과를 만든다.
// 반환: {action: "skip", reason} | {action: "write"|"keep", result}
async function runSignals({ stem, raw, nowMs, root, existing }) {
  const { d0, slot } = parseStem(stem);
  if (nowMs >= d0 + CUTOFF_HOURS[slot] * HOUR_MS) return { action: "skip", reason: `컷오프(${slot}) 이후` };
  if (existsSync(join(root, "data", `${stem}.json`))) return { action: "skip", reason: `data/${stem}.json 존재` };
  const result = await buildSignals({ stem, raw, nowMs });
  if (okCount(result) === 0) throw new Error(`세 소스 전부 실패: ${JSON.stringify(result.errors)}`);
  // 나중 수집일수록 신선하므로 동률이면 덮어쓴다. 성공 소스가 줄면 기존 유지.
  return { action: okCount(result) >= okCount(existing) ? "write" : "keep", result };
}


// ─── self-test ───
// cases 파일: {fixturesRoot, cases:[{name, stem, now, dir, override?, root?, existing?, expect}]}
// expect: {action, sources?, counts?, titlesInclude?, titlesExclude?, pubDateKst?}
function checkCase(c, out) {
  const e = c.expect;
  const errs = [];
  if (out.action !== e.action) errs.push(`action ${out.action} != ${e.action}`);
  const r = out.result;
  if (e.sources) for (const n of Object.keys(e.sources)) if (r?.sources?.[n] !== e.sources[n]) errs.push(`sources.${n} ${r?.sources?.[n]} != ${e.sources[n]}`);
  if (e.counts) for (const n of Object.keys(e.counts)) if ((r?.[n]?.length ?? 0) !== e.counts[n]) errs.push(`${n} ${r?.[n]?.length ?? 0}개 != ${e.counts[n]}`);
  const titles = (r?.news ?? []).map((i) => i.title);
  for (const t of e.titlesInclude ?? []) if (!titles.includes(t)) errs.push(`news에 "${t}" 없음`);
  for (const t of e.titlesExclude ?? []) if (titles.includes(t)) errs.push(`news에 "${t}" 남아 있음`);
  if (e.pubDateKst && !(r?.news ?? []).every((i) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(i.pubDate))) errs.push("news pubDate가 +09:00 ISO가 아님");
  return errs;
}

async function selfTest(casesPath, only) {
  const cfg = JSON.parse(readFileSync(casesPath, "utf8"));
  const base = resolve(dirname(casesPath), cfg.fixturesRoot ?? ".");
  const list = cfg.cases.filter((c) => !only || c.name === only);
  if (list.length === 0) {
    console.error(`self-test 0/0 FAIL (케이스 없음: ${only ?? "전체"})`);
    return false;
  }
  let pass = 0;
  for (const c of list) {
    let errs;
    try {
      const dir = join(base, c.dir);
      const override = c.override && Object.fromEntries(Object.entries(c.override).map(([k, v]) => [k, join(base, v)]));
      const raw = {
        news: async () => readRaw(dir, "gn.xml", override),
        trends: async () => readRaw(dir, "tr.xml", override),
        nate: async () => readRaw(dir, "nate.html", override),
      };
      const existing = c.existing ? JSON.parse(readFileSync(join(base, c.existing), "utf8")) : null;
      const out = await runSignals({ stem: c.stem, raw, nowMs: Date.parse(c.now), root: join(base, c.root ?? "root-empty"), existing });
      errs = checkCase(c, out);
    } catch (e) {
      errs = [`예외: ${e.message}`];
    }
    if (errs.length === 0) pass++;
    console.log(`${errs.length === 0 ? "PASS" : "FAIL"} ${c.name}${errs.length ? ` — ${errs.join("; ")}` : ""}`);
  }
  console.log(`self-test ${pass}/${list.length} ${pass === list.length ? "PASS" : "FAIL"}`);
  return pass === list.length;
}

// ─── main ───
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
};

async function main() {
  const outPath = arg("--out");
  const fromDir = arg("--from-dir");
  const stem = arg("--stem");

  if (process.argv.includes("--self-test")) {
    const here = dirname(fileURLToPath(import.meta.url));
    const casesPath = arg("--cases") ?? join(here, "..", "test", "fixtures", "signals", "cases.json");
    process.exit((await selfTest(casesPath, arg("--only"))) ? 0 : 1);
  }

  if (stem) {
    if (!outPath) {
      console.error("--stem에는 --out <file>이 필요하다");
      process.exit(1);
    }
    const nowMs = arg("--now") ? Date.parse(arg("--now")) : Date.now();
    if (Number.isNaN(nowMs)) {
      console.error(`--now 파싱 실패: ${arg("--now")}`);
      process.exit(1);
    }
    const raw = fromDir
      ? { news: async () => readRaw(fromDir, "gn.xml"), trends: async () => readRaw(fromDir, "tr.xml"), nate: async () => readRaw(fromDir, "nate.html") }
      : { news: () => fetchBytes(GN_URL), trends: () => fetchBytes(TR_URL), nate: () => fetchBytes(NATE_URL) };
    let existing = null;
    if (existsSync(outPath)) {
      try {
        existing = JSON.parse(readFileSync(outPath, "utf8"));
      } catch {
        existing = null; // 깨진 기존 파일은 없는 것으로 본다
      }
    }
    let out;
    try {
      out = await runSignals({ stem, raw, nowMs, root: arg("--root") ?? ".", existing });
    } catch (e) {
      console.error(`수집 실패: ${e.message}`);
      process.exit(1);
    }
    if (out.action === "skip") {
      console.log(`signals: ${stem} 건너뜀 — ${out.reason}`);
      return;
    }
    if (out.action === "write") {
      mkdirSync(dirname(resolve(outPath)), { recursive: true });
      writeFileSync(outPath, JSON.stringify(out.result, null, 2) + "\n");
    }
    console.log(summaryLine(out.result) + (out.action === "keep" ? " (기존 파일이 더 좋아 유지)" : ""));
    return;
  }

  // 기존 모드: 구글뉴스 배열 출력
  let xml;
  try {
    if (fromDir) xml = new TextDecoder().decode(readRaw(fromDir, "gn.xml").buf);
    else xml = new TextDecoder().decode((await fetchBytes(GN_URL)).buf);
  } catch (e) {
    console.error(`수집 실패: ${e.message}`);
    process.exit(1);
  }

  const items = parseGoogleNews(xml);
  if (items.length === 0) {
    console.error("수집 실패: item 0건 (RSS 파싱 실패 또는 빈 응답)");
    process.exit(1);
  }

  const json = JSON.stringify(items, null, 2);
  if (outPath) {
    writeFileSync(outPath, json + "\n");
    console.error(`수집 완료: ${items.length}건 → ${outPath}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

main();
