# 자가 개선 루프 (실험 큐 + 자동 판정기 + 입력 건강 감시) 구현 계획

작성일 2026-09-29 · 상태: critic 1차 반영 · 기준 브랜치: deploy-0929(5180312 — main + hook-v2 + 신선도 게이트 + narration 필수화). 작업 브랜치 `self-improve-loop`. deploy-0929는 오늘 밤 main에 배포되고, 이 브랜치는 그 뒤에 배포한다.

## 변경 이력

| 날짜 | 변경 | 사유 |
|---|---|---|
| 2026-09-29 | 초안 | — |
| 2026-09-29 | critic 1차 반영: 07:00 벽시계 가드 제거 → 24시간 거부권 창 + 항목별 `applyBefore`, 스냅샷을 KPI·판정기 전에 복사하고 경로를 명시 인자로, vars 폴백 제거(flags.json 단일 진실원), evidence에 data 필드 검사, 판정기·health self-test 음성 대조군과 flags 런타임 화이트리스트 프로브, contract-check에 experiments 잡, health의 물어오리 한정·신선도 게이트 이전 회차 제외·health-ack, 플래그 해석 스텝 continue-on-error, 수동 실행 ISC를 dry 모드로 교체, flags 합성 규칙, 당일 스냅샷 없으면 판정 생략, 재빌드 오염 제외, startStem은 적용 시점 결정, adopt AND 명시, Anti-ISC-5·7 교체, file:line 오차 수정, Open Questions 확정 | critic 필수 수정 8건 + 기타 지적 |
| 2026-09-29 | 구현 후 코드 리뷰 반영: 유휴 전환 가드(`hold`·`waitingFor`)로 veto·next 라우팅 우회 차단, `pending.veto` 타입 lint, 시간에 따라 뒤집히는 제외 사유(미발행·미수집·지표 오류)는 발행 후 72시간까지 대기, 수집 실패 시에도 pending 적용(수집 스텝 continue-on-error + 스냅샷 로드 실패 격리), experiment 이슈 생성 전 같은 제목 조회, health는 마커 있는 이슈만 대상 | code-reviewer MEDIUM 5건 + LOW 2건 |

## Intent

- Problem: 물어오리는 10주째 views 중앙값 ~100~137, shares·saved 0, 평균 시청 ~3초/28초인데, 개선 루프가 사람 손에서 끊긴다. 9/14 승인된 단일 이슈 실험은 9/19에 켜기로 하고 15일간 안 켜졌고(저장소 변수 `REEL_FORMAT_MULEORI` 미설정, `TTS_ENABLED=0`은 8/22 값 그대로), 9/19 음악 실험 판정 기록이 없으며, `selection.signalSources`는 8/18 이후 126회차 중 85회차가 fail(최근 10회차는 전부 fail)인데 조치가 없다. 텔레그램은 14일 연속 실패 중이지만 report-notify는 매번 success로 끝나 실패가 보이지 않는다.
- Proposed outcome: 실험 정의를 큐 파일에 PR로 넣기만 하면, 매일 insights 실행(05:00 KST 예약, 실측 07:00~09:15 시작)에서 판정기가 사전등록 임계값으로 판정을 기록하고, 다음 실행에서 플래그 전환·롤백·다음 실험 활성화를 적용한다(그 사이 24시간 거부권). 기록·알림까지 자동이다. 입력 이상(신호 수집 실패, 결방, 신선도 반려, 텔레그램 불능, 실험 정체, 큐 고갈)은 GitHub 이슈 1개로 모인다.
- Affected users and systems: 운영자 Ryan(큐 PR 승인, 필요 시 거부권) / reels.yml build·publish 잡, insights.yml, contract-check.yml, scripts/kpi.mjs, 신규 scripts/flags.mjs·experiment.mjs·health.mjs, 신규 experiments/ 디렉토리, REELS_SPEC.md의 플래그 설명 1줄.
- Constraints: ESM .mjs, 새 npm 의존성 금지(설정 파일은 JSON), 한국어 주석, render.mjs·tts.mjs 무수정, 킬스위치(PUBLISH_LIVE, PUBLISH_LIVE_AIBRIEF)는 저장소 변수에 그대로 둔다. 계정별 활성 실험은 하나. 범위 밖: signals-actions 실험의 구현, D안 구현, daily-briefing 쪽 텔레그램 egress 수정, 9/19 음악 실험 판정 소급.
- Open questions: 전부 확정(아래 Open Questions 절).

## Context (코드베이스 조사 결과)

### 실험 플래그가 읽히는 위치 (전수 grep, deploy-0929 HEAD 5180312 기준)

| 위치 | 내용 |
|---|---|
| `.github/workflows/reels.yml:92-100` | 렌더 스텝. `:94` `TTS_ENABLED: ${{ vars.TTS_ENABLED }}`, `:96` `REEL_FORMAT_MULEORI: ${{ vars.REEL_FORMAT_MULEORI }}`. 실험 플래그가 vars에서 env로 들어오는 유일한 지점 |
| `scripts/render.mjs:70-81` `resolveArm` | `:71` `REELS_ARM` 강제값, `:75` aibrief는 항상 tts, `:76` `TTS_ENABLED !== "1"`이면 control, 그 외 digest 포맷은 일(DD) 짝홀로 tts/control A/B |
| `scripts/render.mjs:85-97` `resolveFormat` | `:86` `REEL_FORMAT_MULEORI` 읽음. `single`이고 account가 muleori일 때만 single. 빈 값이면 digest |
| `scripts/render.mjs:100-104` `resolveSingleArm` | `:101` `REELS_ARM`, `:103` `TTS_ENABLED === "1"`이면 tts |
| `scripts/render.mjs:193` | account는 스템이 아니라 `data.account === "aibrief"`로 결정 |
| `scripts/render.mjs:272` | `format === "single" ? resolveSingleArm() : resolveArm(...)` |
| `scripts/render.mjs:288` | TTS 생성 실패 시 `armRecord = "control-fallback"` (표본 오염 표지) |
| `scripts/render.mjs:325-330` | 팔 기록 `docs/arms/<stem>.txt` (aibrief는 `docs/arms/ai/`) |
| `scripts/render.mjs:334-337` | 포맷 기록 `docs/formats/<stem>.txt` (두 계정 공용) |
| `scripts/tts.mjs` | 두 변수를 읽지 않는다 (grep 0건) |
| `.github/workflows/tts-test.yml:45` | `TTS_ENABLED: '1'` 하드코딩. 테스트 전용이라 영향 없음 |
| `reels.yml:121,145,176,189`, `watchdog.yml:26,34-35` | PUBLISH_LIVE 계열 킬스위치. 이번 이전 대상 아님 |
| `REELS_SPEC.md:78` | 루틴용 문서가 "포맷은 `REEL_FORMAT_MULEORI`, 낭독은 `TTS_ENABLED`"라고 설명 |

저장소 변수(오늘 밤 설정 예정 상태): `PUBLISH_LIVE=1`, `PUBLISH_LIVE_AIBRIEF=1`, `REEL_FORMAT_MULEORI=single`, `TTS_ENABLED=1`. 이 브랜치 배포 후 뒤의 두 개는 삭제한다(배포 절차 참조).

주의할 결합: 포맷이 digest로 돌아가도 `TTS_ENABLED=1`이 남아 있으면 `resolveArm`의 짝홀 A/B가 다시 켜진다(render.mjs:76-80). 따라서 롤백은 두 플래그를 함께 실험 시작 직전 값으로 되돌린다.

