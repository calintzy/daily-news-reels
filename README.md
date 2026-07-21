# daily-news-reels

매일 아침 대한민국 주요 뉴스 TOP 5를 1분짜리 인스타그램 릴스로 자동 제작·게시하는 파이프라인.

## 흐름

```
클라우드 Claude 루틴 (REELS_SPEC.md 읽고 실행)
  → data/YYYY-MM-DD.json 커밋·푸시
      → GitHub Actions (reels.yml)
          → validate  (데이터 계약·사실성 게이트)
          → genimages (OpenAI gpt-image-1.5로 커버+이슈 이미지 6장)
          → render    (Remotion 렌더 → ffmpeg 음악 합성 → 프리뷰 캡처)
          → docs/videos·previews 커밋·푸시 (GitHub Pages로 서빙)
          → Telegram 미리보기 전송 (운영자 사실 검수)
      → 운영자 승인 → Actions에서 publish 워크플로우 수동 실행(dispatch)
          → Instagram Reels 게시
```

이미지는 실존 인물을 그리지 않고 사건을 상징하는 장면으로 생성하며, 영상에 "AI 생성 이미지" 고지가 붙는다.

## 구성

| 파일 | 역할 |
|------|------|
| `REELS_SPEC.md` | 클라우드 루틴이 매 실행 읽는 스펙(데이터 계약·요약 규칙·사실성 원칙) |
| `data/*.json` | 하루치 데이터(계약). `data/sample.json`이 예시 겸 검증 픽스처의 원본 |
| `scripts/collect.mjs` | 구글뉴스 KR RSS 수집(의존성 없음, 로컬/Actions 보조) |
| `scripts/validate.mjs` | 데이터 계약 이진 게이트(구조·문체·**사실성 결정론 대조**) |
| `scripts/genimages.mjs` | OpenAI Images로 이미지 생성(장별 멱등, `--dry-run` 지원) |
| `scripts/render.mjs` | 이미지 확인 → Remotion 렌더 → 음악 합성 → 프리뷰·검증 |
| `scripts/publish.mjs` | 릴스 게시(프리플라이트·컨테이너 멱등·status 폴링·2단계 마커) |
| `scripts/telegram.mjs` | 미리보기(`preview`)·실패 알림(`fail`) |
| `reels/` | Remotion 프로젝트(데이터 주입형 컴포지션 `HotIssueReelPhoto`) |
| `.github/workflows/reels.yml` | build/publish 워크플로우 |

## 로컬 실행

```bash
# 0) reels 의존성 (최초 1회)
cd reels && npm install && cd ..

# 1) 데이터 검증
node scripts/validate.mjs data/sample.json      # → validate: PASS
node scripts/validate.mjs --self-test           # 내장 픽스처 전체 검증

# 2) 이미지 프롬프트 확인(API 호출 없음)
node scripts/genimages.mjs data/sample.json --dry-run

# 3) 이미지 생성 (실제 API 호출 — 비용 발생)
export OPENAI_API_KEY=sk-...
node scripts/genimages.mjs data/sample.json     # assets/img/<date>/*.png

# 4) 렌더 (이미지 6장 필요)
node scripts/render.mjs data/sample.json        # docs/videos/<date>.mp4

# 5) 미리보기 전송
export TG_BOT_TOKEN=... TG_CHAT_ID=...
node scripts/telegram.mjs preview data/sample.json

# 6) 게시 (DRY_RUN 권장 — 컨테이너 FINISHED까지만 확인)
export IG_ACCESS_TOKEN=... IG_USER_ID=...
DRY_RUN=1 node scripts/publish.mjs data/sample.json
```

RSS 수집을 로컬에서 테스트하려면:

```bash
node scripts/collect.mjs --out /tmp/collected.json
```

## 요구 사항

- Node 20+ (Actions는 node 20). 로컬은 최신 LTS 권장.
- `ffmpeg`/`ffprobe` (음악 합성·프리뷰·검증).
- 한글 렌더용 CJK 폰트(Actions는 `fonts-noto-cjk` 설치, macOS는 Apple SD Gothic Neo 기본 탑재).

## 수동 셋업 체크리스트 (인스타 게시 활성화)

게시(`publish`)는 아래를 모두 마친 뒤에만 동작한다. 그 전까지는 build까지만 자동으로 돌고 Telegram 미리보기로 검수한다.

- **M0. 인스타 계정 professional 전환** — 개인 계정을 비즈니스 또는 크리에이터 계정으로 전환.
- **M1. Meta 앱에 계정 연결** — Meta for Developers에서 앱 생성 후 인스타 계정을 연결(Instagram Graph API 사용).
- **M2. `instagram_content_publish` 권한** — 앱에 콘텐츠 게시 권한을 추가하고 앱 리뷰를 통과.
- **M3. 장기 토큰 발급** — 단기 토큰을 장기(60일) 액세스 토큰으로 교환. 만료 전 갱신 루틴 필요.
- **M4. IG User ID 확인** — 게시 대상 인스타 비즈니스 계정의 user id 확보.
- **M5. Secrets 등록**:
  ```bash
  gh secret set IG_ACCESS_TOKEN
  gh secret set IG_USER_ID
  gh secret set OPENAI_API_KEY
  gh secret set TG_BOT_TOKEN
  gh secret set TG_CHAT_ID
  ```
- **M6. GitHub Pages 활성화** — `docs/`를 Pages 소스로 지정(영상 public URL 서빙, `https://calintzy.github.io/daily-news-reels/videos/<date>.mp4`).
- **M7. 실게시 승인 변수** — 실제로 게시를 시작할 때만 저장소 변수 `PUBLISH_LIVE=1` 설정:
  ```bash
  gh variable set PUBLISH_LIVE --body 1
  ```
  이 변수가 `1`이 아니거나 dispatch의 `dry_run`이 `1`이면 게시는 DRY_RUN(컨테이너 확인까지)만 수행한다.

## 라이선스·크레딧

배경 음악: Pure Attitude — Kevin MacLeod (incompetech.com), CC BY 4.0. 캡션에 크레딧 표기 필수(검증이 강제).
