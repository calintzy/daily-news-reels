# 릴스 스펙 (REELS_SPEC)

클라우드 루틴 에이전트는 매 실행 시 이 파일을 읽고 그대로 따른다.
이 파일을 수정하면 다음 실행부터 반영된다 (루틴 자체를 수정할 필요 없음).

## 산출물

- 파일: `data/YYYY-MM-DD.json` — 날짜는 반드시 `TZ=Asia/Seoul date +%F`로 구한다 (UTC 날짜 사용 금지).
- 언어: 한국어 (요약·커버 문구). 이미지 프롬프트만 영문.
- 완료 후: `git add data/YYYY-MM-DD.json` → commit (`reels: YYYY-MM-DD`) → push.
- push하면 GitHub Actions(`reels.yml`)가 검증→이미지→렌더→음악→Telegram 미리보기까지 이어받는다.

## 데이터 계약 (전체)

```json
{
  "date": "2026-07-21",
  "todayOneLiner": "커버에 얹을 한 줄 (존댓말). 대한민국이 주목하는 소식을 소개.",
  "issues": [
    {
      "rank": 1,
      "category": "AI·과학",
      "kicker": "인간 vs AI",
      "title": "제목 (32자 이내)",
      "summary": "존댓말 2문장, 110자 이내. 원문에 없는 고유명사·수치 추가 금지.",
      "sourceTitle": "원문 기사 제목 (원문 그대로 동봉)",
      "sourceDesc": "RSS description 원문 (원문 그대로 동봉)",
      "sourceLink": "https://news.google.com/search?q=...",
      "imagePrompt": "영문 photojournalism 프롬프트. 반드시 'no people'과 'no text' 포함, 세로 9:16."
    }
  ],
  "caption": "인스타 캡션 (이슈 제목 목록 + 해시태그 + CC-BY 표기). http 링크 금지."
}
```

필드별 계약(`scripts/validate.mjs`가 이진 게이트로 강제):

- `date` — 필수. `YYYY-MM-DD`.
- `todayOneLiner` — 필수. 존댓말 종결어미로 끝나는 한 줄.
- `issues` — 4~6개. `rank`는 1부터 연속.
  - `title` — 32자 이내.
  - `summary` — 120자 이내, 문장 2개 이하, 존댓말 종결.
  - `sourceTitle` + `sourceDesc` — 원문 그대로. **요약 사실성 대조의 기준**이 되므로 절대 각색하지 않는다.
  - `imagePrompt` — 영문만(한글 포함 시 FAIL). `no people`·`no text` 필수, 500자 이내.
- `caption` — `Music: Kevin MacLeod (incompetech.com), CC BY 4.0` 필수, http 링크 0건, 2200자 이내.
- (선택) `coverPrompt` — 없으면 기본값(새벽 도시 스카이라인 뉴스룸 무드) 사용.

## 수집

- **WebFetch를 1순위**로 사용한다. 클라우드 샌드박스의 egress 프록시가 Bash curl을 차단하므로(CONNECT 403) curl은 쓰지 않는다.
  - 소스: 구글뉴스 KR RSS `https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko`
  - WebFetch가 실패하면 **WebSearch로 오늘자 국내 주요 뉴스**를 검색해 보완한다.
  - 그래도 안 되면 수집 실패 소스를 명시하고, 확보한 것으로 진행한다.
- `scripts/collect.mjs`는 로컬/Actions 환경용 보조 수집기다(의존성 없이 fetch로 RSS 파싱). 클라우드 루틴은 WebFetch를 우선한다.

## TOP5 선정 기준

- 대중 관심도가 높은 순.
- 카테고리 다양성: 정치는 최대 2건까지만. AI·과학, 사건, 국제, 경제, 사회 등으로 고르게.
- 광고성·홍보성 기사 제외. 단순 시황·연예 가십은 낮은 우선순위.

## 요약 규칙 (가장 중요)

- **존댓말 2문장.** 각 문장은 존댓말 종결어미(습니다/니다/세요/어요/아요/해요/이에요/예요 계열)로 끝난다.
- **원문(sourceTitle + sourceDesc)에 없는 고유명사·수치·기관명을 요약에 추가하는 것을 절대 금지한다.**
  - `validate.mjs`가 결정론적으로 대조한다: summary+title에 등장하는 ①모든 아라비아 숫자 ②모든 라틴문자 토큰(2자 이상) ③괄호·따옴표 안 한글 토큰이 `sourceTitle+sourceDesc`에 문자열로 존재해야 통과한다. 미존재 시 FAIL.
  - 따라서 요약에 쓸 숫자·영문·인용 표현은 반드시 원문에 있는 것만 쓴다. 불확실하면 그 표현을 빼고 일반화한다.
- `sourceTitle`/`sourceDesc`는 반드시 **원문 그대로** 동봉한다(각색·요약 금지). 이것이 사실성 대조의 기준이다.

## imagePrompt 규칙

- **영문**으로 작성. photojournalism·documentary 스타일.
- 반드시 `no people`·`no text` 포함.
- **실존 인물 묘사 금지** — 사건을 상징하는 사물·장면·풍경으로 표현한다(예: 인물 대신 바둑판 클로즈업, 법정 내부, 도시 스카이라인).
- 세로 9:16 구도(`vertical 9:16 composition`).
- 한글이 들어가면 검증에서 FAIL(한글 인명이 프롬프트로 유입되는 것을 차단).

## caption 규칙

- 이슈 제목 목록(번호 매김).
- 해시태그: `#뉴스 #오늘의뉴스 #뉴스요약 #시사 #이슈` 등 (자유롭게 추가 가능).
- **CC-BY 표기 필수**: `Music: Kevin MacLeod (incompetech.com), CC BY 4.0`.
- **http 링크 금지** — 원문 링크는 캡션에 넣지 않는다(사실 검수용 링크는 Telegram 미리보기로만 전달).

## 실패 처리

- 수집 실패한 소스는 명시한다.
- `validate.mjs`가 FAIL하면 Actions가 게시를 중단하고 Telegram으로 실패 알림을 보낸다(운영자가 데이터를 고쳐 재푸시).
