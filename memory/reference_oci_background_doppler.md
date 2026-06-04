# 레퍼런스: OCI 밤새 작업의 대기·체인은 OCI 내부에서 완결

## 함정 (2026-06-02 배치 체인 즉사)
Mac 의 **background bash** (`Bash run_in_background=true`) 는 doppler keychain 인증에 접근 못 함 → `clouds/oci/ociIn.sh` 의 `doppler secrets get OCI_SSH_KEY_B64 --plain` 이 빈 값 반환 → "❌ OCI private key 못 찾음" 으로 첫 호출에서 즉사. (**foreground** Bash 는 keychain OK 라 헷갈림 — 같은 ociIn 이 foreground 는 되고 background 는 안 됨)

증상: byredo/explora 완료 후 74 url 배치를 Mac background 에서 `until ociIn ...; sleep 120` 폴링하려다 첫 ociIn 에서 죽고, 배치가 영영 안 걸림.

## 해법 (근본 — 다른 path 없는 단순책)
**OCI 밤새 작업의 대기·체인 로직은 Mac 이 아니라 OCI 서버 내부 스크립트로 완결한다.** Mac 은 doppler 가 살아있는 **foreground 1회** ociIn 으로 OCI 내부 스크립트를 `setsid` 기동만 하고 빠진다. 이후 폴링·대기·후속 트리거 전부 OCI 안에서 — Mac/doppler 의존 0.

- 대기 조건은 로그 마커(`grep DONE`)보다 **프로세스 기반**(`while pgrep -f 'webSiteExporter.*<url슬러그>'`)이 확실. 로그 redirect 경로·마커명·setsid 후 프로세스명 변형 같은 불확실성을 통째 회피.
- 패턴:
  ```bash
  # OCI 내부 chain.sh
  while pgrep -f 'webSiteExporter.*byredo' >/dev/null || pgrep -f 'webSiteExporter.*explora' >/dev/null; do sleep 120; done
  bash ~/batch_oci.sh >> ~/batch.log 2>&1
  ```
  ```bash
  # Mac (foreground 1회, doppler OK)
  cat chain.sh | ociIn "cat > ~/chain.sh; setsid bash ~/chain.sh >/dev/null 2>&1 </dev/null & disown"
  ```
- setsid 기동 직후 `pgrep -af 'bash.*chain.sh'` 로 살아있음 1회 확인 (detach 라 stdout 안 옴 → 별도 ociIn 으로 검증).
