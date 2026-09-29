# 신호 수집 GitHub Actions 이전 (signals-actions) 구현 계획

작성일 2026-09-29 · 상태: 초안(critic 대기) · 기준: deploy-0929(5180312) + self-improve-loop 브랜치(fd64d87). Step 1~2는 self-improve-loop와 독립이라 먼저 배포할 수 있고, Step 3~5는 self-improve-loop가 main에 배포된 뒤에 올린다.

## 변경 이력
| 날짜 | 변경 | 사유 |
|---|---|---|
| 2026-09-29 | 초안 | — |
| 2026-09-29 | critic 1차 반영 (Step 1~2 범위) | (1) 산출물을 main이 아닌 전용 브랜치 `signals`에 커밋(.git 5.3GB라 얕게 조작, `contents: write`), 루틴은 `git fetch origin signals && git show origin/signals:signals/<stem>.json`으로 읽음. (2) push 재시도 프로브를 로컬 bare repo self-test(`scripts/signals-push.sh --self-test`, 음성 대조군 포함)로 교체하고 동시 dispatch 프로브 삭제. (3) 누출 감지 Anti-ISC-8 추가. (4) 창 상수를 validate.mjs FRESHNESS_WINDOWS와 동일값으로 고정하고 경계 self-test 추가, CLI 옵션을 구현과 일치(`--out-dir` 삭제, `--root`·`--out`·`--only`·`--cases` 명세). 부수: 네이트 디코더를 응답 charset으로 선택하고 U+FFFD 비율로 fail 판정(모지바케 음성 대조군), news `description` 필드 삭제, 픽스처 기대 개수는 cases.json에서 읽음, 사실 수치 정정(86회차 전부 fail, insights 34회, 거부권 20시간, 제외 라벨 `data`). |

## Intent
- Problem: 클라우드 루틴(am 07:10·pm 17:20 KST)의 WebFetch 신호 수집이 샌드박스 egress 때문에 8/18 이후 86회차 전부 fail이다. 그래서 WebSearch(관련도순, 날짜 없음)가 기사 풀을 채웠고, 9/29-am에 33시간 지난 기사가 편입됐다. 신선도 게이트는 오래된 기사를 반려만 할 뿐 신선한 기사 풀을 만들어 주지 않으므로 결방 위험이 남는다.
- Proposed outcome: Actions가 슬롯 전에 구글뉴스·구글 트렌드·네이트 랭킹을 수집해 전용 브랜치 `signals`에 `signals/<stem>.json`으로 커밋하고(main에는 커밋하지 않는다), 루틴은 `git fetch origin signals && git show origin/signals:signals/<stem>.json`으로 이 파일을 1순위로 읽는다. 기사 풀의 `sourceDate`는 파일의 pubDate(KST)를 그대로 쓴다. 루틴이 파일을 쓸지는 실험 큐 항목 signals-actions가 `experiments/flags.json`으로 켜고 끈다.
- Affected users and systems: 운영자 Ryan / 신규 `.github/workflows/signals.yml`, `scripts/collect.mjs`(확장), 신규 `signals/`, `test/fixtures/signals/`, `REELS_SPEC.md` 수집 절, `scripts/flags.mjs`(허용 키 1개), `experiments/queue.json`, `scripts/health.mjs`(점검 1개), `.github/workflows/contract-check.yml`(paths·스텝 1개), 클라우드 루틴(스펙 경유).
- Constraints: 새 npm 의존성 금지, ESM .mjs, 한국어 주석. render.mjs·tts.mjs·validate.mjs·cleanup.mjs 무수정. 선정 기준 변경은 am 회차 전에만 반영한다. 계정별 활성 실험은 하나이며 single-issue-v1 판정 전에는 루틴 동작을 바꾸지 않는다. 범위 밖: 네이버 랭킹 복구, 프록시·외부 스케줄러 도입, aibrief(오리 기자) 수집, 루틴 프롬프트 자체 수정.
- Open questions: 아래 Open Questions 절 3건(Actions IP 차단 시 대안, 기준선 수치 확정 시점, 파일 보존).

## Context (실측, 2026-09-29)

- 소스 응답(로컬 curl 22:07 KST 재확인): 구글뉴스 RSS 91KB·item 34개·pubDate GMT, 트렌드 RSS 20KB·item 10개·`ht:news_item` 29개·pubDate `-0700`, 네이트 랭킹 87KB·EUC-KR. 트렌드 `ht:news_item`에는 게시 시각 필드가 없다(URL에 날짜가 있는 경우만 있음). 네이트 기사 링크는 `//news.nate.com/view/20260929n21906` 형태로 날짜를 담는다.
- `new TextDecoder('euc-kr')`로 네이트를 디코딩하면 제목 20개가 깨짐 없이(U+FFFD 0개) 나온다(로컬 Node 25). WHATWG `euc-kr`은 windows-949(CP949) 상위집합이다. Actions의 Node 20 공식 빌드는 full-icu를 포함하지만 Step 2의 dispatch 실측으로 확인한다.
- `scripts/collect.mjs`(91줄)는 구글뉴스 RSS만 파싱해 배열을 출력한다. 워크플로 호출처는 없고 README·REELS_SPEC이 "로컬/Actions 보조 수집기"로 언급만 한다. `decode`·`pick` 파서를 재사용할 수 있으므로 **새 스크립트 대신 collect.mjs를 확장**한다(기본 출력은 하위 호환 유지).
- 트리거 경로: reels.yml은 `push: paths: data/*.json`, report-notify는 `reports/**`, contract-check는 `contracts/**`·`scripts/rewrite-probes.cjs`(self-improve-loop가 experiments 관련 경로 추가)만 본다. `signals` 브랜치 push는 `data/*.json` 경로가 없으므로 reels를 트리거하지 않고, 다른 워크플로도 `branches: [main]`이거나 무관한 경로만 본다. signals.yml 자체는 schedule이 돌도록 main에 있어야 한다.
- 기존 커밋 워크플로(insights·cleanup·reels)는 `git pull --rebase origin main || true; git push` 1회 시도다. cleanup은 reels와 같은 concurrency 그룹을 쓴다.
- 리포 `.git`는 5.3GB(영상 이력), `data/`는 1.4MB·182파일이다.
- 스케줄 실행 실제 시작 시각(`gh run list`, 8/27~9/29, KST):

