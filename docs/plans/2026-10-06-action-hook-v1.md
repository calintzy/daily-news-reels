# 계획: action-hook-v1 (물어오리 B안, 행동 번역 훅)

작성 2026-10-06 (main `a2c6ca0` 기준). 상태: critic APPROVE WITH CHANGES(필수 6건·권고 5건) 반영본, 2026-10-06. 구현 전에 이 문서만 읽으면 되도록 썼다.

## Intent

- Problem: 물어오리 single 회차의 평균 시청 중앙값은 3.59초(10/6 스냅샷, 10회차)로 0~4.5초 훅 구간 안에서 이탈이 끝난다. 같은 소재(검찰청 폐지)에서 뉴닉은 0.1초에 시청자의 행동 질문("검찰청 없어지면 고소장 어디에 내야 되죠?")을 던져 117.5만 뷰를 냈고, 물어오리 10/01-pm은 사실 통보형 훅("내일 검찰청이 사라집니다.")으로 122뷰였다. 그 회차 rank1 원문 제목에도 "내 사건 수사할 수 있는 기관부터 확인"이라는 행동 각도가 이미 있었다.
- Proposed outcome: single-issue-v1 판정이 적용되는 insights 실행(예상 10/9)에서 판정기가 B안 항목을 자동 활성화해 계정이 유휴가 되지 않는다. 처치 회차는 hookLine을 "행동 번역형"으로 쓰고, 판정기가 회차별 기록으로 처치 여부를 확인한다.
- Affected users and systems: 물어오리(@muleori.news) 시청자 / 클라우드 루틴 daily-news-reels-am·pm(REELS_SPEC.md), `scripts/flags.mjs`, `scripts/render.mjs`, `.github/workflows/reels.yml`·`contract-check.yml`, `experiments/queue.json`, 신규 `contracts/hook-muleori-action/`, 신규 사전등록 문서.
- Constraints: 유지할 것은 기존 ratchetlock 계약 3종, validate.mjs의 rank1 원문 대조 게이트, single-issue-v1의 임계값, 오리 기자 계정 전체. 범위 밖은 상시 2줄 헤드라인, 댓글 키워드 DM CTA, 렌더 컴포지션(`reels/`) 변경, rank1 선정 기준 변경, KPI 추가.
- Open questions: 아래 "Open Questions" 절 참조(임계값 재계산 시점, B안 다음 라우팅, 처치 자기신고 감사 방식).

## Context (조사로 확인한 사실)

### 판정기 동작 (`scripts/experiment.mjs`)
- `--lint` 모드가 있다. 출력은 `queue OK` 한 줄, 실패면 `queue lint FAIL (N건)`과 exit 1. CI(contract-check)도 이 모드를 돌린다.
- **lint가 실패하면 insights 실행은 판정·전환을 전부 건너뛴다**(exit 0). 따라서 큐 변경이 lint를 깨면 10/8 판정 자체가 사라진다.
- ready 항목의 필수 필드: `flags`(허용 키만, `checkFlags`), `evidence` 1개 이상(`{path: "{stem}" 포함, equals}` 또는 `{data, nonEmpty: true}`, data 쪽은 equals를 지원하지 않는다), `samples`, `extendTo`(> samples), `adopt` 1개 이상, `reject` 배열, `next`(같은 계정의 큐 항목).
- 적용 단계(판정 후 20시간 이상 경과한 다음 실행): reject면 flags를 `state.flagsBefore`로 되돌리고, 그다음 `next[verdict]`가 ready이면 `activate`가 **현재 flags 위에 항목 flags를 병합**한다. veto면 flags를 그대로 두고 다음 실험을 켜지 않으며 `hold: true`가 된다.
- 판정 단계: 14회차가 차면 reject를 먼저 보고, 중간 구간이면 같은 창을 28회차로 1회 연장한다(이때는 pending이 생기지 않는다). inconclusive는 연장 뒤에만 나온다.
- `nextStem`: 활성화 시점에 data가 이미 커밋된 회차의 다음 회차가 startStem이 된다.
- 현재 진행: 10/6 스냅샷 기준 유효 표본 10/14(dry-run 실측). 하루 2회차씩 차므로 10/8 insights에서 14/14가 되어 판정이 나올 가능성이 높다.

### 플래그가 루틴에 닿는 경로
- 현재 클라우드 루틴은 `experiments/flags.json`을 읽지 않는다. 플래그는 reels.yml의 `scripts/flags.mjs` 해석 스텝에서만 쓰이고(포맷·TTS는 렌더 단계 레버), hookLine은 루틴(LLM)이 데이터 작성 시점에 결정한다.
- 따라서 훅 처치는 **루틴이 clone 스냅샷의 flags.json을 읽고 분기**해야 한다. 루틴과 Actions가 서로 다른 시점의 flags를 볼 수 있다(insights가 07:00~09:15 사이에 flags를 커밋하므로 am 회차와 경합). 처치 여부의 증거는 Actions가 다시 판단하지 말고 루틴이 실제로 쓴 값을 기록해야 한다.
- `flags.mjs`의 허용 키는 `REEL_FORMAT_MULEORI`, `TTS_ENABLED` 두 개뿐이다. 새 키를 넣지 않으면 B 항목은 lint에서 떨어진다.

### 훅 게이트
- `contracts/hook-muleori/`(v2: 미완결형·당사자형·수치 대비형, 물음표 금지) 3회 동결, CI step이 계약별로 하드코딩돼 있다. `depsHash`가 `scripts/rewrite-probes.cjs`를 묶고 있어 이 파일을 고치면 계약 3종을 모두 다시 동결해야 한다.
- validate.mjs는 물음표를 막지 않는다. 존댓말 정규식(`HONORIFIC_RE`) 실측 결과: "어디에 내야 되죠?"는 **FAIL**(`죠` 미포함), "어디에 내야 할까요?"와 "얼마나 줄어들까요?"는 PASS. 행동 번역 훅의 의문형은 `~까요?/~나요?` 계열이어야 한다.
- 사실성 게이트는 숫자·라틴 토큰·따옴표 속 한글만 원문과 대조한다. 행동 질문의 "고소장" 같은 일반 명사는 통과하므로, 원문 근거 규칙은 프롬프트와 계약 프로브가 맡는다.

### 기록 파일
- `render.mjs`가 `docs/formats/<stem>.txt`(single|digest)와 `docs/arms/<stem>.txt`(tts|control|control-fallback)를 쓰고, reels.yml이 `git add docs/videos docs/previews docs/arms`와 `[ -d docs/formats ] && git add docs/formats`로 커밋한다. cleanup.mjs는 영상·프리뷰·이미지만 지운다.

