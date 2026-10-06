---
date: 2026-10-06
experiment: action-hook-v1, action-hook-v1-digest
type: preregistration
plan: docs/plans/2026-10-06-action-hook-v1.md
---

# 사전등록: action-hook-v1 (물어오리 B안, 행동 번역 훅)

single-issue-v1 판정(예상 2026-10-08 insights) **전에** 고정하는 사전등록이다. 판정 결과를 본 뒤 라우팅과 임계값을 고르면 사후 선택이 되므로, 두 기반 포맷용 항목을 모두 미리 등록한다. 판정은 `scripts/experiment.mjs`가 이 규칙대로 자동으로 한다.

## 1. 가설과 처치

- 가설: hookLine을 "행동 번역형"(이 뉴스 때문에 시청자가 해야 하는 일, 시청자에게 바뀌는 것을 묻거나 알리는 문장)으로 쓰면 0~4.5초 훅 구간의 이탈이 줄어 평균 시청이 오른다.
- 처치는 **훅 프레임 하나**다. 플래그 `HOOK_FRAME_MULEORI=action`이면 루틴이 `node scripts/flags.mjs --hook-prompt`가 가리키는 `contracts/hook-muleori-action/prompt.txt`로 hookLine을 쓰고 데이터 최상위에 `"hookFrame": "action"`을 쓴다. 상시 헤드라인, 댓글 키워드 CTA, 목차 바, 기사 캡처, 렌더 컴포지션, rank1 선정 기준은 바꾸지 않는다.
- 두 항목의 flags는 `{"HOOK_FRAME_MULEORI": "action"}` 하나뿐이다. 포맷·TTS 키는 넣지 않는다(reject 롤백을 activate가 다시 덮어쓰지 않도록).

## 2. 라우팅 (single-issue-v1 판정별)

| single-issue-v1 판정 | 진입 항목 | B 활성화 후 muleori flags | B의 flagsBefore(롤백 기준) |
|---|---|---|---|
| adopt | `action-hook-v1` | `{"REEL_FORMAT_MULEORI":"single","TTS_ENABLED":"1","HOOK_FRAME_MULEORI":"action"}` | `{single, 1}` |
| reject | `action-hook-v1-digest` (롤백 뒤) | `{"REEL_FORMAT_MULEORI":"","TTS_ENABLED":"0","HOOK_FRAME_MULEORI":"action"}` | `{"", "0"}` |
| 중간(14회차) | 해당 없음 — 28회차 연장 | 변화 없음 | 해당 없음 |
| inconclusive(연장 28회차) | `action-hook-v1` | adopt 행과 같음 | `{single, 1}` |
| veto | 활성화 안 함(`hold: true`) | `{single, 1}` 그대로 | 해당 없음 |

## 3. 지표·스냅샷·제외 규칙

- 지표 공식과 스냅샷 규칙은 single-issue-v1 부록(`experiments/preregistration/single-issue-v1-addendum.md`) 2절을 그대로 따른다. avg_watch = `ig_reels_avg_watch_time` 중앙값(초), views = views 중앙값, 당일 스냅샷만, 성숙 기준은 스냅샷 날짜 05:00 KST 기준 발행 24시간.
- 고정 창: startStem(활성화 시점에 data가 이미 커밋된 회차의 다음 회차)부터 스템 순으로 제외 규칙을 통과한 앞의 14회차. 기다려야 하는 회차를 만나면 멈춘다.
- 오염 제외 규칙은 부록 4절과 같고, evidence 표만 아래로 바꾼다.

| 항목 | evidence (전부 일치해야 유효) |
|---|---|
| action-hook-v1 | `docs/hooks/<stem>.txt`=action, `docs/formats/<stem>.txt`=single, `docs/arms/<stem>.txt`=tts, `data/<stem>.json`의 `issues[0].narration` 비어 있지 않음 |
| action-hook-v1-digest | `docs/hooks/<stem>.txt`=action, `docs/formats/<stem>.txt`=digest, `docs/arms/<stem>.txt`=control |

- `docs/hooks/<stem>.txt`는 render가 루틴이 실제로 쓴 `data.hookFrame`으로 기록한다(`action`이 아니면 `v2`). 루틴이 v2로 쓴 회차는 evidence 사유로 제외된다.
- rebuild 제외: 발행 마커 커밋 이후 그 회차의 formats·arms·**hooks** 기록을 바꾼 커밋이 있으면 제외한다.