| 워크플로(예약 KST) | 실제 시작 | 지연 |
|---|---|---|
| cleanup(04:17) | 06:15~07:34, 이상치 08:12·08:49·11:11·12:35 | 약 2~3시간 |
| insights(05:00) | 06:55~08:05, 이상치 08:37·09:11·11:42·13:02 | 약 2~3시간 |
| watchdog am(08:30) | 10:16~11:36 | 약 1.5~3시간 |
| watchdog ai(13:30) | 17:52~20:06 | 약 4.5~6.5시간 |
| watchdog pm(18:00) | 21:52~02:20 | 약 4~8시간 |

  8/26 이전에는 지연이 20~30분이었다. UTC 오후(KST 밤~새벽)에 지연이 가장 크다. 00~04시 KST 예약의 지연은 표본이 없다.
- self-improve-loop 브랜치: `experiments/flags.json`이 플래그의 유일한 진실원이고, `scripts/flags.mjs`의 `FLAG_DEFAULTS`가 허용 키 화이트리스트(`REEL_FORMAT_MULEORI`, `TTS_ENABLED`)다. 큐 항목 evidence는 `{path("{stem}" 포함), equals}` 또는 `{data, nonEmpty:true}` 두 형식만 허용한다. KPI 키는 `sharesPer1000Reach`, `savedPer1000Reach`, `avgWatchMedian`, `viewsMedian`이다. `nextStem()`은 적용 시점에 마지막 data 다음 회차를 startStem으로 잡는다. single-issue-v1은 2026-09-30-am부터 14회차이고 `next.adopt`·`next.inconclusive`가 signals-actions다. health.mjs `checkSignals`는 `signalSources` 값에 `"fail"`이 있는지만 센다.
- **applyBefore 충돌**: self-improve-loop 계획 Open Question 4는 signals-actions를 ready로 바꿀 때 `applyBefore: "07:00"`을 두라고 정했다. 그런데 판정기가 도는 insights는 8/27 이후 34회 중 3회(06:55·06:56·06:57)만 07:00 전에 시작했다. 그대로 두면 활성화가 열흘 가까이 연기되고 health가 pending 48시간 정체 경보를 낸다. 이 계획은 applyBefore 대신 "am 래치"를 쓴다(설계 결정 3).

## Work Objectives

1. Actions가 슬롯마다 멱등하게 `signals/<stem>.json`을 만든다. 소스별 성패가 파일에 남는다.
2. 파서마다 실제 응답 픽스처와 음성 대조군이 있는 self-test가 있다.
3. 루틴은 플래그가 켜진 회차에만 파일을 1순위로 읽고, 결과를 `selection.signalSources.file`에 남긴다. 플래그가 꺼져 있으면 지금과 동작이 같다.
4. signals-actions가 사전등록된 판정 지표로 실험 큐에서 자동으로 켜진다.
5. health가 파일 신선도·결측을 매일 점검한다.

## Guardrails

Must Have
- 멱등: 같은 stem으로 여러 번 실행해도 결과 파일은 하나이고, 성공 소스 수가 줄어드는 덮어쓰기를 하지 않는다.
- 슬롯 컷오프 뒤(am 07:00, pm 17:10 KST)이거나 `data/<stem>.json`이 이미 있으면 수집·커밋 없이 exit 0으로 끝난다(루틴 push와의 경합 차단). 존재 판단은 main 체크아웃의 `data/` 기준이다.
- 산출물은 `signals` 브랜치에만 커밋한다(없으면 orphan 생성). push는 최신 원격 위로 내 커밋 1개를 rebase(-X theirs)한 뒤 최대 3회 재시도하고, 3회 모두 실패하면 exit 1이다. 브랜치 조작은 `--depth=1` fetch와 임시 worktree로만 한다.
- push는 `pull --rebase` 후 재시도 3회.
- 파서 게이트마다 음성 대조군 1개 이상.
- Actions IP에서의 소스 도달성을 cron 활성화 전에 dispatch로 실측한다.

