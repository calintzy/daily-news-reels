# 오리 기자 릴스 안전 영역·표지·숫자 위젯 수정 (2026-10-05)

개정 3 — critic 1차(필수 9건)와 2차(필수 2건: 키 스탯 패턴 순서, Anti-ISC의 작업 트리 비교) 반영.

## Intent
- 문제: 오리 기자(aibrief) 릴스가 인스타그램에서 글자가 잘려 보이고 품질이 낮다(10/5 Ryan 지적, 프로필 그리드 스크린샷으로 재현). 원본 mp4 안에서는 글자가 캔버스를 넘지 않는다. 핵심 글자가 인스타그램이 자르거나 UI로 덮는 가장자리에 배치돼 있다.
- 기대 결과: 그리드·피드 크롭과 릴스 화면 UI에서 훅·제목·핵심 수치·본문이 잘리지 않고 서로 겹치지 않으며, "오늘의 숫자"에 잘린 단어·날짜·틀린 숫자가 들어가지 않는다.
- 영향 범위: `reels/src/CardNewsReel.jsx`(오리 기자 전용 컴포지션), 신규 `reels/src/keyStat.js`, 신규 검사 스크립트·픽스처, `contract-check.yml`의 layout 잡.
- 제약: 물어오리는 single-issue-v1 실험 중이라 출력이 바뀌면 안 된다. 영상 길이·타이밍·TTS 구간은 그대로 둔다. 화면 글자량 축소는 콘텐츠 변수라 이번 범위가 아니다.
- 미정 질문: 릴스 화면 하단·우측 UI가 덮는 정확한 범위는 휴대폰 캡처로 확인하지 못했다. 보수적 기준(CORE)을 쓴다.

## 근거 (실측)
- 그리드 스크린샷: 표지(`thumb_offset` 900ms = 훅 오버레이 27프레임)의 훅 글자가 타일 상단 경계에 걸려 잘리고, 타일의 약 75%가 빈 검은 면이다.
- 중앙 크롭(1080x1920 기준): 3:4는 y 240~1680, 4:5는 y 285~1635, 1:1은 y 420~1500만 남긴다.
- 현재 배치: 훅 `top: 220`, 배지 `top: 92`, 제목 `top: 176`, 키 스탯 `top: 486`, 풀쿼트 `top: 860`~`bottom: 400`, 말풍선 `bottom: 250`, 도장 `bottom: 96`·`right: 60`. 말풍선 17px, 키 스탯 라벨 15px, 킥커 16px.
- 훅 오버레이는 `spring` 진입이라 0프레임에서 글자 불투명도가 0이다.
- `extractKeyStat` 4번 패턴이 "제미나이 4 아르곤"에서 "4 아르"를 뽑고, 날짜("10월", "2027년")도 뽑는다.
- 실데이터 길이(aibrief 46회차 230건, critic 실측): 제목 최대 32자·중앙값 25자, 요약 최대 120자·중앙값 97자, kicker 최대 14자(길이 게이트 없음).

## 설계 결정

### 영역
- CORE: x 72~1008, y 290~1250. 훅 문장, 배지·킥커, 카드 제목, 키 스탯, 풀쿼트.
- SECONDARY: x 72~1008, y 290~1500. 오리 말풍선, 도장.
- 장식(마스트헤드, 하단 서명 바, 배경 순번, 테두리, 도장 안의 "확인" 글자)은 영역·글자 크기 규칙에서 제외한다.
- 판정 여유: 영역 경계에 12px.
  - 구현(critic 2차 선택 반영): 여유는 영역 안쪽 방향이다. 글자 rect는 영역 경계에서 12px 안쪽(CORE x 84~996·y 302~1238, SECONDARY y ~1488)까지만 통과한다.
  - 코드 리뷰 반영: 배치 상자는 판정 한계보다 4px 더 안쪽(경계에서 16px)에 둔다. CI 리눅스 폰트의 1~2px 차이에 대비한 것이다. CORE 스택은 `top: 306; left/right: 88; height: 928`이고 말풍선은 `left/right: 88`이다. ai-layout-max 실측 최소 여유는 4px다.

