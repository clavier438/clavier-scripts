#!/usr/bin/env python3
"""
syncObsidian.py — iCloud 폴더 → Google Drive API 직접 싱크
트리거: LaunchAgent 또는 직접 실행

기본값 (인수 없이 실행): Obsidian vault → icloudSync/obsidianSync/

직접 실행:
  python3 ~/bin/daemons/syncObsidian [옵션]
  python3 ~/bin/daemons/syncObsidian --reset   (Drive 스냅샷 재빌드)

옵션:
  --src PATH          소스 폴더 경로 (기본: Obsidian vault)
  --gdrive-parent     GDrive 상위 폴더명 (기본: icloudSync)
  --gdrive-root       GDrive 대상 폴더명 (기본: obsidianSync)
  --cache PATH        캐시 파일 경로
  --lock PATH         락 파일 경로
  --log PATH          로그 파일 경로
  --reset             Drive 스냅샷 재빌드

@group watcher
@type launchagent
@label com.clavier.watcherObsidian
"""

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("pip3 install requests", file=sys.stderr)
    sys.exit(1)

# ── 고정 설정 ─────────────────────────────────────────────────────────────────
SECRETS_FILE  = Path.home() / ".config/clavier/secrets"
EXCLUDE_NAMES = {".DS_Store", ".trash", ".obsidian", ".sync.pid", ".sync.log"}
EXCLUDE_EXTS  = {".icloud"}

log = logging.getLogger(__name__)


# ── CLI 인수 파싱 ─────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="iCloud 폴더 → Google Drive 싱크")
    p.add_argument(
        "--src",
        default=str(Path.home() / "Library/Mobile Documents/iCloud~md~obsidian/Documents"),
        help="소스 폴더 경로",
    )
    p.add_argument("--gdrive-parent", default="icloudSync", help="GDrive 상위 폴더명")
    p.add_argument("--gdrive-root",   default="obsidianSync", help="GDrive 대상 폴더명")
    p.add_argument(
        "--cache",
        default=str(Path.home() / ".cache/syncObsidian.json"),
        help="캐시 파일 경로",
    )
    p.add_argument("--lock", default="/tmp/syncObsidian.lock", help="락 파일 경로")
    p.add_argument(
        "--log",
        default=str(Path.home() / "Library/Logs/syncObsidian.log"),
        help="로그 파일 경로",
    )
    p.add_argument("--reset", action="store_true", help="Drive 스냅샷 재빌드")
    return p.parse_args()


# ── 시크릿 로드 ───────────────────────────────────────────────────────────────
def load_secrets() -> dict:
    if not SECRETS_FILE.exists():
        return {}
    result = {}
    for line in SECRETS_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        result[k.strip()] = v.strip()
    return result