Must NOT Have
- 새 npm 의존성, iconv류 라이브러리.
- `data/` 경로 쓰기(signals.yml은 존재 여부만 읽는다).
- 플래그가 꺼진 상태에서의 루틴 동작 변경.
- WebSearch 결과를 신호로 쓰는 것(스펙의 기존 금지 유지).
- single-issue-v1 진행 중 수동으로 SIGNALS_FILE을 켜는 것(실험 오염).

## 설계 결정

### 결정 1: 산출물 스키마
```json
{
  "stem": "2026-09-30-am",
  "collectedAt": "2026-09-30T04:12:33+09:00",
  "sources": { "news": "ok", "trends": "ok", "nate": "fail" },
  "errors": { "nate": "HTTP 403" },
  "news":   [{ "title": "", "source": "", "link": "", "pubDate": "2026-09-30T03:30:00+09:00" }],
  "trends": [{ "term": "", "pubDate": "2026-09-29T21:00:00+09:00", "newsItems": [{ "title": "", "snippet": "", "url": "", "source": "" }] }],
  "nate":   [{ "rank": 1, "title": "", "link": "https://news.nate.com/view/20260929n21906" }]
}
```
- 모든 시각은 `+09:00` ISO 8601이다. 루틴이 `sourceDate`에 그대로 복사할 수 있는 형식이다(validate 신선도 게이트 형식과 같다).
- news는 슬롯 창 시작(am: D-1 15:00, pm: D 06:00, validate와 같은 정의) 이전 pubDate와 파싱 불가 pubDate를 버린다. 창 밖 기사가 파일에 들어가지 않으므로 루틴이 쓸 수 없다.
- news의 `description`은 저장하지 않는다(구글뉴스 description은 제목 목록의 반복이라 정보가 없고 파일만 키운다). 기존 모드(배열 출력)는 하위 호환을 위해 description을 유지한다.
- 창 하한은 `scripts/validate.mjs` FRESHNESS_WINDOWS의 `from`과 같은 값이다: am은 D-1 15:00 KST, pm은 D 06:00 KST이고 하한은 포함(`>=`)이다. collect.mjs의 `WINDOW_FROM_HOURS`(am -9, pm 6)와 validate가 어긋나면 안 되므로 경계 self-test(window-boundary-am·pm: 정각 유지, 1초 전 제거)가 잠근다. 상한은 수집 시각이 컷오프 이전이라 두지 않는다.
- 소스 ok 기준(파서 게이트): news는 창 안 item 5개 이상, trends는 검색어·pubDate가 있는 item 5개 이상, nate는 제목 10개 이상이면서 디코딩 결과의 U+FFFD 비율이 0.1% 이하이고 제목에 한글 포함. 네이트 디코더는 응답 charset(헤더, 없으면 meta)으로 고르고 알 수 없는 charset이면 fail이다. 기준 미달이면 그 소스는 `fail`이고 배열은 비운다. 세 소스가 전부 fail이면 파일을 쓰지 않고 exit 1이다.
- ponytail 지점: 트렌드는 전체 10개를 그대로 둔다(라틴 문자 검색어 제외 규칙은 루틴 스펙이 이미 가진다).

### 결정 2: 실행 시각·stem·멱등
| 슬롯 | 예약(KST) | cron(UTC) | 컷오프 |
|---|---|---|---|
| am | 01:07 / 02:37 / 04:07 | `7 16 * * *`, `37 17 * * *`, `7 19 * * *` | 07:00 |
| pm | 09:37 / 10:37 / 11:37 | `37 0 * * *`, `37 1 * * *`, `37 2 * * *` | 17:10 |

- 근거: 04:17·05:00 예약이 2~3시간 늦으므로 am 마지막 예약은 04:07이다(예상 06:00~07:10, 컷오프를 넘기면 no-op). 00~04시 지연은 표본이 없어 01:07·02:37 두 개를 앞에 둔다. pm은 08:30 예약이 1.5~3시간, 13:30 예약이 4.5~6.5시간 늦으므로 오전 후반에 셋을 둔다. 정시(:00)는 GitHub 부하가 몰리는 시각이라 피한다.
- stem: 스케줄 실행은 `github.event.schedule` 문자열로 슬롯을 정하고(watchdog과 같은 방식) 날짜는 실행 시각의 KST 날짜로 정한다. am 예약이 KST 01시 이후라 날짜가 어긋나지 않는다. dispatch는 `stem` 입력을 쓴다.
- 덮어쓰기 규칙: 기존 파일이 있으면 새 결과의 ok 소스 수가 기존 이상일 때만 덮어쓴다(나중 수집일수록 신선하므로 동률이면 덮어쓴다).
- concurrency 그룹 `signals`(cancel-in-progress false)로 지연된 예약이 겹쳐도 직렬 실행한다. reels 그룹에는 넣지 않는다(빌드 대기 중 컷오프를 넘길 수 있다).
- 커밋 메시지 `signals: <stem> news=ok trends=ok nate=fail`. stdout 요약 1줄 `signals: <stem> news=ok(34) trends=ok(10) nate=ok(20)`.

