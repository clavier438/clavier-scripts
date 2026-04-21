#!/bin/bash
# OCI 브리핑 — 원격으로 ociBriefing.sh 실행
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SELF_DIR/server.conf" 2>/dev/null || true

HOST="${HOST:-168.107.63.94}"
SCRIPTS_DIR="${SCRIPTS_DIR:-~/oci-scripts}"

ssh -o ConnectTimeout=8 ubuntu@"$HOST" "bash $SCRIPTS_DIR/ociBriefing.sh"