### 실측 분포 (metrics/2026-10-06.json, 24시간 성숙분)
| 구간 | n | avg_watch 중앙값 | n=14 부트스트랩 중앙값 5% / 50% / 95% | shares/1000reach | views 중앙값 |
|---|---|---|---|---|---|
| single (9/30-am~10/4-pm) | 10 | 3.59초 | 3.26 / 3.59 / 4.93 | 0.9 (shares 1건) | 131.5 |
| digest (9/14-am~9/29-pm, 훅 v1) | 32 | 3.14초 | 2.71 / 3.14 / 3.81 | 0.0 | 130 |

- single의 am/pm 차이가 크다: am 5회 중앙값 5.32초, pm 5회 중앙값 3.00초. 연속 14회차 창은 am 7, pm 7로 균형이 맞지만 제외가 한쪽에 몰리면 흔들린다.
- shares는 10회차에 1건이라 판정 지표로 쓸 수 없다. single-issue-v1의 채택 조건(shares ≥5)이 사실상 도달 불가였던 같은 실수를 반복하지 않는다.

## 결정 1: 처치 범위는 훅 프레임 하나

- 권고: `hookLine` 작성 규칙만 행동 번역형으로 바꾼다. 상시 헤드라인, 댓글 키워드 CTA, 목차 바, 기사 캡처는 넣지 않는다.
- 근거: (1) 시청 이탈이 첫 3~4초 안에 끝나므로 14.4초 CTA는 avg_watch를 움직일 수 없고, 댓글 DM 자동화는 Graph API 권한이 미확인이다(HANDOFF 다음 할 일 3). (2) 상시 헤드라인은 렌더 컴포지션 변경이라 C안(0초 프레임 시각 처치)의 영역이고, 같이 바꾸면 효과를 나눌 수 없다. (3) 훅만 바꾸면 루틴 텍스트 분기 하나로 끝나 렌더·레이아웃 위험이 없다.
- 대안(묶음): 훅 + CTA 문구만 동시 변경. 기대 효과는 댓글 수인데 KPI에 댓글이 없어 판정에 반영되지 않는다. 묶는다면 리스크 R6으로 기록하고 판정 문서에 "복합 처치"로 표기해야 한다. 권고하지 않는다.

## 결정 2: 판정 결과별 라우팅과 flags 병합

B안 항목을 기반 포맷별로 두 개 둔다. 처치(flags)는 같고, evidence와 임계값만 기반 포맷에 맞춘다. 큐 항목은 정적이라 판정 전에 기반 포맷을 알 수 없기 때문이다.

- `action-hook-v1`: single 기반(adopt·inconclusive에서 진입)
- `action-hook-v1-digest`: digest 기반(reject 롤백 뒤 진입)
- 두 항목 모두 `flags: {"HOOK_FRAME_MULEORI": "action"}` 하나만 갖는다. 포맷·TTS 키를 넣으면 reject 롤백을 activate가 다시 덮어쓰므로 넣지 않는다.

| single-issue-v1 판정 | 예상 시점 | 적용 시 flags 처리 | next(권고) | B 활성화 후 muleori flags | B의 flagsBefore(롤백 기준) |
|---|---|---|---|---|---|
| adopt (14회차) | 10/8 판정, 10/9 적용 | 유지 | `action-hook-v1` | `{"REEL_FORMAT_MULEORI":"single","TTS_ENABLED":"1","HOOK_FRAME_MULEORI":"action"}` | `{single, 1}` |
| reject (14회차) | 10/8 판정, 10/9 적용 | `flagsBefore`로 롤백 `{"", "0"}` | `action-hook-v1-digest` | `{"REEL_FORMAT_MULEORI":"","TTS_ENABLED":"0","HOOK_FRAME_MULEORI":"action"}` | `{"", "0"}` |
| 중간 (14회차) | 10/8 | 28회차로 연장, 적용 없음 | 해당 없음 | 변화 없음(single 계속) | 해당 없음 |
| inconclusive (연장 28회차) | 약 10/15 판정, 10/16 적용 | 유지 | `action-hook-v1` | adopt 행과 같음 | `{single, 1}` |
| veto (어느 판정이든) | 판정 다음 날 | 유지(reject여도 롤백 안 함) | 활성화 안 함, `hold: true` | `{single, 1}` 그대로 | 해당 없음 |

- adopt의 next 권고는 `signals-actions`가 아니라 `action-hook-v1`이다. 근거: signals-actions는 draft이고 critic 필수 수정 5~9가 남아 있어 ready로 만들 수 없다(그대로 두면 adopt 시 유휴). 또 B안은 같은 single 기반에서 훅 한 변수만 바꾸므로 adopt 직후가 가장 깨끗한 비교 조건이다. adopt가 나오면 single이 "새 기준선"이 되고 그 위에 B를 얹는 것이 한 번에 한 변수 원칙에 맞는다.
- reject 권고는 사전등록대로 롤백한 뒤 digest 위에서 B를 돌리는 것이다. 단 digest 기준 시청(3.14초)이 single(3.59초)보다 낮아, 롤백 자체가 지표를 낮출 수 있다. 대안: Ryan이 veto하고 `state.muleori.hold`를 지우면, 판정기 2단계가 큐 순서상 첫 ready 항목을 켠다. 큐에서 `action-hook-v1`을 `-digest`보다 앞에 두면 veto 경로는 single 기반 B로 이어진다(flags는 veto로 single 유지). 이 경로는 사전등록 기각 규칙을 사람이 뒤집는 것이므로 판정 문서에 사유를 남긴다.
- `d-plan-character`(D안)는 draft로 남기고 어떤 next도 가리키지 않는다. Ryan이 10/6 B안을 확정했다.

### 거부권 흐름
- 판정 기록(10/8 insights) 뒤 다음 insights 실행 전까지 `experiments/state.json`의 `muleori.pending.veto`를 `true`(따옴표 없이)로 바꾼 커밋을 main에 올린다. 커밋 시각은 10/8 09:30 ~ 10/9 04:30 KST. 끝을 04:30으로 잡는 이유는 R10(insights가 05:00 예약대로 일찍 시작할 수 있음)이다.
- veto 결과: history에 `vetoed: true`, flags 유지, `hold: true`. B를 켜려면 hold를 지우는 커밋이 필요하다.

### 첫 처치 회차 계산
- 적용 조건: 판정 후 20시간 이상. 10/8 판정이 07:00~09:15이면, 10/9 실행이 07:00 이후일 때 21.75시간 이상이라 10/9에 적용된다. 10/9 실행이 05:00대에 일찍 돌면(34회 중 3회 빈도) 판정 시각에 따라 갈린다. 10/8 판정이 09:00 이전이었다면 20시간을 넘겨 05:00대에 바로 활성화되고, 그 뒤였다면 10/10로 밀린다.
- 활성화 커밋 시각과 am 루틴(07:10 clone)의 순서로 갈린다.
  - 일반적인 경우(insights가 10/9-am data 커밋 뒤에 실행): startStem `2026-10-09-pm`. pm 루틴(17:15)이 action flags를 clone하므로 **첫 처치 회차는 2026-10-09-pm**이다.
  - insights가 07:10 clone 전에 flags를 push한 경우: startStem `2026-10-09-am`, 그 회차부터 처치.
  - insights 커밋이 07:10 clone과 am data 커밋 사이인 경우: startStem은 `2026-10-09-am`이지만 루틴은 v2로 썼다. evidence(`docs/hooks`=action)가 이 회차를 `evidence` 사유로 제외하므로 유효 표본은 10-09-pm부터 시작된다.