### 결정 3: 루틴 쪽 켜는 방식 = flags.json + am 래치 (applyBefore 미사용)
- 대안 A(스펙 자체 배포): single-issue-v1 창(9/30~) 도중 선정 기준이 바뀌어 그 실험을 오염시킨다. 기각.
- 대안 B(flags.json + `applyBefore: "07:00"`): 위 applyBefore 충돌 때문에 활성화가 사실상 멈춘다. 기각.
- 채택: `flags.mjs`의 `FLAG_DEFAULTS`에 `SIGNALS_FILE: "0"`을 추가한다. **am 루틴만** `experiments/flags.json`의 `muleori.SIGNALS_FILE`을 읽는다. **pm 루틴은 flags.json을 읽지 않고 같은 날 am 데이터에 `selection.signalSources.file` 키가 있는지를 따른다**(am이 없으면 flags.json). 판정기가 언제 적용하든 전환은 다음 am부터 하루 단위로 일어나므로 "am 전에만 배포" 규칙을 지킨다. applyBefore는 null로 둔다.
- 적용이 am 이후에 일어나면 `nextStem()`이 당일 pm을 startStem으로 잡는다. 그 pm은 래치 때문에 file 키가 없어 `data` 라벨(evidence 불일치)로 제외된다(15회차 중 1회차, 오염 30% 경고 기준 아래).
- 플래그 해석이 LLM 루틴의 준수에 달려 있다. 준수 여부는 evidence(`selection.signalSources.file` nonEmpty)로 표본마다 확인하고, 불이행 회차는 자동 제외된다.

### 결정 4: 루틴 폴백과 기록
- SIGNALS_FILE이 켜진 회차: `git fetch origin signals && git show origin/signals:signals/<stem>.json`으로 파일을 읽는다(main 체크아웃에는 signals/ 디렉터리가 없다).
  - 파일 없음 → `file: "missing"`. 수집 시각이 루틴 실행 시각보다 8시간 넘게 이르면 → `file: "stale"`(am 07:10이면 전날 23:10, pm 17:20이면 09:20이 경계이며 두 경계 모두 첫 예약 시각보다 앞선다). 두 경우 모두 기존 WebFetch → WebSearch 순서로 폴백한다.
  - 그 외 → `file: "ok"`. `signalSources`의 news·trends·nate는 파일의 `sources` 값을 그대로 복사한다. 파일의 news가 fail이면 기사 풀만 기존 폴백을 쓴다.
  - 기사 풀의 `sourceDate`는 파일 news의 `pubDate`를 그대로 쓴다. 트렌드 `newsItems`는 게시 시각이 없으므로 기존 규칙대로 WebFetch로 게시 시각을 확인한 경우에만 편입하고, 그렇지 않으면 신호로만 쓴다.
- SIGNALS_FILE이 꺼진 회차: 스펙의 기존 수집 절을 그대로 따르고 `file` 키를 쓰지 않는다.
- signals가 별도 브랜치라 루틴의 data push와 경합하지 않는다. 스펙의 data push 규칙은 바꾸지 않는다.

### 결정 5: 보존
- signals/는 cleanup.mjs 보존 정책에 넣지 않는다. 파일당 약 40KB, 하루 최대 6커밋으로 연 90MB(압축 전)이고 `.git` 5.3GB 대비 무시할 수준이다. 파일 삭제는 이력 용량을 줄이지 못하고, 실험 판정 뒤 사후 분석(signalHits와 파일 대조)에 파일이 필요하다.

## Task Flow

### Step 1. 수집기 확장과 픽스처 (self-improve-loop와 독립)
- 내용: collect.mjs에 `--stem <stem>`(signals 모드, `--out <file>` 필수), `--now <ISO>`, `--root <dir>`(data/ 존재 검사 기준, 기본 `.`), `--from-dir <dir>`(네트워크 대신 gn.xml·tr.xml·nate.html 파싱), `--self-test [--cases <file>] [--only <name>]`를 추가한다. 이 밖의 옵션은 없다. `--out` 파일이 이미 있으면 덮어쓰기 규칙 비교 대상이 된다(워크플로가 signals 브랜치의 기존 파일을 그 경로에 미리 가져다 둔다). 인자 없는 기존 동작(구글뉴스 배열 출력)은 유지한다. 네이트는 `arrayBuffer()` + `TextDecoder('euc-kr')`로 디코딩한다. 컷오프·data 존재 시 건너뛰기, 창 필터, 파서 게이트, 덮어쓰기 규칙을 스크립트에 둔다(워크플로 bash가 아니라 스크립트에 두어 `--now`로 시험 가능하게 한다).
- 픽스처 재수집: 실행 당일 curl로 `gn.xml`, `tr.xml`, `nate.html`(EUC-KR 원본 바이트)을 `test/fixtures/signals/real/`에 저장하고 수집 시각을 `cases.json`에 기록한다. 음성 대조군은 실제 응답에서 파생한다. `empty.xml`(item 0개 RSS), `nate-mojibake.html`(원본을 UTF-8로 잘못 디코딩해 다시 쓴 파일), `gn-stale`(실제 item 하나의 pubDate를 창 밖으로 바꾼 파일), `tr-empty.xml`.
- self-test 필수 케이스: real-all-ok, news-empty-fail, nate-mojibake-fail, trends-empty-fail, stale-item-dropped, after-cutoff-skip, data-exists-skip, keep-better-existing, overwrite-on-tie, pubdate-kst-format, window-boundary-am, window-boundary-pm(각 정각 유지·1초 전 제거), before-cutoff-runs, pm-after-cutoff-skip, overwrite-on-better. 기대 개수(nate 등)는 소스 코드가 아니라 `test/fixtures/signals/cases.json`에서 읽고, 값은 픽스처에서 독립 계산했다(구글뉴스 34개 중 창 안 27개, 트렌드 10개, 네이트 순위 50개 중 상위 20). 파일: `cases.json`, 음성 대조군 `negative-cases.json`(기대값을 일부러 틀리게 적어 self-test가 exit 1 해야 한다), `gn-boundary.xml`·`gn-stale.xml`·`empty.xml`·`tr-empty.xml`·`nate-mojibake.html`, `existing-*.json`, `root-empty/`·`root-with-data/`.
- 변경 파일: `scripts/collect.mjs`, 신규 `test/fixtures/signals/`, 신규 `scripts/signals-push.sh`(Step 2와 함께 검증), `README.md` 사용법 1줄.
- 롤백: collect.mjs revert, 픽스처 디렉토리 삭제. 호출처가 없어 영향 없음.

