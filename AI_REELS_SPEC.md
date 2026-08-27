# AI 릴스 스펙 (AI_REELS_SPEC) — 오리 기자 계정

클라우드 루틴 에이전트는 매 실행 시 이 파일을 읽고 그대로 따른다.
이 파일을 수정하면 다음 실행부터 반영된다 (루틴 자체를 수정할 필요 없음).

**이 문서는 오리 기자(`@todays.ai.brief`) 계정의 AI 뉴스 릴스 전용이다.**
물어오리(국내 종합 뉴스) 회차는 `REELS_SPEC.md`를 따른다. 두 트랙은 파이프라인(검증·렌더·발행)을 공유하고
데이터의 `account` 필드로만 갈린다. 아래는 **물어오리와 다른 점**을 중심으로 쓴다.

## 산출물

- 파일: `data/ai-YYYY-MM-DD.json` — 날짜는 반드시 `TZ=Asia/Seoul date +%F`로 구한다 (UTC 날짜 사용 금지).
  - **하루 1회, 낮 12시께 발행한다. `slot` 필드는 쓰지 않는다**(아침/저녁 2회인 물어오리와 다르다).
  - 파일명 stem(`ai-2026-08-19`)이 곧 산출물 키다: `assets/img/<stem>/`, `docs/videos/<stem>.mp4`,
    `containers/<stem>`, `published/<stem>`, `docs/arms/ai/<stem>.txt`.
  - 데이터 안 `date` 필드는 그대로 `YYYY-MM-DD`를 쓴다(파일명의 `ai-` 접두는 붙이지 않는다).
- **`"account": "aibrief"` 필수.** 이 필드가 없거나 파일명이 `ai-` 접두가 아니면 `validate.mjs`가 FAIL한다
  (계정-파일명 정합 게이트 — 잘못된 계정으로 게시되는 사고를 막는다).
- 언어: 한국어 (요약·훅·나레이션).
- **이미지를 쓰지 않는다(무료 버전 — 사진 대신 키 스탯 타이포 지면).** 데이터에 `imagePrompt` 필드를 넣지 않는다.
  `genimages.mjs`는 `account: "aibrief"`를 보면 이미지 생성을 스킵하고, `render.mjs`도 이미지 게이트 없이
  `noPhotos: true`로 렌더한다.
- 완료 후: `git add data/ai-YYYY-MM-DD.json` → commit (`ai reels: YYYY-MM-DD`) → push.
- **ai 데이터 파일은 반드시 단독 커밋한다.** 다른 `data/*.json`(물어오리 회차 등)과 같은 커밋에 넣지 않는다 —
  빌드의 스템 결정이 변경된 data 파일 중 **첫 파일 하나만** 잡으므로, 같이 커밋하면 한쪽 회차가 통째로 누락된다.
- push하면 GitHub Actions(`reels.yml`)가 검증→이미지→렌더→음악→Telegram 미리보기까지 이어받고,
  `PUBLISH_LIVE_AIBRIEF=1`이면 자동 발행까지 진행한다(AI 전용 킬스위치 — 물어오리의 `PUBLISH_LIVE`와 별개).

## 데이터 계약 (전체)

```json
{
  "date": "2026-08-19",
  "account": "aibrief",
  "hookLine": "0초 훅 한 문장 (존댓말, 30자 이내). rank 1 이슈의 결론을 구어체로.",
  "issues": [
    {
      "rank": 1,
      "category": "AI 모델",
      "kicker": "무료 개방",
      "title": "제목 (32자 이내)",
      "summary": "존댓말 2문장, 110자 이내. 원문에 없는 고유명사·수치 추가 금지.",
      "narration": "구어체 존댓말 한 문장 (25자 안팎, 30자 하드 상한). rank 2 이상 필수.",
      "sourceTitle": "원문 기사 제목 (원문 그대로 동봉)",
      "sourceDesc": "RSS description 원문 (원문 그대로 동봉)",
      "sourceLink": "https://news.google.com/search?q=..."
    }
  ],
  "caption": "인스타 캡션 (이슈 제목 목록 + 해시태그 + CC-BY 표기). http 링크 금지.",
  "selection": { "spec": "ai-v1", "signalSources": {}, "signalHits": [] }
}
```

