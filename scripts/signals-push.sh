#!/usr/bin/env bash
# signals 브랜치에 signals/<stem>.json을 커밋·push한다.
# 원격이 앞서 있어 거절되면 내 커밋 1개를 최신 원격 위로 rebase(-X theirs)한 뒤 최대 MAX_TRIES회(기본 3) 재시도한다.
# 브랜치 조작은 얕게: 원격 signals는 --depth=1로만 가져오고, main 체크아웃 옆에 임시 worktree를 만든다
# (.git 5.3GB 대비 signals 브랜치는 수십 MB 이하이므로 별도 clone은 만들지 않는다).
# 사용법: bash scripts/signals-push.sh <src-json> <stem> <commit-msg>   (cwd = origin이 있는 리포)
#         bash scripts/signals-push.sh --self-test                       (로컬 bare repo로 재시도 시험)
set -euo pipefail

MAX_TRIES="${MAX_TRIES:-3}"

push_signals() {
  local src="$1" stem="$2" msg="$3" wt i
  wt="$(mktemp -d "${TMPDIR:-/tmp}/signals.XXXXXX")/wt"
  WT="$wt"
  trap 'git worktree remove --force "$WT" 2>/dev/null || true' EXIT
  if git fetch -q --depth=1 origin signals 2>/dev/null; then
    git worktree add -q -B signals "$wt" FETCH_HEAD
  else
    # 원격에 signals가 없으면 orphan으로 만든다(main 이력을 끌고 오지 않는다)
    git worktree add -q --detach --no-checkout "$wt" HEAD
    git -C "$wt" checkout -q --orphan signals
    git -C "$wt" rm -rq --cached . 2>/dev/null || true
  fi
  mkdir -p "$wt/signals"
  cp "$src" "$wt/signals/$stem.json"
  git -C "$wt" add signals
  if git -C "$wt" diff --cached --quiet; then
    echo "signals: 변경 없음 — 커밋 생략"
    return 0
  fi
  git -C "$wt" commit -q -m "$msg"
  for ((i = 1; i <= MAX_TRIES; i++)); do
    if git -C "$wt" push -q origin HEAD:refs/heads/signals; then
      echo "signals: push 성공 (시도 $i/$MAX_TRIES)"
      return 0
    fi
    echo "signals: push 거절 (시도 $i/$MAX_TRIES)" >&2
    if ((i < MAX_TRIES)); then
      # 원격에 signals가 아직 없으면(orphan 첫 push 실패) fetch가 실패하므로 그대로 재시도한다
      if git -C "$wt" fetch -q --depth=1 origin signals 2>/dev/null; then
        if git -C "$wt" rev-parse -q --verify HEAD~1 >/dev/null; then
          git -C "$wt" rebase -q -X theirs --onto FETCH_HEAD HEAD~1
        else
          git -C "$wt" rebase -q -X theirs --onto FETCH_HEAD --root
        fi
      fi
    fi
  done
  echo "signals: push ${MAX_TRIES}회 모두 실패" >&2
  return 1
}