### Step 2. signals.yml 배포와 Actions 실측 (self-improve-loop와 독립)
- 2a: `workflow_dispatch`만 있는 signals.yml(입력 `stem`, `dry`)을 main에 배포한다. dry=1은 수집·요약 출력만 하고 커밋하지 않는다. contract-check.yml paths에 `scripts/collect.mjs`·`test/fixtures/signals/**`를 추가하고 `collect.mjs --self-test` 스텝을 둔다.
- 2b: dry dispatch를 서로 다른 시각에 3회 실행해 Actions IP에서 소스별 도달성·Node 20 EUC-KR 디코딩을 확인한다. news가 fail이면 중단하고 Open Question 1로 돌아간다. trends·nate만 fail이면 news만으로 진행한다(신선도 문제는 해결되고 신호는 계속 fail로 기록된다).
- 2c: push 재시도는 `bash scripts/signals-push.sh --self-test`(로컬 bare repo, 원격에 끼어든 커밋 후 rebase 성공, 재시도 1회뿐이면 exit 1, 원격이 항상 거절하면 3회 후 exit 1 등 7케이스)로 시험한다. concurrency 그룹이 실행을 직렬화하므로 동시 dispatch 프로브는 쓰지 않는다. 이어서 커밋 모드 dispatch(dry=0) 1회로 signals 브랜치 orphan 생성·push와 reels 비트리거를 확인한 뒤 결정 2의 cron 6개 주석을 해제한다. 브랜치 조작은 `--depth=1` fetch와 임시 worktree만 쓰며 `permissions: contents: write`를 명시한다.
- 2d: cron 활성 뒤 3일간 슬롯별 첫 커밋 시각을 기록하고, 컷오프 전 커밋이 없는 슬롯이 있으면 해당 예약을 1시간 당긴다(계획 변경 이력에 기록).
- 변경 파일: 신규 `.github/workflows/signals.yml`, `.github/workflows/contract-check.yml`(paths·self-test 스텝 2개), 신규 `signals` 브랜치(봇 커밋, main에는 파일 없음).
- 롤백: signals.yml의 schedule 삭제 또는 파일 삭제, 필요하면 `signals` 브랜치 삭제. 루틴은 아직 파일을 읽지 않으므로 영향 없음.

### Step 3. 스펙·플래그 연결 (self-improve-loop 배포 뒤, am 회차 전 배포)
- 내용: `flags.mjs`의 `FLAG_DEFAULTS`에 `SIGNALS_FILE: "0"` 추가. REELS_SPEC.md 수집 절에 결정 3·4의 규칙(플래그 읽기, am 래치, missing/stale/ok 판정, 폴백, sourceDate 출처, push 거절 시 rebase)을 추가하고, 데이터 계약의 `signalSources` 예시에 `file` 키를 적는다. `experiments/flags.json`은 수정하지 않는다(값이 없으면 기본값 0).
- 변경 파일: `scripts/flags.mjs`, `REELS_SPEC.md`.
- 롤백: 두 파일 revert. 플래그가 0이면 스펙 추가분은 실행되지 않는다.

### Step 4. health 점검과 실험 큐 ready 전환 (single-issue-v1 판정 전, 목표 10/7)
- health: `checkSignalsFile` 추가. 기준 상수 `SIGNALS_FILE_SINCE`(Step 2c 배포일의 첫 am stem) 이후 최근 10개 물어오리 data stem 중 signals 파일이 없거나, 수집 시각이 결정 4의 stale 기준을 넘거나, `sources.news`가 ok가 아닌 비율이 50%를 넘으면 `ALERT signals-file`. 대상 stem이 없으면 INFO. self-improve-loop의 all-green 픽스처에 signals 파일을 추가해 기존 ISC-4.4(0건)를 유지한다. 신규 픽스처 `test/fixtures/health/signals-file-missing/`, self-test 케이스 `signals-file-missing`, `signals-file-before-since`.
- 큐: signals-actions를 ready로 바꾼다. `flags: {"SIGNALS_FILE": "1"}`, `evidence: [{"data": "selection.signalSources.file", "nonEmpty": true}]`(ITT: missing·stale도 처치 회차로 센다), `samples: 14`, `extendTo: 28`, `applyBefore: null`, adopt·reject는 사전등록 초안의 수치를 single-issue-v1 판정 문서의 기준선으로 채운다. `next`는 null(후속 미정).
- 사전등록 부록 `experiments/preregistration/signals-actions-addendum.md`를 ready 커밋과 같은 커밋으로 넣는다.
- self-improve-loop 계획 Open Question 4에 "applyBefore 대신 am 래치, 근거는 이 문서"를 1줄로 적는다.
- 변경 파일: `scripts/health.mjs`, `test/fixtures/health/**`, `experiments/queue.json`, 신규 `experiments/preregistration/signals-actions-addendum.md`, `docs/plans/2026-09-29-self-improve-loop.md`.
- 롤백: queue 항목을 draft로 되돌린다(활성 전이면 영향 없음, 활성 뒤면 판정기의 rollback 경로 대신 veto 또는 flags.json 수동 복귀). health 점검은 함수 호출 1줄 제거.

