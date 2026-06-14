# launchagents/archive/

설치되지 않는 과거 plist 보관소 (obsidian/scriptable GDrive sync 류).
2026-06-14 SSOT 감사에서 *dead cruft* 로 판정 — 콜로니 어디에도 로드되어 있지 않음.

`bootstrap.sh` 의 LaunchAgent ensure 는 `launchagents/*.plist`(이 하위폴더 제외)만
설치 대상으로 본다. 여기 있는 건 install glob 밖이라 절대 설치되지 않는다 —
참조·복원용으로만 보존. 되살리려면 한 단계 위 `launchagents/` 로 옮기면 된다.
