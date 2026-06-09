# cli/ — 맥락별 front door 트리 (위치 = 의미)

`scripts` 명령이 이 폴더만 읽어 "맥락별 통합 진입점" 카탈로그를 그린다.
SvelteKit `routes/` 정신: **front door 여부와 그 맥락은 *파일을 어느 cli 폴더에 두느냐* 하나로 결정된다.**
마커도 manifest도 없다 — 추가·삭제·재분류 = 위치만 바꾸면 카탈로그가 자동으로 따라온다(drift 대상 0).

## 구조

```
cli/<맥락>/<명령>      ← tools/ 의 실제 front door 로 가는 심링크 (또는 실파일)
```

- `<맥락>` 폴더명 = `scripts` 가 묶어 보여주는 섹션 헤더 (design / framer / image …).
- `<명령>` = 사용자가 터미널에 치는 이름. 설명은 **그 스크립트가 자기 헤더에** 들고 있어
  (`# 이름 — 설명` 또는 JSDoc `* 이름 — 설명`) `scripts` 가 런타임에 읽는다. 여기 따로 안 적는다.
- 모듈(내부에서만 호출되는 것 = recon·brandguide·photo-pattern 등)은 `tools/` 에 그대로 둔다.
  `$lib` 처럼 — front door 가 아니므로 cli/ 에 넣지 않는다. (전체 모듈은 `scripts --all`)

## front door 추가/이동/삭제

```bash
# 추가: 맥락 폴더에 심링크 하나 (원본은 tools/ 에서 안 움직임 = 데일리 드라이버 안전)
ln -sf ../../tools/<file> cli/<맥락>/<명령>

# 새 맥락: 폴더만 만들면 됨
mkdir cli/<새맥락> && ln -sf ../../tools/<file> cli/<새맥락>/<명령>

# 재분류: 심링크를 다른 맥락 폴더로 mv
# 제거: 심링크 rm  (카탈로그에서만 빠짐, 명령 자체는 tools/ 에서 계속 동작)
```

배포(`installScripts.sh`)는 cli/ 를 SKIP — 실제 ~/bin 명령은 tools/·루트에서 이미 깔리고,
cli/ 는 *카탈로그 정의 트리*일 뿐이라 명령으로 재배포하지 않는다.