### 카드(noPhotos) 크기 예산
CORE 스택을 flex column(`top: 290; left: 72; right: 72; height: 960; gap: 24`)으로 바꾼다. 절대 top 값을 쓰지 않으므로 제목 줄 수가 달라져도 아래 요소와 겹치지 않는다.
- 배지 행: 높이 56. 랭크 숫자와 kicker 글자 28px. (구현 조정: kicker 스티커 패딩 `6px 18px`, lineHeight 1.2로 높이 56 안에 맞춤)
- 제목: 20자 이하 68px, 21~26자 62px, 27~32자 56px. lineHeight 1.12, 최대 3줄(높이 208 이하).
- 키 스탯: 라벨 28px. 값은 3자 이하 150px, 5자 이하 130px, 7자 이하 108px, 그보다 길면 76px(2줄까지). 블록 높이 194 이하.
  - probe 조정(2026-10-05): 값 lineHeight 1 → 1.3, 라벨-값 간격 6 → 12. Noto Serif KR의 글리프 영역이 약 1.44em이라 lineHeight 1이면 값의 Range rect가 라벨과 최대 33px 겹쳤다. 블록 높이는 150px 값 기준 약 250(실측 rect 519~769)으로 늘었고, ai-layout-max에서도 스택 960 안에 들어간다(풀쿼트 하단 최대 1188).
- 풀쿼트: 스택의 남은 공간. 100자 초과 40px, 71~100자 44px, 70자 이하 50px. lineHeight 1.42, 좌우 패딩 0.
- 말풍선(SECONDARY): 28px 한 줄, y 1270~1350 부근. (구현: `top: 1262`, 패딩 `12px 22px`, lineHeight 1.3. 도장과 간격을 두려고 1270에서 올렸다)
- 도장(SECONDARY): `right`는 96 이상. 회전과 스프링 오버슈트를 포함해 x 1008을 넘지 않는다. (구현: `right: 100; top: 1344`, 128px 유지. 정지 상태 판정 한계까지 여유 7px. 스프링 오버슈트 계산값 최대 약 1.16배 → x 약 1001)
- 위 수치는 출발값이다. probe 실측으로 영역을 넘으면 같은 규칙(길이 구간별 축소) 안에서 조정하고, 조정한 값을 이 문서에 반영한다.

### 훅 오버레이(표지)
- `left/right: 72`. 훅 블록의 세로 중심은 CORE와 1:1 크롭의 교집합(y 420~1250)의 중심인 835다.
- 0프레임부터 불투명도 1(이동 스프링은 유지하되 0프레임 위치가 영역 안이어야 한다). `thumb_offset`이 거부돼 인스타그램이 다른 프레임을 표지로 쓰는 경우에도 대비한다.
- 훅 위에 오리 로고와 계정명 한 줄(28px 이상). `HookOverlay`에 `brand` prop을 추가한다.
- 보조 문구("오리 기자가 오늘 가장 먼저 물어온 소식")는 훅 블록 바로 아래, 28px 이상.
- 구현: 브랜드 줄(로고 64px + 이름 30px)·훅(78px)·보조 문구(30px)를 `top: 436; height: 798`(1:1 크롭 교집합의 16px 안쪽, 중심 835) 컬럼에 세로 중앙 정렬(간격 32), 이동 스프링은 컬럼 전체에 건다(훅만 움직이면 0프레임에 보조 문구와 겹친다). 실측 27f 블록 y 658~1012, 0f는 +50.

### 아웃트로
범위에 포함한다. 콘텐츠 블록(로고·문구·팔로우 버튼·핸들)을 CORE 안으로 옮기고 eyebrow와 handle을 28px 이상으로 키운다. (구현: CORE 상자에 세로 중앙 정렬, 팔로우 버튼도 26 → 28px. 실측 y 465~1069)

### 사진 모드(noPhotos=false)
프로덕션에서 쓰지 않는 경로다. 카드 요소의 새 배치는 `noPhotos`일 때만 적용하고, 사진 모드의 카드 배치는 기존 값을 유지한다. 훅 오버레이와 아웃트로는 두 모드가 공유하므로 함께 바뀐다(`:962` 주석을 그에 맞게 고친다).

