# 릴스 스펙 (REELS_SPEC)

클라우드 루틴 에이전트는 매 실행 시 이 파일을 읽고 그대로 따른다.
이 파일을 수정하면 다음 실행부터 반영된다 (루틴 자체를 수정할 필요 없음).

## 산출물

- 파일: `data/YYYY-MM-DD-am.json`(아침 회차) / `data/YYYY-MM-DD-pm.json`(저녁 회차) — 날짜는 반드시 `TZ=Asia/Seoul date +%F`로 구한다 (UTC 날짜 사용 금지).
  - 파일명 stem(`2026-07-23-am` 등)이 곧 산출물 키다: `assets/img/<stem>/`, `docs/videos/<stem>.mp4`, `containers/<stem>`, `published/<stem>`.
  - 데이터 안 `date` 필드는 그대로 `YYYY-MM-DD`를 쓰고, 회차는 `slot` 필드("am"|"pm")로 구분한다.
- 언어: 한국어 (요약·커버 문구). 이미지 프롬프트만 영문.
- 완료 후: `git add data/YYYY-MM-DD-<slot>.json` → commit (`reels: YYYY-MM-DD-<slot>`) → push.
- push하면 GitHub Actions(`reels.yml`)가 검증→이미지→렌더→음악→Telegram 미리보기까지 이어받고, `PUBLISH_LIVE=1`이면 자동 발행까지 진행한다.

## 회차(slot) 규칙

하루 2회(아침/저녁) 발행한다. 각 회차는 별도 data 파일이다.

- **am 회차** — 전날 저녁~오늘 아침 뉴스 중심. 파일명 `data/YYYY-MM-DD-am.json`, `slot: "am"`.
- **pm 회차** — 당일 낮 뉴스 중심. 파일명 `data/YYYY-MM-DD-pm.json`, `slot: "pm"`.
  - **같은 날 am 파일이 존재하면 그 5건과 중복되는 기사를 금지**한다. 같은 사건의 실질적 후속 전개는 허용하되, 요약에 "후속"임을 명시한다.
- `slot`은 선택 필드다. 없으면 단일 회차(하위 호환)로 처리한다(기존 `data/YYYY-MM-DD.json`·`data/sample.json`도 계속 동작).
- **커버는 폐지됐다(2026-08-08 리텐션 훅 수술 — 평균 시청 1~4초, 커버 단계 전원 이탈 실측).** 영상은 0초부터 이슈1 + `hookLine` 오버레이로 시작한다. `coverPrompt`·`todayOneLiner`는 더 이상 쓰지 않는다. 날짜·회차 표기는 캡션이 담당한다.

## 데이터 계약 (전체)

```json
{
  "date": "2026-07-21",
  "slot": "am",
  "account": "muleori",
  "hookLine": "0초 훅 한 문장 (존댓말, 30자 이내). rank 1 이슈의 결론을 구어체로.",
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
  "caption": "인스타 캡션 (이슈 제목 목록 + 해시태그 + CC-BY 표기). http 링크 금지.",
  "selection": {
    "spec": "remix-v1",
    "signalSources": { "trends": "ok", "nate": "fail" },
    "signalHits": [
      { "rank": 2, "source": "trends", "term": "면허", "cause": "약물운전 면허취소 287건" }
    ]
  }
}
```

필드별 계약(`scripts/validate.mjs`가 이진 게이트로 강제):

- `date` — 필수. `YYYY-MM-DD`.
- `slot` — 선택. `"am"` 또는 `"pm"`만 허용(다른 값이면 FAIL). 없으면 단일 회차로 처리.
- `account` — **선택(2026-08-18 멀티 계정화).** 발행 계정을 정한다. `"muleori"`(물어오리, 기본값 — **생략 가능하며 이 스펙의 회차는 생략한다**) 또는 `"aibrief"`(오리 기자, `@todays.ai.brief`)만 허용한다. 다른 값이면 FAIL.
  - **파일명 stem과 정합해야 한다**: `ai-` 접두 stem(`data/ai-YYYY-MM-DD.json`) ⟺ `account: "aibrief"`. 한쪽만 맞으면 validate가 FAIL한다(잘못된 계정으로 게시되는 것을 막는 게이트).
  - 이 스펙(물어오리)의 회차는 `account`를 쓰지 않아도 되며, 기존 데이터 파일은 전부 그대로 통과한다.
  - 오리 기자 릴스의 작성 규칙은 별도 문서 `AI_REELS_SPEC.md`를 따른다.