### Step 5. 활성화 확인 (자동, 사람은 관찰만)
- 판정기가 single-issue-v1 판정(adopt 또는 inconclusive) 후 20시간 거부권 창을 지나 signals-actions를 활성화한다. 다음 am부터 data에 `file` 키가 생기는지, 첫 3회차의 `file: ok` 비율과 signalHits를 확인한다.
- 롤백: `pending.veto` 또는 flags.json의 `SIGNALS_FILE`을 "0"으로 되돌리는 커밋(다음 am부터 원복). 수동 원복 커밋 메시지는 `experiment: rollback signals-actions`로 쓴다(Anti-ISC-6이 접두사로 판정기·원복 커밋만 허용한다).

## 사전등록 초안 (signals-actions)
- 가설: 슬롯 전 수집 파일로 신호·신선한 기사 풀을 복구하면 "이미 사람들이 보는 뉴스"가 선정되어 도달이 오른다.
- 처치: SIGNALS_FILE=1(ITT). 대조: single-issue-v1 판정 창 14회차(같은 포맷, 신호 fail 상태).
- 기준선 B: single-issue-v1 판정 문서의 viewsMedian·avgWatchMedian. ready 커밋에서 수치로 고정한다.
- 판정(판정기 자동): adopt = viewsMedian ≥ 1.2×B_views 그리고 avgWatchMedian ≥ 0.9×B_watch. reject = viewsMedian < 0.9×B_views. 그 사이는 28회차로 1회 연장 후 무결론.
- 과정 지표(판정 문서에 사람이 기록, 자동 판정에는 쓰지 않음): `file: ok` 비율(80% 미만이면 "처치 불충분" 표기, 50% 미만이면 판정 무효 권고), signalHits가 1건 이상인 회차 비율(대조 창과 비교), `[신선도]` 반려로 인한 결방 수(health missed 분류), 파일 news에서 온 기사 비율.
- 외생 충격: self-improve-loop 규칙대로 같은 기간 aibrief 지표를 병기한다(8/31~9/7 두 계정 동시 붕괴 선례).

## Criteria

프로브 출력은 판정용 몇 줄만 남기고 상세는 `$TMPDIR` 로그로 보낸다. `<base>`는 이 작업 시작 커밋이다.

Step 1
- ISC-1.1: `node scripts/collect.mjs --self-test 2>&1 | tail -1 → self-test N/N PASS` → pass/fail
- ISC-1.2 (음성 대조군, 비교기): `node scripts/collect.mjs --self-test --cases test/fixtures/signals/negative-cases.json >/dev/null 2>&1; echo $? → 1` → pass/fail
- ISC-1.3 (음성 대조군, 인코딩): `node scripts/collect.mjs --self-test --only nate-mojibake-fail 2>&1 | tail -1 → self-test 1/1 PASS` (nate=fail로 판정되어야 통과) → pass/fail
- ISC-1.4 (음성 대조군, 빈 RSS): `node scripts/collect.mjs --self-test --only news-empty-fail 2>&1 | tail -1 → self-test 1/1 PASS` → pass/fail
- ISC-1.5 (음성 대조군, 창 밖 pubDate): `node scripts/collect.mjs --self-test --only stale-item-dropped 2>&1 | tail -1 → self-test 1/1 PASS` → pass/fail
- ISC-1.6 (실응답 파싱): `node scripts/collect.mjs --from-dir test/fixtures/signals/real --stem <cases.json real-all-ok의 stem> --now <같은 케이스의 now> --out $TMPDIR/s.json >/dev/null 2>&1 && node -e 'const s=require(process.env.TMPDIR+"/s.json");console.log(s.sources.news,s.sources.trends,s.sources.nate,s.nate.length,s.news.every(i=>/\+09:00$/.test(i.pubDate)))' → ok ok ok <cases.json real-all-ok의 counts.nate> true` → pass/fail
- ISC-1.7 (하위 호환): `node scripts/collect.mjs --from-dir test/fixtures/signals/real 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(Array.isArray(JSON.parse(d))))' → true` → pass/fail
- ISC-1.8 (컷오프): `node scripts/collect.mjs --from-dir test/fixtures/signals/real --stem 2026-10-01-am --now 2026-10-01T07:05:00+09:00 --out $TMPDIR/sig.json 2>&1 | grep -c 건너뜀 → 1` 그리고 `test ! -e $TMPDIR/sig.json && echo nofile → nofile`(실행 전 `rm -f $TMPDIR/sig.json`) → pass/fail
- ISC-1.9 (음성 대조군, 창 경계): `node scripts/collect.mjs --self-test --only window-boundary-am 2>&1 | tail -1 → self-test 1/1 PASS` 그리고 `node scripts/collect.mjs --self-test --only window-boundary-pm 2>&1 | tail -1 → self-test 1/1 PASS`(D-1 15:00:00 유지·14:59:59 제거, 하한 `>=`를 `>`로 바꾼 변형은 이 두 케이스가 잡는다) → pass/fail