- 14회차 창: 10-09-pm부터 10-16-am까지. 24시간 성숙 후 약 10/18 insights 판정, 10/19 적용 예상(제외가 없을 때).
- 중간 판정으로 연장되면: 28회차(9/30-am~10/13-pm)가 약 10/15에 차고 10/16 적용, 첫 처치 회차는 약 2026-10-16-pm.

## 결정 3: 루틴 분기와 처치 증거 설계

- 새 플래그 키 `HOOK_FRAME_MULEORI`, 값은 `""`(기본, 훅 v2) 또는 `"action"`.
- 루틴이 조건을 직접 해석하지 않도록 결정론적 헬퍼를 둔다: `node scripts/flags.mjs --hook-prompt`가 clone된 `experiments/flags.json`을 읽어 사용할 프롬프트 경로와 프레임을 한 줄로 출력한다. 알 수 없는 값·파일 손상이면 v2와 경고를 출력한다(실패 시 기존 동작으로 떨어지는 fail-safe).
  ```
  contracts/hook-muleori/prompt.txt frame=v2           ← 현재 flags.json
  contracts/hook-muleori-action/prompt.txt frame=action ← HOOK_FRAME_MULEORI=action
  ```
- REELS_SPEC.md는 **기존 줄을 지우거나 고치지 않고** hookLine 항목 아래에 "실험 분기" 하위 항목을 추가한다: hookLine을 쓰기 전에 헬퍼를 실행하고 출력된 프롬프트를 정본으로 쓴다. `frame=action`일 때만 데이터 최상위에 `"hookFrame": "action"`을 쓰고, v2면 필드를 쓰지 않는다. 플래그가 꺼진 동안 루틴이 읽는 훅 규칙 텍스트는 헬퍼가 가리키는 기존 `contracts/hook-muleori/prompt.txt` 그대로다.
- **우선 조항(하위 항목 첫 문장에 넣는다)**: "헬퍼 출력이 `frame=action`이면, 이 스펙의 hookLine 관련 기존 문구, 곧 데이터 계약 예시의 hookLine 설명(현재 32행), '존댓말 평서형 종결(물음표·의문형 금지)'(현재 70행), '정본은 `contracts/hook-muleori/prompt.txt`'(현재 72행)는 적용하지 않고 헬퍼가 출력한 프롬프트만 따른다. 30자 상한과 rank1 원문 사실성 규칙은 두 프롬프트에 모두 있으므로 그대로 지킨다." 이 조항이 없으면 LLM이 "물음표 금지"와 새 프롬프트의 "의문형 허용"을 동시에 읽고 임의로 고른다.
- 이 스펙 변경은 LLM이 읽는 유일한 변경이라 2차 배포로 분리한다(결정 6).
- 증거 기록: `render.mjs`가 formats 기록 바로 옆에서 `docs/hooks/<stem>.txt`를 쓴다. 값은 `data.hookFrame === "action"`이면 `action`, 아니면 `v2`(물어오리만, aibrief는 쓰지 않는다). reels.yml에 `[ -d docs/hooks ] && git add docs/hooks`를 추가한다. 이 값은 Actions 시점의 flags가 아니라 루틴이 실제로 쓴 데이터에서 나오므로 경합이 있어도 사실과 맞다.
- B 항목 evidence:
  - `action-hook-v1`: `docs/hooks/{stem}.txt`=action, `docs/formats/{stem}.txt`=single, `docs/arms/{stem}.txt`=tts, `issues.0.narration` nonEmpty
  - `action-hook-v1-digest`: `docs/hooks/{stem}.txt`=action, `docs/formats/{stem}.txt`=digest, `docs/arms/{stem}.txt`=control
- validate.mjs는 바꾸지 않는다. hookFrame 값 오타는 render가 v2로 기록하고 evidence가 그 회차를 제외한다(결방 없음).
- 대안(기각): `{data: "hookFrame", nonEmpty: true}`만 쓰는 방식은 값 대조가 안 돼 v2 회차가 실수로 필드를 써도 통과하고, 판정기를 고쳐 data equals를 지원하는 방식은 판정기 self-test 회귀 범위가 넓다.

## 결정 4: 새 프롬프트 변형을 기존 계약을 건드리지 않고 추가

- 별도 계약 디렉토리 `contracts/hook-muleori-action/`를 만든다(contracts/hook에서 hook-muleori를 분리했던 9/14 선례와 같은 방식). 기존 `contracts/hook-muleori/`의 prompt·asserts·tests·ratchet.json은 한 바이트도 바꾸지 않는다.
- prompt.txt 규칙 요지(정본은 구현 시 작성):
  - 이 뉴스 때문에 시청자가 해야 하는 일, 또는 시청자에게 바뀌는 것을 질문이나 당사자 행동 문장으로 쓴다.
  - 의문형 허용. 종결은 `~까요?`, `~나요?`, `~어요?` 계열로 쓰고 `~죠?`는 쓰지 않는다(validate 존댓말 게이트 FAIL 실측).
  - 원문 근거: 평서형 행동 문장은 그 행동·변화가 원문에 있을 때만 쓴다. 질문형은 원문(제목·설명)이 답을 담고 있는 질문만 쓴다. 30자, 원문 밖 수치·고유명사 금지, 제목 축약 금지는 v2와 같다.
  - 행동 각도가 원문에 없는 사건형 rank1(사고·범죄)은 "시청자 관점 질문" 폴백을 쓴다(예: 원문이 답하는 "누가 책임지나요?" 형태). 지어낸 영향은 금지한다.
