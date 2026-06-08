#!/bin/bash
# pdf-grid-serve — webp/png 폴더를 로컬 서버로 serve + index.json 생성
# Figma 플러그인(PDF Grid 배치)의 "서버 자동로드"가 이 서버에서 이미지를 createImageAsync 로 불러온다.
#
# 사용:
#   ./pdf-grid-serve.sh <이미지폴더> [포트=8787]
#   ./pdf-grid-serve.sh /tmp/amandayan_webp
#
# 흐름: 이 서버 실행 → Figma 플러그인 열고 "서버에서 자동 배치" 클릭 → 그리드 자동 배치.
# (manifest devAllowedDomains 가 http://localhost:8787 이므로 포트 바꾸면 manifest 도 같이.)
set -e

DIR="${1:?사용: $0 <이미지폴더> [포트=8787]}"
PORT="${2:-8787}"
[ -d "$DIR" ] || { echo "[ERROR] 폴더 없음: $DIR"; exit 1; }
cd "$DIR"

# index.json = 이미지 파일명 배열 (webp + png + jpg). 플러그인이 fetch 해서 URL 조립.
ls *.webp *.png *.jpg *.jpeg 2>/dev/null | python3 -c "import sys, json; print(json.dumps(sorted([l.strip() for l in sys.stdin if l.strip()])))" > index.json
N=$(python3 -c "import json; print(len(json.load(open('index.json'))))")

echo "[serve] $DIR"
echo "[serve]   → http://localhost:$PORT  (이미지 ${N}장 + index.json, CORS on)"
echo "[serve] Figma 플러그인 '서버 URL' = http://localhost:$PORT 그대로 두고 '서버에서 자동 배치' 클릭."
echo "[serve] Ctrl+C 로 종료."

# CORS 헤더 포함 정적 서버 (플러그인 iframe fetch + createImageAsync 허용)
python3 -c "
import http.server, socketserver
PORT = $PORT
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        http.server.SimpleHTTPRequestHandler.end_headers(self)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), H) as httpd:
    httpd.serve_forever()
"
