#!/usr/bin/env python3
# 에셋 루트 경로 단일 정의 (하드코딩 0). repoPaths 패턴과 동형 — 경로 SSOT 한 곳.
#   해석 순서: env override(CLAVIER_ASSET_LUT) → 기본 iCloud 에셋 lut 폴더.
# 도구(costyle/img/photo-lut)는 절대경로를 박지 말고 이 함수만 호출한다.
import os

# 기본 = 사용자 iCloud 영구 에셋 보관소 (LUT/스타일 SSOT). 브랜드=하위폴더 관례(aman/ 등).
_DEFAULT_LUT = "~/Library/Mobile Documents/com~apple~CloudDocs/0/works/asset/img/lut"


def asset_lut_root():
    """LUT/스타일 에셋 SSOT 루트 (절대경로). env CLAVIER_ASSET_LUT 로 override 가능."""
    return os.path.expanduser(os.environ.get("CLAVIER_ASSET_LUT", _DEFAULT_LUT))


def brand_dir(brand, create=False):
    """브랜드별 에셋 폴더 (SSOT 안). create=True 면 생성."""
    d = os.path.join(asset_lut_root(), brand)
    if create:
        os.makedirs(d, exist_ok=True)
    return d


if __name__ == "__main__":
    print(asset_lut_root())
