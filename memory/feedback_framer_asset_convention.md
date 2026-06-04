---
name: feedback-framer-asset-convention
description: Framer 코드 컴포넌트 저장 위치 + macOS 태그/버전 컨벤션
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d692d3ba-b2b4-4c6e-869a-1537a213aecf
---

**Framer 코드 컴포넌트(.tsx)는 여기 저장한다:**
`/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0/works/asset/framer/`
(iCloud Drive. 기존에 slideshow.tsx, imgBackgroundSection 등이 모여 있는 Framer 컴포넌트 자산 폴더.)

**버전·구분은 macOS Finder 태그로 단다** (파일명은 깔끔하게 유지):
- 태그 3종: `Framer` (공통 그룹) · `<컴포넌트명>` (구분) · `v<semver>` (예 `v1.0.0`)
- 코드 상단 헤더 주석에도 `// <Name> — v1.0.0` 으로 같은 버전 박아 둘 것 (태그+주석 일치)
- 반복 수정 시 semver 올림: 기능 추가=minor, 버그수정=patch

**태그 거는 법 (설치 불필요, 공식 API):** JXA로 `NSURLTagNamesKey` 설정.
```js
// /tmp/settag.js  →  osascript -l JavaScript /tmp/settag.js "<path>" Framer <Name> v1.0.0
ObjC.import("Foundation")
function run(argv){var u=$.NSURL.fileURLWithPath(argv[0]);var e=$();
 return u.setResourceValueForKeyError($(argv.slice(1)),$.NSURLTagNamesKey,e)?"OK":"ERR"}
```
확인: `mdls -name kMDItemUserTags "<path>"`. (`xattr` 바이너리 plist 직접 쓰기보다 이 방법이 안전.)

[[feedback_component_level_tone]]
