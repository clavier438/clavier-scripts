---
name: img
description: >-
  터미널에서 로컬 사진/이미지를 다루는 모든 요청의 작업 방식. 사용자가 "사진/이미지 정리해줘", "중복 빼고
  최고화질만 남겨", "webp/heic/jpg로 변환", "HEIC 풀어", "리사이즈/해상도 줄여", "메타데이터/EXIF 봐줘/
  지워줘", "촬영일/카메라로 이름·폴더 정리", "여백·레터박스 잘라", "사진 태그/분류", "수천 장 클러스터해서
  대표만", "몽타주 시트", "컬러그레이딩 LUT 뽑아", "캡처원 앞단/옆단에서 정리" 같은 말을 하면 — '재사용'을
  명시 안 해도 — 반드시 이 스킬을 적용. 새 도구를 짜기 전에 이미 있는 `img` front door(dedup·convert·tag·
  cluster·montage·pattern·grade·deframe·ref-fetch)와 설치된 exiftool·ImageMagick 을 먼저 조합한다.
  reuse-first 의 사진 특화판 + 검토 끝난 외부 도구 판정(czkawka 보류·BRISQUE 기각·digiKam 기각).
---

# img — 로컬 사진/이미지 작업 (clavier-scripts)

## 정신

사용자는 터미널에서 자연어로 **"사진 이거 해줘"** 만 던진다. Claude 가 그때그때 적당한 바퀴를
재사용·조합해 처리하고, 반복될 패턴이면 모듈로 박아 시스템을 키운다. **GUI 없이, 인터페이스 학습 없이.**
Capture One(편집/톤/세션) 앞단·옆단의 *정리·중복·변환·분류* 레이어가 전부 이 스킬 안에 있다.

핵심 원칙(`memory/feedback_single_solution` + reuse-first): **새 코드 한 줄 쓰기 전에 "이 바퀴 이미 있나?"**
사진 영역은 거의 다 이미 있다 — 못 찾으면 보통 내가 덜 찾은 것.

## 1. 먼저 `img` front door — 9할은 여기서 끝난다

`tools/img.py` (= `img` 명령, `# door: image`) 가 흩어진 image-*/photo-* 도구를 동사 하나로 모은 얇은 라우터다.
**verb 목록은 고정 카탈로그로 외우지 말고 직접 떠본다**(생성형 우선 — img.py 가 SSOT):

```bash
img help            # 전체 verb + 옵션. 인자 없이 `img` 만 치면 대화형 위저드(TTY)
img <verb> --help   # verb 별 상세 옵션 (대부분 argparse)
```

현재 verb 와 자연어 매핑 (변하면 `img help` 가 정답):

| 사용자가 말하면 | verb | 비고 |
|---|---|---|
| "화질 다른 중복 빼고 최고화질만" | `img dedup` | perceptual dhash → 픽셀수 큰 것만 보존. **파괴적 → 항상 `--dry` 먼저** |
| "webp/heic/jpg/png/avif 로 변환" | `img convert --to <fmt>` | any→any, 병렬, 비파괴 |
| "여백·레터박스·텍스트카드 배경 잘라/격리" | `img deframe` | 프레이밍 띠 감지. **파괴적 → 미리보기→확인** |
| "사진 태그/분류" | `img tag` | 비전 6축 → Finder 태그 + `_tags.json` (비파괴) |
| "수천 장 패턴별로 묶어 대표만" | `img cluster` | 오프라인·무료 |
| "전체 한눈에 시트로" | `img montage` | 비율보존 그리드 |
| "브랜드 사진 체계 분석" | `img pattern` | `_tags.json` 필요 |
| "컬러그레이딩 LUT 뽑아" | `img grade` | → `.cube` 3D LUT |
| "브랜드 페이지 이미지 수집" | `img ref-fetch` | |

- **폴더 verb 는 기본 재귀**(하위 폴더 전부). top-level 만: `-R` / `--no-recurse`.
- **파괴적 작업(dedup·deframe)은 반드시 미리보기 먼저** — `img dedup <폴더> --dry` 로 몇 장 지워지는지 보여주고,
  사용자 확인 후 실제 실행. 대화형 위저드는 이 플로가 내장돼 있다. 자동(비-TTY)에선 직접 `--dry` → 확인 → 실삭제.
- `lut`(적용)·`brandRe` 는 *별도 front door* — img 가 흡수하지 않는다(떠돌이가 아님). 브랜드 리버스
  엔지니어링 전체 파이프라인은 `brandRe`(`DESIGN_RECON.md`).

