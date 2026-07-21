#!/usr/bin/env node
// 구글뉴스 KR RSS 수집 — 의존성 없이 fetch + 정규식 파서
// 사용법: node scripts/collect.mjs [--out result.json]
//   stdout(기본) 또는 --out 파일로 {title, source, link, pubDate, description}[] 출력
//   수집 실패 시 exit 1

import { writeFileSync } from "node:fs";

const RSS_URL = "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko";

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

async function main() {
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx !== -1 ? process.argv[outIdx + 1] : null;

  let xml;
  try {
    const res = await fetch(RSS_URL, {
      headers: { "user-agent": "Mozilla/5.0 (daily-news-reels collect)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (e) {
    console.error(`수집 실패: ${e.message}`);
    process.exit(1);
  }

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
