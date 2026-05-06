// 워커 → Doppler config + wrangler env 매핑 (단일 진실 소스)
//
// 새 워커(예: nextProject) 추가 절차:
//   1) platform-workers/framer-sync/wrangler.toml 에 [env.<name>] 섹션 추가
//   2) Doppler 에 prd_<name> config 생성 + secrets 입력
//   3) 이 파일 WORKER_ENV_MAP 에 한 줄 추가
//   → workerCtl / doppler-sync-wrangler 자동으로 인식
//
// 같은 매핑을 bash 에서도 쓰지만 (doppler-sync-wrangler.sh) 일부러 양쪽에 박았다.
// JS↔bash 인터프로세스 호출은 sync 한 번에 의의 없는 비용. 매핑 변경 = 양쪽 동시 수정 = 한 commit.
//
// dopplerConfig: 그 워커의 secrets 가 들어있는 Doppler config 이름
// wranglerEnv:   wrangler.toml 의 [env.<name>] 섹션 이름 (top-level 환경 = null)

export const DOPPLER_PROJECT = "clavier"

export const WORKER_ENV_MAP = {
    sisoso: { dopplerConfig: "prd",        wranglerEnv: null },
    mukayu: { dopplerConfig: "prd_mukayu", wranglerEnv: "mukayu" },
}

export function getWorkerEnv(workerName) {
    return WORKER_ENV_MAP[workerName] ?? null
}

export function listWorkerEnvs() {
    return Object.entries(WORKER_ENV_MAP).map(([name, e]) => ({ name, ...e }))
}