### 키 스탯(`reels/src/keyStat.js`, 순수 함수)
정밀도를 재현율보다 우선한다. 확신이 없으면 kicker로 폴백한다.
- 반환값: `{text, isStat}`. 라벨은 `isStat`으로 정한다(kicker에 숫자가 있어도 "오늘의 키워드").
- 수사: `(?<![\d.,A-Za-z\-])\d{1,3}(?:,\d{3})*(?:\.\d+)?|(?<![\d.,A-Za-z\-])\d+(?:\.\d+)?` 뒤에 `(?:(?:조|억|만)\s*\d+)*` 허용("26만8000").
  - 코드 리뷰 반영: 공백 뒤 숫자는 그 뒤에 다시 조·억·만이 올 때만 잇는다(`(?:조|억|만)(?:\d+|\s+\d+(?=조|억|만))`). "3조 5000억"·"26만8000"은 유지하고 "100만 2주"·"1조 3개"는 붙이지 않는다. 수사 앞 제외 글자에 "제"를 더했다("제3회").
- 패턴 우선순위(위에서부터, 같은 패턴 안에서는 title 먼저, 그다음 summary의 첫 등장):
  1. 퍼센트: 수사 + `%`(+`p` 허용).
  2. 수량 복합: 수사 + `(조|억|만)\s*(명|건|개|대|토큰)`. 금액 패턴보다 먼저 시도한다("100만 토큰"이 "100만"으로 잘리지 않게).
  3. 금액·복합: 수사 + `(조|억|만)` + 선택적 `\s*(원|달러|유로|위안|엔)`.
  4. 배수: 수사 + `배`.
  5. 기간: 수사 + `(개월|시간|주)`, 1~2자리 수사 + `년`, 수사 + `일`은 뒤에 `만에|간|동안|연장|이내`가 올 때만. 코드 리뷰 반영: "간"은 붙여 쓰고 뒤에 경계가 올 때만 받는다("20일간"은 받고 "15일 간담회"는 뺀다).
  6. 수량 단일: 수사 + `(명|건|개|곳|종|회|달러|원)`. 숫자와 단위 사이 공백 없음. 코드 리뷰 반영: 정밀도 우선으로 `위`("1위")와 `대`("3대 분야")를 뺐다. "20만대" 같은 수량 복합(2번)은 유지한다.
- 뒤쪽 경계: 4~6번은 매치 뒤가 문자열 끝, 공백, 구두점, 조사(로·를·을·이·가·은·는·의·에·와·과·도·만·씩)일 때만 받는다("31개국", "5개사", "Opus 5 대비" 제외).
  - 구현 조정(critic 2차 선택 반영 포함): 뒤쪽 경계를 패턴 1~6 전체에 건다("2조각" 제외). 조사에 "으로"·"부터"·"까지"를 더했다("100만 토큰으로", "329만원부터"). 3번(금액)은 뒤에 숫자·수량 단위가 이어지면 받지 않는다("26만8000개"가 "26만"으로 잘리는 것 방지). 수사 앞 글자 제외에 `~`(범위 표기)와 `조·억·만`(+공백 1개, "1조 5000억"의 "5000억")을 더했다. 동결 사례에 "300만 명" → `300만 명`, "2조각" → kicker를 추가했다.
- 제외: 4자리 수사 + `년`(연도), 수사 + `월`, `N월 N일`의 일, 범위 표기("23~24일").
- 추출값은 반드시 title 또는 summary의 연속 부분 문자열이다(값을 만들지 않는다).