# ── Google Drive 클라이언트 ───────────────────────────────────────────────────
class GDrive:
    _TOKEN_URL  = "https://oauth2.googleapis.com/token"
    _API        = "https://www.googleapis.com/drive/v3"
    _UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"

    def __init__(self, client_id: str, client_secret: str, refresh_token: str):
        self._client_id     = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._access_token  = None
        self._token_expiry  = 0.0

    def _refresh(self):
        r = requests.post(self._TOKEN_URL, data={
            "grant_type":    "refresh_token",
            "client_id":     self._client_id,
            "client_secret": self._client_secret,
            "refresh_token": self._refresh_token,
        }, timeout=15)
        r.raise_for_status()
        data = r.json()
        self._access_token = data["access_token"]
        self._token_expiry = time.time() + data.get("expires_in", 3600) - 60

    def _h(self) -> dict:
        if not self._access_token or time.time() > self._token_expiry:
            self._refresh()
        return {"Authorization": f"Bearer {self._access_token}"}

    # ── 폴더 ─────────────────────────────────────────────────────────────────
    def find_folder(self, name: str, parent_id: str = "root") -> str | None:
        q = (f"name='{name}' and mimeType='application/vnd.google-apps.folder'"
             f" and '{parent_id}' in parents and trashed=false")
        r = requests.get(f"{self._API}/files", headers=self._h(),
                         params={"q": q, "fields": "files(id)"}, timeout=15)
        r.raise_for_status()
        items = r.json().get("files", [])
        return items[0]["id"] if items else None

    def create_folder(self, name: str, parent_id: str = "root") -> str:
        r = requests.post(f"{self._API}/files", headers=self._h(), timeout=15, json={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        })
        r.raise_for_status()
        return r.json()["id"]

    def get_or_create_folder(self, name: str, parent_id: str = "root") -> str:
        fid = self.find_folder(name, parent_id)
        if fid:
            return fid
        fid = self.create_folder(name, parent_id)
        log.info(f"  📁 폴더 생성: {name}")
        return fid

    def move_to_parent(self, file_id: str, new_parent_id: str,
                       old_parent_id: str = "root") -> None:
        """기존 폴더를 새 상위 폴더로 이동."""
        r = requests.patch(
            f"{self._API}/files/{file_id}",
            headers=self._h(),
            params={
                "addParents": new_parent_id,
                "removeParents": old_parent_id,
                "fields": "id",
            },
            timeout=15,
        )
        r.raise_for_status()

    def get_or_create_folder_in_parent(self, name: str, parent_id: str) -> str:
        """parent 아래 폴더를 찾고, root에 있으면 이동, 없으면 생성."""
        fid = self.find_folder(name, parent_id)
        if fid:
            return fid
        root_fid = self.find_folder(name, "root")
        if root_fid:
            self.move_to_parent(root_fid, parent_id)
            log.info(f"  📦 {name}/ → icloudSync/ 하위로 이동됨")
            return root_fid
        fid = self.create_folder(name, parent_id)
        log.info(f"  📁 폴더 생성: {name}")
        return fid

    def list_folder(self, folder_id: str) -> list[dict]:
        items, page_token = [], None
        while True:
            params = {
                "q": f"'{folder_id}' in parents and trashed=false",
                "fields": "nextPageToken,files(id,name,mimeType,md5Checksum)",
                "pageSize": 1000,
            }
            if page_token:
                params["pageToken"] = page_token
            r = requests.get(f"{self._API}/files", headers=self._h(),
                             params=params, timeout=30)
            r.raise_for_status()
            data = r.json()
            items.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return items

    # ── 파일 업로드/삭제 ─────────────────────────────────────────────────────
    def upload(self, content: bytes, name: str, parent_id: str,
               file_id: str = None) -> str:
        boundary = "syncObsidian_multipart_boundary"
        meta = {"name": name}
        if not file_id:
            meta["parents"] = [parent_id]
        body = (
            f"--{boundary}\r\nContent-Type: application/json\r\n\r\n".encode()
            + json.dumps(meta).encode()
            + f"\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n".encode()
            + content
            + f"\r\n--{boundary}--".encode()
        )
        headers = {
            **self._h(),
            "Content-Type": f"multipart/related; boundary={boundary}",
        }
        if file_id:
            url  = f"{self._UPLOAD_API}/files/{file_id}?uploadType=multipart&fields=id"
            resp = requests.patch(url, headers=headers, data=body, timeout=60)
        else:
            url  = f"{self._UPLOAD_API}/files?uploadType=multipart&fields=id"
            resp = requests.post(url, headers=headers, data=body, timeout=60)
        resp.raise_for_status()
        return resp.json()["id"]

    def delete(self, file_id: str):
        r = requests.delete(f"{self._API}/files/{file_id}",
                            headers=self._h(), timeout=15)
        r.raise_for_status()


# ── Drive 스냅샷 (초기 캐시 빌드) ────────────────────────────────────────────
def build_drive_snapshot(drive: GDrive, folder_id: str, prefix: str,
                         snapshot: dict):
    for item in drive.list_folder(folder_id):
        rel = f"{prefix}/{item['name']}" if prefix else item["name"]
        is_folder = item["mimeType"] == "application/vnd.google-apps.folder"
        if is_folder:
            snapshot[f"__folder__{rel}"] = {"drive_id": item["id"]}
            build_drive_snapshot(drive, item["id"], rel, snapshot)
        else:
            snapshot[rel] = {
                "drive_id": item["id"],
                "md5": item.get("md5Checksum", ""),
            }


# ── 캐시 ─────────────────────────────────────────────────────────────────────
def load_cache(cache_file: Path) -> dict:
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_cache(cache: dict, cache_file: Path):
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(cache, indent=2, ensure_ascii=False))