Step 2
- ISC-2.1 (Actions 도달성, dry 3회 중 최신): `gh run view <run-id> --log | grep -oE "news=[a-z]+" | head -1 → news=ok` → pass/fail
- ISC-2.2 (Actions EUC-KR): `gh run view <run-id> --log | grep -oE "nate=(ok|fail)\([0-9]+\)" | head -1 → nate=ok(20)` (fail이면 errors 사유를 기록하고 Open Question 1로) → pass/fail
- ISC-2.3 (push 재시도, 로컬 bare repo): `bash scripts/signals-push.sh --self-test 2>&1 | tail -1 → self-test 7/7 PASS` → pass/fail
- ISC-2.3a (음성 대조군, 재시도 소진): `bash scripts/signals-push.sh --self-test 2>&1 | grep -E "^PASS (no-retry-negative-control|always-reject-exit1-after-3)" | wc -l → 2` (재시도 1회뿐이면 exit 1, 원격이 항상 거절하면 3회 후 exit 1이 통과 조건인 케이스) → pass/fail
- ISC-2.4 (cron 도달, 활성 3일 뒤): `git fetch origin signals && git log origin/signals --since=3.days --format=%s | grep -oE '^signals: [0-9-]+(am|pm)' | sort -u | wc -l → 6 이상` → pass/fail
- ISC-2.5 (contract-check 연결): `grep -c "collect.mjs --self-test" .github/workflows/contract-check.yml → 1` 그리고 `grep -c "signals-push.sh --self-test" .github/workflows/contract-check.yml → 1` → pass/fail
- ISC-2.6 (권한): `grep -c "contents: write" .github/workflows/signals.yml → 1` → pass/fail

Step 3
- ISC-3.1: `node scripts/flags.mjs --check experiments/flags.json → flags check: PASS` → pass/fail
- ISC-3.2 (음성 대조군, 플래그 형식): `echo '{"muleori":{"SIGNALS_FILE":1}}' > $TMPDIR/f.json; node scripts/flags.mjs --check $TMPDIR/f.json >/dev/null 2>&1; echo $? → 1` → pass/fail
- ISC-3.3: `grep -c "signals/<stem>.json" REELS_SPEC.md → 1 이상` 그리고 `grep -c "SIGNALS_FILE" REELS_SPEC.md → 1 이상` → pass/fail
- ISC-3.4 (스펙 계약 유지): `node scripts/validate.mjs --self-test 2>&1 | tail -1 → self-test N/N PASS` → pass/fail

Step 4
- ISC-4.1: `node scripts/experiment.mjs --lint >/dev/null 2>&1; echo $? → 0` → pass/fail
- ISC-4.2: `node scripts/health.mjs --self-test 2>&1 | tail -1 → self-test N/N PASS` → pass/fail
- ISC-4.3 (음성 대조군, 파일 결측): `node scripts/health.mjs --dry-run --root test/fixtures/health/signals-file-missing --now <픽스처 now> 2>&1 | grep -c "ALERT signals-file" → 1` → pass/fail
- ISC-4.4 (양성 대조군 유지, self-improve ISC-4.4 동결분): `node scripts/health.mjs --dry-run --root test/fixtures/health/all-green --now 2026-10-03T09:00:00+09:00 2>&1 | grep -cE "^(ALERT|WARN)" → 0` → pass/fail
- ISC-4.5: `node -e 'const q=require("./experiments/queue.json");const i=q.items.find(x=>x.id==="signals-actions");console.log(i.status,i.flags.SIGNALS_FILE,i.applyBefore??null,i.adopt.length>0)' → ready 1 null true` → pass/fail
- ISC-4.6: `test -f experiments/preregistration/signals-actions-addendum.md && git log -1 --format=%H -- experiments/preregistration/signals-actions-addendum.md | xargs -I{} git show --name-only --format= {} | grep -c queue.json → 1` (부록과 ready 전환이 같은 커밋) → pass/fail

Step 5
- ISC-5.1 (래치): `node -e '<startStem 이후 첫 am과 같은 날 pm의 selection.signalSources.file 존재 여부 출력>' → true true` → pass/fail
- ISC-5.2 (준수): `node -e '<활성 후 물어오리 data 4개 중 signalSources.file 키가 있는 수 출력>' → 4` → pass/fail