물어오리 계약과 **같은 것**(전부 `scripts/validate.mjs`가 동일 게이트로 강제):
`date`, `hookLine`(30자·존댓말·rank1 원문 대조), `issues` 4~6개·rank 연속, `title` 32자,
`summary` 110자·2문장·존댓말·사실성, `narration` 30자·1문장·존댓말·해당 이슈 원문 대조,
`sourceTitle`/`sourceDesc` 원문 그대로,
`caption` 2200자·http 금지·음악 크레딧 필수.

**다른 것**:

- `account` — **필수. `"aibrief"`.**
- `slot` — 쓰지 않는다(1일 1회).
- `imagePrompt` — **쓰지 않는다.** 오리 기자는 사진 없는 무료 버전이라 이미지를 생성하지 않는다
  (`validate.mjs`도 aibrief에 한해 이 필드를 선택 항목으로 취급한다).
- `selection` — `{"spec": "ai-v1", "signalSources": {}, "signalHits": []}`로 고정한다.
  AI 트랙은 v1에서 관심 신호 소스(트렌드·네이트)를 쓰지 않는다. `spec`이 `ai-v1`이므로 물어오리의
  리믹스 표본(`remix-v1`)과 사후 집계에서 구분된다.

## 수집

- **WebFetch를 1순위**로 사용한다. 클라우드 샌드박스의 egress 프록시가 Bash curl을 차단하므로(CONNECT 403) curl은 쓰지 않는다.
  - **1순위 — 구글뉴스 AI 검색 RSS**:
    `https://news.google.com/rss/search?q=AI%20OR%20%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5&hl=ko&gl=KR&ceid=KR:ko`
  - **보완 — 테크 일반 쿼리**: 같은 검색 RSS의 `q`를 테크 일반 키워드(반도체·빅테크·클라우드·로봇 등)로 바꿔
    후보 풀을 넓힌다. AI 기사만으로 5건이 안 되거나 카테고리가 한쪽에 쏠릴 때 쓴다.
  - RSS WebFetch가 실패하면 **WebSearch로 오늘자 AI·테크 주요 뉴스**를 검색해 보완한다.
- 관심 신호 소스(구글 트렌드·네이트 랭킹)는 v1에서 쓰지 않는다 — `selection.signalSources`는 빈 객체로 남긴다.

## TOP5 선정 기준

- **AI·테크로 한정**한다. 일반 정치·사회 뉴스는 AI·테크와의 직접 연결(규제·산업 영향 등)이 없으면 넣지 않는다.
- **일반 대중 관심 기준.** 개발자 전용 뉴스(라이브러리 릴리스, 벤치마크 소수점 갱신, 프레임워크 API 변경)는
  넣지 않는다. "IT를 잘 모르는 사람도 왜 중요한지 한 문장으로 이해되는" 기사만 고른다.
- 선정 우선순위 사다리 — 위에서부터 적용하며, 아래 단계가 위 단계를 뒤집지 못한다.
  1. 광고성·홍보성 기사 제외(제품 출시 보도자료 그대로 옮긴 기사 포함).
  2. 단순 주가·시황, 루머·미확인 유출 후순위.
  3. 카테고리 다양성: AI 모델·서비스 / 빅테크 사업 / 규제·정책 / 반도체·인프라 / 사회 영향(일자리·교육·범죄) 등으로 고르게.
     한 회사 뉴스가 3건 이상 되지 않게 한다.
  4. **rank 1은 "정지력"이 최우선이다** — 스크롤을 멈추게 할 힘: 생활 직결(일자리·요금·안전), 충격 수치, 명확한 변화.
     rank 1이 곧 훅(hookLine 원천)이다.
  5. rank 2~5는 1~4를 통과한 후보 중 파급력·신선도가 큰 순.

## 재작성 규칙 (요약) — 정본: contracts/rewrite/prompt.txt

각 기사의 title·summary는 반드시 `contracts/rewrite/prompt.txt`를 읽고 그 규칙을 그대로 적용해 작성한다.
(이미지를 쓰지 않으므로 imagePrompt 관련 지시는 적용하지 않는다.)
hookLine은 `contracts/hook/prompt.txt`가 정본이다. **두 정본은 물어오리와 공유한다**(ratchetlock 계약으로 회귀 관리).
AI 트랙 전용 프롬프트를 따로 만들지 않는다.