- asserts.js: hook-muleori의 프로브(30자·존댓말·rank1 사실성·제목 중복)를 그대로 가져오고 `actionFrame` 프로브를 하나 더한다. `scripts/rewrite-probes.cjs`는 require만 하고 수정하지 않는다(depsHash 보존).
- **actionFrame 판정 규칙(확정)**. 공백을 정규화한 훅 문장이 아래 둘 중 하나를 만족하면 PASS, 아니면 FAIL이고 사유 문자열은 `행동 번역 없음`이다.
  1. 의문형: 문장이 `?`로 끝나고 `/(어디|언제|누가|누구|무엇|뭘|뭐|어떻게|얼마|몇|왜)|야 ?(할|합|하|해|돼|되|됩)/`에 걸린다(의문사 또는 "~야 할/해" 의무 표지). 종결 어미 자체(`까요/나요/가요/어요` 등)는 기존 존댓말 프로브가 판정하고 `~죠?`는 거기서 FAIL한다.
  2. 평서형: `/야 ?(합니다|해요|됩니다|돼요)|수 (있|없)(습니다|어요)|세요[.!]?$/`에 걸린다(의무, 가능, 권유 종결).
  - 이 두 정규식으로 아래 기대 표 7행 중 정규식이 맡는 6행을 10/6에 실측해 전부 기대대로 나왔다(추가로 "신청은 내일부터 할 수 있습니다.", "대출 받을 때 꼭 확인하세요."도 PASS).
  - 변화 동사만 있는 문장(`사라집니다`, `오릅니다`, `바뀝니다`, `달라집니다`)은 위 표지가 없으므로 FAIL한다. 의문사 없는 예/아니오 질문("검찰청이 사라질까요?")도 FAIL한다.
  - 기대 판정 표(구현 시 asserts.js 주석에 그대로 둔다):

  | 문장 | 기대 |
  |---|---|
  | 고소장, 이제 어디에 내야 할까요? | PASS (의문형, `어디`) |
  | 내 대출 한도, 얼마나 줄어들까요? | PASS (의문형, `얼마`) |
  | 이제 고소장은 경찰서에 내야 합니다. | PASS (평서형, 의무) |
  | 내일 검찰청이 사라집니다. | FAIL (변화 동사만) |
  | 주유소 가격, 곧 오릅니다. | FAIL (v2 당사자형, 변화 동사만) |
  | 검찰청이 사라질까요? | FAIL (의문사·행동 표지 없음) |
  | 검찰청 없어지면 고소장 어디에 내야 되죠? | FAIL (존댓말 프로브, `죠`) |

- tests.yaml: 실측 rank1 원문 4건 이상. 10/01-pm 검찰청 회차(원문 제목 "檢 폐지 D-1…법조계 내 사건 수사할 수 있는 기관부터 확인")를 반드시 포함하고, 행동 각도가 없는 사건형 1건(예: 10/05-pm 오키나와)을 포함한다.
- 음성 대조군 2건, 둘 다 사실성·길이·존댓말은 통과하고 actionFrame에서만 떨어지도록 만든다.
  - `negative-no-action.txt`: 사실 통보형 "내일 검찰청이 사라집니다." + 10/01-pm 원문 vars.
  - `negative-v2-party.txt`: v2 당사자형 "주유소 가격, 곧 오릅니다." + vars. vars는 가격 인상이 적힌 실측 rank1 원문을 data/에서 찾아 쓰고, 없으면 음성 대조군 전용 합성 vars임을 파일 옆 주석(promptfooconfig.yaml 머리말)에 적는다.
  - 두 표본 모두 `ratchetlock lint`가 exit 1이고 출력에 `행동 번역 없음`이 있어야 한다. 다른 사유로 떨어지면 표본이 actionFrame을 시험하지 못하므로 표본을 고친다.
- 동결: `--live` freeze(claude CLI 프로바이더)로 기준선을 만들고 contract-check.yml에 두 단계를 추가한다. 하나는 `cd contracts/hook-muleori-action && npx ratchetlock check --probe-locked`이고, 다른 하나는 음성 표본 2건을 lint해서 **하나라도 exit 0이면 단계가 exit 1**을 내는 반전 단계다(기존 "판정기 음성 대조군" 단계와 같은 형태).

## 결정 5: 판정 기준 사전등록

문서 위치: `experiments/preregistration/action-hook-v1.md`(single-issue-v1-addendum.md와 같은 디렉토리, 두 큐 항목의 `prereg` 필드가 이 파일을 가리킨다). 지표 공식·스냅샷·제외 규칙은 single-issue-v1 부록 2·4절을 그대로 인용하고, evidence 표만 위 결정 3으로 바꾼다.

| 항목 | samples / extendTo | adopt (AND) | reject | 근거 |
|---|---|---|---|---|
| action-hook-v1 (single 기반) | 14 / 28 | avgWatchMedian ≥ 4.9 AND viewsMedian ≥ 100 | avgWatchMedian < 3.3 | am/pm 구성 변동 범위: am 7·pm 7 구성에서 무처치 n=14 부트스트랩 95% 4.93, 5% 3.26. 이 범위를 벗어나야 결론을 낸다. views 하한은 TTS A/B에서 본 도달 감소 패턴을 막는 가드(single 중앙값 131.5) |
| action-hook-v1-digest (digest 기반) | 14 / 28 | avgWatchMedian ≥ 3.8 AND viewsMedian ≥ 100 | avgWatchMedian < 2.7 | am/pm 구성 변동 범위: digest n=14 부트스트랩 95% 3.81, 5% 2.71 (9/14~9/29, 훅 v1 시기) |

- **am/pm 구성 규칙(사전등록 본문에 넣는다)**: B 판정이 기록되면 판정 문서 "회차별" 표의 유효 표본에서 am 수와 pm 수를 센다. 차이가 2 이상이면 판정 문서의 verdict와 상관없이 거부권 창 안에 veto하고, 사전등록·판정 문서에 "am/pm 구성 무결론"으로 기록한다. 근거: critic의 층화 부트스트랩 결과, 처치 효과가 없어도 am 9·pm 5 구성이면 채택 확률이 18.5%, am 6·pm 8 구성이면 기각 확률이 10.4%다. 위 임계값은 7/7 구성에서만 잡음 범위를 뜻한다. veto 후 계정은 `hold`로 멈추며, 다음 실험은 사람이 hold를 풀어 정한다.
- 이 규칙은 B 항목에만 적용한다. single-issue-v1의 사전등록은 바꾸지 않는다(Anti-ISC-4).
- shares·saved는 기록만 하고 조건에 넣지 않는다(10회차에 shares 1건).
- 임계값은 처치 데이터가 생기기 전(첫 처치 회차 전)까지만 고칠 수 있다. 10/8 스냅샷으로 14회차 분포를 다시 계산해 위 값과 0.2초 넘게 다르면 2차 배포와 같은 창(10/8 09:30 ~ 10/9 04:30)에 큐와 사전등록을 함께 고친다.
- B 항목의 `next`: 세 판정 모두 `signals-actions`(draft). 판정 후 `waitingFor`로 대기하고 health가 WARN queue로 알린다. 다음 실험이 정해지면 그때 ready로 바꾼다.

## 결정 6: 배포를 둘로 나눈다

