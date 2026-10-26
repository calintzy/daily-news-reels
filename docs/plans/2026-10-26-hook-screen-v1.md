# 물어오리 훅+화면 묶음 실험 hook-screen-v1 (2026-10-26)

개정 1 — critic 1차 APPROVE WITH CHANGES(MAJOR 4건 M1~M4, MINOR 10건) 반영. 초안 대비 ISC ID는 유지했고 바뀐 ISC는 같은 ID로 내용을 교체했으며 새 ISC는 뒤 번호로 붙였다.
개정 2 — critic 2차 APPROVE WITH CHANGES(MAJOR N1: 롤백 뒤 hookFrame 잔존 발행, MINOR 5건) 반영. ISC ID 유지, 새 ISC는 ISC-3.21·3.22·5.13.

## Intent
- 문제: 물어오리 digest의 0~1.8초는 hookLine이 0.5~0.84 어두운 막 위에 뜨고 0프레임에는 글자 불투명도가 0이다. 10/25-am부터 켜진 action-hook-v1-digest는 REELS_SPEC 분기가 없어 3회차 전부 `docs/hooks=v2`로 표본에서 빠지고 있다.
- 기대 결과: 행동 번역 훅(첫 문장)과 0~5.3초 화면 개편(이미지 노출·상단 2줄 헤드라인·구절 자막·초점 확대)이 같은 회차에 동시에 켜지고, 판정기가 이 묶음을 사전등록 임계값으로 판정한다.
- 영향 범위: 물어오리 digest 이슈1 슬라이드(새 컴포지션), render.mjs·flags.mjs·reels.yml·layout-cli/check·새 픽셀 프로브·contract-check·health·experiment(재빌드 감지 한 줄, self-test 하네스 `buildCaseRoot`), contracts/hook-muleori-action, REELS_SPEC hookLine 분기, experiments/*.
- 제약: 준비될 때까지 현재 영상이 그대로 나간다. 오리 기자 계정·single 포맷·사실성 게이트(validate·rewrite·hook v2 계약)는 바꾸지 않는다. 가상 인물 진행자는 범위 밖이다.
- 미정 질문: TTS 재가동, 헤드라인 문구 출처, 실사형 생성 사진의 무막 확대 노출, 초점 표시 방식, 적용 범위, state 수동 수정 예외, inconclusive 처리(문서 끝 "Ryan 확인 필요"), AI 표기 가림 여부와 로컬·CI 폰트 차이("미결" 절).

## Context

### Ryan 결정 (10/26, A안)
- 행동 번역 훅과 0~4초 화면 개편을 같은 영상에 넣어 한 실험으로 판정한다. "한 번에 한 변수" 규칙을 알고 뒤집었다. 판정 결과는 묶음 전체에 대한 것이고 두 처치의 효과를 나눌 수 없다.
- 두 처치가 모두 준비된 날 동시에 켠다. 그 전에는 현재 영상이 그대로 나간다.

### 코드 확인: digest가 쓰는 컴포지션과 0~4초 화면 (main `1e5139d`)
- 컴포지션 선택: `scripts/render.mjs:244-249`. single이면 `SingleIssueReel`, aibrief면 `CardNewsReel`, 그 외(물어오리 digest)는 `HotIssueReelPhoto`다. 포맷은 `resolveFormat`(`render.mjs:85-97`)이 `REEL_FORMAT_MULEORI`로 정하고 flags.json의 현재 값 `""`이라 digest다.
- 길이: 이슈당 159f(5.3초) × 5 + 아웃트로 45f = 28초(`reels/src/timing.js:4-12`). 이슈1 슬라이드는 0~158f, 아웃트로는 795f부터다.
- 0~1.8초(0~54f): `HookOverlay`(`reels/src/HotIssueReelPhoto.jsx:97-144`, 482-484행에서 렌더). 전면에 `rgba(5,6,8,0.5)→0.84` 그라데이션 막(110-111행)을 깔고 hookLine을 96px 흰 글자로 가운데에 띄운다. 글자 불투명도는 `spring({frame})`(100행, 135행)이라 **0프레임에서 0**이고, 40~54f에 페이드아웃한다(101-104행).
- 막 아래 이미지: `PhotoBackground`(65-93행)가 슬라이드 안에서 1.02→1.12배(159f 기준 선형, 90f에서 약 1.077배)로 확대·이동한다. 막 때문에 0~1.8초 동안 이미지는 어둡게 깔린다.
- 1.5~5.3초: `IssueSlide`(147-364행)의 글자가 `textDelay = hookDuration - 10 = 44f`(480행)부터 들어온다. 순번·카테고리 태그는 `top: 72`(201-242행), kicker·제목·요약 상자는 `bottom: 330`(243-347행, 상자 하단 y≈1590)에 있다. "AI 생성 이미지" 표기는 오른쪽 아래 `bottom: 38` 21px·불투명도 0.36(348-361행)이다.
- 따라서 지금 0~4초는 "어두운 막 + 0프레임에 안 보이는 훅 한 문장(0~1.8초)" → "이미지 + 하단 제목·요약 상자 일괄 표시(1.5초~)"다. 순번 태그(y 72)와 요약 상자 하단(y≈1590)은 `safeArea.js`의 CORE(y 290~1250)·SECONDARY(y 290~1500) 밖이다.
- 이미지 성격: 생성 이미지는 삽화가 아니라 **실사형 보도사진**이다. 스펙 imagePrompt 규칙이 photojournalism·documentary 스타일을 요구하고(`REELS_SPEC.md:128`, `contracts/rewrite/prompt.txt:37`), 실데이터도 그렇다(`data/2026-10-26-am.json` rank1 "photojournalism documentary, flooded coastal road …").
- 재사용 가능한 export: `fontFamily`(15행, 폰트는 "Noto Sans CJK KR" 우선), `splitSentences`(58행), `PhotoBackground`(65행), `DEFAULT_BRAND`(24행), `HotIssueReelPhoto`(463행). `wrapTitle`(44행), `IssueSlide`, `PhotoOutro`, `HookOverlay`는 export되지 않는다.
- 훅 증거: `render.mjs:342-348`이 `data.hookFrame === "action"`일 때만 `docs/hooks/<stem>.txt=action`, 아니면 `v2`를 쓴다. 최근 data(10/23-am~10/26-am)에는 `hookFrame` 필드가 없다(직접 확인). `docs/hooks/` 기록은 2026-10-07-am부터만 있다.
- 질문형 hookLine과 validate: `data/2026-10-26-am.json`의 hookLine만 "태풍 참피, 어디에 피해가 났을까요?"로 바꾼 사본은 `validate: PASS`, "…어디까지 번졌죠?"는 `[문체] … 존댓말 종결어미 아님`으로 FAIL했다(10/26 직접 실행). 존댓말 정규식 `HONORIFIC_RE`(`scripts/rewrite-probes.cjs:14-15`)가 `요?` 종결을 허용한다. validate는 질문형을 막지 않으므로 validate 변경은 필요 없다. REELS_SPEC 70행의 "의문형 금지"는 LLM 지시문일 뿐이다.

### 코드 확인: 판정기(`scripts/experiment.mjs`)가 지원하는 의미
- **활성 중 항목 교체·중단: 지원하지 않는다.** 활성 실험은 판정(pending 기록, 593-611행) → 다음 실행에서 적용(476-531행)으로만 끝난다. 판정은 유효 표본이 window(14)에 차야 나오는데(571-575행), action-hook-v1-digest는 REELS_SPEC 분기가 없는 한 유효 표본이 0에서 늘지 않는다.
- lint 제약: 활성 항목은 ready여야 하고(207행), 계정당 활성 1개(223-224행), `waitingFor`는 큐에 있는 id여야 한다(193행). 큐 항목 flags는 flags.mjs 허용 키 검사를 받는다(147-148행). 이력(`history`)에 있는 id는 다시 활성화되지 않는다(439행, 542행). history의 verdict 값은 lint가 검사하지 않고 id만 읽힌다.
- **hold**: 활성 실험이 없을 때만 의미가 있다. `hold: true`면 자동 활성화를 멈춘다(536-540행). 활성 중에 hold를 써도 무시된다.
- **waitingFor**: 유휴 상태에서 그 id만 후보로 본다(543-545행). hold보다 뒤에 검사한다.
- **veto**: pending이 있을 때만 쓴다. 판정 후 20시간(`VETO_HOURS`, 34행) 뒤 적용 시점에 `veto: true`면 flags를 유지하고 hold로 멈춘다(484-517행). reject 적용만 `flagsBefore`로 롤백하고, adopt·inconclusive는 flags를 유지한다(494-497행).
- **startStem**: `nextStem`(80-88행)이 `data/`에 커밋된 마지막 물어오리 회차의 다음 회차를 고른다. 활성화(441-461행)는 이 값과 `flagsBefore`를 기록하고 큐 항목 flags를 기존 flags 위에 병합한다.
- 표본 제외: evidence(path equals 또는 data nonEmpty)가 하나라도 안 맞으면 `evidence` 사유로 제외한다(266-283행). 재빌드 감지(`gitRebuiltFn`, 697-714행)는 발행 마커 뒤 formats·arms·hooks 기록 변경만 본다.
- self-test 하네스 `buildCaseRoot`(838-848행)는 회차별 formats·arms·hooks 파일만 만든다. 화면 증거 케이스를 쓰려면 screens 파일 생성 한 갈래가 필요하다. self-test는 `--only <이름>`으로 케이스 하나만 돌릴 수 있다(923행). 기존 음성 대조군 파일에는 일부러 틀린 케이스(`wrong-expectation-*`)가 이미 있어 파일 전체 실행은 항상 exit 1이다.
- health(`scripts/health.mjs:223-246`)의 flags-applied 검사는 format·arm만 대조한다. hookFrame 불일치는 어떤 경보도 내지 않아서 이번 3회차 누락이 조용히 지나갔다.

### 코드 확인: 안전 영역 계약의 현재 적용 범위
- `scripts/layout-check.mjs`와 `reels/layout-cli.mjs`는 **오리 기자 전용**이다. layout-cli는 `CardNewsReel`을 고정 선택하고(67행) aibrief 브랜드·`noPhotos`를 주입한다(33-58행). 검사 프레임은 0·27·이슈별 +140·아웃트로 +40이다(`layout-check.mjs:53-58`). 27f 표지 판정(`cover`)은 `hook` 요소를 찾는다(139행).
- 측정은 컴포넌트 안의 `LayoutProbe`(`CardNewsReel.jsx:1031-1070`)가 `[data-el]` 요소의 위치·글자 크기·실효 불투명도를 `LAYOUT {...}` 로그로 내는 방식이다. 폰트 확인은 "Noto Serif KR" 기준이다(1066행). `HotIssueReelPhoto`에는 `data-zone`·`data-el`·LayoutProbe가 없다.
- contract-check의 layout 잡(`contract-check.yml:151-190`)은 aibrief 픽스처 2개 PASS, probe 꺼짐, 넘치는 픽스처 FAIL(음성 대조군)을 돈다.

## Work Objectives
1. 지금 표본 제외만 쌓는 action-hook-v1-digest를 철회하고, 준비 기간 동안 계정을 hold로 멈춘다.
2. 행동 번역 훅 계약의 "원문이 답하지 않는 질문 금지"를 강화하고 기준선을 다시 동결한다.
3. 물어오리 digest 이슈1 슬라이드의 화면 v1을 새 컴포지션으로 만들고, 처치가 꺼진 동안 기존 영상이 바뀌지 않음을 실회차로 확인한다.
4. REELS_SPEC에 hookLine 실험 분기를 넣는다(질문형이면 summary 첫 문장이 답을 담는 조항 포함).
5. 새 큐 항목 hook-screen-v1-digest와 사전등록을 넣고 판정기가 묶음을 켜게 한다.

## 설계 결정

### 결정 1: action-hook-v1-digest 철회와 준비 기간 hold (지금 건다)
- 판정기에 중단 기능이 없으므로 사람이 한 번 손으로 정리한다. 이는 10/6 계획의 "state·flags 직접 수정 금지(예외 veto·hold 해제)"에 **세 번째 예외**를 더하는 것이라 Ryan 승인이 필요하다("Ryan 확인 필요" 6).
- 정리 커밋 한 개에 아래를 같이 넣는다(나눠 넣으면 lint가 깨져 다음 insights의 판정·전환이 멈춘다).
  - `state.muleori`를 `{ "active": null, "flagsSince": <커밋 시점 nextStem>, "pending": null, "hold": true }`로 바꾼다. 이슈 번호는 지운다.
  - 철회 기록 파일 `experiments/verdicts/action-hook-v1-digest.md`를 새로 쓴다(철회 일시, 사유: REELS_SPEC 분기 미배포로 유효 표본 0, 제외 회차 목록, 대체 항목 hook-screen-v1-digest).
  - `state.history`에 `{ "id": "action-hook-v1-digest", "account": "muleori", "verdict": "withdrawn", "decidedAt": <커밋 시각>, "appliedAt": <커밋 시각>, "file": "experiments/verdicts/action-hook-v1-digest.md" }`를 덧붙인다. 이력 id라 다시 켜지지 않는다.
  - `flags.muleori`를 활성 전 값 `{ "REEL_FORMAT_MULEORI": "", "TTS_ENABLED": "0" }`으로 되돌린다. 지금은 아무 효과가 없는 키지만, 결정 6의 순서대로 REELS_SPEC 분기를 먼저 배포하면 남아 있는 `action` 값 때문에 처치가 준비 전에 켜진다.
  - 큐의 `action-hook-v1`(single 기반)과 `action-hook-v1-digest`를 `draft`로 바꾸고 hypothesis 끝에 "2026-10-26 hook-screen-v1-digest로 대체"를 붙인다. single 기반 항목은 이력에 없는 ready라 hold를 푸는 순간 큐 순서상 먼저 켜질 수 있다.
  - 이슈 #3은 철회 사유 코멘트와 함께 닫는다.
- 지금 거는 이유: 활성 상태를 그대로 두면 제외만 쌓이고(health contamination WARN), 누군가 REELS_SPEC 분기만 먼저 넣으면 훅 단독 회차가 이 항목의 유효 표본으로 들어가 묶음 실험과 섞인다. hold 중 health는 "물어오리 활성 실험 없음" WARN을 낸다. 예상된 상태다.

### 결정 2: 처치 정의와 증거 (화면은 data.hookFrame에 묶는다)
- **추천안(critic MINOR 1의 두 안 중 후자): 화면 v1은 `data.hookFrame === "action"` AND 물어오리 AND digest AND `SCREEN_MULEORI !== "off"`일 때 쓴다.** `SCREEN_MULEORI`는 값 `""`(기본, 따름) 또는 `"off"`(화면만 끄는 비상 스위치)인 허용 키이고 큐 항목 flags에는 넣지 않는다.
  - 이유: 훅은 루틴의 clone 시점 flags로 data에 기록되고, 화면은 그 data를 보고 정해지므로 두 처치는 같은 data에서 짝을 이룬다. insights 활성화가 am 루틴 clone(07:10)과 data push 사이에 끼면 그 회차는 "훅 v2 + 기존 화면"으로 현재 영상과 같게 나간다. reject 롤백이 clone 뒤·빌드 전에 끼어도 action data는 v1 화면으로 렌더되어 짝이 유지된다.
  - 기각한 안: 화면을 Actions 시점 flags(`SCREEN_MULEORI=v1`)로 켜고 hookFrame과 AND로 묶는 안. reject 롤백이 clone 뒤·빌드 전에 적용되면 hooks=action·screens=v0 회차가 1회 생긴다(판정 창이 닫힌 뒤라 표본 영향은 없지만 health ALERT와 기록 불일치가 남는다).
  - 짝이 깨지는 경우는 사람이 `SCREEN_MULEORI=off`를 쓴 때(의도된 비상 정지)와 새 컴포지션 폴백(`v0-fallback`)뿐이다. 둘 다 그 회차는 evidence 사유로 제외된다.
  - 부수 효과: REELS_SPEC 분기 커밋 하나를 revert하면 루틴이 hookFrame을 쓰지 않아 훅과 화면이 함께 꺼진다. 활성 중 비상 정지 수단이 된다.
- 컴포지션 결정을 render.mjs의 export 순수 함수 하나로 모은다(예: `resolveComposition({ account, format, screen, hookFrame })` → id). 기존 `resolveFormat` export 선례와 같은 방식이고, Anti-ISC가 이 함수로 single·aibrief 무회귀를 확인한다.
- 증거 기록: render가 hooks 기록 바로 옆에서 **물어오리 회차에만** `docs/screens/<stem>.txt`를 쓴다(aibrief 회차는 쓰지 않는다). 값은 실제로 쓴 컴포지션 기준 `v1` 또는 `v0`, 새 컴포지션 렌더가 예외로 실패해 기존 컴포지션으로 다시 렌더했으면 `v0-fallback`(텔레그램 경고, TTS 폴백 `render.mjs:286-300` 선례). 결방보다 표본 제외가 낫다. 폴백 경로 시험용으로 강제 실패 env(예: `REELS_SCREEN_FORCE_FAIL=1`, `REELS_ARM` 강제 오버라이드 `render.mjs:71` 선례)를 둔다.
- reels.yml 렌더 스텝 env에 `SCREEN_MULEORI`를 한 줄로 전달하고, 산출물 커밋에 `[ -d docs/screens ] && git add docs/screens`를 추가한다. `gitRebuiltFn`의 경로 목록에 `docs/screens/${stem}.txt`를 추가한다.
- health flags-applied에 훅·화면 대조를 더한다. 기준은 flags가 `HOOK_FRAME_MULEORI=action`일 때 `flagsSince` 이후 최근 2회차다.
  - 한쪽만 바뀐 회차(action·v0, v2·v1)가 있으면 ALERT. 단 `SCREEN_MULEORI=off`면 action·v0이 기대값이다.
  - 둘 다 꺼진 회차(v2·v0)가 2회 연속이면 ALERT(분기 누락. 이번 3회차 무경보 누락의 재발 방지), 1회면 WARN(활성화 직후 clone 경합으로 정상 발생).
  - **반대 방향 검사(개정 2, N1)**: flags가 `HOOK_FRAME_MULEORI=action`이 아닌데 `flagsSince` 이후 최근 2회차에 `hooks=action` 또는 `screens=v1`이 있으면 ALERT. 화면이 data에 묶여 있으므로, reject 롤백·철회 뒤에도 루틴 LLM이 이전 data 파일을 본보기 삼아 `"hookFrame": "action"`을 따라 쓰면 기각된 묶음이 계속 발행된다. 이 검사가 그 경우를 잡는다. 1차 방어는 Step 4 분기 문구("이전 data 파일의 hookFrame을 따라 쓰지 않는다")다.

### 결정 3: 화면 v1 사양 (이슈1 슬라이드 0~158f만)
- 새 컴포넌트 파일과 새 컴포지션 id(예: `HookScreenReel`)로 만든다. **경계 규칙: `frame >= issueDuration`이면 `<HotIssueReelPhoto {...props} />`를 그대로 반환한다.** 이슈 2~5와 아웃트로는 기존 컴포넌트가 그리므로 픽셀 단위로 같다(Anti-ISC-11).
- `HotIssueReelPhoto.jsx`는 렌더 코드를 바꾸지 않는다. 이미 export된 `PhotoBackground`·`splitSentences`·`fontFamily`·`DEFAULT_BRAND`·`HotIssueReelPhoto`를 import한다. `wrapTitle`은 파일 끝에 `export {wrapTitle};` 한 줄만 추가해 재사용한다(복사하면 줄바꿈 규칙이 갈라진다). 이 한 줄 외의 diff는 없어야 한다(ISC-3.9).
- 배치(1080×1920, 모든 글자는 CORE 안, 표기만 SECONDARY).

| 요소 | `data-el` / `data-zone` | 위치 | 시간 |
|---|---|---|---|
| 이미지 | `photo` | 전면 `PhotoBackground`. 바깥 래퍼가 0f 1.35배 → 45f 1.0배로 줌아웃(초점 영역은 이미지 중앙 고정) | 0~158f |
| 헤드라인 2줄 | `headline-1`, `headline-2` / core | y 약 300~560, 뒤에 상단 띠 막 | 0f부터 158f까지 고정 |
| 첫 구절 | `hook` / core | y 약 960~1238, 뒤에 하단 띠 막 | 0f부터 최소 28f |
| 이후 구절 | `subtitle` / core | 같은 자리 | 첫 구절 뒤부터 158f |
| AI 생성 표기 | `ai-label` / secondary | 오른쪽 아래, y 1500 안, 28px 이상, 불투명도 0.8 이상 | 0~158f |

- 초점 표시는 줌아웃 하나만 쓴다. 초점 바깥을 어둡게 하는 스포트라이트·화살표·원형 표식은 쓰지 않는다(Ryan 확인 4).
- 이미지 노출: 막은 상단 띠(헤드라인 뒤)와 하단 띠(자막 뒤)에만 둔다. 가운데 띠(y 600~900)는 막 없이 둔다. 판정은 결정 4의 픽셀 프로브로 한다. 기존 `HookOverlay` 전면 막은 쓰지 않는다.
- 0프레임과 표지: 헤드라인과 첫 구절(`hook`)은 0f에 불투명도 1로 보인다(스프링 진입 금지). **첫 구절은 최소 28f 유지**해서 그리드 표지(`thumb_offset` 900ms = 27f, `scripts/publish.mjs:192`)가 0f와 같은 상태가 되고, layout-check의 `cover` 판정(27f `hook` 요소)을 그대로 쓴다.
- 헤드라인 문구: 기본안은 `issues[0].title`을 `wrapTitle`로 2줄로 나눈 것이다(새 필드 없음, validate·사실성 게이트 그대로). "사실 줄 + 갈등·영향 줄"을 따로 쓰는 안은 새 데이터 필드가 필요하다(Ryan 확인 2). kicker는 실데이터에서 제목 반복이 많아(예: "태풍 참피" / "태풍 '참피', 남부·제주 폭우·강풍 피해") 둘째 줄로 쓰지 않는다.
- 구절 자막 규칙(결정적 순수 함수, 단위 테스트 대상).
  - 순서는 hookLine 구절들 → `issues[0].summary` 첫 문장 구절들이다. 쉼표·어절 경계에서 12자 안팎으로 나눈다.
  - 구절 길이는 글자 수에 비례하고 최소 20f(0.67초), 첫 구절은 최소 28f, hookLine 전체는 75f 이하다.
  - 문장 중간에서 자르지 않는다. 남은 시간에 다 들어가지 않으면 인접 구절을 합치고(최대 2줄), 그래도 안 되면 첫 문장 전체를 한 블록(최대 3줄)으로 보여 준다.
  - summary 둘째 문장은 화면에 나오지 않는다. 그래서 질문형 훅의 답이 첫 문장에 있어야 한다(결정 5의 REELS_SPEC 조항, 결정 7).
  - 음성 없이 자막만 순차 표시한다(Ryan 확인 1의 추천안). 음악은 지금과 같다.
- 실사 위장 금지: 이미지는 **실사형 생성 사진**이다. 실제 현장 영상처럼 보이게 하는 연출("현장", "LIVE", "REC", 촬영 시각, 카메라 UI)을 넣지 않는다. "AI 생성 이미지" 표기를 0f부터 읽을 수 있게 보이고 layout-check가 판정한다. imagePrompt는 바꾸지 않는다(이미지 생성 쪽 변수를 늘리지 않는다). 막 없이 0초부터 확대해 보이는 것 자체의 허용 여부는 Ryan 확인 3이다.

### 결정 4: 렌더 계약을 물어오리 화면 v1까지 넓힌다
- layout-cli 옵션 추가(기본 동작은 그대로 `CardNewsReel`).
  - `--composition <id>`: `HookScreenReel` 또는 `HotIssueReelPhoto`면 물어오리 브랜드·`imageDir`로 inputProps를 만들고 픽스처 이미지를 `reels/public/img/current/`로 복사한다(render.mjs 214-219행과 같은 방식). 검사 프레임은 0·27·30·90·150f다.
  - `--frames <목록>`: 지정 프레임만 렌더한다(Anti-ISC-11의 159·300·815f 스틸용).
- LayoutProbe 출력 스키마 확장(새 컴포넌트의 LayoutProbe, CardNewsReel 것은 그대로).
  - 요소마다 기존 필드(el·zone·left/top/right/bottom·fontSize·opacity·overflow)에 `text`(textContent를 trim한 값)를 더한다.
  - `photo` 요소에는 `scale` = `getBoundingClientRect().width / offsetWidth`를 더한다. 이 값은 조상 transform을 모두 곱한 실제 배율이라 **바깥 줌아웃 배율 × PhotoBackground 내부 줌**이다(0f 약 1.35 × 1.02 ≈ 1.38, 90f 약 1.0 × 1.077 ≈ 1.08).
  - `fontsOk`는 "Noto Sans CJK KR"로 확인한다(`HotIssueReelPhoto.jsx:15`).
- layout-check는 같은 `--composition`을 받아 프레임별 필수 요소를 바꾸고 새 판정 줄 4개를 더한다.
  - `image`: 0·30·90f 스틸(PNG)의 y 600~900 띠 평균 휘도(ffmpeg `signalstats` YAVG)를 기준 띠의 YAVG로 나눈 비율이 0.75 이상. **기준 띠는 그 스틸과 같은 변환(배율·이동)을 원본 이미지에 적용해 잘라 낸다(개정 2).** LayoutProbe가 `photo`의 화면 사각형(`getBoundingClientRect()`의 left·top·width·height)을 내고, 검사기는 y 600~900 띠를 그 사각형과 object-fit cover 규칙으로 원본 픽셀 좌표에 되짚어 ffmpeg `crop`으로 잘라 비교한다. 그래서 확대·이동 때문에 비교 대상 영역이 달라지는 오차가 없다. 막 자기신고(`data-scrim`)는 쓰지 않는다. 이 측정은 별도 스크립트(예: `scripts/image-exposure-check.mjs <still.png> <원본.png> --rect <사각형 json>`)로 두고 layout-check가 부른다. 단독 실행도 PASS/FAIL·비율을 낸다.
  - 기대 분리폭: 화면 v1의 비율은 약 0.9~1.0(가운데 띠에 막 없음), 현행 HotIssueReelPhoto 0f는 막 불투명도가 가운데 띠에서 약 0.6이라 비율 약 0.35~0.4다. 임계 0.75와 음성 대조군 사이 분리폭은 약 0.4다. Step 3 executor가 두 값을 실측해 픽스처 주석과 이 문서에 기록한다.
  - `focus`: `photo.scale`이 0f에서 1.3 이상, 90f에서 1.12 이하(곱한 배율 기준).
  - `subtitle-change`: 30f와 90f에 보이는 자막 요소(`hook` 또는 `subtitle`)의 `text`가 다르다.
  - `ai-label`: 0·27·90f에서 `ai-label`의 실효 불투명도 0.8 이상, 글자 28px 이상, SECONDARY 영역 안.
  - 기존 `frame0`(0f 훅 불투명도 ≥ 0.95·CORE 안), `cover`(27f `hook`), `zones`, `overlap`, `font-size`(28px), `required`는 그대로 적용한다.
  - `--from-log <파일>`: 렌더 없이 기록된 `LAYOUT` 줄 파일을 판정한다(음성 대조군 재생용).
- 음성 대조군(동결, contract-check layout 잡에 반전 단계로 넣는다).
  - 이미지 노출: 현행 `HotIssueReelPhoto`의 0f 스틸(`--composition HotIssueReelPhoto --no-probe --stills`)과 원본 이미지를 `image-exposure-check`에 넣으면 반드시 FAIL(현행 전면 막 0.5~0.84). 스틸 PNG와 그 0f의 `photo` 사각형 json(PhotoBackground 0f 값 zoom 1.02·x −34·y 18·inset −90에서 계산)을 픽스처로 커밋해 렌더 없이 재현한다.
  - AI 표기: 통과한 실행의 `LAYOUT` 줄을 복사하고 `ai-label`만 현행 값(불투명도 0.36, 21px, `bottom: 38` 위치)으로 바꾼 픽스처를 `--from-log`로 판정하면 반드시 `ai-label: FAIL`.
- 새 컴포넌트는 LayoutProbe를 `layoutProbe` prop이 있을 때만 렌더한다(프로덕션 inputProps에는 없다). `--no-probe` 렌더에서 LAYOUT 줄은 0건이어야 한다.
- 픽스처: 물어오리 `test/fixtures/2099-01-02-am.json`(실데이터 rank1 원문 + 행동 번역 hookLine + `hookFrame: "action"`), 같은 내용에서 `hookFrame`만 뺀 `test/fixtures/hookframe-off/2099-01-02-am.json`(같은 stem이라 같은 이미지 디렉토리를 쓴다), 최대 길이 픽스처(hook 30자·title 32자·summary 120자), 이미지 픽스처(실제 생성 이미지 축소본, issue-1~5), 위 음성 대조군 2종. contract-check의 paths 필터와 layout 잡에 단계를 추가한다.

### 결정 5: 실험 등록 (hook-screen-v1-digest)
- 큐 항목 형태(임계값 숫자는 Step 5에서 계산해 채운다).

```json
{
  "id": "hook-screen-v1-digest",
  "account": "muleori",
  "status": "ready",
  "hypothesis": "행동 번역 훅 + 0~5.3초 화면 v1(이미지 노출·상단 2줄 헤드라인·구절 자막·초점 줌아웃)을 한 묶음으로 켜면 digest 평균 시청이 오른다. 화면은 data.hookFrame=action에 묶여 함께 켜진다. 섞인 처치라 두 요소의 효과는 분리하지 않는다",
  "flags": { "HOOK_FRAME_MULEORI": "action" },
  "evidence": [
    { "path": "docs/hooks/{stem}.txt", "equals": "action" },
    { "path": "docs/screens/{stem}.txt", "equals": "v1" },
    { "path": "docs/formats/{stem}.txt", "equals": "digest" },
    { "path": "docs/arms/{stem}.txt", "equals": "control" }
  ],
  "samples": 14,
  "extendTo": 28,
  "adopt": [ { "kpi": "avgWatchMedian", "op": ">=", "value": "<p95>" }, { "kpi": "viewsMedian", "op": ">=", "value": "<기준 views 중앙값>" } ],
  "reject": [ { "kpi": "avgWatchMedian", "op": "<", "value": "<p5>" } ],
  "next": { "adopt": "signals-actions", "reject": "signals-actions", "inconclusive": "signals-actions" },
  "prereg": "experiments/preregistration/hook-screen-v1.md"
}
```

- flags에 TTS·SCREEN 키를 넣지 않는다. reject 롤백이 `flagsBefore`(`{"", "0"}`)로 정확히 돌아가 훅이 꺼지면 화면도 따라 꺼진다.
- 사전등록 새 파일 `experiments/preregistration/hook-screen-v1.md`에 적을 것.
  - 가설·처치(결정 2·3), 증거 표(위 evidence), 게이팅 규칙.
  - **섞인 처치의 한계**: adopt면 "묶음 채택"이고 어느 요소가 효과를 냈는지는 모른다. reject면 묶음 기각이고 한 요소의 이득이 다른 요소의 손해에 묻혔을 가능성을 배제하지 못한다. 분리 실험은 이 판정 뒤 별도 항목으로만 연다. REELS_SPEC 분기의 summary 첫 문장 조항도 묶음의 일부다.
  - 임계값 근거: 무처치 digest 회차(9/14-am~9/29-pm, 그리고 10/25-am~활성화 전날)에서 n=14 부트스트랩 10,000회의 avg_watch 중앙값 5%·95% 분위. 기준 표본 조건은 `formats=digest`·`arms=control`·훅 v2·화면 v0이다. **`docs/hooks/<stem>.txt`가 없는 회차(10/7 이전)는 v2로, `docs/screens/<stem>.txt`가 없는 회차는 v0으로 간주한다.** 최근 회차(10/25~)만의 중앙값이 합본 중앙값과 0.3초 넘게 다르면 최근 회차만으로 계산한다(계정 상태 변화 반영). 이 선택 규칙들은 계산 전에 문서에 적는다. views 하한은 같은 기준 표본의 views 중앙값(도달 감소 가드)이다.
  - 임계값은 기계 판독용 JSON 코드 블록 하나(`{"adopt":[…],"reject":[…]}`, 큐 항목과 같은 값·같은 순서)로도 적는다(ISC-5.4).
  - 지표·스냅샷·제외 규칙은 single-issue-v1 부록 2·4절, am/pm 구성 규칙(유효 표본의 am·pm 수 차이 2 이상이면 veto 후 hold)은 action-hook-v1 사전등록 5절을 그대로 가져온다.
  - **판정 전 사람 검토(10/6 계획 R3 복원)**: 판정이 기록되면 거부권 창 안에 창 회차 hookLine 14개(연장 시 28개)를 사람이 원문·summary 첫 문장과 대조한다. "답 없는 질문"은 질문형 hookLine 중 원문(제목+설명)에 답 구절이 없거나 summary 첫 문장에 답이 없는 것이다. **3건 이상이면 verdict와 상관없이 veto**하고 판정 문서에 "답 없는 질문 N건"으로 기록한다. 기준 3은 계산 전에 고정한다(14건의 약 20%).
  - **R3 veto 뒤 원복(개정 2)**: 판정기의 veto는 flags를 유지한다(`experiment.mjs:484-517`, vetoed면 롤백 없이 hold). 그래서 R3 veto 뒤에는 결정 1과 같은 철회 커밋으로 `flags.muleori`를 `{"", "0"}`으로 원복한다. 묶음을 켠 채 유지하려면 Ryan이 따로 결정하고 판정 문서에 사유를 남긴다.
  - 부록: Step 2 verifier의 동결 출력 대조표(결정 7).
  - 판정 의미: reject만 `flagsBefore`로 롤백한다. inconclusive는 묶음이 켜진 채 유지된다(판정기 494-497행, Ryan 확인 7). 다음 항목이 draft라 판정 적용 뒤 `waitingFor: signals-actions`로 대기하고 health가 WARN queue를 낸다.
  - 임계값 수정 가능 기간은 첫 처치 회차 전까지다.
- 활성화 방법: Step 5 커밋이 같은 push에서 큐 항목(ready)·사전등록·`state.muleori`의 `hold` 삭제와 `waitingFor: "hook-screen-v1-digest"` 추가를 함께 넣는다. 다음 insights가 이 항목을 활성화하고 훅 플래그를 병합하며 startStem을 계산하고 이슈를 만든다. 사람이 `active`를 직접 쓰지 않는다.

### 결정 6: 배포 창·순서·롤백
- 피할 시각(KST): insights 05:00 예약~09:30(실측 시작 07:00~09:15, 05:00대 시작도 드물게 있음), 물어오리 루틴 07:10·17:15와 백업 07:45·17:45, 그 뒤 빌드·발행(대략 +40분), 오리 기자 루틴 11:47과 빌드.
- 창 A(LLM이 읽지 않는 변경): 10:00~11:30 또는 13:00~16:30. 창 B(빌드·LLM 입력이 바뀌는 변경): 20:00~다음 날 04:30. 같은 날 am·pm이 같은 빌드 조건이어야 하고, 스펙 변경은 am 루틴 전에만 넣는다(HANDOFF 상설 규칙).
- 출시 순서(각 단계 = 별도 커밋, 앞 단계 ISC 통과 뒤 다음 단계).

| 순서 | 내용 | 창 | 가장 이른 날짜 |
|---|---|---|---|
| 0 | 철회·hold 커밋(Step 1) | 창 A | 10/26(월) 오늘 insights 완료 확인 뒤 |
| 1 | 훅 계약 강화·재동결(Step 2) | 창 A 또는 B | 10/27 |
| 2 | 화면 v1 코드(hookFrame이 없어 처치 꺼짐, Step 3) | 창 B | 10/28 20:00~10/29 04:30 → 10/29-am·pm 실빌드로 `screens=v0` 확인 |
| 3 | REELS_SPEC 분기(Step 4) | 창 B | 10/29 20:00~10/30 04:30 → 10/30-am·pm 루틴 산출물 확인 |
| 4 | 큐·사전등록·hold 해제(Step 5) | 창 B | 10/30 20:00~10/31 04:30 → 10/31 insights가 활성화 |

- 첫 처치 회차는 대개 활성화 당일 pm이다. insights가 07:10 clone 전에 끝나면 당일 am부터다. clone과 data push 사이에 끝나면 그 am은 startStem이지만 훅 v2·화면 v0으로 나가고 evidence 사유로 제외된다(health WARN 1회는 정상).
- 14회차 창은 약 10/31-pm~11/7-am, 판정은 24시간 성숙 뒤 약 11/8~11/9 insights, 적용은 그다음 실행이다(제외가 없을 때).
- 롤백.

| 상황 | 방법 |
|---|---|
| Step 3 배포 뒤(Step 5 전) 처치가 꺼져 있는데 영상·기록이 바뀜 | Step 3 커밋 `git revert`(즉시, 결방 위험이 없으면 창 B) |
| 활성 뒤 화면 렌더 실패 | render 폴백이 기존 화면으로 발행하고 `v0-fallback`으로 기록(자동). 반복되면 아래 비상 정지 |
| 활성 뒤 화면만 비상 정지 | flags.json `SCREEN_MULEORI=off` 커밋(사람 수정 예외, 그 회차들은 제외됨) |
| 활성 뒤 묶음 비상 정지 | Step 4 커밋 `git revert` → 다음 루틴부터 hookFrame이 없어 훅·화면이 함께 꺼진다. 그 뒤 결정 1과 같은 철회 커밋으로 항목을 정리 |
| Step 5 이후 Step 3을 되돌려야 함 | **철회 커밋을 먼저** 넣는다(active null·hold·flags 원복, `SCREEN_MULEORI` 키 제거). 그다음 Step 3 revert. 순서가 바뀌면 허용 키가 사라져 flags.json·큐 lint가 FAIL하고 판정·전환이 멈춘다 |
| 판정 전 중단 결정 | 결정 1과 같은 철회 커밋(active null·hold·flags 원복·history withdrawn·철회 기록 파일) |
| 판정 적용 거부 | `state.muleori.pending.veto=true` 커밋(판정 당일 09:30~다음 날 04:30) |

### 결정 7: 질문형 훅의 답이 화면에 나오게 한다
- 문제: 화면 v1은 summary 첫 문장까지만 자막으로 보인다. 원문에 답이 있어도 summary 둘째 문장에만 있으면 시청자는 답을 보지 못한다.
- **추천안: REELS_SPEC 분기(Step 4)에 "hookLine이 질문형이면 rank1 summary 첫 문장이 그 질문의 답을 담게 쓴다"를 넣는다.** 기각한 안(자막에 둘째 문장까지 넣기)은 159f 안에 hookLine(최대 75f) 뒤 두 문장(최대 약 110자)을 넣으면 구절당 0.5초 안팎이 되어 읽을 수 없고, 넘치면 hookLine을 한 블록으로 줄여야 해서 훅 처치 자체가 약해진다.
- 이 조항은 summary 작성 지시라 `contracts/rewrite`(요약 규칙 계약)가 회귀를 막지 못한다. rewrite 계약은 바꾸지 않고(Must NOT), 사전등록의 판정 전 사람 검토(결정 5, 3건 이상 veto)로 감시한다. 이 위험을 사전등록에 적는다.
- Step 2 verifier 산출물: 새 동결 출력 5건마다 "질문형 여부 / 답이 되는 원문 구절(인용) / 해당 data 파일 rank1 summary 첫 문장에 답 포함 여부"를 표로 만든다. 계약 tests.yaml 5건은 `data/2026-10-01-pm.json`·`2026-10-05-am`·`2026-09-23-am`·`2026-09-25-am`·`2026-10-05-pm`의 rank1이라 summary를 같은 파일에서 찾는다. 이 표는 Step 5 사전등록 부록에 그대로 넣는다.

## Guardrails

### Must Have
- 처치가 꺼진 동안(data에 `hookFrame` 없음) 물어오리 영상과 기록(formats·arms·hooks)은 지금과 같고, `docs/screens`는 `v0`이다.
- 두 처치는 같은 data에서 짝을 이룬다(결정 2). 짝이 깨지는 경우는 `SCREEN_MULEORI=off`와 `v0-fallback`뿐이다.
- 새 화면 요소는 전부 `data-zone`·`data-el`을 갖고 layout-check의 기존 판정(frame0·cover·zones·overlap·font-size·required)과 새 판정(image·focus·subtitle-change·ai-label)을 통과한다.
- 각 새 게이트에는 반드시 FAIL해야 하는 실제 나쁜 표본을 음성 대조군으로 함께 동결한다(이미지 노출·AI 표기·판정기·health).
- 철회 커밋(Step 1)과 활성화 커밋(Step 5)은 `experiments/`만 바꾸고 각 커밋 안에서 lint가 통과한다.
- 로컬 렌더 프로브는 별도 git worktree에서 돌리고 산출물을 커밋하지 않는다.

### Must NOT Have
- 오리 기자 경로 변경: `CardNewsReel.jsx`, `AI_REELS_SPEC.md`, aibrief inputProps·브랜드, layout-cli 기본 동작, aibrief 회차의 `docs/screens` 기록.
- single 포맷 경로 변경: `SingleIssueReel.jsx`, `singleFormat.js`, `scripts/tts.mjs`.
- 사실성 게이트 변경: `scripts/validate.mjs`, `scripts/rewrite-probes.cjs`, `contracts/hook-muleori/`, `contracts/hook/`, `contracts/rewrite/`.
- `HotIssueReelPhoto.jsx`의 `export {wrapTitle};` 한 줄 외 변경.
- REELS_SPEC의 기존 줄 삭제·수정(분기는 하위 항목 추가만).
- TTS 재가동, 가상 인물 진행자, 선정 기준·imagePrompt 변경, 이슈 2~5·아웃트로 화면 변경, 스포트라이트·화살표·원형 표식(Ryan 확인에서 달리 정하지 않는 한).
- 사람이 `state.active`를 직접 쓰는 활성화, `rm -rf`, 강제 push.

## Task Flow

### Step 1. action-hook-v1-digest 철회와 hold — 담당 executor(sonnet), 확인 verifier
- 결정 1의 커밋 한 개와 이슈 #3 닫기. 창 A. 먼저 오늘 insights 실행이 끝났는지 확인한다(`gh run list -w insights -L 1`, `unset GITHUB_TOKEN` 후 샌드박스 밖).
- 이 단계는 Ryan 확인 6의 승인 뒤에만 한다.

### Step 2. 행동 번역 훅 계약 강화·재동결 — 담당 executor(sonnet), 확인 verifier
- `contracts/hook-muleori-action/prompt.txt`에 조항을 강화한다. 요지는 "질문형을 쓰기 전에 원문(제목+설명)에서 그 질문의 답이 되는 구절을 먼저 찾는다. 찾지 못하면 질문형을 쓰지 말고 안내형 또는 사건형 폴백을 쓴다"와 실패 예시 2개(금융 해킹 "어떻게 확인할까요?", 아파트 "어디가 뜰까요?")다.
- `--live` freeze로 기준선을 다시 뜬다(claude CLI, ratchetlock은 타르볼 URL 설치, memory `ratchetlock-install-notes.md`). 답 유무는 결정적 프로브로 판정할 수 없으므로, 알려진 두 실패 출력이 다시 나오지 않음을 ISC로 고정하고 verifier가 결정 7의 대조표를 만든다.
- 기존 음성 대조군 2건과 다른 계약 3종은 그대로 둔다.

### Step 3. 화면 v1 구현(처치 꺼짐) — 담당 executor(opus), 리뷰 code-reviewer, 확인 verifier
- contract-check.yml layout 잡의 apt 설치 줄(`fonts-noto-cjk`)에 `ffmpeg`를 추가한다. reels.yml(50행)은 이미 설치하지만 layout 잡은 설치하지 않아서, 이 줄이 없으면 픽셀 프로브(ISC-3.4)와 CI 판정(ISC-3.15)이 CI에서 돌지 않는다.
- 결정 2·3·4 전부. 새 컴포넌트·컴포지션 등록(경계 159f 위임), `wrapTitle` export 한 줄, `resolveComposition`·`docs/screens` 기록·폴백·강제 실패 env, `SCREEN_MULEORI` 허용 키(`""`|`"off"`), reels.yml env·git add, `gitRebuiltFn` 경로, `buildCaseRoot`의 screens 파일 생성, health 훅·화면 대조와 self-test 케이스, 판정기 self-test 케이스, layout-cli/check 확장·LayoutProbe 스키마·픽셀 프로브·픽스처·음성 대조군·contract-check 단계.
- 구절 분할 함수는 순수 함수로 두고 이웃 테스트(`reels/src/keyStat.test.mjs`) 크기로 `node --test` 테스트를 붙인다.
- 창 B에 push한 뒤 다음 am·pm 실빌드에서 `screens=v0`와 health OK를 확인한다.

### Step 4. REELS_SPEC hookLine 실험 분기 — 담당 executor(sonnet), 확인 verifier
- 10/6 계획(`docs/plans/2026-10-06-action-hook-v1.md`) 결정 3의 분기 텍스트와 우선 조항을 그대로 쓴다. 헬퍼 `node scripts/flags.mjs --hook-prompt`를 실행하고, `frame=action`이면 그 프롬프트만 따르며(70행 "의문형 금지"·72행 정본 문구 비적용 조항 포함) 데이터 최상위에 `"hookFrame": "action"`을 쓴다. v2면 필드를 쓰지 않는다.
- 결정 7 조항을 같은 분기 안에 한 줄 더한다. "`frame=action`이고 hookLine이 질문형이면 rank1 summary 첫 문장이 그 질문의 답을 담게 쓴다."
- 잔존 방지 조항을 같은 분기 안에 넣는다(개정 2, N1). "`hookFrame` 필드는 이전 data 파일을 본보기로 따라 쓰지 않는다. 이번 실행에서 헬퍼(`node scripts/flags.mjs --hook-prompt`)가 출력한 frame만 따른다. `frame=v2`면 이전 회차에 필드가 있어도 쓰지 않는다." 화면이 data.hookFrame에 묶여 있어서, 이 조항이 없으면 reject 롤백 뒤에도 기각된 묶음이 발행될 수 있다. 2차 방어는 결정 2의 health 반대 방향 검사다.
- 창 B에 push한 뒤 다음 am·pm 루틴 산출물이 `hookFrame` 없음·validate PASS·`hooks=v2`인지 확인한다(플래그가 꺼져 있으므로 영상은 그대로다).

### Step 5. 큐·사전등록·활성화 — 담당 analyst(임계값 계산, python3) → executor(sonnet), 게이트 critic, 확인 verifier
- analyst가 결정 5의 기준 표본 규칙(파일 없음 간주 규칙 포함)을 먼저 사전등록 초안에 적고, 그다음 최신 `metrics/<date>.json`으로 부트스트랩을 계산한다.
- executor가 큐 항목·사전등록 파일(부록 대조표 포함)·`state.muleori`(hold 삭제, waitingFor 추가)를 한 커밋으로 넣는다. critic이 사전등록을 검토한 뒤 창 B에 push한다.
- 활성화 다음 날 첫 처치 회차의 증거(`hooks=action`·`screens=v1`), 발행 마커, 0초 프레임 이미지 노출, 이슈 생성을 확인한다.

## Criteria

공통 전제: 저장소 루트에서 실행한다. `BASE=1e5139d`. 로컬 렌더 ISC는 worktree 루트(`$WT`, 아래 "로컬 렌더 요령")에서 샌드박스를 해제하고 실행한다. 상세 출력은 `$TMPDIR` 로그로 보낸다. 로컬과 CI의 폰트가 달라 결과가 갈리면 CI 결과(ISC-3.15)가 구속력을 갖는다.

### Step 1
- ISC-1.1: `node scripts/experiment.mjs --lint 2>&1 | tail -1` → `queue OK` → pass/fail
- ISC-1.2: `node -e 'const s=require("./experiments/state.json");console.log(s.muleori.active,s.muleori.hold,s.history.at(-1).id,s.history.at(-1).verdict)'` → `null true action-hook-v1-digest withdrawn` → pass/fail
- ISC-1.3: `node -e 'console.log(JSON.stringify(require("./experiments/flags.json").muleori))'` → `{"REEL_FORMAT_MULEORI":"","TTS_ENABLED":"0"}` → pass/fail
- ISC-1.4: `node scripts/flags.mjs --hook-prompt 2>/dev/null` → `contracts/hook-muleori/prompt.txt frame=v2` → pass/fail
- ISC-1.5: `node -e 'const q=require("./experiments/queue.json");console.log(["action-hook-v1","action-hook-v1-digest"].map(i=>q.items.find(x=>x.id===i).status).join(" "))'` → `draft draft` → pass/fail
- ISC-1.6: `node scripts/experiment.mjs --snapshot metrics/2026-10-26.json --dry-run --now 2026-10-27T08:00:00+09:00 2>&1 | grep -c "muleori: hold"` → `1` → pass/fail
- ISC-1.7: `unset GITHUB_TOKEN; gh issue view 3 --json state -q .state` → `CLOSED` → pass/fail
- ISC-1.8: `git show --name-only --format= <step1-sha> | grep -vc '^experiments/'` → `0` → pass/fail
- ISC-1.9: 다음 insights 실행 뒤 `git pull` 한 main에서 `node -e 'const s=require("./experiments/state.json").muleori;console.log(s.active,s.hold)'` → `null true`(판정기가 hold를 유지하고 아무것도 켜지 않음) → pass/fail
- ISC-1.10: `node -e 'const fs=require("fs");const h=require("./experiments/state.json").history.at(-1);console.log(fs.existsSync(h.file))'` → `true`(철회 기록 파일 존재) → pass/fail

### Step 2
- ISC-2.1: `cd contracts/hook-muleori-action && npx ratchetlock check --probe-locked > $TMPDIR/hma.log 2>&1; echo $?` → `0` → pass/fail
- ISC-2.2: `node -e 'const r=require("./contracts/hook-muleori-action/ratchet.json");const f=r.frozen.at(-1);console.log(r.frozen.length>=2 && f.promptHash===r.current.prompts["prompt.txt"])'` → `true` → pass/fail
- ISC-2.3: `node -e 'const f=require("./contracts/hook-muleori-action/ratchet.json").frozen.at(-1);console.log(Object.values(f.cases).filter(c=>/어디가 뜰까요|어떻게 확인할까요/.test(c.output)).length)'` → `0` → pass/fail
- ISC-2.4 (기존 음성 대조군 유지): `cd contracts/hook-muleori-action && for n in no-action v2-party; do node ../../node_modules/ratchetlock/dist/cli.js lint --output negative-$n.txt --vars negative-$n.vars.json > $TMPDIR/neg-$n.log 2>&1; echo $?; done | tr '\n' ' '` → `1 1 ` → pass/fail
- ISC-2.5 (질문형 통과): `node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync("data/2026-10-26-am.json"));d.hookLine="태풍 참피, 어디에 피해가 났을까요?";fs.writeFileSync(process.env.TMPDIR+"/2026-10-26-am.json",JSON.stringify(d))' && node scripts/validate.mjs $TMPDIR/2026-10-26-am.json 2>&1 | tail -1` → `validate: PASS` → pass/fail
- ISC-2.6: contract-check push 실행 결론 `unset GITHUB_TOKEN; gh run list -w contract-check -L 1 --json conclusion -q '.[0].conclusion'` → `success` → pass/fail
- ISC-2.7: verifier 대조표(결정 7)가 5행이다. 산출물을 `$TMPDIR/hook-answer-table.md`로 받아 `grep -c '^| 10-0\|^| 09-2' $TMPDIR/hook-answer-table.md` → `5` → pass/fail

### Step 3 (로컬 프로브는 `$WT`에서, 샌드박스 해제)
- ISC-3.1: `node scripts/layout-check.mjs test/fixtures/2099-01-02-am.json --composition HookScreenReel --stills $TMPDIR/scr --log $TMPDIR/scr.log | head -1` → `PASS` → pass/fail
- ISC-3.2: `node scripts/layout-check.mjs test/fixtures/2099-01-02-am.json --composition HookScreenReel --log $TMPDIR/scr.log | grep -cE '^(frame0|cover|zones|overlap|font-size|required|image|focus|subtitle-change|ai-label): PASS$'` → `10` → pass/fail
- ISC-3.3: 최대 길이 물어오리 픽스처로 ISC-3.1과 같은 명령 → `PASS` → pass/fail
- ISC-3.4 (이미지 노출 게이트 음성 대조군, 동결): `node scripts/image-exposure-check.mjs test/fixtures/img/hotissue-2099-01-02-am-f000.png test/fixtures/img/2099-01-02-am/issue-1.png > $TMPDIR/iex.log; echo $?; head -1 $TMPDIR/iex.log` → `1` / `FAIL`(현행 HotIssueReelPhoto 0f 스틸은 반드시 떨어진다) → pass/fail
- ISC-3.5 (영상 렌더): 픽스처 이미지 5장을 `$WT/assets/img/2099-01-02-am/`에 둔 뒤 `node scripts/render.mjs test/fixtures/2099-01-02-am.json > $TMPDIR/r1.log 2>&1; tail -1 $TMPDIR/r1.log; cat docs/screens/2099-01-02-am.txt docs/hooks/2099-01-02-am.txt | tr '\n' ' '` → `render: PASS` / `v1 action ` → pass/fail
- ISC-3.6: 폐기(판별력 없음). Anti-ISC-11로 대체한다.
- ISC-3.7 (처치 꺼짐): `node scripts/render.mjs test/fixtures/hookframe-off/2099-01-02-am.json > $TMPDIR/r0.log 2>&1; grep -c 'Remotion 렌더 시작… (HotIssueReelPhoto)' $TMPDIR/r0.log; cat docs/screens/2099-01-02-am.txt`, 그리고 ISC-3.5 픽스처를 `SCREEN_MULEORI=off`로 렌더해 `cat docs/screens/2099-01-02-am.txt` → `1` / `v0` / `v0` → pass/fail
- ISC-3.8 (게이팅): `node --input-type=module -e 'import {resolveComposition as r} from "./scripts/render.mjs";console.log([r({account:"muleori",format:"digest",screen:"",hookFrame:"action"}),r({account:"muleori",format:"digest",screen:""}),r({account:"muleori",format:"digest",screen:"off",hookFrame:"action"})].join(" "))'` → `HookScreenReel HotIssueReelPhoto HotIssueReelPhoto` → pass/fail
- ISC-3.9: `git diff $BASE -- reels/src/HotIssueReelPhoto.jsx | grep -E '^[-+][^-+]'` → 정확히 `+export {wrapTitle};` 한 줄 → pass/fail
- ISC-3.10: `node scripts/flags.mjs --check experiments/flags.json && node -e 'import("./scripts/flags.mjs").then(m=>console.log(m.ALLOWED_KEYS.includes("SCREEN_MULEORI")))'` → `flags check: PASS` / `true` → pass/fail
- ISC-3.11: `grep -c 'SCREEN_MULEORI: ${{ steps.flags.outputs.SCREEN_MULEORI }}' .github/workflows/reels.yml; grep -c 'git add docs/screens' .github/workflows/reels.yml; grep -c 'docs/screens/${stem}.txt' scripts/experiment.mjs` → `1` `1` `1` → pass/fail
- ISC-3.12: `node scripts/experiment.mjs --self-test > $TMPDIR/st.log 2>&1; echo $?; node scripts/experiment.mjs --self-test --cases test/fixtures/experiments/negative-cases.json --only wrong-expectation-screen-v0-as-valid > $TMPDIR/stn.log 2>&1; echo $?` → `0` `1`(새 음성 케이스 단독 실행. "screens=v0인 회차를 유효로 기대"는 반드시 실패) → pass/fail
- ISC-3.13: `node scripts/health.mjs --self-test > $TMPDIR/h.log 2>&1; echo $?; node scripts/health.mjs --self-test --cases test/fixtures/health/negative-cases.json --only wrong-expectation-hook-screen-mismatch-as-ok > $TMPDIR/hn.log 2>&1; echo $?` → `0` `1`(새 음성 케이스 단독 실행) → pass/fail
- ISC-3.14: `node --test reels/src/*.test.mjs > $TMPDIR/t.log 2>&1; echo $?` → `0` → pass/fail
- ISC-3.15: push 뒤 `unset GITHUB_TOKEN; gh run list -w contract-check -L 1 --json conclusion -q '.[0].conclusion'` → `success`(check·experiments·layout 3잡. 로컬과 결과가 다르면 이것이 구속력을 갖는다) → pass/fail
- ISC-3.16 (실회차, 처치 꺼짐): 배포 다음 날 `cat docs/screens/<D>-am.txt docs/screens/<D>-pm.txt docs/hooks/<D>-am.txt | tr '\n' ' '` → `v0 v0 v2 ` → pass/fail
- ISC-3.17 (AI 표기 판정의 **비교기 음성 대조군**, 동결. 기록된 LAYOUT 줄을 재생하므로 비교기가 나쁜 값을 잡는지만 시험한다. 실제 렌더에서 `ai-label`을 재는 측정 경로의 증거는 ISC-3.2다): `node scripts/layout-check.mjs test/fixtures/2099-01-02-am.json --composition HookScreenReel --from-log test/fixtures/layout-neg-ai-label.log --log $TMPDIR/nal.log | grep -c '^ai-label: FAIL$'` → `1`(그리고 exit 1) → pass/fail
- ISC-3.18 (probe 꺼짐): `cd reels && node layout-cli.mjs ../test/fixtures/2099-01-02-am.json --composition HookScreenReel --no-probe | grep -x 'layout-lines: 0'` → `layout-lines: 0` → pass/fail
- ISC-3.19 (폴백): `REELS_SCREEN_FORCE_FAIL=1 node scripts/render.mjs test/fixtures/2099-01-02-am.json > $TMPDIR/rf.log 2>&1; tail -1 $TMPDIR/rf.log; cat docs/screens/2099-01-02-am.txt` → `render: PASS` / `v0-fallback` → pass/fail
- ISC-3.20 (aibrief 미기록, 실회차): Step 3 배포 다음 날 `ls docs/screens | grep -c '^ai-'` → `0` → pass/fail
- ISC-3.21 (health 반대 방향 검사 음성 대조군, 동결): `node scripts/health.mjs --self-test --cases test/fixtures/health/negative-cases.json --only wrong-expectation-stale-hookframe-as-ok > $TMPDIR/hs.log 2>&1; echo $?` → `1`("flags는 action이 아닌데 최근 회차가 hooks=action·screens=v1"을 OK로 기대한 케이스는 반드시 실패). 같은 상황을 ALERT로 기대한 정상 케이스는 ISC-3.13의 self-test 안에서 통과해야 한다 → pass/fail
- ISC-3.22 (CI에 ffmpeg 설치): `grep -c 'apt-get install -y fonts-noto-cjk ffmpeg' .github/workflows/contract-check.yml` → `1`(layout 잡) → pass/fail

### Step 4
- ISC-4.1: `grep -c 'node scripts/flags.mjs --hook-prompt' REELS_SPEC.md; grep -c '"hookFrame": "action"' REELS_SPEC.md` → 둘 다 `1` 이상 → pass/fail
- ISC-4.2: `git diff <step4-sha>~1 <step4-sha> -- REELS_SPEC.md | grep -cE '^-[^-]'` → `0`(삭제·수정 줄 없음) → pass/fail
- ISC-4.3: `FLAGS_FILE=test/fixtures/experiments/flags-hook-action.json node scripts/flags.mjs --hook-prompt 2>/dev/null` → `contracts/hook-muleori-action/prompt.txt frame=action` → pass/fail
- ISC-4.4 (실회차, 플래그 꺼짐): 배포 다음 날 `node -e 'for (const s of ["<D>-am","<D>-pm"]) console.log(require("./data/"+s+".json").hookFrame ?? "none")' | tr '\n' ' '; cat docs/hooks/<D>-am.txt docs/hooks/<D>-pm.txt | tr '\n' ' '` → `none none ` / `v2 v2 ` → pass/fail
- ISC-4.5: `grep -c 'summary 첫 문장이 그 질문의 답' REELS_SPEC.md` → `1` → pass/fail

### Step 5
- ISC-5.1: `node scripts/experiment.mjs --lint 2>&1 | tail -1` → `queue OK` → pass/fail
- ISC-5.2: `node -e 'const it=require("./experiments/queue.json").items.find(i=>i.id==="hook-screen-v1-digest");console.log(it.status,JSON.stringify(it.flags),it.evidence.map(e=>e.path.split("/")[1]+"="+e.equals).join(","))'` → `ready {"HOOK_FRAME_MULEORI":"action"} hooks=action,screens=v1,formats=digest,arms=control` → pass/fail
- ISC-5.3: `node -e 'const s=require("./experiments/state.json").muleori;console.log(s.hold ?? "none",s.waitingFor)'` → `none hook-screen-v1-digest` → pass/fail
- ISC-5.4: 사전등록의 기계 판독 블록이 큐와 정확히 같다. `node -e 'const fs=require("fs");const it=require("./experiments/queue.json").items.find(i=>i.id==="hook-screen-v1-digest");const m=fs.readFileSync("experiments/preregistration/hook-screen-v1.md","utf8").match(/```json\n(\{"adopt"[\s\S]*?)\n```/);console.log(!!m && JSON.stringify(JSON.parse(m[1]))===JSON.stringify({adopt:it.adopt,reject:it.reject}))'` → `true` → pass/fail
- ISC-5.5: `grep -c '섞인 처치' experiments/preregistration/hook-screen-v1.md` → `1` 이상 → pass/fail
- ISC-5.6 (활성화 리허설): `node scripts/experiment.mjs --snapshot metrics/<최신>.json --dry-run --now <다음 날>T08:00:00+09:00 2>&1 | grep -c 'hook-screen-v1-digest 활성화 — startStem'` → `1` → pass/fail
- ISC-5.7 (실활성화 뒤): `node -e 'const s=require("./experiments/state.json").muleori;const f=require("./experiments/flags.json").muleori;console.log(s.active,f.HOOK_FRAME_MULEORI,f.SCREEN_MULEORI ?? "unset",f.TTS_ENABLED)'` → `hook-screen-v1-digest action unset 0` → pass/fail
- ISC-5.8 (첫 처치 회차): `cat docs/hooks/<첫 처치>.txt docs/screens/<첫 처치>.txt published/<첫 처치> | head -3 | tr '\n' ' '` → `action v1 <숫자 미디어 id> ` → pass/fail
- ISC-5.9: `unset GITHUB_TOKEN; gh issue list --label experiment --state open --json title -q '.[].title' | grep -c 'hook-screen-v1-digest'` → `1` → pass/fail
- ISC-5.10 (첫 처치 회차 0초 프레임): `ffmpeg -v error -ss 0 -i docs/videos/<첫 처치>.mp4 -frames:v 1 $TMPDIR/first-f0.png && node scripts/image-exposure-check.mjs $TMPDIR/first-f0.png assets/img/<첫 처치>/issue-1.png | head -1` → `PASS`. verifier는 같은 PNG를 직접 열어 이미지 노출·헤드라인·첫 구절·AI 표기를 눈으로도 확인한다(보조 증거) → pass/fail
- ISC-5.11: `grep -c '^| 10-0\|^| 09-2' experiments/preregistration/hook-screen-v1.md` → `5` 이상(부록 대조표 5행) → pass/fail
- ISC-5.12: `grep -c '3건 이상이면 verdict와 상관없이 veto' experiments/preregistration/hook-screen-v1.md` → `1`(판정 전 사람 검토 규칙과 기준 고정) → pass/fail
- ISC-5.13 (판정 후 관찰, reject 또는 철회·R3 veto 원복 뒤): flags 원복이 적용된 실행 뒤 첫 2회차 `<S1>`·`<S2>`에서 `cat docs/hooks/<S1>.txt docs/hooks/<S2>.txt docs/screens/<S1>.txt docs/screens/<S2>.txt | tr '\n' ' '` → `v2 v2 v0 v0 `(루틴이 이전 data의 hookFrame을 따라 쓰지 않음. 어긋나면 health 반대 방향 검사 ALERT도 함께 확인) → pass/fail

### Anti-ISC
- Anti-ISC-1 (오리 기자 무회귀): `git diff --stat $BASE -- reels/src/CardNewsReel.jsx AI_REELS_SPEC.md | wc -l` → `0`, 그리고 `node scripts/layout-check.mjs test/fixtures/ai-2099-01-01.json --log $TMPDIR/a.log | head -1` → `PASS` → pass/fail
- Anti-ISC-2 (오리 기자 음성 대조군 유지): `node scripts/layout-check.mjs test/fixtures/ai-layout-overflow.json --log $TMPDIR/ao.log > /dev/null; echo $?` → `1` → pass/fail
- Anti-ISC-3 (single 무회귀): `git diff --stat $BASE -- reels/src/SingleIssueReel.jsx reels/src/singleFormat.js scripts/tts.mjs | wc -l` → `0`, 그리고 `node --input-type=module -e 'import {resolveComposition as r} from "./scripts/render.mjs";console.log(r({account:"muleori",format:"single",screen:"",hookFrame:"action"}),r({account:"aibrief",format:"digest",screen:"",hookFrame:"action"}))'` → `SingleIssueReel CardNewsReel` → pass/fail
- Anti-ISC-4 (사실성 게이트 무변경): `git diff --stat $BASE -- scripts/validate.mjs scripts/rewrite-probes.cjs contracts/hook-muleori contracts/hook contracts/rewrite | wc -l` → `0` → pass/fail
- Anti-ISC-5 (사실성 게이트 작동, 음성 대조군): ISC-2.5와 같은 사본에 hookLine "태풍 참피, 500mm 넘었을까요?"(원문에 없는 수치)와 "태풍 참피 피해, 어디까지 번졌죠?"를 각각 넣어 `node scripts/validate.mjs … | tail -1` → 둘 다 `validate: FAIL`로 시작 → pass/fail
- Anti-ISC-6 (실사 위장 금지·AI 표기): `grep -cE 'LIVE|REC|현장 영상|단독' reels/src/HookScreenReel.jsx` → `0`, 그리고 ISC-3.2 로그의 `ai-label: PASS`(0·27·90f 불투명도 0.8 이상·28px 이상·SECONDARY 안), 그리고 ISC-3.17이 `ai-label: FAIL` → pass/fail
- Anti-ISC-7 (TTS 꺼짐 유지, Ryan 확인 1 추천안 기준): `node -e 'const it=require("./experiments/queue.json").items.find(i=>i.id==="hook-screen-v1-digest");console.log("TTS_ENABLED" in it.flags)'` → `false` → pass/fail
- Anti-ISC-8 (활성화 커밋 범위): `git show --name-only --format= <step5-sha> | grep -vc '^experiments/'` → `0` → pass/fail
- Anti-ISC-9 (로컬 렌더 산출물 미커밋): `git ls-files | grep -c '2099-01-02-am\.mp4\|assets/img/2099-01-02-am'` → `0` → pass/fail
- Anti-ISC-10 (single 기반 항목 재활성화 없음): 활성화 뒤 `node -e 'console.log(require("./experiments/state.json").muleori.active)'` → `hook-screen-v1-digest`(`action-hook-v1` 아님) → pass/fail
- Anti-ISC-11 (이슈 2~5·아웃트로 불변): 같은 픽스처로 `cd reels && node layout-cli.mjs ../test/fixtures/2099-01-02-am.json --composition HotIssueReelPhoto --no-probe --frames 159,300,815 --stills $TMPDIR/old && node layout-cli.mjs ../test/fixtures/2099-01-02-am.json --composition HookScreenReel --no-probe --frames 159,300,815 --stills $TMPDIR/new && for f in 159 300 815; do cmp -s $TMPDIR/old/2099-01-02-am-f$f.png $TMPDIR/new/2099-01-02-am-f$f.png && echo same; done | grep -c same` → `3` → pass/fail

## Success Criteria
- Step 1~5의 ISC와 Anti-ISC가 전부 pass다(ISC-3.6은 폐기).
- 활성화 뒤 처음 4회차(유효·제외 무관)에서 `docs/hooks`와 `docs/screens`가 짝을 이룬다(action·v1 또는 v2·v0). 한쪽만 바뀐 회차가 있으면 health가 ALERT를 낸다.
- 판정기가 사전등록 임계값으로 묶음을 판정하고, 판정 전 사람 검토 결과와 섞인 처치의 한계가 판정 문서·사전등록에 적혀 있다.

## 로컬 렌더 요령
- 렌더 산출물(docs/videos·previews·arms·formats·hooks·screens, assets/img)이 작업 트리를 더럽히지 않게 worktree에서 돌린다. 예: `git worktree add <스크래치패드>/wt-hook-screen -b hook-screen-v1` 후 `WT=<그 경로>`.
- `ln -s /Users/ryan/ClaudeProject/daily-news-reels/reels/node_modules $WT/reels/node_modules`. 계약 단계에서 ratchetlock이 필요하면 루트 `node_modules`도 같은 방식으로 심링크한다.
- Remotion(헤드리스 Chrome)·ffmpeg 렌더는 샌드박스를 해제해야 한다. layout-cli는 실행 중 `reels/`로 이동해 루트 `.remotion/` 캐시를 만들지 않는다. render-cli는 playwright chromium 경로를 쓴다.
- 로컬 macOS와 CI ubuntu(fonts-noto-cjk)의 폰트가 달라 글자 폭·줄바꿈이 갈릴 수 있다. 로컬 PASS·CI FAIL이면 CI(ISC-3.15)를 따른다.
- `rm -rf`는 훅이 막는다. worktree와 임시 산출물은 지우지 않고 스크래치패드에 남긴다. 정리는 Ryan이 터미널에서 한다. `--force`처럼 `-f`가 섞인 명령도 force push로 오탐될 수 있으니 쓰지 않는다.
- `gh`는 `unset GITHUB_TOKEN` 후 샌드박스 밖에서 실행한다.

## 미결 (조사 필요, Ryan 질문 아님)
- AI 생성 표기 위치(오른쪽 아래, y 1500 안)가 릴스 화면 오른쪽 버튼 열(좋아요·댓글·공유)에 가리는지 확인하지 못했다. Step 3 배포 전에 Aside로 물어오리 최근 릴스 실화면을 캡처해 버튼 열 범위를 재고, 겹치면 표기를 왼쪽 아래(SECONDARY 안)로 옮긴다(memory `check-instagram-via-aside.md`, `video-lens-run-notes.md`).
- 로컬·CI 폰트 차이로 layout-check 결과가 다를 수 있다. CI 결과(ISC-3.15)가 구속력을 갖는다.

## Ryan 확인 필요

> Ryan 결정 2026-10-26: 7개 항목 전부 추천안 승인.
1. **TTS를 다시 켤지.** 추천: 켜지 않는다. 음성 없이 구절 자막만 순차 표시하고 음악은 지금과 같다. 근거는 세 가지다. 8/22 digest TTS A/B에서 TTS 팔 조회수 중앙값 59 대 대조 94로 도달이 깎였고, `scripts/tts.mjs`가 단어·구절 타이밍을 내보내지 않아 자막 동기화 작업이 따로 필요하며, 10/12~10/20 edge-tts 403 무음 발행 같은 운영 위험이 묶음에 세 번째 변수로 붙는다. 켜기로 하면 큐 flags에 `TTS_ENABLED`가 들어가고 Anti-ISC-7과 결정 5의 롤백 설명을 고친다.
2. **헤드라인 2줄 문구 출처.** 추천: `issues[0].title`을 2줄로 나눠 쓴다(새 필드 없음, 기존 validate·사실성 게이트 그대로). 외부 사례의 "사실 줄 + 갈등·영향 줄"을 그대로 하려면 새 필드(예: 16자 이내 영향 줄, 원문 대조)를 REELS_SPEC·validate에 추가해야 하고, 이는 Must NOT의 validate 무변경과 충돌한다. 첫 화면의 영향·행동 각도는 행동 번역 훅 자막이 맡는다.
3. **실사형 생성 사진을 막 없이 확대해 0초부터 보여도 되는가.** 생성 이미지는 photojournalism 스타일의 실사형 사진이라, 지금처럼 어두운 막에 덮여 있을 때보다 실제 현장 사진으로 오인될 가능성이 커진다(특히 속보형 rank1의 사고·재난 장면). 추천: 허용하되 "AI 생성 이미지" 표기를 0프레임부터 불투명도 0.8 이상·28px 이상으로 보이고(layout-check 판정), 실사 연출 요소를 금지한다. 허용하지 않으면 가운데 띠에 옅은 막을 남기는 쪽으로 `image` 판정 기준(비율 0.75)을 낮춰야 하고, 처치 1번(이미지 노출)이 약해진다.
4. **결핍의 시각화 방식.** 추천: 0~1.5초 이미지 중앙 영역 1.35배 확대에서 전체로 줌아웃하는 것 하나만 쓴다. 초점 바깥을 어둡게 하는 스포트라이트와 화살표·원형 표식은 실사형 사진의 한 부분을 "사실 근거"처럼 지목해 오인을 키우므로 쓰지 않는다.
5. **화면 개편 적용 범위.** 추천: 이슈1 슬라이드(0~5.3초)만 바꾸고 이슈 2~5·아웃트로는 그대로 둔다. 판정 지표 avg_watch가 2~4초대라 처치가 닿는 구간은 이슈1뿐이고, 범위를 넓히면 변수가 늘어난다. 5.3초에 화면 양식이 바뀌는 것은 감수한다.
6. **state·flags 수동 수정 예외 승인.** 판정기에는 활성 실험 중단 기능이 없어서 action-hook-v1-digest 철회(결정 1)는 사람이 state·flags를 한 번 직접 고쳐야 한다. 10/6 계획의 금지 규칙(예외 veto·hold 해제)에 "실험 철회"와 "화면 비상 정지(`SCREEN_MULEORI=off`)" 예외를 더한다. 추천: 승인하고 오늘(10/26) 10:00~16:30 사이에 hold를 건다. 판정기에 철회 기능을 코드로 넣는 대안은 self-test 회귀 범위가 넓어 이번 범위에서 뺀다.
7. **inconclusive 처리.** 판정기 의미상 inconclusive면 묶음이 켜진 채 유지된다(reject만 원복). 추천: 그대로 둔다(single-issue-v1 사전등록과 같은 규칙). 원복을 원하면 사전등록에 "inconclusive면 결정 1과 같은 철회 커밋으로 원복"을 적는다.

## 실행 메모(critic 최종 승인 2026-10-26, executor 처리)

ISC 본문은 고치지 않는다. 아래 메모는 해당 ISC·Step을 실행할 때 함께 적용한다.

1. **rect 고정값 파일** (Step 3, ISC-3.4·ISC-5.10): 두 ISC 명령에는 `--rect`가 빠져 있고, 두 경우 모두 LayoutProbe가 없어서 rect를 잴 수 없다. 0f 변환은 결정적이므로 rect 고정값 파일을 커밋해 `--rect`로 넘긴다.
   - `test/fixtures/img/rect-hotissue-f0.json`: HotIssueReelPhoto 0f. PhotoBackground `inset -90`, 1260×2100, 배율 1.02, 이동 (x, 18). x는 `-26 + panBias`이고, rank1의 panBias는 `(1 - 3) * 4 = -8`이라 실제 값은 −34다(`HotIssueReelPhoto.jsx:71`, `:183`). 승인 메시지의 (−26, 18)은 panBias를 빼고 적은 값이므로 executor가 렌더 스틸과 대조해 확정한다. 결정 4의 "x −34"와 같다.
   - `test/fixtures/img/rect-hookscreen-f0.json`: HookScreenReel 0f. 바깥 줌아웃 0f 배율 1.35와 PhotoBackground 0f 변환을 곱한 값이다. ISC-5.10(첫 처치 회차 0초 프레임)에 쓴다.
2. **reject 롤백 경합의 대칭 규칙** (Step 3 health 반대 방향 검사, ISC-5.13): reject 롤백이 am 루틴 clone(07:10)과 data push 사이에 적용되면 그 am 회차는 action·v1 짝으로 정상 발행된다. 그런데 flagsSince가 그 회차부터라서(`experiment.mjs:520`) 반대 방향 검사가 거짓 ALERT를 내고 ISC-5.13은 거짓 FAIL이 된다.
   - health: 활성화 쪽 규칙(1회 WARN)과 대칭으로, flagsSince 이후 **첫 회차 1건만** action·v1 짝이면 WARN으로 둔다. 두 번째 회차부터 action 또는 v1이 나오면 ALERT다. health self-test에 이 WARN 케이스를 추가한다.
   - ISC-5.13: S1·S2는 "flags 원복 커밋 시각 뒤에 clone한 첫 2회차"로 정의한다(루틴 clone 시각 am 07:10·pm 17:15 기준).
3. **R3 veto 뒤 원복 커밋의 창** (Step 5 사전등록 결정 5 "R3 veto 뒤 원복"): 원복 커밋은 창 B(20:00~다음 날 04:30)에 넣는다. 같은 날 am·pm이 같은 빌드 조건이어야 하고, 다음 am 루틴이 원복된 flags를 읽게 하기 위해서다.
