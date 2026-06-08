#!/usr/bin/env swift
// image-convert-heic — 현재 폴더 아래 JPG 를 HEIC 로 변환, 원본은 휴지통.
// M2 ImageIO HW 가속 경로 사용 (VideoToolbox). sips 대비 5~10x 빠름.
//
//   image-convert-heic [폴더] [품질 0.0-1.0] [--dry]
//   image-convert-heic                        # 현재 폴더, 품질 0.75
//   image-convert-heic ~/Pictures/brands 0.8
//   image-convert-heic . 0.75 --dry           # 미리보기만

import Foundation
import ImageIO
import UniformTypeIdentifiers

// ── 인자 파싱 ─────────────────────────────────────────────────────────────
var args = CommandLine.arguments.dropFirst()
let isDry  = args.contains("--dry");  args = args.filter { $0 != "--dry" }
let rootPath = args.first ?? FileManager.default.currentDirectoryPath
let quality: Double = args.dropFirst().first.flatMap(Double.init) ?? 0.75

guard (0.0...1.0).contains(quality) else {
    fputs("❌ 품질은 0.0~1.0 사이여야 합니다.\n", stderr); exit(1)
}

let fm = FileManager.default
var rootURL = URL(fileURLWithPath: rootPath).standardizedFileURL
if !fm.fileExists(atPath: rootURL.path) {
    fputs("❌ 폴더 없음: \(rootURL.path)\n", stderr); exit(1)
}

// ── 파일 수집 ─────────────────────────────────────────────────────────────
let jpgExts: Set<String> = ["jpg", "jpeg"]

guard let enumerator = fm.enumerator(
    at: rootURL,
    includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey],
    options: [.skipsHiddenFiles]
) else {
    fputs("❌ 폴더 열기 실패\n", stderr); exit(1)
}

var targets: [URL] = []
for case let url as URL in enumerator {
    let ext = url.pathExtension.lowercased()
    guard jpgExts.contains(ext) else { continue }
    // 이미 같은 이름의 HEIC 가 있으면 건너뜀
    let heicURL = url.deletingPathExtension().appendingPathExtension("heic")
    if fm.fileExists(atPath: heicURL.path) { continue }
    targets.append(url)
}

// ── 안내 ──────────────────────────────────────────────────────────────────
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
print("  대상 폴더 : \(rootURL.path)")
print("  품질      : \(quality)")
print("  대상 JPG  : \(targets.count) 개")
print("  dry-run   : \(isDry)")
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

if targets.isEmpty { print("변환할 JPG 없음."); exit(0) }

if isDry {
    targets.prefix(20).forEach { print("  \($0.path)") }
    if targets.count > 20 { print("  ... 외 \(targets.count - 20) 개") }
    exit(0)
}

// ── 변환 ──────────────────────────────────────────────────────────────────
let perfCores = Int(
    (ProcessInfo.processInfo.environment["PERF_CORES"].flatMap(Int.init))
    ?? max(2, ProcessInfo.processInfo.activeProcessorCount - 1)
)

var converted = 0, failed = 0, trashed = 0
let lock = NSLock()
let queue = OperationQueue()
queue.maxConcurrentOperationCount = perfCores + 2

let start = Date()

for src in targets {
    queue.addOperation {
        let dst = src.deletingPathExtension().appendingPathExtension("heic")

        // 로드
        guard let source = CGImageSourceCreateWithURL(src as CFURL, nil),
              let image  = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            fputs("FAIL_LOAD: \(src.lastPathComponent)\n", stderr)
            lock.lock(); failed += 1; lock.unlock()
            return
        }

        // 메타데이터 보존
        let meta = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]

        // HEIC 인코딩 (ImageIO — M2 HW 가속 경로)
        guard let dest = CGImageDestinationCreateWithURL(
            dst as CFURL,
            UTType.heic.identifier as CFString,
            1, nil
        ) else {
            fputs("FAIL_DST: \(dst.lastPathComponent)\n", stderr)
            lock.lock(); failed += 1; lock.unlock()
            return
        }

        var opts: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: quality]
        meta.forEach { opts[$0] = $1 }
        CGImageDestinationAddImage(dest, image, opts as CFDictionary)

        guard CGImageDestinationFinalize(dest) else {
            fputs("FAIL_ENCODE: \(dst.lastPathComponent)\n", stderr)
            lock.lock(); failed += 1; lock.unlock()
            return
        }

        // 원본 → 휴지통 (FileManager.trashItem = macOS 네이티브)
        do {
            try FileManager.default.trashItem(at: src, resultingItemURL: nil)
            lock.lock(); converted += 1; trashed += 1; lock.unlock()
        } catch {
            fputs("FAIL_TRASH: \(src.lastPathComponent) — \(error.localizedDescription)\n", stderr)
            lock.lock(); converted += 1; lock.unlock()
        }
    }
}

queue.waitUntilAllOperationsAreFinished()

// ── 결과 ──────────────────────────────────────────────────────────────────
let elapsed = Date().timeIntervalSince(start)
let rate = elapsed > 0 ? String(format: "%.1f", Double(converted) / elapsed) : "?"
print("")
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
print("  ✓ 변환    : \(converted) 개")
print("  🗑 휴지통  : \(trashed) 개")
print("  ✗ 실패    : \(failed) 개")
print("  ⏱ 소요    : \(String(format: "%.1f", elapsed))초 (\(rate) 장/초)")
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