| 구분 | 내용 | LLM이 읽는가 | 배포 창(KST) |
|---|---|---|---|
| 1차 | flags 키·`--hook-prompt` 헬퍼, 큐·라우팅, 사전등록, render의 docs/hooks 기록, reels.yml git add, 판정기 재빌드 감지 한 줄, 새 계약·CI 단계, 판정기 self-test 케이스 | 아니다(REELS_SPEC이 헬퍼를 아직 가리키지 않으므로 루틴 입력은 바이트 단위로 같다) | 10/6 20:00 ~ 10/7 04:30(권고) 또는 10/7 20:00 ~ 10/8 04:30 |
| 2차 | REELS_SPEC.md 실험 분기 하위 항목(우선 조항 포함)만 | 그렇다 | 10/8 판정이 adopt·reject로 확정된 뒤 10/8 09:30 ~ 10/9 04:30. 중간(연장)이면 보류하고, 연장 판정이 기록된 날 09:30부터 다음 날 04:30 사이에 배포한다. 10/8에 판정이 안 나오면(wait) 판정이 나온 날로 하루씩 민다 |

- **1차 창의 근거**: 1차 변경은 LLM 입력을 바꾸지 않지만, render가 쓰는 기록과 Actions 단계가 바뀌므로 "같은 날 am과 pm은 같은 빌드 조건"이라는 회차 사이 원칙을 따른다. pm 루틴(17:15)·백업(17:45)과 pm 빌드·발행이 끝난 20:00 이후, 다음 날 05:00(insights 예약 시각, R10) 전인 04:30까지로 잡는다. am 루틴 clone(07:10)도 이 창 뒤다. 오늘 밤 창을 권고하는 이유는 10/7 am·pm 빌드로 docs/hooks=v2 기록과 CI를 하루 먼저 실회차에서 확인할 수 있어서다(ISC-5.2).
- **판정 전에 1차를 배포하는 이유**: 라우팅(`next`)은 적용 시점(10/9)에 읽히므로 기술적으로는 10/8 판정 뒤에 넣어도 동작한다. 그래도 판정 전에 넣는 이유는 사전등록이다. 판정 결과를 보고 라우팅과 임계값을 고르면 사후 선택이 된다. 또 10/8 실행의 lint가 통과해야 판정이 기록되므로, 허용 키와 ready 항목은 같은 push에 넣는다.
- **2차를 판정 뒤로 미루는 이유**: 스펙 텍스트가 바뀌면 플래그가 꺼져 있어도 LLM이 읽는 입력이 달라진다. 10/8 판정이 중간이면 10/7~10/13 회차가 single-issue-v1 연장 창에 들어가므로 그 기간에는 스펙을 건드리지 않는다. adopt·reject가 확정된 뒤에는 single 창이 닫혀 오염될 표본이 없다.
- **2차 창의 끝**: 활성화가 가장 빨리 일어나는 시각은 10/9 05:00대 insights다(R10). 그 전에 스펙이 main에 있어야 첫 처치 루틴이 분기를 읽으므로 04:30을 끝으로 한다. 2차 누락은 ISC-3.4로 잡는다.

## Guardrails

### Must Have
- 플래그가 꺼진 동안 루틴이 쓰는 훅 규칙은 지금과 같아야 한다(1차 배포는 LLM 입력 무변경, 2차는 판정 확정 뒤).
- `HOOK_FRAME_MULEORI` 허용 키 추가와 B 항목 ready 추가는 같은 push(1차)에 들어간다(순서가 어긋나면 lint 실패로 10/8 판정이 사라진다).
- 1차 배포는 결정 6의 1차 창에, 2차 배포는 2차 창에 한다. 두 창 모두 insights 실행 시간대(05:00~09:30)를 피한다.
- 처치 증거는 루틴이 쓴 데이터에서 나온다(docs/hooks).

### Must NOT Have
- `contracts/hook-muleori/`, `contracts/hook/`, `contracts/rewrite/`, `scripts/rewrite-probes.cjs`, `scripts/validate.mjs` 변경.
- `experiments/state.json`·`flags.json`을 사람이 직접 수정. 예외는 veto 커밋과 veto 뒤 `hold` 해제 커밋 두 가지다.
- 1차 배포에 REELS_SPEC.md 변경을 섞는 것.
- single-issue-v1 항목의 flags·evidence·samples·adopt·reject 변경(바꾸는 것은 `next`뿐).
- `reels/`(컴포지션), `AI_REELS_SPEC.md`, 오리 기자 flags 변경.
- 헤드라인·CTA·선정 기준 동시 변경.

## Task Flow

### Step 1. 플래그 키와 훅 프롬프트 헬퍼
- 변경 파일: `scripts/flags.mjs`(허용 키 `HOOK_FRAME_MULEORI` 기본값 `""`, `--hook-prompt` 모드), `test/fixtures/experiments/`에 action 값·잘못된 값 flags 픽스처 2개.
- 완료 조건: ISC-1.x 전부 PASS.

### Step 2. 행동 번역 훅 계약 신설과 동결
- 변경 파일: `contracts/hook-muleori-action/`(prompt.txt, asserts.js, tests.yaml, promptfooconfig.yaml, provider.sh, ratchet.json, negative-no-action.txt·.vars.json, negative-v2-party.txt·.vars.json), `.github/workflows/contract-check.yml`(check 단계와 음성 표본 반전 단계 추가).
- freeze는 로컬 `--live`(claude CLI 필요, ratchetlock은 타르볼 URL 설치. memory `ratchetlock-install-notes.md`).
- 완료 조건: ISC-2.x PASS, Anti-ISC-1 PASS. (1차 배포)

### Step 3. 처치 기록(3a, 1차)과 스펙 분기(3b, 2차)
- 3a 변경 파일: `scripts/render.mjs`(물어오리 회차에 `docs/hooks/<stem>.txt` 기록), `.github/workflows/reels.yml`(git add 화이트리스트에 docs/hooks).
- 3b 변경 파일: `REELS_SPEC.md`(hookLine 항목 아래 실험 분기 하위 항목 추가. 첫 문장은 결정 3의 우선 조항. 데이터 계약 예시 아래에 선택 필드 `hookFrame` 설명 추가. 기존 줄 삭제·수정 없음). 3b는 구현을 1차 때 브랜치에 같이 만들어 두되 main에는 2차 창에만 머지한다.
- 완료 조건: 3a는 ISC-3.3, 3b는 ISC-3.1·3.2·3.4·3.5와 Anti-ISC-2·3·6 PASS.

