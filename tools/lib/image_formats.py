# image_formats — 로컬 래스터 사진을 인식·디코딩하는 단일 소스 (reuse-first).
#
# 왜 lib 인가: brandRe·image-tagger·photo-cluster·photo-lut·recon 가 각자 동일한
#   확장자 집합을 복붙해 왔다(4중 복제). 한 곳에 .heic 를 더하려면 다섯 곳을 손대야
#   했다 = drift 의 정의. 여기로 모아 모두 import 하게 한다.
#   (site-scraper 의 집합은 .svg 등 *웹 벡터 자산* 을 포함 — 관심사가 달라 별개로 둔다.)
#
# 세 가지를 제공:
#   PHOTO_EXTS      — 인식할 로컬 사진 확장자 (소문자, 점 포함). heic/heif 포함.
#   find_images()   — 폴더/대상에서 사진 경로를 찾는 단일 탐색 소스 (재귀 기본).
#   register_heif() — PIL 이 .heic/.heif 를 열 수 있게 pillow-heif opener 를 등록.
#                     이미지를 PIL 로 *디코딩* 하는 도구는 Image.open 전에 한 번 호출.
#                     pillow-heif 가 없으면 조용히 False (heic 만 건너뛰고 나머지는 동작).

import os

# 로컬 래스터 사진 확장자 — 폴더에서 "이미지인가" 판별용.
PHOTO_EXTS = frozenset({
    ".jpg", ".jpeg", ".png", ".webp", ".avif",
    ".gif", ".bmp", ".tiff", ".heic", ".heif",
})


def find_images(root, recursive=True, skip_hidden=True):
    """root(폴더/대상) 아래 PHOTO_EXTS 사진 경로를 정렬해 반환 — 폴더 지정 시 단일 탐색 소스.

    왜 lib 인가: image-tagger 의 find_images 와 photo-cluster·photo-lut 의 ** glob,
      그리고 deframe·dedup·convert 의 top-level listdir 이 제각각이었다 (재귀 여부도 불일치).
      "폴더/대상을 지정하면 재귀로 받는다" 를 한 곳에 박아 모두 같은 규칙을 쓰게 한다.

    recursive=True(기본): os.walk 로 하위 폴더까지. False: top-level 만 (--no-recurse 매핑).
    skip_hidden=True: dotfile 과 '.'·'_' 로 시작하는 폴더(_graphic_frames·_cluster·patterns·
      sample 같은 출력/메타 dir)를 가지치기 — 산출물을 입력으로 되먹지 않게."""
    root = os.path.expanduser(root)
    out = []
    if recursive:
        for dirpath, dirnames, files in os.walk(root):
            if skip_hidden:
                dirnames[:] = [d for d in dirnames if not d.startswith((".", "_"))]
            for fn in files:
                if skip_hidden and fn.startswith("."):
                    continue
                if os.path.splitext(fn)[1].lower() in PHOTO_EXTS:
                    out.append(os.path.join(dirpath, fn))
    else:
        for fn in os.listdir(root):
            p = os.path.join(root, fn)
            if not os.path.isfile(p):
                continue
            if skip_hidden and fn.startswith("."):
                continue
            if os.path.splitext(fn)[1].lower() in PHOTO_EXTS:
                out.append(p)
    return sorted(out)

_heif_registered = None  # None=미시도, True=등록됨, False=불가(pillow-heif 없음)


def register_heif():
    """PIL 에 HEIF/HEIC opener 를 등록. 멱등 — 여러 번 불러도 1회만 실제 등록.
    pillow-heif 미설치 환경에서도 예외 없이 False 반환(heic 만 graceful skip).
    설치: <venv>/bin/pip install pillow-heif"""
    global _heif_registered
    if _heif_registered is not None:
        return _heif_registered
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
        _heif_registered = True
    except Exception:
        _heif_registered = False
    return _heif_registered