- `hookLine` — **필수. 영상 0초에 풀스크린으로 뜨는 훅 한 문장.** 규칙:
  - **rank 1 이슈의 결론·핵심 사실**을 구어체 존댓말로 쓴다 (예: "집값 대책, 오늘 더 세게 나옵니다"). 헤드라인 복사 금지 — "무엇이 달라졌나/달라지나"가 한눈에 읽혀야 한다.
  - 30자 이내(validate 하드 게이트). 존댓말 종결.
  - **사실성: rank 1 이슈의 sourceTitle·sourceDesc에 있는 내용만** 쓴다. 원문에 없는 수치·고유명사를 넣으면 validate가 반려한다(rank1 원문 대조 게이트). 과장·낚시 금지 — 훅은 세게, 사실은 그대로.
  - hookLine 작성 규칙의 정본은 `contracts/hook/prompt.txt`다. 이 파일이 정본이며 ratchetlock 계약(동결 기준선·CI check 게이트)으로 회귀 관리된다.
- `issues` — 4~6개. `rank`는 1부터 연속.
  - `title` — 32자 이내.
  - `summary` — **120자 초과 시 validate가 발행을 반려한다(07-24·25 이틀 연속 실측 — 하드 게이트)**. 안전하게 105자 이하로 쓴다. 문장 2개 이하, 존댓말 종결.
  - `narration` — **작성하지 않는다(2026-08-22 훅 수술 3단계 — TTS A/B 조기 판정 종료).** 판정: TTS 팔 조회수 중앙값 59 vs 대조군 94 vs 실험 전 107 — TTS가 도달을 깎는 방향으로 일관해 조기 종료(`TTS_ENABLED=0`). 필드가 있어도 validate는 통과하지만(선택 필드) 렌더가 쓰지 않으며, 길이 초과로 회차가 반려될 위험만 남는다(2026-08-18-am 실측: 31자 2건으로 회차 중단) — 그러니 쓰지 마라. TTS를 재실험하려면 `TTS_ENABLED=1` 복원 + 이 항목을 되돌린다.
  - `sourceTitle` + `sourceDesc` — 원문 그대로. **요약 사실성 대조의 기준**이 되므로 절대 각색하지 않는다.
  - `imagePrompt` — 영문만(한글 포함 시 FAIL). `no people`·`no text` 필수, 500자 이내.
- `caption` — `Music: Kevin MacLeod (incompetech.com), CC BY 4.0` 필수, http 링크 0건, 2200자 이내.
- `selection` — **필수(2026-08-18 리믹스 업그레이드).** 이 회차가 어떤 신호로 만들어졌는지의 기록물이다. `signalSources`에 신호 소스별 성패(`ok`/`fail`), `signalHits`에 신호가 실제 선정을 좌우한 이슈들(`rank`·`source`·`term`·`cause`)을 남긴다. `signalHits`가 빈 배열이면 "신호 0건 → 기존 기준으로 선정"을 뜻한다. 이 필드가 없으면 리믹스 효과를 사후 판정할 수 없다 — 반드시 쓴다.
- `coverPrompt` — **폐지됨(2026-08-08).** 커버가 없으므로 작성하지 않는다. 그리드 썸네일은 훅 오버레이 프레임(이슈1 이미지 + hookLine)이 자동으로 담당한다.

## 수집