### Step 4. 큐 항목·라우팅·사전등록 (1차)
- 변경 파일: `experiments/queue.json`(`action-hook-v1`, `action-hook-v1-digest`를 ready로 추가하고 이 순서로 signals-actions 앞에 둔다. single-issue-v1의 `next`를 `{adopt: action-hook-v1, reject: action-hook-v1-digest, inconclusive: action-hook-v1}`로), `experiments/preregistration/action-hook-v1.md`(am/pm 구성 규칙 포함), `test/fixtures/experiments/cases.json`(세 판정별 활성화 flags, veto, docs/hooks=v2 회차의 evidence 제외 케이스), `scripts/experiment.mjs`(재빌드 감지 대상에 `docs/hooks/${stem}.txt` 한 항목 추가).
- 재빌드 감지 추가의 근거: `gitRebuiltFn`은 발행 마커 뒤에 기록 파일 **내용이 바뀐 커밋**만 본다. hookLine만 고쳐 재빌드하면 formats·arms는 같은 값으로 다시 써져 커밋에 안 잡히고, hookFrame이 v2와 action 사이에서 바뀐 재빌드는 docs/hooks만 바뀐다. 처치 자체가 바뀌는 재빌드를 놓치지 않으려면 한 줄을 추가해야 한다. self-test는 `isRebuilt`를 주입하므로 이 한 줄은 ISC-4.11의 grep으로 확인한다.
- 완료 조건: ISC-4.x PASS, Anti-ISC-4·5 PASS.

### Step 5. 배포와 운영 확인
- 1차: 결정 6의 1차 창에 Step 1·2·3a·4를 한 push로 배포하고 contract-check 녹색을 확인한다.
- 10/8 insights 뒤 판정을 확인한다. adopt·reject면 2차 창에 Step 3b를 배포한다. reject면 같은 창 안에 veto 여부를 Ryan이 정한다(Open Question 4).
- 적용 실행 뒤 활성화·startStem을 확인하고, 첫 처치 회차의 data·docs/hooks·영상 훅을 확인한다. B 판정이 나오면 am/pm 구성 규칙(ISC-5.7)을 먼저 적용한다.
- 완료 조건: ISC-5.x PASS, Anti-ISC-6·7 PASS.

## Criteria

`BASE=a2c6ca0`(이 계획 작성 시점 main). `SIM`은 시뮬레이션용 스크래치 디렉토리. 시뮬레이션 공통 준비:
`SIM=$TMPDIR/expsim-$RANDOM && mkdir -p $SIM && cp -R experiments data published $SIM/ && node -e 'const f=require("fs"),p=process.argv[1]+"/experiments/state.json",s=JSON.parse(f.readFileSync(p));s.muleori.pending={verdict:process.argv[2],decidedAt:"2026-10-08T08:00:00+09:00",file:"x",veto:process.argv[3]==="veto"};f.writeFileSync(p,JSON.stringify(s))' $SIM <verdict> [veto]`
(10/6 실측: 이 방식으로 현재 큐에 reject를 넣으면 `next.reject=d-plan-character, status=draft — 대기`가 출력됨. 프로브가 동작함을 확인했다.)

### Step 1
- ISC-1.1: `node scripts/flags.mjs --hook-prompt` → `contracts/hook-muleori/prompt.txt frame=v2` → pass/fail
- ISC-1.2: `FLAGS_FILE=test/fixtures/experiments/flags-hook-action.json node scripts/flags.mjs --hook-prompt` → `contracts/hook-muleori-action/prompt.txt frame=action` → pass/fail
- ISC-1.3: `FLAGS_FILE=test/fixtures/experiments/flags-hook-bad.json node scripts/flags.mjs --hook-prompt 2>/dev/null; echo "exit=$?"` → stdout이 `contracts/hook-muleori/prompt.txt frame=v2`와 `exit=0` 두 줄뿐이다(잘못된 값은 v2로 폴백, 경고가 stdout에 섞이지 않음) → pass/fail
- ISC-1.4: `node scripts/flags.mjs --check experiments/flags.json` → `flags check: PASS` → pass/fail
- ISC-1.5: `node scripts/flags.mjs data/2026-10-06-am.json 2>/dev/null | grep -c '^HOOK_FRAME_MULEORI= '` → `1` (기본값 빈 문자열로 해석) → pass/fail
- ISC-1.6: `FLAGS_FILE=test/fixtures/experiments/flags-hook-bad.json node scripts/flags.mjs --hook-prompt 2>&1 >/dev/null | grep -c '경고'` → `1` (폴백 사실은 stderr로만 알린다) → pass/fail

### Step 2
- ISC-2.1: `cd contracts/hook-muleori-action && npx ratchetlock check --probe-locked > $TMPDIR/hma.log 2>&1; echo $?` → `0` → pass/fail
- ISC-2.2 (음성 대조군): `cd contracts/hook-muleori-action && node ../../node_modules/ratchetlock/dist/cli.js lint --output negative-no-action.txt --vars negative-no-action.vars.json > $TMPDIR/neg.log 2>&1; echo $?` → `1` (사실 통보형 훅은 actionFrame에서 반드시 잡힌다. 0이면 프로브 고장) → pass/fail
- ISC-2.3: `jq '.frozen[-1].cases | length' contracts/hook-muleori-action/ratchet.json` → `4` 이상 → pass/fail
- ISC-2.4: `grep -c '檢 폐지 D-1' contracts/hook-muleori-action/tests.yaml` → `1` 이상 (검찰청 실측 케이스 포함) → pass/fail
- ISC-2.5: `grep -c 'cd contracts/hook-muleori-action && npx ratchetlock check --probe-locked' .github/workflows/contract-check.yml` → `1` → pass/fail
- ISC-2.6: `jq -r '.frozen[-1].cases[].output' contracts/hook-muleori-action/ratchet.json | grep -c '죠?'` → `0` → pass/fail
- ISC-2.7 (음성 대조군 2): `cd contracts/hook-muleori-action && node ../../node_modules/ratchetlock/dist/cli.js lint --output negative-v2-party.txt --vars negative-v2-party.vars.json > $TMPDIR/neg2.log 2>&1; echo $?` → `1` (v2 당사자형 "주유소 가격, 곧 오릅니다."는 반드시 잡힌다) → pass/fail
- ISC-2.8: `grep -c 'negative-v2-party.txt' .github/workflows/contract-check.yml` → `1` 이상 (음성 표본 lint가 통과하면 exit 1을 내는 반전 단계가 CI에 있음) → pass/fail
- ISC-2.9: `cat $TMPDIR/neg.log $TMPDIR/neg2.log | grep -c '행동 번역 없음'` → `2` (두 음성 표본이 다른 사유가 아니라 actionFrame으로 떨어짐) → pass/fail

### Step 3
- ISC-3.1 (3b): `git diff $BASE -- REELS_SPEC.md | grep -c '^-[^-]'` → `0` (추가만 함) → pass/fail
- ISC-3.2 (3b): `grep -c 'node scripts/flags.mjs --hook-prompt' REELS_SPEC.md` → `1` 이상 → pass/fail
- ISC-3.3 (3a): `grep -c 'git add docs/hooks' .github/workflows/reels.yml` → `1` → pass/fail
- ISC-3.4 (2차 배포 누락 감지, 활성화 전 마지막 확인. 2차 창 끝 10/9 04:30 직후 실행): `git fetch -q origin && git show origin/main:REELS_SPEC.md | grep -c 'flags.mjs --hook-prompt'` → `1` (0이면 2차 배포 누락. 즉시 배포하거나, 시간이 없으면 활성화 전에 veto해 B 창이 v2 회차로 채워지는 것을 막는다) → pass/fail
- ISC-3.5 (3b): `grep -c '헬퍼가 출력한 프롬프트만 따른다' REELS_SPEC.md` → `1` (우선 조항 존재) → pass/fail