AI 트랙 추가 조항:

- **라틴 표기는 원문 표기를 그대로 따른다.** 원문이 "인공지능"이면 요약도 "인공지능", 원문이 "OpenAI"면 그대로 "OpenAI"로 쓴다.
  원문에 없는 영문 표기를 만들어 넣지 않는다(예: 원문이 "구글"인데 요약에 "Google"을 쓰면 사실성 게이트가 FAIL한다 —
  `validate.mjs`는 라틴 토큰을 원문 문자열과 대조한다).
- **사실성 게이트는 물어오리와 공유하며 AI 트랙 사정으로 완화하지 않는다.** 영문 제품명·모델명·수치가 많은 분야지만,
  원문(sourceTitle + sourceDesc)에 없는 고유명사·버전·수치는 절대 쓰지 않는다. 불확실하면 그 표현을 빼고 일반화한다.
- `narration`은 rank 2 이상 필수, **25자 안팎으로 짧게** 쓴다(30자는 하드 상한 — 붙여 쓰면 반려된다).
  rank 1은 hookLine이 낭독을 겸하므로 생략한다. 화면 자막(`title`·`summary`) 문구를 그대로 복사하지 말고 말로 풀어 쓴다.
- **오리 기자 회차는 항상 TTS 나레이션 팔이다**(물어오리의 A/B 짝홀 배정·`TTS_ENABLED` 킬스위치와 무관).
  그러니 narration이 없으면 대조군으로 폴백되어 낭독 없는 영상이 나간다 — 반드시 쓴다.

## caption 규칙

브랜드: **오리 기자 (@todays.ai.brief)** — "매일 AI 뉴스를 물어오는" 오리 계정. @muleori.news(물어오리)의 자매 계정.

- 첫 줄: `[오리 기자] YYYY-MM-DD AI 뉴스 브리핑`
- 이슈 제목 목록(번호 매김).
- 마무리 한 줄: `내일도 AI 뉴스 물어오겠습니다 🦆` (또는 같은 톤의 변형).
- 해시태그: `#AI #인공지능 #테크뉴스 #IT뉴스 #오리기자` 등 (자유롭게 추가 가능).
- **CC-BY 표기 필수**: `Music: Kevin MacLeod (incompetech.com), CC BY 4.0`.
- **http 링크 금지** — 원문 링크는 캡션에 넣지 않는다(사실 검수용 링크는 Telegram 미리보기로만 전달).

## 실패 처리

- 수집 실패한 소스는 명시한다.
- **push 전 자가검증(필수)**: 데이터 파일을 작성한 뒤 반드시 `node scripts/validate.mjs data/<stem>.json`을 직접 실행해 `validate: PASS`를 확인한 뒤에만 push한다. FAIL이면 출력된 위반 항목을 고치고 재실행한다 — 사실성 위반(숫자·라틴 토큰 원문에 없음)은 해당 표현을 원문에 있는 표현으로 바꾸거나 빼고 일반화, 길이 위반은 축약. PASS 전에는 절대 push하지 않는다.
  5회 수정에도 같은 이슈가 계속 FAIL이면 그 이슈를 후보 풀의 다음 기사로 교체해 재작성한다.
  (근거: 2026-08-26~27 사실성·길이 위반 데이터가 그대로 push돼 3회차(2026-08-26-am, ai-2026-08-26, ai-2026-08-27) 결방 — Actions 게이트는 반려만 할 뿐 고치지 못하므로 생성 측에서 PASS를 보장해야 한다.)
- `validate.mjs`가 FAIL하면 Actions가 게시를 중단하고 Telegram으로 실패 알림을 보낸다(운영자가 데이터를 고쳐 재푸시). (최후 안전망 — 여기 도달하면 자가검증을 안 한 것이다.)
- 발행 감시: watchdog가 13:30 KST에 `published/ai-YYYY-MM-DD` 마커를 점검한다.
  `PUBLISH_LIVE_AIBRIEF=1`일 때만 감시하므로, 라이브 전에는 경보가 오지 않는다.
