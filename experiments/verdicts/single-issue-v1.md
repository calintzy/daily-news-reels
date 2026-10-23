# 판정: single-issue-v1 — reject

- 판정 시각: 2026-10-24T07:58:15+09:00
- 계정: muleori / 창: 2026-09-30-am부터 유효 표본 28개 (연장)
- 가설: 단일 이슈 18초 + 나레이션이 시청·공유를 올린다
- 사전등록: RyanVault 02-CONTENT/ideas/2026-09-14-daily-news-reels-single-issue-preregistration.md / 부록: experiments/preregistration/single-issue-v1-addendum.md
- 적용: 다음 insights 실행(판정 후 20시간 이상 경과)에서 적용한다. 거부하려면 그 전에 `experiments/state.json`의 `muleori.pending.veto`를 true로 바꾸는 커밋을 main에 올린다.

## 조건 (각 목록은 AND)

| 구분 | kpi | 조건 | 실측 | 충족 |
|---|---|---|---|---|
| adopt | sharesPer1000Reach | >= 5 | 0.4 | X |
| adopt | avgWatchMedian | >= 5.4 | 3.6 | X |
| reject | avgWatchMedian | < 3.6 | 3.6 | O |

집계: n=28, reach 합 2731, shares 합 1, saved 합 0, views 중앙값 120.0

## 회차별

| 스템 | 상태 | reach | shares | avg_watch(초) | 비고 |
|---|---|---|---|---|---|
| 2026-09-30-am | 유효 | 140 | 1 | 5.3 |  |
| 2026-09-30-pm | 유효 | 56 | 0 | 2.4 |  |
| 2026-10-01-am | 유효 | 142 | 0 | 4.5 |  |
| 2026-10-01-pm | 유효 | 111 | 0 | 3.6 |  |
| 2026-10-02-am | 유효 | 137 | 0 | 3.6 |  |
| 2026-10-02-pm | 유효 | 109 | 0 | 3.0 |  |
| 2026-10-03-am | 유효 | 128 | 0 | 5.6 |  |
| 2026-10-03-pm | 유효 | 107 | 0 | 3.6 |  |
| 2026-10-04-am | 유효 | 143 | 0 | 5.7 |  |
| 2026-10-04-pm | 유효 | 24 | 0 | 1.3 |  |
| 2026-10-05-am | 유효 | 2 | 0 | 7.0 |  |
| 2026-10-05-pm | 유효 | 120 | 0 | 2.3 |  |
| 2026-10-06-am | 유효 | 127 | 0 | 90.1 |  |
| 2026-10-06-pm | 유효 | 106 | 0 | 12.1 |  |
| 2026-10-07-am | 유효 | 130 | 0 | 3.6 |  |
| 2026-10-07-pm | 유효 | 100 | 0 | 2.9 |  |
| 2026-10-08-am | 유효 | 67 | 0 | 2.5 |  |
| 2026-10-08-pm | 유효 | 88 | 0 | 2.2 |  |
| 2026-10-09-am | 유효 | 103 | 0 | 2.5 |  |
| 2026-10-09-pm | 유효 | 109 | 0 | 4.2 |  |
| 2026-10-10-am | 유효 | 114 | 0 | 3.5 |  |
| 2026-10-10-pm | 유효 | 120 | 0 | 1.8 |  |
| 2026-10-11-am | 유효 | 104 | 0 | 2.6 |  |
| 2026-10-11-pm | 유효 | 6 | 0 | 3.6 |  |
| 2026-10-12-am | 유효 | 109 | 0 | 4.0 |  |
| 2026-10-12-pm | 제외:evidence | - | - | - | docs/arms/2026-10-12-pm.txt=control-fallback |
| 2026-10-13-am | 제외:evidence | - | - | - | docs/arms/2026-10-13-am.txt=control-fallback |
| 2026-10-13-pm | 제외:evidence | - | - | - | docs/arms/2026-10-13-pm.txt=control-fallback |
| 2026-10-14-am | 제외:evidence | - | - | - | docs/arms/2026-10-14-am.txt=control-fallback |
| 2026-10-14-pm | 제외:evidence | - | - | - | docs/arms/2026-10-14-pm.txt=control-fallback |
| 2026-10-15-am | 제외:evidence | - | - | - | docs/arms/2026-10-15-am.txt=control-fallback |
| 2026-10-15-pm | 제외:evidence | - | - | - | docs/arms/2026-10-15-pm.txt=control-fallback |
| 2026-10-16-am | 제외:evidence | - | - | - | docs/arms/2026-10-16-am.txt=control-fallback |
| 2026-10-16-pm | 제외:evidence | - | - | - | docs/arms/2026-10-16-pm.txt=control-fallback |
| 2026-10-17-am | 제외:evidence | - | - | - | docs/arms/2026-10-17-am.txt=control-fallback |
| 2026-10-17-pm | 제외:evidence | - | - | - | docs/arms/2026-10-17-pm.txt=control-fallback |
| 2026-10-18-am | 제외:evidence | - | - | - | docs/arms/2026-10-18-am.txt=control-fallback |
| 2026-10-18-pm | 제외:evidence | - | - | - | docs/arms/2026-10-18-pm.txt=control-fallback |
| 2026-10-19-am | 제외:evidence | - | - | - | docs/arms/2026-10-19-am.txt=control-fallback |
| 2026-10-19-pm | 제외:evidence | - | - | - | docs/arms/2026-10-19-pm.txt=control-fallback |
| 2026-10-20-am | 제외:evidence | - | - | - | docs/arms/2026-10-20-am.txt=control-fallback |
| 2026-10-20-pm | 제외:evidence | - | - | - | docs/arms/2026-10-20-pm.txt=control-fallback |
| 2026-10-21-am | 유효 | 109 | 0 | 2.9 |  |
| 2026-10-21-pm | 유효 | 103 | 0 | 3.2 |  |
| 2026-10-22-am | 유효 | 17 | 0 | 3.6 |  |

제외: evidence 17 (고려 45회차 중 17)

**오염 경고**: 제외 비율 38% > 30%

## 동시 대조군 (aibrief, 같은 기간)

- 창 기간: n=21, shares/1000reach 0.0, avg_watch 중앙값 2.7초
- 창 직전 14일: n=13, avg_watch 중앙값 3.8초