### Step 4
- ISC-4.1: `node scripts/experiment.mjs --lint` → `queue OK` → pass/fail
- ISC-4.2: `node scripts/experiment.mjs --self-test 2>&1 | tail -1` → `self-test N/N PASS` → pass/fail
- ISC-4.3: 준비(verdict=adopt) 후 `node scripts/experiment.mjs --root $SIM --dry-run --now 2026-10-09T08:00:00+09:00 | grep -c 'action-hook-v1 활성화 .*"REEL_FORMAT_MULEORI":"single","TTS_ENABLED":"1","HOOK_FRAME_MULEORI":"action"'` → `1` → pass/fail
- ISC-4.4: 준비(verdict=reject) 후 같은 명령 `| grep -c 'action-hook-v1-digest 활성화 .*"REEL_FORMAT_MULEORI":"","TTS_ENABLED":"0","HOOK_FRAME_MULEORI":"action"'` → `1` → pass/fail
- ISC-4.5: 준비(verdict=inconclusive) 후 같은 명령 `| grep -c 'action-hook-v1 활성화 .*"single"'` → `1` → pass/fail
- ISC-4.6: 준비(verdict=reject, veto) 후 같은 명령 `| grep -c ' 활성화 — startStem'` → `0` (veto 로그 문구 "다음 실험 활성화 안 함"에도 '활성화'가 들어 있으므로 activate 로그의 고유 문구로 센다) → pass/fail
- ISC-4.7: `node scripts/health.mjs --dry-run 2>&1 | grep -c '판정 후 계정이 유휴가 된다'` → `0` (10/6 현재 값은 `1`. 변경 전후 대조) → pass/fail
- ISC-4.8: `jq -r '.items[] | select(.id | startswith("action-hook")) | .prereg' experiments/queue.json | xargs ls | wc -l` → `2` → pass/fail
- ISC-4.9: `node scripts/experiment.mjs --self-test --cases test/fixtures/experiments/negative-cases.json > $TMPDIR/neg-exp.log 2>&1; echo $?` → `1` (기존 판정기 음성 대조군 유지) → pass/fail
- ISC-4.10: `grep -c 'am/pm 구성 무결론' experiments/preregistration/action-hook-v1.md` → `1` 이상 (am/pm 구성 규칙 사전등록) → pass/fail
- ISC-4.11: `grep -c 'docs/hooks/${stem}.txt' scripts/experiment.mjs` → `1` (재빌드 감지 대상) → pass/fail