- **WebFetch를 1순위**로 사용한다. 클라우드 샌드박스의 egress 프록시가 Bash curl을 차단하므로(CONNECT 403) curl은 쓰지 않는다.
  - 기사 풀 소스: 구글뉴스 KR RSS `https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko`
  - **관심 신호 소스(2026-08-18 리믹스 업그레이드 — TOP5 선정의 1차 근거)**:
    - 구글 트렌드 KR 급상승 RSS `https://trends.google.co.kr/trending/rss?geo=KR` — 1순위 신호원. 각 item의 `<title>`(검색어)과 `<ht:news_item>`(기사 제목·스니펫·링크)을 모두 읽는다.
    - 네이트 뉴스 랭킹(많이 본 뉴스) `https://news.nate.com/rank/?mid=n1000` — 2순위 신호원. 상위 20위만 본다.
    - **네이버 랭킹뉴스는 쓰지 않는다** — `news.naver.com`·`m.news.naver.com`은 robots 정책으로 WebFetch가 도메인 단위 거부하고(2026-08-18 실측) curl은 프록시가 막는다. 되살리려면 먼저 WebFetch 성공을 실증한 뒤 이 줄을 고친다.
  - **트렌드 기사 직접 편입** — 급상승 검색어의 `<ht:news_item>` 기사는 구글뉴스 RSS에 없더라도 기사 풀에 후보로 추가한다. 이때 news_item의 title/snippet을 각색 없이 `sourceTitle`/`sourceDesc`로 동봉한다(요약 사실성 대조의 기준이 된다).
  - 기사 풀 WebFetch가 실패하면 **WebSearch로 오늘자 국내 주요 뉴스**를 검색해 보완한다. **WebSearch는 기사 풀 보완용이며 인기 신호의 대체물이 아니다** — 관련도 순 결과이므로 대중 관심도의 근거로 쓰지 않는다.
  - 신호 소스가 **일부라도** 실패하면 실패 소스명을 `selection.signalSources`에 기록하고 확보한 신호만으로 진행한다. 신호가 0건인 회차는 기존 기준으로 선정하고 `selection.signalHits: []`로 남긴다.
- `scripts/collect.mjs`는 로컬/Actions 환경용 보조 수집기다(의존성 없이 fetch로 RSS 파싱). 클라우드 루틴은 WebFetch를 우선한다.

## TOP5 선정 기준

- 대중 관심도가 높은 순. "중요한 뉴스"보다 "이미 사람들이 보고 있는 뉴스"를 앞세운다(2026-08-18 리믹스 업그레이드).
- **선정 우선순위 사다리 — 위에서부터 적용하며, 아래 단계가 위 단계를 뒤집지 못한다.**
  1. 광고성·홍보성 기사 제외.
  2. 연예·스포츠 가십, 단순 시황 후순위 — 관심 신호가 아무리 강해도 이 항목은 TOP5에 넣지 않는다(트렌드 급상승은 연예·가십에 편중되기 쉽다 — 실측상 10건 중 6건).
  3. 정치 최대 2건, 카테고리 다양성(AI·과학, 사건, 국제, 경제, 사회 등으로 고르게).
  4. pm 회차는 같은 날 am 5건과 중복 금지 — 신호가 겹쳐도 중복 금지가 우선한다. pm의 신호는 **am 실행 시각 이후 `pubDate`의 트렌드 item**을 우선 보고, 그 창에 신호가 없으면 신호 없이 기존 기준으로 선정하고 `signalHits: []`로 기록한다(같은 사건의 실질적 후속 전개는 허용 — 요약에 "후속" 명시).
  5. **rank 1은 "정지력"이 최우선이다(2026-08-08)** — 스크롤을 멈추게 할 힘. **정지력 판정에서 속보형 — 진행 중인 사건·재난·사고(인명 피해, 긴급 전개, "지금 벌어지는 일") — 을 최우선한다(2026-08-22 훅 수술 3단계).** 근거 실측: 8/17-pm 재난 속보 훅(거제 산사태 사망)만 조회수 232·평균 시청 6.2초로 평시(중앙값 107·2.0초)의 2~3배 — 관측 6주 중 유일한 아웃라이어. 반면 경제지표·정책형 훅은 전부 바닥이었다. 속보형 후보가 없는 회차만 기존 기준으로 뽑는다: 생활 직결(주거·돈·안전·일자리), 충격 수치, 명확한 변화. rank 1이 곧 훅(hookLine 원천)이므로 관심 신호는 정지력이 대등한 후보 사이의 타이브레이커로만 쓴다 — 신호가 있다는 이유로 정지력 낮은 기사를 rank 1에 올리지 않는다.
  6. rank 2~5는 1~4를 통과한 후보 중 **신호가 있는 쪽을 앞세운다.** 편집자적 중요도는 신호가 없을 때의 보조 기준이다.