### 검증 방식
- 대상 요소에 `data-zone="core|secondary"`와 `data-el="hook|hook-sub|hook-brand|rank|kicker|title|stat-label|stat|quote|duck|stamp|outro-*"`를 단다. `data-zone`은 높이가 고정된 컨테이너가 아니라 텍스트 요소에 붙인다.
- `layoutProbe` prop이 true일 때만 probe가 동작한다. probe는 자체 `delayRender`를 걸고 `document.fonts.ready`와 rAF 2회를 기다린 뒤 측정하고 `continueRender`한다.
- 측정 항목(요소별): `Range.selectNodeContents(el).getBoundingClientRect()`, `scrollHeight > clientHeight` 여부, computed font-size, 조상까지 곱한 실효 opacity. 로그는 `'LAYOUT ' + JSON.stringify({frame, fontsOk, els:[…]})` 문자열 한 줄. `fontsOk`는 `document.fonts.check('900 40px "Noto Serif KR"')`.
  - 구현 조정: 넘침은 `el.offsetHeight > 부모 clientHeight` 또는 `scrollWidth > clientWidth`로 잰다. `scrollHeight > clientHeight`는 lineHeight가 1.44em보다 좁은 세리프 글자(제목·수치·아웃트로 문구)에서 넘침이 없어도 항상 참이었다(probe 실측). 넘침은 stdout의 `zones` 줄에 합쳐 보고한다.
  - `layout-cli.mjs`는 brand를 render.mjs의 aibrief 값과 같게 명시한다. 생략하면 Root.jsx defaultProps의 물어오리 브랜드가 채워진다.
  - 글자 크기 규칙에서 `stamp`("확인")와 `outro-logo`(이미지)는 제외한다.
  - 코드 리뷰 반영: `fontsOk`는 data-el 요소들의 textContent 합을 `document.fonts.check`의 text 인자로 넘겨 한글 글리프 조각까지 확인한다. 측정은 try/catch/finally로 감싸 실패하면 `LAYOUT_ERROR` 줄을 남기고 finally에서 `continueRender`한다. layout-check는 `LAYOUT_ERROR` 줄과 JSON 파싱 실패를 `required: FAIL`로 처리한다.
  - 영역·표지 범위·판정 여유 값은 `reels/src/safeArea.js` 하나에 두고 CardNewsReel.jsx와 layout-check.mjs가 함께 import한다.
- 판정 규칙: 실효 opacity 0.05 미만 요소는 영역·겹침 판정에서 제외. `fontsOk`가 false면 FAIL. 프레임별 필수 요소가 없으면 FAIL. 넘침이면 FAIL. 보이는 CORE 요소끼리 rect가 교차하면 FAIL.
- 검사 프레임: 0(훅 가시성), 27(표지, 훅 박스는 y 420~1250 안), 이슈별 `i*159 + 140`, 아웃트로 `outroStart + 40`.
- 렌더 부분은 `reels/layout-cli.mjs`(Remotion import 가능 위치)에 두고, `scripts/layout-check.mjs`는 그것을 `cwd: reels`로 spawn해 판정만 한다. stdout 형식은 첫 줄 `PASS` 또는 `FAIL`, 이어서 `fonts: …`, `frame0: …`, `cover: …`, `zones: …`, `overlap: …`, `font-size: …`, `required: …` 줄. 상세는 로그 파일.
- 육안 확인용으로 `--stills <dir>` 옵션을 주면 검사 프레임의 스틸을 저장한다.

## 단계
1. `reels/src/keyStat.js` + `reels/src/keyStat.test.mjs`.
2. `CardNewsReel.jsx` 레이아웃·글자 크기·`data-*`·probe.
3. `reels/layout-cli.mjs`, `scripts/layout-check.mjs`.
4. 픽스처: `test/fixtures/ai-layout-max.json`(hookLine 30자, 이슈 5개. 이슈별로 32자 제목+120자 요약, kicker 14자에 수치 없는 이슈, 3자 스탯 이슈, 긴 어절 제목으로 3줄이 되는 이슈를 나눠 넣는다), `test/fixtures/ai-layout-overflow.json`(제목 48자, 요약 200자. 반드시 FAIL).
5. `contract-check.yml`에 layout 잡: `cd reels && npm ci`, `sudo apt-get install -y fonts-noto-cjk`, keyStat 테스트, layout-check 2건 + 음성 대조군, 실패 시 기존 잡과 같은 텔레그램 알림. paths에 `reels/src/**`, `reels/layout-cli.mjs`, `reels/package-lock.json`, `scripts/layout-check.mjs`, `test/fixtures/ai-layout-*.json`, `test/fixtures/ai-2099-01-01.json`.
6. 로컬 스틸로 표지·카드·아웃트로 육안 확인.