# ─── self-test: 로컬 bare repo에서 재시도 경로를 시험한다 ───
selftest() {
  local T pass=0 total=0
  T="$(mktemp -d "${TMPDIR:-/tmp}/signals-st.XXXXXX")"
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
  local self
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

  # 케이스 환경: $T/<n>/remote.git(bare), $T/<n>/repo(main만 있는 clone), 결과 json
  mkenv() {
    local d="$T/$1"
    mkdir -p "$d"
    git init -q --bare "$d/remote.git"
    git clone -q "file://$d/remote.git" "$d/repo" 2>/dev/null
    git -C "$d/repo" config core.hooksPath "$d/repo/.git/hooks" # 전역 hooksPath가 있어도 시험용 훅이 돌게 한다
    git -C "$d/repo" checkout -q -b main
    echo x >"$d/repo/README"
    git -C "$d/repo" add README
    git -C "$d/repo" commit -q -m init
    git -C "$d/repo" push -q origin main
    echo '{"stem":"S","by":"ours"}' >"$d/ours.json"
  }
  # 끼어들기: 다른 clone이 원격 signals에 커밋을 push한다. $2=파일명, $3=내용
  mkinterloper() {
    local d="$T/$1"
    cat >"$d/interlope.sh" <<EOS
#!/usr/bin/env bash
set -e
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX # 훅 안에서 실행되므로 push 중인 리포 환경을 지운다
c=\$(mktemp -d "\${TMPDIR:-/tmp}/signals-il.XXXXXX")
git clone -q "file://$d/remote.git" "\$c" 2>/dev/null
cd "\$c"
if git ls-remote --exit-code origin signals >/dev/null 2>&1; then
  git checkout -q -b signals origin/signals
else
  git checkout -q --orphan signals
  git rm -rqf . 2>/dev/null || true
fi
mkdir -p signals
printf '%s\n' '$3' >"signals/$2"
git add signals
git commit -q -m interloper
git push -q origin HEAD:signals
EOS
    # 첫 push 직전 1회만 끼어들고, 모든 push 시도를 로그에 남긴다
    cat >"$d/repo/.git/hooks/pre-push" <<EOS
#!/usr/bin/env bash
echo push >>"$d/pushes.log"
if [ ! -e "$d/interloped" ]; then touch "$d/interloped"; bash "$d/interlope.sh" >"$d/interlope.log" 2>&1; fi
exit 0
EOS
    chmod +x "$d/repo/.git/hooks/pre-push"
  }
  check() { # name, condition-exit-code
    total=$((total + 1))
    if [ "$2" -eq 0 ]; then
      pass=$((pass + 1))
      echo "PASS $1"
    else
      echo "FAIL $1"
    fi
  }
  remote_show() { git --git-dir="$T/$1/remote.git" show "signals:$2" 2>/dev/null; }
  run() { # env-name, extra env assignments via MAX_TRIES
    (cd "$T/$1/repo" && bash "$self" "$T/$1/ours.json" S "signals: S" >"$T/$1/run.log" 2>&1)
  }

  # 1. 원격에 signals 없음 → orphan 생성 후 push 성공
  mkenv c1
  run c1 && remote_show c1 signals/S.json | grep -q ours
  check "orphan-create" $?

  # 2. 원격에 다른 파일 커밋이 끼어듦 → rebase 후 성공, 두 파일 모두 보존, push 시도 2회
  mkenv c2
  mkinterloper c2 other.json '{"by":"other"}'
  rc=0
  run c2 || rc=1
  remote_show c2 signals/S.json | grep -q ours || rc=1
  remote_show c2 signals/other.json | grep -q other || rc=1
  [ "$(wc -l <"$T/c2/pushes.log")" -eq 2 ] || rc=1
  check "interloper-rebase-success" $rc

  # 3. 같은 파일을 끼어든 쪽이 다른 내용으로 먼저 push → 충돌을 내 쪽으로 해소하고 성공
  mkenv c3
  mkinterloper c3 S.json '{"stem":"S","by":"other"}'
  rc=0
  run c3 || rc=1
  remote_show c3 signals/S.json | grep -q ours || rc=1
  check "interloper-same-file-conflict-resolves" $rc

  # 4. 음성 대조군: 재시도 1회뿐이면 같은 끼어들기에서 exit 1 (끼어들기가 실제로 push를 거절시킨다는 증거)
  mkenv c4
  mkinterloper c4 other.json '{"by":"other"}'
  rc=0
  (cd "$T/c4/repo" && MAX_TRIES=1 bash "$self" "$T/c4/ours.json" S "signals: S" >/dev/null 2>&1) && rc=1
  remote_show c4 signals/S.json >/dev/null && rc=1
  check "no-retry-negative-control" $rc

  # 5. 음성 대조군: 원격이 항상 거절 → 3회 시도 후 exit 1
  mkenv c5
  printf '#!/usr/bin/env bash\nexit 1\n' >"$T/c5/remote.git/hooks/pre-receive"
  chmod +x "$T/c5/remote.git/hooks/pre-receive"
  printf '#!/usr/bin/env bash\necho push >>"%s/pushes.log"\nexit 0\n' "$T/c5" >"$T/c5/repo/.git/hooks/pre-push"
  chmod +x "$T/c5/repo/.git/hooks/pre-push"
  rc=0
  run c5 && rc=1
  [ "$(wc -l <"$T/c5/pushes.log")" -eq 3 ] || rc=1
  check "always-reject-exit1-after-3" $rc

  # 6. 같은 내용 재실행 → 커밋 없이 exit 0 (원격 커밋 수 불변)
  mkenv c6
  run c6
  before="$(git --git-dir="$T/c6/remote.git" rev-list --count signals)"
  rc=0
  run c6 || rc=1
  [ "$(git --git-dir="$T/c6/remote.git" rev-list --count signals)" = "$before" ] || rc=1
  check "idempotent-no-change" $rc

  # 7. orphan 생성 도중 다른 쪽이 signals를 먼저 만듦(루트 커밋 2개) → --root rebase로 성공
  mkenv c7
  mkinterloper c7 other.json '{"by":"other"}'
  rc=0
  run c7 || rc=1
  remote_show c7 signals/S.json | grep -q ours || rc=1
  remote_show c7 signals/other.json | grep -q other || rc=1
  check "orphan-race-root-rebase" $rc

  if [ -n "${DEBUG:-}" ]; then for f in "$T"/*/run.log "$T"/*/interlope.log; do echo "--- $f"; cat "$f"; done; fi # DEBUG=1이면 케이스별 로그 출력
  echo "self-test $pass/$total $([ "$pass" -eq "$total" ] && echo PASS || echo FAIL)"
  [ "$pass" -eq "$total" ]
}

if [ "${1:-}" = "--self-test" ]; then
  selftest
elif [ "$#" -eq 3 ]; then
  push_signals "$1" "$2" "$3"
else
  echo "사용법: signals-push.sh <src-json> <stem> <commit-msg> | --self-test" >&2
  exit 2
fi