# ── 유틸 ─────────────────────────────────────────────────────────────────────
def md5_of(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def should_skip(path: Path) -> bool:
    return (
        path.name in EXCLUDE_NAMES
        or path.name.startswith(".")
        or path.suffix in EXCLUDE_EXTS
    )


# ── 락 파일 (중복 실행 방지) ─────────────────────────────────────────────────
def acquire_lock(lock_file: Path) -> bool:
    if lock_file.exists():
        try:
            pid = int(lock_file.read_text().strip())
            os.kill(pid, 0)
            return False
        except (ProcessLookupError, ValueError, OSError):
            pass
    lock_file.write_text(str(os.getpid()))
    return True


def release_lock(lock_file: Path):
    lock_file.unlink(missing_ok=True)


# ── 핵심 싱크 로직 ────────────────────────────────────────────────────────────
def sync(drive: GDrive, cache: dict, src: Path,
         gdrive_parent: str, gdrive_root: str) -> dict:
    dest_label = f"{gdrive_parent}/{gdrive_root}" if gdrive_parent else gdrive_root
    log.info(f"=== sync 시작: {src.name} → {dest_label} ===")

    if gdrive_parent:
        parent_id = drive.get_or_create_folder(gdrive_parent)
        root_id = drive.get_or_create_folder_in_parent(gdrive_root, parent_id)
    else:
        root_id = drive.get_or_create_folder(gdrive_root)

    if not cache:
        log.info("캐시 없음 — Drive 현재 상태 읽는 중...")
        build_drive_snapshot(drive, root_id, "", cache)
        log.info(f"  Drive 스냅샷 완료: {len(cache)}개 항목")

    folder_ids: dict[str, str] = {"": root_id}
    for key, val in cache.items():
        if key.startswith("__folder__"):
            folder_ids[key[len("__folder__"):]] = val["drive_id"]

    local_files: set[str] = set()
    local_dirs:  set[str] = set()
    uploaded = deleted = skipped = 0

    for dirpath, dirnames, filenames in os.walk(src, topdown=True):
        dirnames[:] = [d for d in dirnames if not should_skip(Path(dirpath) / d)]

        dir_path = Path(dirpath)
        rel_dir = str(dir_path.relative_to(src))
        if rel_dir == ".":
            rel_dir = ""

        if rel_dir:
            local_dirs.add(rel_dir)
            folder_cache_key = f"__folder__{rel_dir}"
            if rel_dir not in folder_ids:
                parent_rel = str(dir_path.parent.relative_to(src))
                if parent_rel == ".":
                    parent_rel = ""
                p_id = folder_ids.get(parent_rel, root_id)
                fid = drive.get_or_create_folder(dir_path.name, p_id)
                folder_ids[rel_dir] = fid
                cache[folder_cache_key] = {"drive_id": fid}

        cur_parent_id = folder_ids.get(rel_dir, root_id)

        for fname in sorted(filenames):
            fpath = dir_path / fname
            if should_skip(fpath):
                continue

            rel_file = f"{rel_dir}/{fname}" if rel_dir else fname
            local_files.add(rel_file)

            try:
                content = fpath.read_bytes()
            except (PermissionError, OSError) as e:
                log.warning(f"  읽기 실패 (건너뜀): {rel_file} — {e}")
                continue

            local_md5 = md5_of(content)
            cached = cache.get(rel_file)

            if cached and cached.get("md5") == local_md5:
                skipped += 1
                continue

            existing_id = cached["drive_id"] if cached else None
            try:
                new_id = drive.upload(content, fname, cur_parent_id, existing_id)
                cache[rel_file] = {"drive_id": new_id, "md5": local_md5}
                action = "🔄" if cached else "⬆ "
                log.info(f"  {action} {rel_file}")
                uploaded += 1
            except Exception as e:
                log.error(f"  업로드 실패: {rel_file} — {e}")

    for key in list(cache.keys()):
        if key.startswith("__folder__"):
            rel = key[len("__folder__"):]
            if rel and rel not in local_dirs:
                try:
                    drive.delete(cache[key]["drive_id"])
                    log.info(f"  🗑  폴더 삭제: {rel}/")
                    deleted += 1
                except Exception as e:
                    log.error(f"  폴더 삭제 실패: {rel} — {e}")
                del cache[key]
                folder_ids.pop(rel, None)
        elif key not in local_files:
            try:
                drive.delete(cache[key]["drive_id"])
                log.info(f"  🗑  파일 삭제: {key}")
                deleted += 1
            except Exception as e:
                log.error(f"  파일 삭제 실패: {key} — {e}")
            del cache[key]

    log.info(f"=== 완료: ⬆ {uploaded}개 업로드 / 🗑 {deleted}개 삭제 / ⏭ {skipped}개 건너뜀 ===")
    return cache


# ── 진입점 ────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()
    src        = Path(args.src).expanduser()
    cache_file = Path(args.cache).expanduser()
    lock_file  = Path(args.lock)
    log_file   = Path(args.log).expanduser()

    log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.FileHandler(log_file), logging.StreamHandler()],
    )

    if not acquire_lock(lock_file):
        log.info("이미 실행 중 — 종료")
        return

    try:
        secrets = load_secrets()
        client_id     = secrets.get("GDRIVE_CLIENT_ID", "")
        client_secret = secrets.get("GDRIVE_CLIENT_SECRET", "")
        refresh_token = secrets.get("GDRIVE_REFRESH_TOKEN", "")

        if not all([client_id, client_secret, refresh_token]):
            log.error(
                "GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN "
                "이 ~/.config/clavier/secrets 에 없음"
            )
            sys.exit(1)

        drive = GDrive(client_id, client_secret, refresh_token)
        cache = {} if args.reset else load_cache(cache_file)
        if args.reset:
            log.info("--reset: 캐시 초기화, Drive 재스캔")

        try:
            cache = sync(drive, cache, src, args.gdrive_parent, args.gdrive_root)
        finally:
            save_cache(cache, cache_file)

    finally:
        release_lock(lock_file)


if __name__ == "__main__":
    main()