- **"신호 일치" 판정(모호성 제거)** — 검색어 문자열이 기사에 들어 있다는 것만으로 일치로 보지 않는다. 그 검색어의 `<ht:news_item>` 기사들을 읽고 **급상승의 원인 사건**을 먼저 특정한 뒤, 후보 기사가 그 사건을 다룰 때만 일치다(예: 검색어 "선박"의 원인이 예멘 후티의 사우디 군함 공격이면 국내 조선업 수주 기사는 불일치). 원인 사건을 특정할 수 없으면 신호 없음으로 처리한다. `ht:approx_traffic`(트래픽 크기)은 순위 근거로 쓰지 않는다 — 신호는 있음/없음 이진값이다. 검색어가 라틴문자로만 이루어진 항목은 신호에서 제외한다(geo=KR 피드의 해외 노이즈).
- **선정 기준 변경은 am 회차 실행 전에만 배포한다** — 회차 사이 배포는 그날 am/pm 성과 비교를 오염시킨다.

## 재작성 규칙 (요약·imagePrompt) — 정본: contracts/rewrite/prompt.txt

각 기사의 title·summary·imagePrompt는 반드시 `contracts/rewrite/prompt.txt`를 읽고 그 규칙을 그대로 적용해 작성한다. 이 파일이 재작성 규칙의 정본이며 ratchetlock 계약(동결 기준선·CI check 게이트)으로 회귀 관리된다.

규칙 요지:

- **summary** — 존댓말 2문장·110자 이내. 각 문장이 존댓말 종결어미(습니다/니다/세요/어요/아요/해요/이에요/예요 계열)로 끝난다. **원문(sourceTitle + sourceDesc)에 없는 고유명사·수치·기관명을 요약에 추가하는 것을 절대 금지**한다.
  - `validate.mjs`가 결정론적으로 대조한다: summary+title에 등장하는 ①모든 아라비아 숫자 ②모든 라틴문자 토큰(2자 이상) ③괄호·따옴표 안 한글 토큰이 `sourceTitle+sourceDesc`에 문자열로 존재해야 통과한다. 미존재 시 FAIL.
  - 따라서 요약에 쓸 숫자·영문·인용 표현은 반드시 원문에 있는 것만 쓴다. 불확실하면 그 표현을 빼고 일반화한다.
- `sourceTitle`/`sourceDesc`는 반드시 **원문 그대로** 동봉한다(각색·요약 금지). 이것이 사실성 대조의 기준이다.
- **imagePrompt** — 영문 전용(한글 금지), photojournalism·documentary 스타일, `no people`·`no text` 필수, 실존 인물 묘사 금지(상징 사물·장면으로), `vertical 9:16 composition`, 500자 이내.

**규칙을 바꾸려면 prompt.txt를 수정한다 — push 시 contract-check 워크플로가 게이트한다. freeze 없이 프로브·프롬프트만 바꾸면 check가 드리프트로 반려할 수 있다.**

## caption 규칙

브랜드: **물어오리 (@muleori.news)** — "매일 아침 국내 뉴스 5개를 물어오는" 오리 계정. 기존 @todays.ai.brief(오리 기자)의 자매 계정.

- 첫 줄: 회차에 따라 `[물어오리] YYYY-MM-DD 아침 브리핑`(am) / `[물어오리] YYYY-MM-DD 저녁 브리핑`(pm). slot이 없으면 `[물어오리] YYYY-MM-DD 오늘의 뉴스 TOP 5`.
- 이슈 제목 목록(번호 매김).
- 마무리 한 줄: `내일 아침에도 물어오겠습니다 🦆` (또는 같은 톤의 변형).
- 해시태그: `#뉴스 #오늘의뉴스 #뉴스요약 #시사 #이슈 #물어오리` 등 (자유롭게 추가 가능).
- **CC-BY 표기 필수**: `Music: Kevin MacLeod (incompetech.com), CC BY 4.0`.
- **http 링크 금지** — 원문 링크는 캡션에 넣지 않는다(사실 검수용 링크는 Telegram 미리보기로만 전달).

## 실패 처리

- 수집 실패한 소스는 명시한다.
- `validate.mjs`가 FAIL하면 Actions가 게시를 중단하고 Telegram으로 실패 알림을 보낸다(운영자가 데이터를 고쳐 재푸시).