## 2. img verb 로 안 되는 1회성 → 설치된 칼로 조합 (새로 짜지 말 것)

이미 설치돼 PATH 에 있는 표준 CLI 두 개로 대부분의 *특수·1회성* 작업을 한 줄로 처리한다:

- **exiftool** (`/opt/homebrew/bin/exiftool`) — 메타데이터 읽기/쓰기/삭제, 촬영일·카메라 기반 rename/이동.
  - 해상도: `exiftool -ImageWidth -ImageHeight -n *.jpg`
  - EXIF 전부 제거(비파괴, `_original` 백업): `exiftool -all= *.jpg`
  - 촬영일로 리네임: `exiftool '-FileName<CreateDate' -d '%Y%m%d_%H%M%S%%-c.%%e' .`
- **ImageMagick** (`magick`·`identify`·`convert`) — 크기/포맷 식별, 리사이즈, 크롭, 합성.
  - 식별: `identify -format '%wx%h %m\n' *.png`
  - 리사이즈(비율 보존, 긴 변 2000): `magick in.jpg -resize 2000x2000 out.jpg`
  - ※ 형식 *변환* 자체는 `img convert` 가 병렬·비파괴라 그쪽이 우선. ImageMagick 은 리사이즈·크롭·합성 등.

1회성은 한 줄로 끝내고, **같은 요청이 두 번째 나오면 그때 모듈화**(아래 3).

## 3. 반복되면 모듈로 — 시스템을 키운다 (확장 규칙)

같은 작업을 또 하게 되면 떠돌이 스크립트로 두지 말고 front door 뒤에 박는다:

- **공유 lib 먼저**: `tools/lib/image_formats.py` 가 사진 인식 단일 소스 —
  `PHOTO_EXTS`(heic 포함) · `find_images(root, recursive=)` · `register_heif()`. 새 도구는 **반드시 이걸 import**
  (확장자 집합·폴더 탐색을 다시 짜면 drift). 진입: `sys.path.insert(0, .../lib); from image_formats import ...`.
- **새 동작 = `img` 에 verb 추가**: `tools/img.py` 의 `VERBS` 테이블에 한 줄 + `tools/<new>.py` 모듈.
  라우팅·help·대화형 메뉴가 그 한 줄에서 자동 derive 된다(손댈 곳 하나). 모듈은 `image_formats` import,
  `--dry` 지원(파괴적이면), 오프라인·토큰 0 우선.
- **numpy/Pillow 필요 시**: img.py 가 `webExporter/.venv` 파이썬을 자동 선택 — 모듈은 그냥 `import`만.
- 작업 단위마다 `python -c` 구문확인 → git commit(`memory/feedback_tidy_as_you_go`).

## 4. 검토 끝난 외부 도구 — 재논의 금지 (2026-06-13)

외부 추천(czkawka·BRISQUE·digiKam)은 검토 완료. **추가 설치 없이 `img` + exiftool + ImageMagick 으로 충분.**
상세 표는 `DESIGN_RECON.md` "사진 정리 외부 CLI 도구 — 검토 결과".

- **czkawka** ⬜ 보류 — 사진 중복은 `img dedup` 가 커버. *영상·빈폴더·깨진파일* 정리까지 실제로 필요해지면
  그때 front door 뒤에 도입(image-dedup 범위 밖). 미리 깔지 않음.
- **BRISQUE/NIQE** ❌ 기각 — "동일 사진 다른 화질" 엔 픽셀수가 결정론적 정답. 지각 화질점수는 다운스케일본이
  더 높게 나올 수 있어 *틀린 경로*. 서로 다른 컷 선별은 `img tag`(비전 6축)가 담당.
- **digiKam** ❌ 기각 — GUI DAM 오버킬. "터미널에서 순식간에" 와 정반대.

## 함정

- **파괴적 verb(dedup·deframe)를 미리보기 없이 실행하지 말 것.** 항상 `--dry`/미리보기 → 사용자 확인 → 실행.
- verb 목록·옵션을 기억에서 단정하지 말 것 — `img help` / `img <verb> --help` 가 SSOT(img.py 가 변한다).
- 형식 변환에 ImageMagick `convert` 를 직접 부르지 말 것 — `img convert` 가 병렬·비파괴. ImageMagick 은 리사이즈/크롭/합성용.
- 새 도구에서 확장자 집합·폴더 탐색을 재구현하지 말 것 — `tools/lib/image_formats.py` import.