## Criteria
기준 SHA: `e221101`(작업 시작 시점의 main).
- ISC-1.1: `node scripts/layout-check.mjs test/fixtures/ai-2099-01-01.json` → 첫 줄 `PASS`, exit 0.
- ISC-1.2: `node scripts/layout-check.mjs test/fixtures/ai-layout-max.json` → 첫 줄 `PASS`, exit 0.
- ISC-1.3(음성 대조군, 비교기): `… ai-2099-01-01.json --core-bottom 700` → 첫 줄 `FAIL`, exit 1.
- ISC-1.4: ISC-1.1 출력에 `cover: PASS`(27f 훅 박스가 y 420~1250 안).
- ISC-1.5: ISC-1.1 출력에 `frame0: PASS`(0f 훅 글자의 실효 opacity ≥ 0.95, 영역 안).
- ISC-1.6: ISC-1.1·1.2 출력에 `overlap: PASS`.
- ISC-1.7(음성 대조군, 실제 넘침): `… ai-layout-overflow.json` → 첫 줄 `FAIL`, exit 1.
- ISC-1.8(음성 대조군, 필수 요소): `… ai-2099-01-01.json --require-el nonexistent` → `required: FAIL`, exit 1.
- ISC-2.1: `node --test reels/src/keyStat.test.mjs` → pass. 입력은 `{title, summary, kicker}` 전체, 기대값은 결정적이다. 동결 사례:
  - 10/02 이슈1(제목 "구글, '제미나이 4 아르곤' 공개", 요약에 "100만 토큰") → `100만 토큰`, isStat true.
  - 제목 "구글, '제미나이 4 아르곤' 공개", 요약에 수치 없음 → kicker, isStat false.
  - "애플 'Siri AI' 한국어 지원 10월 시작"(요약에 다른 수치 없음) → kicker.
  - "2027년 초 위성 2기를 발사" → kicker.
  - "44.6% 급증" → `44.6%`. "오픈AI에 27조 투자" → `27조`. "심사 기간을 45일 연장" → `45일`. "9개월 만에" → `9개월`.
  - "100억달러" → `100억달러`. "2000억 위안" → `2000억 위안`. "128,536명" → `128,536명`. "26만8000개" → `26만8000개`.
  - "Opus 5 대비" → kicker. "새 법령이 15일 발효" → kicker. "9월 23~24일" → kicker. "31개국" → kicker. "10월 2일부터" → kicker.
  - kicker "1M 토큰 출력" 폴백 → isStat false.
  - critic 2차·코드 리뷰 추가분: "300만 명" → `300만 명`. "2조각" → kicker. "과기정통부는 15일 간담회를 열고" → kicker. "20일간 진행" → `20일`. "가입자 100만 2주 만에 돌파" → kicker. "투자 1조 3개 기업에 집행" → kicker. "벤치마크에서 1위를 주장" → kicker. "3대 분야" → kicker. "제3회" → kicker.
- ISC-2.2(음성 대조군): 같은 사례 표를 수정 전 `extractKeyStat` 로직(테스트 파일 안에 고정)에 돌리면 3건 이상 실패한다는 것을 테스트로 단언한다.
- ISC-2.3: `data/ai-*.json` 전 이슈에 새 추출기를 돌려, isStat true인 모든 값이 title 또는 summary의 부분 문자열이고 앞 글자가 `[\d.,A-Za-z\-만억조]`가 아니라는 것을 스크립트(테스트 안)로 단언한다.
- ISC-3.1: ISC-1.1·1.2 출력에 `font-size: PASS`(data-zone 글자 28px 이상).
- ISC-3.2(음성 대조군): `… ai-2099-01-01.json --min-font 200` → `font-size: FAIL`, exit 1.
- Anti-ISC-1(커밋 전후 모두 유효하도록 작업 트리와 비교): `git diff --stat e221101 -- reels/src/SingleIssueReel.jsx reels/src/HotIssueReelPhoto.jsx reels/src/timing.js reels/src/nowrapNumbers.jsx reels/src/Root.jsx reels/src/singleFormat.js reels/src/defaultProps.js reels/package.json reels/package-lock.json scripts/render.mjs scripts/publish.mjs` → 출력 없음.
- Anti-ISC-2: `layoutProbe` 없이 0프레임 스틸을 렌더했을 때 브라우저 로그의 `LAYOUT` 줄 0건(`node reels/layout-cli.mjs … --no-probe`의 출력 `layout-lines: 0`).
- Anti-ISC-3: `git diff e221101 -- reels/src/timing.js` 출력 없음(Anti-ISC-1에 포함)이고, 수정 후 fixture 렌더의 총 프레임이 `159*5+45 = 840`.

## 롤백
머지 커밋 revert. 데이터·스펙·워크플로 변수 변경이 없어 다른 조치는 필요 없다.
