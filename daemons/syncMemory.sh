#!/usr/bin/env bash
# syncMemory.sh — Claude 메모리 → memory-backup/ 자동 동기화
# @group watcher
# @type launchagent
# @label com.clavier.watcherMemory
#
# 동작 원리 (이벤트 드리븐):
#   com.clavier.watcherMemory LaunchAgent가 ~/.claude/projects/-Users-clavier/memory/
#   폴더를 WatchPaths로 감시한다. 파일이 바뀌면 이 스크립트가 실행됨.
#
# 흐름:
#   memory/ 파일 변경
#     → watcherMemory LaunchAgent 트리거
#     → 이 스크립트 실행 → scripts/memory-backup/ 으로 rsync
#
# GitHub 반영: gitSync 데몬 폐지(2026-05-18) — 자동 커밋 없음.
#   memory/ 는 git 추적 디렉터리이므로 Claude 세션이 커밋하면 post-commit 훅이 push.
#
# 직접 실행:
#   ~/bin/daemons/syncMemory

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MEMORY_SRC="$HOME/.claude/projects/-Users-clavier/memory"
SCRIPTS_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/0/scripts"
BACKUP_DST="$SCRIPTS_DIR/memory-backup"

if [[ ! -d "$MEMORY_SRC" ]]; then
    echo "[syncMemory] 소스 폴더 없음: $MEMORY_SRC" >&2
    exit 1
fi

mkdir -p "$BACKUP_DST"

# rsync: 소스 → 목적지 동기화
# --delete: 소스에서 삭제된 파일은 백업에서도 삭제 (항상 최신 상태 유지)
# --checksum: 타임스탬프 대신 내용으로 비교 (iCloud 타임스탬프가 불안정한 경우 대비)
rsync -a --delete --checksum "$MEMORY_SRC/" "$BACKUP_DST/"

echo "[syncMemory] $(date '+%Y-%m-%d %H:%M:%S') 동기화 완료 ($MEMORY_SRC → $BACKUP_DST)"