### 기타 사실

- reels.yml은 `data/*.json` push에만 반응한다(`:4-6`). experiments/ 커밋은 빌드를 트리거하지 않는다. build 잡은 push된 커밋을 체크아웃하므로(`:33-35`), 플래그는 데이터 커밋 시점의 트리에서 읽힌다.
- 푸시 경합 선례: reels.yml `:112-113`, `:231-232`와 insights.yml `:41-42`가 모두 `git pull --rebase origin main || true` 후 1회 push였다. 재시도 없음. 경로는 서로 겹치지 않는다(reels: docs/·assets/img·containers·published, insights: metrics·experiments). 이번에 세 곳 모두 rebase + 최대 3회 재시도로 바꾼다.
- insights.yml의 cron은 20:00 UTC(05:00 KST)지만 metrics 커밋 실측 시각은 07:15~09:15 KST다(9/22~9/29 커밋 로그). "05:00 판정"을 전제로 한 설계는 쓰지 않는다.
- `scripts/kpi.mjs`는 `renderReport`만 export했다. `loadEntries`(24시간 성숙 필터)는 항목에 stem을 싣지 않았고, `computeStats`는 기간 창 필터와 집계가 한 함수에 묶여 있었다. 판정기는 "고정 회차 목록" 기준 집계가 필요하므로 집계부(`aggregate`)만 분리해 재사용한다. kpi.mjs는 이미 스냅샷 경로 인자를 받는다(`node scripts/kpi.mjs metrics/DATE.json`).
- metrics 스냅샷 행은 `stem, account, timestamp, metrics{views, reach, shares, saved, ig_reels_avg_watch_time …}` 구조다.
- `scripts/validate.mjs`는 `--self-test` 관례(내장 픽스처, `self-test N/N PASS`)를 쓴다. 신선도 반려 메시지는 `[신선도]` 접두사를 단다. 신선도 게이트는 2026-09-30-am 회차부터 적용된다. validate.mjs는 import 시 main()이 돌므로 health는 자식 프로세스로 실행한다.
- watchdog.yml: 슬롯별(08:30/13:30/18:00 KST) 실시간 결방 감지, 데이터가 있으면 reels.yml 재dispatch, 텔레그램 경보. report-notify.yml: 클라우드 점검 루틴의 reports/*.md를 텔레그램으로 릴레이하며 `curl -s` 결과를 확인하지 않아 전송 실패여도 run은 success다.
- 텔레그램 14일 실패의 실제 위치는 daily-briefing 리포의 클라우드 실행 환경(egress 차단, reports/2026-09-29-am.md)이다. 이 리포의 Actions 러너에서는 별도로 확인해야 한다.
- 리포 이슈 라벨에 `health`, `experiment`는 아직 없다(스크립트가 `gh label create --force`로 만든다). 루트에는 package.json이 없고 scripts/*.mjs는 의존성 없이 실행된다.
- `data/2026-08-12-am.json`은 JSON 파싱이 안 된다. 입력 감시는 이 파일에서 죽으면 안 된다.
- 로컬 샌드박스에서 `diff -q - file`은 stdin을 못 읽는다. 표준입력 대조 프로브는 `cmp - file`을 쓴다.

## Work Objectives

1. 실험 플래그의 진실원을 커밋된 `experiments/flags.json` 하나로 옮기고(vars 폴백 없음), 오늘 밤 수동 설정한 변수에서 무중단으로 이전한다.
2. 큐 정의(사람 소유)와 진행 상태(기계 소유)를 파일로 분리하고, 사전등록 임계값으로 판정하는 판정기를 만든다. 판정과 적용 사이에 24시간 거부권 창을 둔다.
3. 판정기를 insights.yml의 당일 스냅샷 복사·KPI 집계 뒤에 붙이고, 판정·전환을 GitHub 이슈로 알린다.
4. 입력 건강을 매일 점검해 health 이슈 1개로 모은다.

## 설계 결정

### 결정: 파일 3개 분리 (queue / state / flags) + 부속 파일
- Why: 사람이 PR로 고치는 파일(queue.json)과 판정기가 매일 쓰는 파일(state.json, flags.json)이 같으면 큐 PR이 봇 커밋과 매번 충돌한다.
- Alt considered: queue.json 한 파일에 status 필드. PR 충돌과 "봇이 사람 정의를 고쳤다" 추적 문제 때문에 기각.
- Threat: 세 파일이 서로 모순될 수 있다(state가 가리키는 id가 queue에 없음, 한 계정에 활성 2개 등).
- Mitigation: `experiment.mjs --lint`가 교차 검증한다. contract-check.yml의 experiments 잡이 experiments/** push·PR마다 실행하고, 판정기 실행 모드도 시작 시 lint를 먼저 돌려 실패하면 판정·전환 없이 exit 0으로 끝난다(health가 같은 lint로 ALERT queue-lint를 낸다).
- Open: 없음

부속 파일: `experiments/verdicts/<id>.md`(판정 문서, 판정기 소유), `experiments/health-ack.json`(알려진 경보 인지, 사람 소유), `experiments/preregistration/<id>-addendum.md`(사전등록 부록, 사람 소유).

형태(결정을 담는 스키마이므로 인라인):

```jsonc
// experiments/queue.json — 사람 소유, PR로만 변경
{
  "version": 1,
  "items": [
    {
      "id": "single-issue-v1",
      "account": "muleori",
      "status": "ready",                 // ready | draft (draft는 구현 전이라 활성화 불가)
      "hypothesis": "단일 이슈 18초 + 나레이션이 시청·공유를 올린다",
      "flags": { "REEL_FORMAT_MULEORI": "single", "TTS_ENABLED": "1" },   // 기존 flags 위에 병합된다
      "evidence": [                      // 전부 일치해야 유효 표본
        { "path": "docs/formats/{stem}.txt", "equals": "single" },
        { "path": "docs/arms/{stem}.txt",    "equals": "tts" },
        { "data": "issues.0.narration", "nonEmpty": true }                // data/<stem>.json 필드 검사
      ],
      "samples": 14, "extendTo": 28,
      "adopt":  [ { "kpi": "sharesPer1000Reach", "op": ">=", "value": 5 },   // 목록은 AND
                  { "kpi": "avgWatchMedian",     "op": ">=", "value": 5.4 } ],
      "reject": [ { "kpi": "avgWatchMedian",     "op": "<",  "value": 3.6 } ], // 목록은 AND, adopt보다 먼저 본다
      "next": { "adopt": "signals-actions", "reject": "d-plan-character", "inconclusive": "signals-actions" },
      "applyBefore": null,               // 선택. KST "HH:MM" — 이 시각 이후 실행에서는 이 항목이 관여하는 flags 변경을 연기
      "prereg": "RyanVault 02-CONTENT/ideas/2026-09-14-daily-news-reels-single-issue-preregistration.md",
      "addendum": "experiments/preregistration/single-issue-v1-addendum.md"
    },
    { "id": "signals-actions",  "account": "muleori", "status": "draft", "hypothesis": "선정 기준 변경 — 구현 계획 별도" },
    { "id": "d-plan-character", "account": "muleori", "status": "draft", "hypothesis": "기각 시 D안 placeholder" }
  ]
}
// experiments/state.json — 판정기 소유
{ "version": 1,
  "muleori": { "active": "single-issue-v1", "startedAt": "<적용 시각>", "startStem": "2026-09-30-am",
               "window": 14, "extended": false, "issue": null,
               "flagsBefore": { "REEL_FORMAT_MULEORI": "", "TTS_ENABLED": "0" },   // rollback 기준(실험 시작 직전 flags)
               "flagsSince": "2026-09-30-am",                                      // 현재 flags가 반영되기 시작한 회차(health 대조 기준)
               "pending": null },       // 판정 후 적용 대기: { verdict, decidedAt, file, stats, veto:false } — veto는 boolean만(lint)
  // 유휴 상태에서만: "hold": true(veto 또는 next 없음 — 사람이 지울 때까지 자동 활성화 정지),
  //                  "waitingFor": "<id>"(next가 draft — 그 항목이 ready가 될 때만 활성화)
  "aibrief": { "active": null, "flagsSince": null, "pending": null },
  "history": [ { "id": "...", "account": "...", "verdict": "adopt|reject|inconclusive", "vetoed": true?,
                 "decidedAt": "...", "appliedAt": "...", "file": "experiments/verdicts/<id>.md" } ] }
// experiments/flags.json — 판정기 소유(긴급 시 사람이 PR로 수정 가능)
{ "muleori": { "REEL_FORMAT_MULEORI": "single", "TTS_ENABLED": "1" }, "aibrief": {} }
```

queue의 `rollback` 필드는 두지 않는다. 롤백 값은 활성화 시점에 state에 저장한 `flagsBefore` 하나뿐이다(값이 두 곳에 있으면 어긋난다).

flags.json의 허용 키는 `REEL_FORMAT_MULEORI`, `TTS_ENABLED` 두 개뿐이다(화이트리스트). 값은 한 줄 문자열이다. PUBLISH_LIVE 계열은 사람의 안전장치이므로 넣지 않는다. lint·`flags.mjs --check`가 파일을 거부하고, 런타임 해석은 해당 키만 무시한다.

### 결정: 플래그 해석은 render.mjs가 아니라 reels.yml의 별도 스텝에서, 진실원은 flags.json 하나
- Why: render.mjs·tts.mjs의 env 계약(`process.env.REEL_FORMAT_MULEORI`, `TTS_ENABLED`)을 그대로 두면 렌더 코드 회귀 위험이 0이다. 새 스크립트 `scripts/flags.mjs`가 data 파일의 account를 읽고(render.mjs:193과 같은 규칙) `flags.json`에서 그 계정 값만 골라 `$GITHUB_OUTPUT`에 쓴다. 렌더 스텝 env는 `${{ steps.flags.outputs.* }}`로 바꾼다. 저장소 변수는 읽지 않는다(vars 폴백 제거: 진실원이 둘이면 이번 15일 미적용 사고와 같은 "어느 값이 이겼나" 문제가 다시 생긴다).
- Alt considered: (1) render.mjs가 flags.json을 직접 읽기 — 렌더 경로 수정과 테스트 부담 때문에 기각. (2) `$GITHUB_ENV`에 쓰기 — 이후 모든 스텝에 퍼지므로 출력(outputs)으로 렌더 스텝에만 명시 전달한다.
- Threat: flags.json 손상·부재 또는 해석 스텝 실패 시 실험 처치가 꺼진 채 발행된다.
- Mitigation: flags.mjs는 절대 exit 1로 발행을 막지 않는다. 파싱 실패·부재·계정 항목 없음이면 기본값(`REEL_FORMAT_MULEORI=""`→digest, `TTS_ENABLED=0`→control)과 경고를 남긴다. 해석 스텝은 `continue-on-error: true`라 스크립트가 죽어도 출력이 비고 렌더는 같은 기본 동작으로 간다. 출처(`source=file|default`)를 로그와 Step Summary에 남긴다. 처치가 꺼진 회차는 evidence 불일치로 표본에서 자동 제외되고, health의 flags-applied 점검이 ALERT를 낸다.
- Open: 없음

### 결정: 판정 규칙과 상태 기계

```
ready --(유휴 계정이면 큐 순서상 첫 ready, 또는 이전 실험 적용 시 next)--> active   : flagsBefore 저장, flags 병합, startStem 결정
active --(유효 표본 < window)--> active (대기)
active --(유효 표본 = window, reject 충족)--> pending(reject)
active --(유효 표본 = window, adopt 충족)--> pending(adopt)
active --(중간 구간, extended=false)--> active(extended=true, window=extendTo)   : 즉시(flags 불변)
active --(중간 구간, extended=true)--> pending(inconclusive)
pending --(다음 실행, 판정 후 20h 이상, veto 아님, applyBefore 통과)--> 적용:
    reject       → flags = flagsBefore, next.reject 활성화
    adopt        → flags 유지, next.adopt 활성화
    inconclusive → flags 유지, next.inconclusive 활성화 (무결론 verdict 기록)
pending(veto=true) --(다음 실행)--> vetoed : flags 유지, 다음 실험 활성화 안 함, state.hold=true
다음 항목이 draft면 활성화하지 않는다 → 계정 유휴 + state.waitingFor=next(그 항목이 ready가 되면 활성화), 없으면 hold
유휴 계정 자동 활성화: hold면 정지, waitingFor면 그 항목만, 둘 다 없으면 큐 순서상 첫 ready(이력에 없는 것)
```

- 유효 표본: 해당 account의 스템 중 `startStem` 이후를 스템 순으로 보며, 발행 마커가 media id이고, evidence(파일 기록·data 필드) 전부 일치하고, 재빌드 오염이 없고, 당일 스냅샷에 오류 없는 행이 있으며 발행 후 24시간이 지난 회차. 앞에서 window개만 쓴다(창 고정: 날마다 재판정해도 결과가 바뀌지 않게 하여 엿보기 편향을 막는다). 미성숙이거나 아직 스냅샷에 없는 회차를 만나면 거기서 멈춘다(뒤 회차로 건너뛰면 창이 흔들린다). 시간이 지나면 뒤집힐 수 있는 사유(미발행·스냅샷 행 없음·지표 오류)는 예상 발행 후 72시간까지 제외하지 않고 기다린다(판정 당일 일시 오류 하나로 창 구성이 바뀌지 않게).
- 오염 제외 사유: `evidence`(예: `control-fallback`, 플래그 반영 전에 빌드된 회차), `evidence-missing`, `data`(narration 비었음), `rebuild`, `unpublished`(마커 없음·pending이고 예상 발행 후 24시간 경과), `no-metrics`, `metrics-error`. 사유별로 세어 판정 문서에 기록한다. 고려 회차 중 제외 비율이 30%를 넘으면 판정 문서에 "오염 경고", health에 WARN contamination.
- 재빌드 감지: 그 회차의 `published/<stem>`를 처음 커밋한 커밋 이후(`<marker>..HEAD`)에 `docs/formats/<stem>.txt`·`docs/arms/<stem>.txt`를 바꾼 커밋이 있으면 `rebuild`로 제외한다. 발행 전 재빌드(watchdog 재dispatch)는 발행 영상과 기록이 같으므로 제외하지 않는다. insights 체크아웃은 `fetch-depth: 0`. git을 못 쓰면 제외하지 않는다.
- 조건 평가: adopt·reject 목록은 각각 AND(전부 충족)다. 값이 null(reach 합 0 등)이면 거짓. reject를 먼저 본다. 공식은 kpi.mjs `aggregate`와 같다.
- reject를 avg_watch 하나로만 거는 이유: shares는 회차당 reach ~100 규모에서 0이 대부분이라 노이즈가 커서 오판정 롤백의 주원인이 된다. 연속값 중앙값인 avg_watch가 더 안정적이다(사전등록과 동일).
- 24시간 거부권 창(07:00 벽시계 가드 대체): 판정한 실행에서는 verdict·판정 문서·pending만 기록하고 flags는 바꾸지 않는다. flags 적용과 다음 실험 활성화는 판정 후 20시간 이상 지난 다음 insights 실행에서 한다(매일 1회 실행이므로 사실상 다음 날). 그 사이 사람은 `state.json`의 `<account>.pending.veto`를 true로 커밋해 거부할 수 있다. 벽시계 가드는 cron 실측(07:00~09:15 시작)상 거의 매번 연기만 만들었으므로 버린다.
- `applyBefore`(항목 필드, 선택): 루틴의 선정 기준을 바꾸는 실험(signals-actions 등)은 am 루틴(07:10) 도중 flags가 바뀌면 안 된다. 이런 항목은 `applyBefore: "07:00"`을 두고, 그 항목의 활성화 또는 rollback이 걸린 적용은 KST가 그 시각 이후인 실행에서 연기한다. 렌더 전용 플래그(single-issue-v1)는 데이터 커밋 트리에서 읽히므로 시각 제약이 필요 없어 두지 않는다.
- flags 합성: 활성화 시 `flagsBefore = 현재 flags[account]`를 state에 저장하고 `flags[account] = { ...현재, ...item.flags }`로 병합한다(adopt로 유지된 값이 다음 실험에도 남는다). rollback은 항상 그 실험의 `flagsBefore`로 되돌린다.
- startStem은 flags 적용 시점에 정한다: 그 계정의 가장 최근 `data/<stem>.json` 다음 회차(am→같은 날 pm, pm→다음 날 am, ai-D→ai-D+1). 이미 데이터가 커밋된 회차는 이전 flags 트리에서 빌드됐기 때문이다. 경합으로 그 회차가 이전 값으로 빌드되면 evidence 불일치로 제외된다.
- 당일 스냅샷: 판정은 `--snapshot`으로 받은 파일 이름이 실행일(KST)과 같을 때만 한다. 없거나 다르면 판정을 건너뛴다(pending 적용은 스냅샷과 무관하게 진행).
- 동시 대조군·외생 충격: 판정 문서에 같은 기간 aibrief 지표와 그 직전 14일 지표를 적고, aibrief avg_watch 중앙값이 직전 대비 70% 미만이면 "두 계정 동반 급락 의심"을 기록한다. 자동 강등은 하지 않는다(Open Question 2 확정).
- 사전등록에 없던 규칙(1회 연장 28회차, 무결론 처리, 고정 14회차 목록 집계, 당일 스냅샷 선복사, 오염 제외, 거부권)은 `experiments/preregistration/single-issue-v1-addendum.md`로 첫 판정 전에 고정한다. 볼트 원본은 수정하지 않고 부록 문안을 리포에 둔다.

### 결정: 알림은 GitHub 이슈, 텔레그램은 보조
- 실험마다 이슈 1개(라벨 `experiment`)를 활성화 뒤 첫 실행에서 만들고(state.issue에 번호 기록), 연장·판정 시 코멘트, 적용 시 코멘트 후 닫는다. 입력 건강은 이슈 1개(라벨 `health`)를 열린 동안 본문 갱신으로 재사용하고, 상태 서명(ALERT·WARN 항목 목록, 본문 HTML 주석에 저장)이 바뀔 때만 코멘트하며, 전부 정상이면 코멘트 후 닫는다. 열린 health 이슈가 여럿이면 가장 오래된 것만 쓴다. 기본 `GITHUB_TOKEN`에 `issues: write` 권한을 준다. gh 호출 실패는 경고만 남기고 판정·커밋을 막지 않는다. experiment 이슈는 만들기 전에 같은 제목의 열린 이슈를 조회해 재사용한다(이전 실행이 이슈 생성 후 state push에 실패한 경우의 중복 방지). health는 본문에 `health-sig` 마커가 있는 이슈만 대상으로 한다.

### 기존 워크플로와의 역할 정리
- watchdog.yml: 슬롯 단위 실시간 감지와 자가 복구(재dispatch)를 하므로 하루 1회인 health로 대체할 수 없다. 유지하고 수정하지 않는다(Open Question 3 초안대로). health는 같은 판정 기준(`published/<stem>`이 있고 pending이 아님)으로 최근 7일 결방을 집계만 한다.
- report-notify.yml: 텔레그램 릴레이 역할은 그대로 둔다. health 이슈 본문에 최신 reports/ 파일의 첫 줄과 경로를 넣어, 텔레그램이 죽어 있어도 GitHub 쪽에서 점검 결과를 볼 수 있게 한다. 텔레그램 불능은 health가 Bot API `getChat`(메시지 발송 없는 읽기 호출)으로 직접 확인한다.
- insights.yml: 판정기(collect 잡 내부, 당일 스냅샷 복사·KPI 뒤)와 health(별도 잡, `needs: collect`, `if: always()`)를 여기에 합친다. 새 워크플로 파일은 만들지 않는다. 수동 실행용 `mode` 입력(full|dry)을 둔다. dry는 수집·스냅샷 복사·커밋·이슈 변경 없이 최신 커밋 스냅샷으로 판정기와 health를 dry-run한다.

## Guardrails

### Must Have
- 플래그 이전은 무중단: 초기 flags.json 값은 오늘 밤 설정한 변수 값과 같다(muleori single + TTS 1, aibrief 비움).
- 판정기·health는 `--self-test`와 `--dry-run --now <ISO>` 모드를 가진다(validate.mjs 관례). 픽스처는 `--root <dir>`·임시 디렉토리로 실제 리포 파일과 분리한다.
- 새 게이트마다 음성 대조군 1개 이상. self-test 비교기 자체의 음성 대조군(기대를 틀리게 적은 케이스 파일은 exit 1)도 둔다.
- insights.yml: 스냅샷 복사가 KPI·판정기보다 먼저이고, 두 스크립트 모두 스냅샷 경로를 명시 인자로 받는다. 커밋은 metrics·kpi·state·flags·verdicts를 한 커밋으로 묶고, push는 rebase 후 최대 3회 재시도한다. 같은 워크플로의 중복 실행은 concurrency 그룹으로 직렬화한다.
- reels.yml의 두 push(build·publish)도 rebase 후 최대 3회 재시도한다.
- 봇 판정 커밋 메시지는 `experiment:` 접두사를 단다(experiments 변경이 없는 날은 기존 `metrics:` 메시지).
- validate.mjs self-test 17/17 PASS 유지, kpi.mjs 출력은 골든과 바이트 단위 동일.

### Must NOT Have
- render.mjs, tts.mjs 수정.
- 새 npm 의존성, package.json·lock 파일 추가.
- flags.json에 PUBLISH_LIVE 계열 키. 워크플로가 실험 플래그를 `vars.`에서 읽는 것.
- 판정기가 queue.json을 수정하거나 insights 커밋이 queue.json·data/를 add하는 것.
- 한 account에 활성 실험 2개.
- 판정한 같은 실행에서 flags를 바꾸는 것.
- 판정기의 텔레그램 단독 알림(판정기 코드에 텔레그램 호출 없음).
- health 이슈 중복 생성.

## Task Flow

### Step 1. 플래그 진실원 이전 (flags.json + resolver)
- 변경 파일: 신규 `experiments/flags.json`, `experiments/state.json`(single-issue-v1 active, startStem 2026-09-30-am, flagsBefore digest/0), `experiments/queue.json`(3개 항목), `experiments/health-ack.json`(빈 목록), 신규 `scripts/flags.mjs`, `.github/workflows/reels.yml`(렌더 스텝 앞에 `continue-on-error` 플래그 해석 스텝, 렌더 env를 스텝 출력으로 교체, 두 push에 재시도), `REELS_SPEC.md:78`(진실원이 flags.json임을 1줄로 명시).
- 순서: flags.json 값이 오늘 밤 변수 값과 같으므로 배포 시각 제약이 없다. 변수 삭제는 아래 배포 절차대로 확인 후 Ryan이 한다.
- 롤백: 아래 배포 절차의 롤백 참조.

### Step 2. 판정기 코어 (kpi.mjs 집계 분리 + experiment.mjs + 픽스처)
- 변경 파일: `scripts/kpi.mjs`(항목에 stem 추가, 집계부 `aggregate` 분리·export, `loadEntries`·`snapshotTimeFromPath` export. 출력은 골든과 바이트 단위 동일), 신규 `scripts/experiment.mjs`(`--lint`, `--self-test [--only] [--cases]`, `--dry-run`, `--now`, `--root`, `--snapshot`), 신규 `test/fixtures/experiments/`(base 큐·상태·플래그, `cases.json`, `negative-cases.json`, `two-active/`, `flags-publish-live.json`), 신규 `test/fixtures/kpi-2026-09-29.golden.md`(리팩토링 전에 먼저 동결), `.github/workflows/contract-check.yml`(push·PR paths에 experiments/**·관련 스크립트·픽스처 추가, 별도 `experiments` 잡: lint, flags 계약, 판정기·health self-test와 음성 대조군, KPI 골든).
- self-test 필수 케이스: adopt, verdict-no-apply, reject-avgwatch-2.0, middle-extend, extended-inconclusive, fallback-excluded, narration-missing-excluded, rebuild-excluded, unpublished-excluded, immature-wait, samples-13-wait, no-same-day-snapshot-skip, pending-too-early, pending-reject-apply-next-draft, pending-adopt-next-ready(합성 규칙·startStem), applyBefore-defer, veto, idle-pickup, lint-two-active, lint-publish-live-flag, reject-next-draft-no-bypass, veto-hold-next-day, waiting-for-only-named-next, lint-veto-string, metrics-error-waits, metrics-error-old-excluded(코드 리뷰 재현 R1~R4 동결).
- 롤백: 워크플로에 아직 연결되지 않으므로 파일 삭제와 kpi.mjs revert로 끝난다.

### Step 3. insights.yml 연결 + 실험 이슈 알림
- 변경 파일: `.github/workflows/insights.yml`(`mode` 입력, concurrency 그룹, collect 잡에 `issues: write`·`fetch-depth: 0`, 수집 스텝 `continue-on-error`(실패하면 당일 스냅샷을 만들지 않고 판정기는 pending 적용만 한다, outcome은 health가 ALERT collect로), 스냅샷 복사 스텝을 KPI 앞으로, KPI·판정기에 스냅샷 경로 인자, 판정기 스텝 `continue-on-error`와 outcome을 잡 출력으로, 통합 커밋과 재시도 push), 신규 `experiments/verdicts/`(판정 시 생성).
- 첫 full 실행에서 single-issue-v1용 `experiment` 이슈가 없으면 만들고 state에 번호를 기록한다. 라벨이 없으면 만든다.
- 목표 시점: 첫 판정 예상 실행(2026-10-08 insights, 실측 07:00~09:15) 전날까지 배포. 늦어져도 창이 고정이라 결과는 같다.
- 롤백: 판정 스텝 제거 커밋. state·flags는 마지막 값으로 남으므로 reels는 그대로 돈다. 판정 적용 전이면 pending.veto로, 적용 후면 flags.json과 state.json을 이전 커밋 값으로 되돌리는 커밋 하나로 처리한다(판정 문서는 남기고 "무효" 표기).

### Step 4. 입력 건강 감시 (health.mjs + health 잡)
- 변경 파일: 신규 `scripts/health.mjs`, `.github/workflows/insights.yml`(health 잡: `needs: collect`, `if: always()`, main 최신 체크아웃, TG 시크릿은 `getChat` 전용, `issues: write`, collect 결과·판정기 outcome을 env로 전달), `test/fixtures/health/`(all-green, flag-not-applied, `cases.json`, `negative-cases.json`).
- 점검 항목과 임계값:
  1. 신호 수집(signals): 최근 10개 물어오리 데이터 중 signalSources에 fail이 하나라도 있는 비율이 50% 초과면 ALERT. 기록 없는 회차는 분모 제외, 파싱 불가 파일은 건너뛰고 건수만 보고.
  2. 결방(missed): 최근 7일(어제까지) 기대 회차(킬스위치가 켜진 계정의 am/pm/ai) 중 발행 마커가 없거나 pending인 회차. 1건 WARN, 2건 이상 ALERT. 데이터가 있으면 `validate.mjs`를 다시 돌려 사유(freshness/validate/build·publish/no-data)를 분류한다.
  3. 신선도 반려(freshness): 위 재검증 중 `[신선도]` 사유 건수 1건 이상 WARN. 신선도 게이트 도입(2026-09-30-am) 이전 물어오리 회차는 재검증하지 않고 "미분류(게이트 도입 전)"로 둔다(새 게이트로 옛 데이터를 재판정하면 거짓 반려가 난다).
  4. 텔레그램(telegram): `getChat`이 `ok:false`거나 네트워크 오류면 ALERT. 시크릿이 없으면 INFO. 최신 reports/*.md에 텔레그램 실패 문구가 있으면 WARN telegram-report(다른 리포 문제일 수 있음을 명시).
  5. 실험 정체(experiment-stall): 활성 실험이 예상 종료일(startStem 날짜 + ceil(window/하루 회차 수)일 + 성숙 2일 + 여유 3일)을 넘기거나 pending이 48시간 넘게 미적용이면 ALERT. 진행 상황(유효 표본 x/window, 제외 사유)은 INFO, 제외 비율 30% 초과(고려 3회차 이상)면 WARN contamination.
  6. 플래그 미적용(flags-applied): 물어오리 스템만(ai- 제외). `flagsSince` 이후 최근 2회차의 docs/formats·docs/arms가 flags.json이 켠 값과 다르면 ALERT(이번 15일 미적용 사고를 직접 잡는 항목). arm이 `control-fallback`뿐이면 WARN tts-fallback. digest + TTS 1(짝홀 A/B)이면 arm은 대조하지 않는다.
  7. 큐(queue): 활성 실험의 next 후보가 전부 draft/없으면 WARN, 물어오리 활성 실험이 없으면 WARN. 실험 파일 lint 실패면 ALERT queue-lint.
  8. 잡(collect, experiment-run): collect 잡 결과가 success가 아니면 ALERT, 판정기 스텝 outcome이 failure면 ALERT.
- 알려진 경보 인지: `experiments/health-ack.json`의 `{check, until, note}` 항목은 until(KST 날짜)까지 해당 check의 ALERT·WARN을 ACK로 내린다(서명에서 빠져 코멘트 피로가 없다). 만료되면 원래 수준으로 돌아오고 INFO로 만료를 알린다. 초기값은 빈 목록이다(첫날 신호 수집 ALERT로 health 이슈가 열려야 한다).
- 롤백: health 잡 삭제. 열린 health 이슈는 수동으로 닫는다.

### Step 5. 운영 개시 확인과 사전등록 보완
- 변경 파일: `experiments/preregistration/single-issue-v1-addendum.md`(리포 내 부록 문안). 볼트 원본은 읽기만 한다. Ryan이 원하면 볼트 문서에 부록 링크를 수동으로 단다.
- 내용: 연장·무결론·고정 14회차 목록·당일 스냅샷 선복사·오염 제외·거부권·동시 대조군 규칙과 재계산한 일정. 첫 실제 insights 실행에서 판정 대기 로그, experiment 이슈 생성, health 이슈 생성(현재 신호 수집 100% fail이므로 반드시 열려야 한다)을 확인한다.
- 롤백: 해당 없음.

## 일정 (재계산)

- insights는 05:00 KST 예약, 실측 시작 07:00~09:15. 판정은 스냅샷 파일 날짜 05:00 KST 기준 성숙(24시간)으로 한다.
- single-issue-v1 창: 2026-09-30-am ~ 2026-10-06-pm(제외 없을 때 14회차). 10/6-pm(17:30 발행)은 10/7 스냅샷에서 11.5시간이라 미성숙, 10/8 스냅샷에서 성숙.
- 첫 판정: 2026-10-08 insights 실행. 적용: 2026-10-09 insights 실행(판정 후 20시간 이상). 적용 후 flags는 그 시점 최근 데이터 다음 회차부터 반영된다(10/9 am 데이터가 이미 커밋됐으면 10/9-pm부터).

## 배포 절차

전제: 오늘 밤 deploy-0929가 main에 머지되고 Ryan이 저장소 변수 `REEL_FORMAT_MULEORI=single`, `TTS_ENABLED=1`을 설정한다. 이 브랜치는 그 뒤에 배포한다.

1. deploy-0929 배포 후 `self-improve-loop`를 최신 main에 rebase(충돌 예상 파일: 없음. reels.yml·insights.yml은 deploy-0929 기준으로 수정했다).
2. PR을 열어 contract-check의 `experiments` 잡이 통과하는지 확인한 뒤 main에 머지한다. flags.json 값이 변수 값과 같으므로 머지 시각 제약은 없다. 머지 직후부터 reels 렌더는 vars가 아니라 flags.json을 읽는다.
3. 머지 후 첫 물어오리 빌드 2회차에서 확인: 빌드 로그 `REEL_FORMAT_MULEORI=single (source=file, account=muleori)`(ISC-1.7), `docs/formats/<stem>.txt = single`, `docs/arms/<stem>.txt = tts`(ISC-1.6).
4. 확인 후 Ryan이 변수 삭제: `gh variable delete REEL_FORMAT_MULEORI`, `gh variable delete TTS_ENABLED`(ISC-1.8). 렌더가 더 이상 읽지 않으므로 런타임 영향은 없고, 진실원을 하나로 만드는 정리다.
5. 다음 insights 실행(또는 `gh workflow run insights.yml -f mode=dry`로 무변경 확인)에서 판정기 로그 `single-issue-v1: 유효 표본 n/14`, experiment 이슈 생성(full 실행), health 이슈 생성을 확인한다(ISC-3.2, 3.3, 4.6).

롤백:
- 변수 삭제 전: 머지 커밋 revert. reels.yml이 다시 vars를 읽고 변수가 살아 있으므로 무중단이다.
- 변수 삭제 후: `gh variable set REEL_FORMAT_MULEORI --body single`, `gh variable set TTS_ENABLED --body 1`로 복원한 다음 revert.
- 판정기만 멈추기: insights.yml의 판정기 스텝 제거 커밋(flags.json은 마지막 값으로 유지되어 렌더는 그대로).
- 잘못된 판정: 적용 전이면 `state.json`의 `muleori.pending.veto=true` 커밋, 적용 후면 flags.json·state.json을 이전 커밋 값으로 되돌리는 커밋.
- health만 멈추기: health 잡 삭제, 열린 health 이슈 수동 종료.

## Criteria (ISC)

`$BASE`는 이 작업 브랜치의 분기 기준(deploy-0929, 배포 후에는 그 머지가 들어간 main 커밋)이다. 모든 명령은 리포 루트에서 실행한다. `$TMPDIR`의 출력 파일은 매번 새로 만든다(`rm -f` 후 실행).

### Step 1
- ISC-1.1: `node -e "for (const f of ['queue','state','flags']) JSON.parse(require('fs').readFileSync('experiments/'+f+'.json','utf8')); console.log('ok')" → ok` → pass/fail
- ISC-1.2: `GITHUB_OUTPUT=$TMPDIR/go node scripts/flags.mjs data/2026-09-29-am.json >/dev/null && grep -E '^(REEL_FORMAT_MULEORI|TTS_ENABLED)=' $TMPDIR/go | sort | tr '\n' ' ' → REEL_FORMAT_MULEORI=single TTS_ENABLED=1` → pass/fail
- ISC-1.3 (부재 시 기본값, vars 폴백 없음 — critic 1차로 내용 교체): `FLAGS_FILE=/nonexistent GITHUB_OUTPUT=$TMPDIR/go2 node scripts/flags.mjs data/2026-09-29-am.json 2>&1 | grep -c "REEL_FORMAT_MULEORI= (source=default" → 1` 그리고 `grep -c '^TTS_ENABLED=0$' $TMPDIR/go2 → 1` → pass/fail
- ISC-1.4 (aibrief 격리): `GITHUB_OUTPUT=$TMPDIR/go3 node scripts/flags.mjs data/ai-2026-09-28.json >/dev/null; grep -c REEL_FORMAT_MULEORI=single $TMPDIR/go3 → 0` → pass/fail
- ISC-1.5 (음성 대조군, 파일 화이트리스트): `node scripts/flags.mjs --check test/fixtures/experiments/flags-publish-live.json; echo $? → 1` → pass/fail
- ISC-1.6 (배포 후 실측): `git fetch -q && git show origin/main:docs/formats/<이전 후 첫 물어오리 스템>.txt → single` → pass/fail
- ISC-1.7 (배포 후 실측): `gh run view <그 회차 build run id> --log | grep -c "REEL_FORMAT_MULEORI=single (source=file" → 1` → pass/fail
- ISC-1.8 (변수 퇴역 후): `gh variable list | grep -cE "^(REEL_FORMAT_MULEORI|TTS_ENABLED)\s" → 0` → pass/fail
- ISC-1.9 (음성 대조군, 런타임 화이트리스트): `FLAGS_FILE=test/fixtures/experiments/flags-publish-live.json GITHUB_OUTPUT=$TMPDIR/go4 GITHUB_ENV=$TMPDIR/ge4 node scripts/flags.mjs data/2026-09-29-am.json >/dev/null 2>&1; cat $TMPDIR/go4 $TMPDIR/ge4 2>/dev/null | grep -c PUBLISH_LIVE → 0` → pass/fail
- ISC-1.10 (손상 파일 내성): `printf '{bad' > $TMPDIR/bad.json; FLAGS_FILE=$TMPDIR/bad.json node scripts/flags.mjs data/2026-09-29-am.json >/dev/null 2>&1; echo $? → 0` → pass/fail
- ISC-1.11 (해석 스텝 비차단): `grep -A3 "id: flags" .github/workflows/reels.yml | grep -c "continue-on-error: true" → 1` → pass/fail

### Step 2
- ISC-2.1 (KPI 회귀 계약): `node scripts/kpi.mjs metrics/2026-09-29.json | cmp - test/fixtures/kpi-2026-09-29.golden.md && echo same → same` → pass/fail
- ISC-2.2: `node scripts/experiment.mjs --self-test 2>&1 | tail -1 → self-test N/N PASS` (N ≥ 10) → pass/fail
- ISC-2.3 (음성 대조군, 기각): `node scripts/experiment.mjs --self-test --only reject-avgwatch-2.0 2>&1 | tail -1 → self-test 1/1 PASS` → pass/fail
- ISC-2.4 (음성 대조군, 오염 제외): `node scripts/experiment.mjs --self-test --only fallback-excluded 2>&1 | tail -1 → self-test 1/1 PASS` (fallback 회차는 reach 10000·shares 0이라 표본에 들어가면 판정이 adopt에서 벗어나고 excluded 기대도 깨진다) → pass/fail
- ISC-2.5 (실데이터 dry-run — critic 1차로 명령 교체): `node scripts/experiment.mjs --dry-run --now 2026-09-29T09:00:00+09:00 --snapshot metrics/2026-09-29.json 2>&1 | grep -c "single-issue-v1: 유효 표본 0/14" → 1` → pass/fail
- ISC-2.6: `node scripts/experiment.mjs --lint → queue OK` → pass/fail
- ISC-2.7 (음성 대조군, lint): `node scripts/experiment.mjs --lint --root test/fixtures/experiments/two-active; echo $? → 1` → pass/fail
- ISC-2.8 (음성 대조군, self-test 비교기): `node scripts/experiment.mjs --self-test --cases test/fixtures/experiments/negative-cases.json >/dev/null 2>&1; echo $? → 1` → pass/fail
- ISC-2.9 (data 필드 evidence): `node scripts/experiment.mjs --self-test --only narration-missing-excluded 2>&1 | tail -1 → self-test 1/1 PASS` → pass/fail
- ISC-2.10 (validate 회귀): `node scripts/validate.mjs --self-test 2>&1 | tail -1 → self-test 17/17 PASS` → pass/fail
- ISC-2.11 (lint 실패 시 판정·전환 없음): `node scripts/experiment.mjs --root test/fixtures/experiments/two-active >/dev/null 2>&1; echo $? → 0` 그리고 `git status --porcelain test/fixtures/experiments/two-active | wc -l → 0` → pass/fail
- ISC-2.12 (contract-check 연결): `grep -c '"experiments/\*\*"' .github/workflows/contract-check.yml → 2` 그리고 `grep -c "experiment.mjs --lint" .github/workflows/contract-check.yml → 1` → pass/fail

### Step 3
- ISC-3.1: `grep -c "node scripts/experiment.mjs --snapshot" .github/workflows/insights.yml → 2` (full·dry 분기) → pass/fail
- ISC-3.2 (배포 후, 스냅샷 무변경 dry 모드 — critic 1차로 교체): `gh workflow run insights.yml -f mode=dry && sleep 120 && gh run list --workflow insights.yml -L1 --json conclusion -q '.[0].conclusion' → success` 그리고 같은 시점 `git log -1 --format=%s origin/main -- metrics` 불변 → pass/fail
- ISC-3.3 (배포 후 첫 full 실행): `gh issue list --label experiment --state open --json title -q '.[].title' | grep -c single-issue-v1 → 1` → pass/fail
- ISC-3.4 (첫 판정 후, 2026-10-08 이후): `ls experiments/verdicts/single-issue-v1.md >/dev/null && node -e "console.log(require('./experiments/state.json').muleori.pending?.verdict ?? require('./experiments/state.json').history.find(h=>h.id==='single-issue-v1')?.verdict)"` → adopt|reject|inconclusive 중 하나 → pass/fail
- ISC-3.5 (스냅샷 선복사 순서): `awk '/name: 당일 스냅샷 복사/{a=NR} /name: KPI 집계/{b=NR} /name: 실험 판정기/{c=NR} END{print (a<b && b<c)?"ordered":"bad"}' .github/workflows/insights.yml → ordered` 그리고 `grep -c 'kpi.mjs "${{ steps.snap.outputs.path }}"' .github/workflows/insights.yml → 1` → pass/fail
- ISC-3.6 (push 재시도): `grep -c "push 재시도" .github/workflows/reels.yml → 2` 그리고 `grep -c "push 재시도" .github/workflows/insights.yml → 1` → pass/fail
- ISC-3.7 (거부권 창 — 판정 실행에서 flags 불변): `node scripts/experiment.mjs --self-test --only verdict-no-apply 2>&1 | tail -1 → self-test 1/1 PASS` → pass/fail
- ISC-3.8 (applyBefore 연기): `node scripts/experiment.mjs --self-test --only applyBefore-defer 2>&1 | tail -1 → self-test 1/1 PASS` → pass/fail

### Step 4
- ISC-4.1: `node scripts/health.mjs --self-test 2>&1 | tail -1 → self-test N/N PASS` → pass/fail
- ISC-4.2 (실데이터 음성 대조군, 신호 수집): `node scripts/health.mjs --dry-run 2>&1 | grep -c "ALERT signals" → 1` (현재 최근 10회차 전부 fail이고 health-ack가 비어 있으므로 반드시 경보) → pass/fail
- ISC-4.3 (음성 대조군, 플래그 미적용 — critic 1차로 --now 추가): `node scripts/health.mjs --dry-run --root test/fixtures/health/flag-not-applied --now 2026-10-03T09:00:00+09:00 2>&1 | grep -c "ALERT flags-applied" → 1` → pass/fail
- ISC-4.4 (양성 대조군, 오탐 방지 — ai 기록·파싱 불가 파일 포함 픽스처): `node scripts/health.mjs --dry-run --root test/fixtures/health/all-green --now 2026-10-03T09:00:00+09:00 2>&1 | grep -cE "^(ALERT|WARN)" → 0` → pass/fail
- ISC-4.5 (파싱 불가 파일 내성): `node scripts/health.mjs --dry-run >/dev/null 2>&1; echo $? → 0` (data/2026-08-12-am.json이 있는 실제 트리) → pass/fail
- ISC-4.6 (중복 방지, 배포 후 insights full 실행 2회 뒤): `gh issue list --label health --state open --json number -q length → 1` → pass/fail
- ISC-4.7 (음성 대조군, health self-test 비교기): `node scripts/health.mjs --self-test --cases test/fixtures/health/negative-cases.json >/dev/null 2>&1; echo $? → 1` → pass/fail
- ISC-4.8 (신선도 게이트 이전 회차 제외): `node scripts/health.mjs --self-test --only pre-gate-no-freshness 2>&1 | tail -1 → self-test 1/1 PASS` → pass/fail
- ISC-4.9 (ack 만료 시 복귀): `node scripts/health.mjs --self-test --only ack-expired 2>&1 | tail -1 → self-test 1/1 PASS` → pass/fail

### Anti-ISC (Guardrails와 범위 밖에서 파생)
- Anti-ISC-1: `git diff --name-only $BASE -- scripts/render.mjs scripts/tts.mjs | wc -l → 0` → pass/fail
- Anti-ISC-2: `git diff --name-only $BASE | grep -cE "(^|/)package(-lock)?\.json$" → 0` → pass/fail
- Anti-ISC-3: `grep -c PUBLISH_LIVE experiments/flags.json → 0` → pass/fail
- Anti-ISC-4: `git log --format=%s -- experiments/queue.json | grep -c "^experiment:" → 0` (봇이 큐를 수정하지 않음) → pass/fail
- Anti-ISC-5 (교체, critic 1차 — 기존 프로브는 항상 참): `node scripts/experiment.mjs --self-test --only lint-two-active 2>&1 | tail -1 → self-test 1/1 PASS` (계정당 활성 2개를 lint가 거부) → pass/fail
- Anti-ISC-6: `grep -c "api.telegram.org" scripts/experiment.mjs → 0` → pass/fail
- Anti-ISC-7 (교체, critic 1차 — 기존 프로브는 reels.yml paths 때문에 항상 참): `grep -E "git add" .github/workflows/insights.yml | grep -cE "(data|queue)" → 0` (insights 커밋이 data/·queue.json을 add하지 않음) → pass/fail
- Anti-ISC-8 (aibrief 무간섭): `node -e "console.log(Object.keys(require('./experiments/flags.json').aibrief).length)" → 0` (aibrief 실험이 큐에 들어오기 전까지) → pass/fail
- Anti-ISC-9 (vars 폴백 없음): `grep -cE "vars\.(TTS_ENABLED|REEL_FORMAT_MULEORI)" .github/workflows/*.yml | awk -F: '{s+=$2} END{print s}' → 0` → pass/fail

## Success Criteria

- 2026-10-08 insights 실행에서 사람 개입 없이 single-issue-v1 판정이 기록되고(verdicts 문서·state.pending·experiment 이슈 코멘트), 2026-10-09 실행에서 적용된다(history·flags·이슈 종료).
- 판정이 reject면 적용 다음 물어오리 회차의 docs/formats가 digest, docs/arms가 control이다(짝홀 A/B 재개 없음).
- health 이슈가 현재의 신호 수집 전면 실패를 첫날 보고하고, 같은 이슈가 매일 갱신된다.

## 리스크

1. 판정기 오판정으로 좋은 실험을 롤백: 14회차 reach 합이 ~1,400 수준이라 shares 비율은 소수 건에 좌우된다. 대응은 reject를 avg_watch 중앙값에만 거는 것, 중간 구간 1회 연장, 판정 문서에 회차별 표와 제외 사유를 모두 싣는 것, 판정과 적용 사이 20시간 이상의 거부권 창이다. 판정 문서에는 같은 기간 aibrief 지표를 동시 대조군으로 함께 적는다.
2. 커밋 경합: insights push와 reels build/publish push가 겹칠 수 있다. 쓰는 경로가 서로 겹치지 않아 rebase 충돌은 없고 경합 거절만 생긴다. 세 곳 모두 rebase + 최대 3회 재시도, insights는 concurrency 그룹. build는 push된 데이터 커밋의 트리에서 flags를 읽으므로, flags 적용 커밋 이전에 만들어진 데이터 커밋은 이전 값으로 빌드된다. 이 회차는 evidence 대조로 표본에서 자동 제외되고 startStem도 적용 시점의 다음 회차로 잡는다.
3. 소표본 노이즈와 배급 바닥: views ~100은 초기 테스트 배치 크기라 신호가 약하다. KPI를 views가 아니라 shares·avg_watch로 두고, 창을 고정해 날마다 재판정하는 엿보기 편향을 막는다.
4. cron 지연: GitHub cron은 수 시간 늦을 수 있다(실측 07:00~09:15 시작). 판정·적용 모두 벽시계와 무관하게 설계했고, 적용이 반복 지연되면 health가 pending 48시간 초과로 정체를 잡는다. 선정 기준 실험은 `applyBefore`로 am 루틴 도중 전환을 막는다.
5. flags.json 손상: flags.mjs가 기본값으로 폴백해 발행은 계속되고(처치는 꺼짐), health의 flags-applied 점검이 불일치를 ALERT로 잡으며, 해당 회차는 evidence로 표본에서 빠진다. lint가 contract-check에서 PR 단계에 손상을 막는다.
6. 판정기 버그로 잘못된 값 기록: 키 화이트리스트와 contract-check의 lint가 막고, 음성 대조군 self-test가 판정기·비교기 고장을 잡는다. 판정기가 죽어도(`continue-on-error`) metrics 커밋은 진행되고 health가 ALERT experiment-run을 낸다.
7. 재빌드 감지는 git 이력에 의존한다. 얕은 클론이나 git 오류면 제외하지 않는 쪽으로 실패한다(표본 오염 가능). insights는 `fetch-depth: 0`으로 체크아웃한다.
8. 큐 고갈: single-issue-v1의 next가 전부 draft라 판정 적용 후 물어오리는 유휴(`waitingFor`)가 된다. health가 첫날부터 WARN queue로 알리며, 알려진 상태이면 health-ack로 인지 처리한다.
9. (코드 리뷰 LOW, 미수정) insights 체크아웃 뒤 사람이 `pending.veto`를 push하면 봇의 state.json 변경과 rebase 충돌이 나서 그날 커밋 push가 3회 실패한다. veto는 보존되는 안전한 실패지만 그날 metrics 스냅샷 커밋이 유실되고 이슈에는 "적용" 코멘트가 먼저 달린다. 대응: veto는 insights 실행 시간대(07:00~09:30 KST)를 피해 커밋한다.
10. (코드 리뷰 LOW, 미수정) flags 적용 직후 경합 회차(적용 커밋 전에 data가 커밋된 회차)는 판정기에서는 evidence로 제외되지만 health flags-applied가 한 번 거짓 ALERT를 낼 수 있다.
11. (코드 리뷰 LOW, 미수정) push 재시도 루프에서는 예전 `|| true`가 가리던 `git pull --rebase` 실패가 3회 후 exit 1이 된다. 현재 build가 쓰는 경로는 전부 add되거나 무시 대상이라 걸리는 경로는 없다.
12. (코드 리뷰, 미수정) 판정기가 이슈 코멘트·종료를 state push보다 먼저 한다. push가 3회 모두 실패하면 이슈에는 적용 코멘트가 남았는데 state는 적용 전이라 다음 실행이 같은 코멘트를 다시 단다(이슈 생성 중복은 제목 조회로 막았다).

## Open Questions (확정)

1. 무결론(연장 28회차 후에도 중간 구간): **flags 유지 + 무결론 verdict 기록 + next.inconclusive가 ready면 활성화.** draft면 계정 유휴 + health WARN.
2. 두 계정 동반 급락 시 자동 강등: **하지 않는다. 판정 문서에 기록만.** 판단은 거부권으로 사람이 한다.
3. watchdog 경보를 health 이슈에도 남길지: 초안대로 하지 않는다(watchdog 무수정).
4. signals-actions: **draft 유지.** 루틴이 flags.json을 읽게 되는 구현 계획은 별도이며, ready로 바꿀 때 `applyBefore: "07:00"`을 함께 둔다.
5. 9/19 음악 실험 판정 소급: 범위 밖(소급하지 않는다).
6. startStem: `2026-09-30-am`(오늘 밤 변수 전환 뒤 첫 회차). 이후 실험은 flags 적용 시점에 판정기가 정한다.
7. 보류·연장 규칙, 고정 14회차 목록 집계, 당일 스냅샷 선복사: **사전등록 부록**(`experiments/preregistration/single-issue-v1-addendum.md`)으로 고정.