### Step 5 (운영, 날짜 도래 시 실행)
- ISC-5.1 (1차 배포 직후): `gh run list -w contract-check.yml -L 1 --json conclusion -q '.[0].conclusion'` → `success` → pass/fail
- ISC-5.2 (1차 배포 뒤 첫 am 빌드 후, 권고 창이면 10/7-am): `git show origin/main:docs/hooks/2026-10-07-am.txt` → `v2` → pass/fail
- ISC-5.3 (10/8 insights 후): `git show origin/main:experiments/state.json | jq -r '.muleori.pending.verdict // (if .muleori.extended then "extended" else "wait" end)'` → `adopt`·`reject`·`extended`·`wait` 중 하나(결과를 이슈 #1과 대조) → pass/fail
- ISC-5.4 (적용 실행 후): `git show origin/main:experiments/state.json | jq -r '.muleori.active'` → 표의 next와 일치(`action-hook-v1` 또는 `action-hook-v1-digest`) → pass/fail
- ISC-5.5 (startStem 회차 빌드 후): `S=$(git show origin/main:experiments/state.json | jq -r .muleori.startStem); git show origin/main:data/$S.json | jq -r .hookFrame; git show origin/main:docs/hooks/$S.txt` → `action` 두 줄 → pass/fail
- ISC-5.6 (startStem 회차): `mkdir -p $TMPDIR/v/data && git show origin/main:data/$S.json > $TMPDIR/v/data/$S.json && node scripts/validate.mjs $TMPDIR/v/data/$S.json 2>&1 | tail -1` → `validate: PASS` (rank1 사실성 게이트 통과) → pass/fail
- ISC-5.7 (B 판정 기록 후, 거부권 창 안): `F=experiments/verdicts/action-hook-v1.md; [ -f $F ] || F=experiments/verdicts/action-hook-v1-digest.md; git show origin/main:$F | awk -F'|' '$3 ~ /유효/ { if ($2 ~ /-am /) a++; else p++ } END { d=a-p; if (d<0) d=-d; print (d<2 ? "balanced" : "veto") }'` → `balanced`면 판정대로, `veto`면 am/pm 구성 규칙에 따라 veto 커밋 → pass/fail은 "출력에 맞는 조치가 거부권 창 안에 main에 반영됐는가"로 판정 → pass/fail

### Anti-ISC
- Anti-ISC-1: `git diff --stat $BASE -- contracts/hook-muleori contracts/hook contracts/rewrite scripts/rewrite-probes.cjs | wc -l` → `0` (기존 ratchetlock 계약·공유 프로브 무변경) → pass/fail
- Anti-ISC-2: `git diff --stat $BASE -- scripts/validate.mjs reels AI_REELS_SPEC.md | wc -l` → `0` (사실성 게이트·렌더 컴포지션·오리 기자 스펙 무변경 = 헤드라인·CTA 미포함) → pass/fail
- Anti-ISC-3: `git diff $BASE -- REELS_SPEC.md | grep -c '^+.*\(헤드라인\|댓글에\|DM\)'` → `0` (처치 범위 훅 하나) → pass/fail
- Anti-ISC-4: `diff <(git show $BASE:experiments/queue.json | jq -c '.items[0] | del(.next)') <(jq -c '.items[0] | del(.next)' experiments/queue.json) && echo same` → `same` (single-issue-v1은 next만 변경) → pass/fail
- Anti-ISC-5: `git show --stat --format= <배포 커밋> -- experiments/state.json experiments/flags.json | wc -l` → `0` (배포가 판정기 소유 파일을 건드리지 않음) → pass/fail
- Anti-ISC-6 (개정, 1차 배포부터 2차 배포 직전까지 LLM 입력 불변): `git fetch -q origin && git diff --stat $BASE origin/main -- REELS_SPEC.md contracts/hook-muleori contracts/rewrite | wc -l` → `0`. 2차 배포 직전(10/8 판정 확인 직후)에 실행한다. 루틴이 hookLine을 쓸 때 읽는 파일은 이 셋뿐이므로, 이 diff가 비어 있으면 single-issue-v1 판정 창과 연장 창의 훅 규칙이 바이트 단위로 같았다는 증거가 된다. → pass/fail
  - 개정 사유: 이전 프로브(배포~활성화 회차의 `docs/hooks`가 v2이고 `hookFrame`이 없음)는 동어반복이었다. render는 hookFrame이 없으면 v2를 기록하고, 플래그가 꺼진 동안 스펙은 hookFrame을 쓰라고 하지 않는다. 그래서 그 프로브는 "필드를 안 썼다"를 두 번 잰 것이고, 스펙 문구가 바뀌어 훅 형태가 달라져도 그대로 통과했다. 훅 규칙이 바뀌었는지는 출력 기록이 아니라 루틴의 입력 파일로 판정해야 한다.
- Anti-ISC-7: `git show origin/main:experiments/flags.json | jq -c .aibrief` → `{}` (오리 기자 무영향) → pass/fail

## 리스크

| # | Threat | Mitigation |
|---|---|---|
| R1 | 허용 키 추가 없이 큐만 배포되면 lint FAIL로 10/8 판정이 통째로 생략된다 | 1차 배포를 한 push로, ISC-4.1을 push 직전 로컬과 CI(contract-check queue lint) 양쪽에서 확인 |
| R12 | 2차 배포(스펙 분기)가 누락되거나 늦으면 B가 활성화돼도 루틴이 v2로 써서 창 전체가 evidence 제외로 채워진다 | ISC-3.4를 2차 창 끝 직후에 실행, 0이면 즉시 배포하거나 활성화 전 veto |
| R2 | 루틴 LLM이 헬퍼 출력을 무시하거나 frame=action인데 hookFrame을 안 쓴다(또는 반대) | 증거는 docs/hooks로 기록되고 evidence 불일치 회차는 제외된다. 판정 문서 오염 경고(제외 30% 초과)와 health contamination WARN이 알린다 |
| R3 | hookFrame=action은 자기신고라 실제 훅이 행동 번역형이 아닐 수 있다 | 계약의 actionFrame 프로브로 프롬프트 회귀를 막고, 판정 전 거부권 창에서 창 회차 hookLine 14개를 사람이 훑는다(Open Question 3) |
| R4 | 행동 번역이 원문에 없는 영향을 지어내 낚시가 된다 | validate rank1 사실성 게이트 유지, 프롬프트에 "원문이 답하는 질문만" 규칙, 사건형 폴백 규칙, 계약 tests에 사건형 케이스 포함 |
| R5 | 의문형 `~죠?` 종결이 validate 존댓말 게이트에 걸려 루틴이 재작성을 반복하거나 결방 | 프롬프트에서 `~죠?` 금지와 허용 어미 명시, ISC-2.6, 루틴은 push 전 자가 validate 규칙이 이미 있음 |
| R6 | 처치를 묶으면(훅+CTA) 효과 귀속이 불가능 | 훅 하나로 한정(결정 1), Anti-ISC-2·3 |
| R7 | reject 롤백 시 digest 기반으로 돌아가 기준 시청이 낮아지고, digest+훅 v2 데이터가 없어 비교 기준이 9/14~9/29(훅 v1) 과거 분포다 | digest 전용 임계값을 따로 사전등록, 판정 문서에 기준 시기 명시, 대안으로 veto 후 single 기반 B 경로 제시 |
| R8 | am/pm 효과(single am 5.32초 vs pm 3.00초)가 커서 제외가 한쪽에 몰리면 중앙값이 흔들린다 | 사전등록의 am/pm 구성 규칙: 유효 표본 am/pm 차이가 2 이상이면 verdict와 상관없이 veto하고 "am/pm 구성 무결론"으로 기록(ISC-4.10, ISC-5.7). 근거는 critic 층화 부트스트랩(무처치에서 9/5 구성 채택 18.5%, 6/8 구성 기각 10.4%) |
| R9 | 배포가 single-issue-v1 연장 창(10/7~10/13 회차)과 겹친다 | 1차는 LLM 입력 무변경(Anti-ISC-6), 2차는 adopt·reject 확정 뒤에만. 중간이면 2차 보류 |
| R10 | insights가 05:00 예약대로 일찍 시작할 수 있다(34회 중 3회). 판정 시각에 따라 적용이 하루 밀리거나, 반대로 05:00대에 활성화가 먼저 일어난다 | 모든 배포·veto 창의 끝을 04:30으로 잡는다. 적용이 밀려도 계정은 single로 계속 발행되므로 유휴는 아니다 |
| R11 | 두 계정 동시 변동(외생 충격)이 처치 효과로 오인된다 | 판정기의 aibrief 동시 대조군·동반 급락 기록 유지. 단 오리 기자는 10/5 레이아웃이 바뀌어 대조군 기준선이 이동했다는 점을 판정 문서 해석에 적는다 |

## Success Criteria
- 10/9(또는 판정 적용일) insights 뒤 `state.muleori.active`가 B 항목 중 하나다. 이때 health의 WARN queue는 B 항목의 `next`가 draft(`signals-actions`)라서 나오는 예상된 상태이며 실패가 아니다.
- 첫 처치 회차의 data에 `hookFrame: "action"`, `docs/hooks`=action, validate PASS.
- 1차 배포부터 2차 배포 직전까지 루틴이 읽는 훅 관련 파일이 바뀌지 않았고(Anti-ISC-6), 기존 계약 3종 check가 녹색이다.

## Open Questions
1. 임계값을 10/8 스냅샷(14회차 완성)으로 재계산할지: 권고는 차이가 0.2초를 넘을 때만 10/8 09:30 ~ 10/9 04:30(2차 창)에 갱신. 대안은 지금 값으로 고정.
2. B안 판정 뒤 next: 권고는 세 판정 모두 `signals-actions`(draft, waitingFor 대기). 대안은 next 없음(hold로 정지).
3. 처치 자기신고 감사: 권고는 거부권 창에서 사람이 hookLine 14개를 훑는 수동 점검. 대안은 render에서 actionFrame 판정을 경고로 기록(코드 추가, 이번 범위 밖).
4. Ryan에게 물을 질문: "10/8 판정이 기각선(3.6초)과 0.01초 차이로 기각되면, 사전등록대로 digest로 돌아가 B를 할까요, 아니면 veto하고 single 위에서 B를 할까요?" (답이 없으면 기본 동작은 digest 기반 B. 답은 2차 창 안에 필요하다)
5. 댓글 수는 KPI에 없어 행동 번역 훅의 대화 유도 효과는 판정에 반영되지 않는다. kpi.mjs에 comments 지표를 넣는 것은 KPI 골든 계약 변경이라 별도 계획으로 남긴다.