## 4. 판정 기준

| 항목 | samples / extendTo | adopt (AND) | reject | 근거 |
|---|---|---|---|---|
| action-hook-v1 (single 기반) | 14 / 28 | avgWatchMedian ≥ 4.9 AND viewsMedian ≥ 100 | avgWatchMedian < 3.3 | single 무처치 n=14 부트스트랩(9/30-am~10/4-pm, 10회차) 5% 3.26초·95% 4.93초. views 하한은 도달 감소 가드(single views 중앙값 131.5) |
| action-hook-v1-digest (digest 기반) | 14 / 28 | avgWatchMedian ≥ 3.8 AND viewsMedian ≥ 100 | avgWatchMedian < 2.7 | digest 무처치 n=14 부트스트랩(9/14-am~9/29-pm, 훅 v1 시기, 32회차) 5% 2.71초·95% 3.81초 |

- reject를 먼저 본다. 둘 다 아니면 같은 startStem부터 28회차로 1회 연장하고, 연장 뒤에도 중간이면 inconclusive로 기록한다.
- shares·saved는 기록만 하고 조건에 넣지 않는다(single 10회차에 shares 1건이라 판정 지표로 쓸 수 없다).
- 다음 실험(`next`)은 세 판정 모두 `signals-actions`(draft)다. 판정 적용 뒤 `waitingFor`로 대기하고 health가 WARN queue로 알린다. 이는 예상된 상태다.

## 5. am/pm 구성 규칙 (B 항목에만 적용)

- B 판정이 기록되면 판정 문서(`experiments/verdicts/<id>.md`) "회차별" 표의 유효 표본에서 am 수와 pm 수를 센다.
- **차이가 2 이상이면 판정 문서의 verdict와 상관없이 거부권 창 안에 veto하고, 이 문서와 판정 문서에 "am/pm 구성 무결론"으로 기록한다.** veto 후 계정은 `hold`로 멈추며, 다음 실험은 사람이 hold를 풀어 정한다.
- 근거: single은 am 5회 중앙값 5.32초, pm 5회 중앙값 3.00초로 슬롯 차이가 크다. critic 층화 부트스트랩 결과, 처치 효과가 없어도 am 9·pm 5 구성이면 채택 확률 18.5%, am 6·pm 8 구성이면 기각 확률 10.4%다. 4절 임계값은 am 7·pm 7 구성에서만 잡음 범위를 뜻한다.
- single-issue-v1의 사전등록은 바꾸지 않는다.

## 6. 적용과 거부권

- single-issue-v1 부록 5절과 같다. 판정한 실행은 기록만 하고, 다음 insights 실행(판정 후 20시간 이상 경과)에서 적용한다.
- 거부권: 다음 insights 실행 전에 `experiments/state.json`의 `muleori.pending.veto`를 `true`(따옴표 없는 불리언)로 바꾼 커밋을 main에 올린다. 커밋 시각은 판정 당일 09:30부터 다음 날 04:30 KST 사이(insights가 05:00 예약대로 일찍 시작할 수 있음).
- single-issue-v1이 reject인데 사람이 veto하고 `state.muleori.hold`를 지우면, 판정기가 큐 순서상 첫 ready 항목인 `action-hook-v1`(single 기반)을 켠다. 이 경로는 사전등록 기각 규칙을 사람이 뒤집는 것이므로 판정 문서에 사유를 남긴다.

## 7. 임계값 수정 가능 기간

- 임계값은 첫 처치 회차 전까지만 고칠 수 있다. 10/8 스냅샷으로 14회차 분포를 다시 계산해 위 값과 0.2초 넘게 다르면, 2차 배포 창(10/8 09:30 ~ 10/9 04:30 KST)에 큐와 이 문서를 함께 고친다.

## 8. 예상 일정 (single-issue-v1이 10/8에 adopt·reject로 판정될 때)

- 적용: 10/9 insights. 첫 처치 회차는 대개 `2026-10-09-pm`(insights가 10/9-am data 커밋 뒤에 실행될 때).
- 14회차 창: 10-09-pm ~ 10-16-am(제외가 없을 때). 판정 약 10/18 insights, 적용 약 10/19.
- single-issue-v1이 중간 판정으로 연장되면 첫 처치 회차는 약 `2026-10-16-pm`.
