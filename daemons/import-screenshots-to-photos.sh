#!/bin/bash
# 스크린샷 폴더에 새로 생긴 파일을 macOS 사진(Photos) 앱으로 자동 가져오기.
# launchd LaunchAgent(WatchPaths)가 폴더 변경을 감지하면 실행된다.
# 이미 가져온 파일은 확장 속성(xattr)으로 표시해 중복 가져오기를 막는다.

# freshness — daemons/ 에서 tools/lib 까지 한 단계 올라감. ~/Library/Scripts 심링크로
# 호출돼도 readlink 로 repo 진본 위치 해석. fail-open(절대 차단 안 함, DECISIONS 5/30).
. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/../tools/lib/freshness.sh"

DIR="$HOME/Pictures/Screenshots"
MARK="com.clavier.photosImported"

[ -d "$DIR" ] || exit 0

# 스크린샷 파일 쓰기가 끝날 시간을 잠깐 둠
sleep 1

cd "$DIR" || exit 0
shopt -s nullglob nocaseglob

for f in *.png *.jpg *.jpeg *.heic *.heif *.gif *.tiff *.tif *.mov *.mp4; do
	[ -f "$f" ] || continue

	# 이미 가져온 파일이면 건너뜀
	if xattr -p "$MARK" "$f" >/dev/null 2>&1; then
		continue
	fi

	abspath="$DIR/$f"

	if /usr/bin/osascript - "$abspath" <<'APPLESCRIPT'
on run argv
	set p to item 1 of argv
	tell application "Photos"
		import {POSIX file p} skip check duplicates false
	end tell
end run
APPLESCRIPT
	then
		xattr -w "$MARK" 1 "$f"
		echo "$(date '+%Y-%m-%d %H:%M:%S') imported: $f"
	else
		echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED: $f"
	fi
done