Anti-ISC
- Anti-ISC-1 (의존성 금지): `git diff --name-only <base>..HEAD | grep -cE '(^|/)package(-lock)?\.json$' → 0` → pass/fail
- Anti-ISC-2 (reels 비트리거): `gh run list --workflow reels.yml -L 50 --json headSha -q "[.[]|select(.headSha==\"<signals 커밋 sha>\")]|length" → 0` → pass/fail
- Anti-ISC-3 (main 미기록·signals 브랜치 경로 한정): `git log origin/main --format=%H --grep '^signals:' -n 20 | wc -l → 0`(main에 signals 커밋 없음) 그리고 `git log origin/signals --format=%H -n 20 | xargs -I{} git show --name-only --format= {} | grep -v '^$' | grep -vc '^signals/' → 0` → pass/fail
- Anti-ISC-4 (무수정 파일): `git diff --name-only <base>..HEAD -- scripts/render.mjs scripts/tts.mjs scripts/validate.mjs scripts/cleanup.mjs | wc -l → 0` → pass/fail
- Anti-ISC-5 (기본값 꺼짐): `node --input-type=module -e 'import("./scripts/flags.mjs").then(m=>console.log(m.FLAG_DEFAULTS.SIGNALS_FILE))' → 0` → pass/fail
- Anti-ISC-6 (실험 중 수동 켜기 금지): `git log <base>..origin/main --format=%s -S'SIGNALS_FILE' -- experiments/flags.json | grep -vc '^experiment: ' → 0` (flags.json의 SIGNALS_FILE 변경은 판정기 커밋 `experiment: <날짜> 판정 상태 갱신…`만. 봇과 사람의 커밋 작성자가 둘 다 calintzy라 메시지 접두사로 구분한다) → pass/fail
- Anti-ISC-7 (WebSearch 신호 금지 문구 유지): `grep -c "인기 신호의 대체물이 아니다" REELS_SPEC.md → 1` → pass/fail
- Anti-ISC-8 (누출 감지, 활성화 전): `node -e 'const fs=require("fs");let n=0;for(const f of fs.readdirSync("data"))if(f.endsWith(".json")){let j;try{j=JSON.parse(fs.readFileSync("data/"+f))}catch{continue}if(j.account!=="aibrief"&&j.selection?.signalSources&&"file" in j.selection.signalSources)n++}console.log(n)' → 0`(활성화 전 물어오리 data에 `signalSources.file` 키 0건. 활성화 뒤에는 Step 5의 ISC-5.2가 이 검사를 대체한다. `data/2026-08-12-am.json`은 기존부터 JSON 파싱이 안 되어 건너뛴다) → pass/fail

## Risks
1. Actions IP 차단: 구글 트렌드·네이트가 데이터센터 IP를 막을 수 있다. Step 2b에서 cron 전에 실측하고, news만 되면 진행한다. 파일 `errors`에 HTTP 상태를 남겨 health 경보와 함께 원인을 볼 수 있다.
2. 네이트 HTML 구조 변경: 파서 게이트(제목 10개·U+FFFD 0개)가 nate=fail로 떨어뜨리고 health signals(기존 check)가 fail 비율로 잡는다. 픽스처는 실응답이므로 구조가 바뀌면 재수집한 픽스처로 self-test를 갱신한다.
3. cron 지연 악화: 00~04시 지연 표본이 없다. 3개 예약 중 하나만 컷오프 전에 끝나면 된다. Step 2d로 3일 실측 후 조정하고, 계속 놓치면 루틴이 stale·missing으로 기존 폴백을 쓴다(지금보다 나빠지지 않는다).
4. pm 기사 풀의 오전 편중: pm 파일은 약 11~15시에 수집되어 그 뒤 기사가 빠진다. 루틴은 파일이 ok여도 구글뉴스 WebFetch 보완을 시도할 수 있다(실패해도 무방). 과정 지표로 관찰한다.
5. 루틴 규칙 불이행: LLM 루틴이 래치·플래그를 잘못 읽을 수 있다. evidence 불일치 회차는 자동 제외되고, 제외가 30%를 넘으면 self-improve의 오염 경고가 뜬다.
6. 레포 용량: 연 약 90MB(압축 전)로 `.git` 5.3GB 대비 작다. 덮어쓰기 규칙으로 슬롯당 커밋은 최대 3개다.
7. push 경합: 컷오프와 data 존재 검사로 루틴 push 시각과 겹치지 않게 하고, insights·cleanup과는 rebase 재시도로 처리한다.

## Open Questions
1. Actions에서 trends·nate가 막히면 대안(자체 러너, 외부 프록시)을 도입할지. 이 계획 범위 밖이며 Step 2b 결과가 나오면 결정한다.
2. 기준선 B 수치는 single-issue-v1 판정 문서가 나와야 확정된다. 판정이 10/7 이후로 늦어지면 ready 전환도 늦어지고, 그동안 판정기는 `waitingFor`로 대기한다(자동 우회 없음).
3. signals/ 보존은 이번에는 무기한으로 둔다. `.git` 용량 문제가 다시 생기면 cleanup 편입을 재검토한다.

## Success Criteria
- 매 슬롯 컷오프 전에 `signals/<stem>.json`이 `signals` 브랜치에 있고, 소스별 성패가 파일에 기록된다.
- single-issue-v1 판정 전까지 루틴 동작이 바뀌지 않는다.
- signals-actions가 사람의 수동 플래그 조작 없이 판정기로 켜지고, 켜진 다음 am부터 data에 `signalSources.file`이 기록된다.
- 파일 결측이 이어지면 health 이슈에 `ALERT signals-file`이 뜬다.
