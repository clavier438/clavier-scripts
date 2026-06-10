#!/usr/bin/env python3
# image-convert-webp — 브랜드 폴더의 JPEG/PNG를 고품질 WebP로 변환. 병렬 처리로 빠름.
# 원본 파일은 보존, 비파괴. _tags.json·_cls.json 메타도 .webp 로 업데이트.
#   image-convert-webp.py <folder>        # 한 폴더
#   image-convert-webp.py --all <root>    # 전체 폴더
#   --quality 80    # 기본 95, 낮추면 더 압축
#   --dry           # 미리보기(변환 안 함)
import os, sys, glob, json, argparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass

from pathlib import Path
from PIL import Image
from multiprocessing import Pool
from datetime import datetime
from image_formats import register_heif, find_images  # 재귀 탐색·확장자 단일 소스 + HEIF 디코딩

register_heif()  # .heic/.heif 도 입력으로 변환 가능하게 (pillow-heif 없으면 graceful skip)

def convert_image(args_tuple):
    """단일 이미지를 WebP로 변환"""
    input_path, quality = args_tuple
    try:
        input_path = Path(input_path)
        output_path = input_path.with_suffix('.webp')

        # 이미 WebP이면 스킵
        if input_path.suffix.lower() == '.webp':
            return None, None, None

        # 원본 크기 기록
        input_size = input_path.stat().st_size

        # 이미지 열기
        img = Image.open(input_path)

        # RGBA로 변환 (투명도 지원)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGBA')
        elif img.mode == 'CMYK':
            img = img.convert('RGB')
        else:
            img = img.convert('RGB')

        # 고품질 WebP로 저장
        img.save(
            output_path,
            'WEBP',
            quality=quality,
            method=6  # 느리지만 최고 품질
        )

        output_size = output_path.stat().st_size
        reduction = ((1 - output_size / input_size) * 100) if input_size > 0 else 0

        return str(input_path), str(output_path), {
            'input_size': input_size,
            'output_size': output_size,
            'reduction_percent': reduction,
            'original_format': input_path.suffix.lower()
        }
    except Exception as e:
        return str(input_path), None, str(e)

def convert_folder(folder, quality=95, dry=False, recursive=True):
    """폴더 내 모든 이미지를 WebP로 변환 (기본 재귀 — 하위 폴더 포함)."""
    folder = Path(folder)

    # 단일 탐색 소스(find_images) — 모든 사진 포맷. 단, 타겟(.webp)은 입력에서 제외.
    image_files = [f for f in find_images(folder, recursive=recursive)
                   if not f.lower().endswith(".webp")]

    if not image_files:
        return 0, 0, []

    # 결과 정리
    success = []
    failed = []
    skipped = []
    total_input = 0
    total_output = 0

    if not dry:
        # 병렬 처리
        with Pool(processes=None) as pool:
            results = pool.map(convert_image, [(f, quality) for f in image_files])
    else:
        # dry-run: 순차 처리
        results = [convert_image((f, quality)) for f in image_files]

    for input_file, output_file, info in results:
        if info is None:
            skipped.append(input_file)
        elif isinstance(info, str):  # 에러
            failed.append((input_file, info))
        else:
            success.append((input_file, output_file, info))
            total_input += info['input_size']
            total_output += info['output_size']

    # 메타 데이터 업데이트 (비파괴)
    if not dry and success:
        # _tags.json 업데이트
        tags_file = folder / '_tags.json'
        if tags_file.exists():
            try:
                with open(tags_file, encoding='utf-8') as f:
                    tags_data = json.load(f)

                # 파일명을 .webp로 변경
                new_tags = []
                for tag_record in tags_data:
                    if 'file' in tag_record:
                        file_path = Path(tag_record['file'])
                        if file_path.suffix.lower() in ['.jpg', '.jpeg', '.png', '.bmp', '.gif']:
                            tag_record['file'] = str(file_path.with_suffix('.webp'))
                    new_tags.append(tag_record)

                with open(tags_file, 'w', encoding='utf-8') as f:
                    json.dump(new_tags, f, ensure_ascii=False, indent=2)
            except Exception:
                pass

        # _cls.json 업데이트
        cls_file = folder / '_cls.json'
        if cls_file.exists():
            try:
                with open(cls_file, encoding='utf-8') as f:
                    cls_data = json.load(f)

                new_cls = []
                for cls_record in cls_data:
                    if 'file' in cls_record:
                        file_path = Path(cls_record['file'])
                        if file_path.suffix.lower() in ['.jpg', '.jpeg', '.png', '.bmp', '.gif']:
                            cls_record['file'] = str(file_path.with_suffix('.webp'))
                    new_cls.append(cls_record)

                with open(cls_file, 'w', encoding='utf-8') as f:
                    json.dump(new_cls, f, ensure_ascii=False, indent=2)
            except Exception:
                pass

    return len(image_files), len(success), failed

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='JPEG/PNG를 고품질 WebP로 변환')
    parser.add_argument('path', nargs='?', help='변환할 폴더')
    parser.add_argument('--all', action='store_true', help='모든 폴더 변환')
    parser.add_argument('--quality', type=int, default=95, help='WebP 품질 (1-100, 기본 95)')
    parser.add_argument('--dry', action='store_true', help='미리보기 (변환 안 함)')
    parser.add_argument('--no-recurse', action='store_true', help='하위 폴더 제외 (기본: 재귀 탐색)')

    args = parser.parse_args()
    recursive = not args.no_recurse

    if args.all:
        # --all 모드: 모든 폴더에서 변환
        root = Path(os.path.expanduser(args.path or "~/Library/Mobile Documents/com~apple~CloudDocs/0/works/study/books/imageRefs"))
        print(f"{'폴더':20}{'전':>5}{'성공':>5}{'실패':>5}  {'(dry)' if args.dry else ''}")

        total_files = total_success = 0
        for brand_dir in sorted(root.iterdir()):
            if brand_dir.is_dir():
                n, s, f = convert_folder(brand_dir, quality=args.quality, dry=args.dry, recursive=recursive)
                if n:
                    print(f"{brand_dir.name:20}{n:>5}{s:>5}{len(f):>5}")
                    total_files += n
                    total_success += s

        print(f"\n전체: {total_files} → {total_success} 성공, {total_files - total_success} 스킵 ({'미적용' if args.dry else '적용됨'})")
    elif args.path:
        # 단일 폴더 모드
        n, s, failed = convert_folder(args.path, quality=args.quality, dry=args.dry, recursive=recursive)
        print(f"{n}개 → {s}개 변환, {len(failed)}개 실패 ({'미적용' if args.dry else '적용됨'})")
        if failed:
            for f, err in failed:
                print(f"  ✗ {Path(f).name}: {err}")
    else:
        print("사용법: image-convert-webp.py <폴더> | --all [root] [--quality 80] [--dry]")
        sys.exit(1)
