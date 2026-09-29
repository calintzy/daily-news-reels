---
date: 2026-09-29
experiment: single-issue-v1
type: preregistration-addendum
original: RyanVault 02-CONTENT/ideas/2026-09-14-daily-news-reels-single-issue-preregistration.md
---

# 사전등록 부록: single-issue-v1 (첫 판정 전 추가)

원 사전등록(2026-09-14)의 채택·기각 임계값은 바꾸지 않는다. 아래는 원문에 없던 집계·보류·연장 규칙을 첫 판정 전에 고정하는 부록이다. 판정은 `scripts/experiment.mjs`가 이 규칙대로 자동으로 한다.

## 1. 전환 시점과 창

- 전환: 2026-09-29 밤 저장소 변수로 켜고, 이후 `experiments/flags.json`(single + TTS 1)으로 이전한다. 원문의 9/19 전환은 실행되지 않았다.
- 창 시작 회차(startStem): `2026-09-30-am`.
- 판정 표본은 날짜 구간(kpi-latest.md의 "최근 14일")이 아니라 **고정 회차 목록**이다. startStem부터 스템 순으로 보며 아래 제외 규칙을 통과한 앞의 14회차만 쓴다. 날마다 다시 계산해도 같은 14회차가 나온다(엿보기 편향 방지).
- 아직 발행 24시간이 지나지 않았거나 스냅샷에 아직 없는 회차를 만나면 거기서 멈추고 기다린다. 뒤 회차로 건너뛰지 않는다.

## 2. 지표와 스냅샷

- 공식은 kpi-latest.md와 같다(`scripts/kpi.mjs`의 `aggregate`): shares/1000reach = shares 합 / reach 합 × 1000, avg_watch = `ig_reels_avg_watch_time` 중앙값(초).
- 판정은 **당일 스냅샷**으로만 한다. insights 워크플로는 수집 직후 `insights.json`을 `metrics/<KST 오늘>.json`으로 먼저 복사하고, KPI 집계와 판정기가 모두 그 경로를 명시 인자로 받는다. 당일 스냅샷이 없으면 그날은 판정하지 않는다.
- 성숙 기준은 스냅샷 파일 날짜의 05:00 KST 기준 발행 24시간 경과다(kpi.mjs와 같다). insights는 05:00 예약이지만 실측 시작은 07:00~09:15다.

## 3. 판정 규칙

- 채택: shares/1000reach ≥ 5 **그리고** avg_watch ≥ 5.4초(조건 목록은 AND).
- 기각: avg_watch < 3.6초. 기각 조건을 채택보다 먼저 본다.
- 중간 구간(둘 다 아님): **1회 연장**한다. 창을 같은 startStem부터 28회차로 늘리고 다시 기다린다.
- 연장 후에도 중간 구간이면 **무결론(inconclusive)**으로 기록하고 flags는 유지한 채 다음 ready 실험(`next.inconclusive`)을 활성화한다. 다음 항목이 draft이면 활성화하지 않고 계정은 유휴가 된다(health가 WARN queue로 알린다). 근거: 기각 임계 미만이 아니므로 해악 증거가 없다.

## 4. 오염 제외 (표본에서 빼고 사유별로 센다)

| 사유 | 조건 |
|---|---|
| evidence | `docs/formats/<stem>.txt` ≠ single 또는 `docs/arms/<stem>.txt` ≠ tts(`control-fallback` 포함) |
| evidence-missing | 위 기록 파일 없음 |
| data | `data/<stem>.json`의 `issues[0].narration`이 비었음(나레이션은 처치의 일부) |
| rebuild | 발행 마커 커밋 이후 그 회차의 formats/arms 기록을 바꾼 커밋이 있음(수동 재빌드가 기록을 덮어씀) |
| unpublished | 발행 마커가 없거나 pending이고 예상 발행 후 24시간이 지남 |
| no-metrics / metrics-error | 스냅샷에 행이 없거나 오류 행 |

고려 회차 중 제외 비율이 30%를 넘으면 판정 문서에 오염 경고를 싣고 health가 WARN contamination을 낸다. 판정 자체는 막지 않는다.

## 5. 적용과 거부권

- 판정한 실행에서는 판정(verdict)만 기록한다(`experiments/verdicts/single-issue-v1.md`, state의 pending). flags 변경과 다음 실험 활성화는 **다음 insights 실행**(판정 후 20시간 이상 경과)에서 적용한다.
- 그 사이 사람이 `experiments/state.json`의 `muleori.pending.veto`를 true로 바꾸는 커밋을 main에 올리면, 적용 시 flags를 유지하고 실험을 거부(vetoed)로 닫으며 다음 실험을 활성화하지 않는다.
- 기각 적용 시 flags는 실험 시작 직전 값(`flagsBefore`: 포맷 digest, TTS 0)으로 돌아간다. 두 값을 함께 되돌리므로 짝홀 A/B는 재개되지 않는다.

## 6. 외생 충격 (동시 대조군)

- 판정 문서에 같은 기간 aibrief 지표와 창 직전 14일 aibrief 지표를 함께 적는다.
- aibrief avg_watch 중앙값이 창 직전 대비 70% 미만이면 "두 계정 동반 급락 의심"을 기록한다. **자동 강등(보류)은 하지 않는다** — 기록만 하고 판단은 거부권으로 사람이 한다.

## 7. 예상 일정 (재계산)

- 14회차: 2026-09-30-am ~ 2026-10-06-pm(제외가 없을 때).
- 마지막 회차(10/6 17:30 발행)는 10/7 스냅샷(05:00 기준 11.5시간)에서 미성숙, 10/8 스냅샷에서 성숙한다.
- 첫 판정: 2026-10-08 insights 실행(05:00 예약, 실측 07:00~09:15). 적용: 2026-10-09 insights 실행. 적용 후 flags는 그다음 데이터 커밋 회차부터 반영된다.
