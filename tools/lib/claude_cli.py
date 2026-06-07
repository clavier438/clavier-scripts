#!/usr/bin/env python3
# claude_cli.py — claude CLI (구독 빌링) 단일 호출 헬퍼.
#
# copy/runner.mjs 의 파이썬 짝. brandguide.py·photo-pattern.py 에 복붙 2벌로
# 있던 run_claude 를 단일화하고, image-tagger 비전 분류용으로 이미지 입력 +
# 구조화 출력(--json-schema)을 확장한다. (reuse-first 스킬: 복붙 2곳+ → lib 추출.)
#
# 정신 (copy 방식 = feedback_no_system_slot): system 슬롯을 비우고
#   (--system-prompt "") 지침은 user 프롬프트에 싣는다. claude CLI 는 OAuth
#   구독으로 돌아 별도 API 크레딧이 들지 않는다 → ANTHROPIC_API_KEY 를 환경에서
#   떼고 호출해 '구독 빌링' 을 강제(doppler run 으로 키가 주입돼도 API 과금 안 됨).
#
# ── 비전 입력 근거 (reference + 실측) ─────────────────────────────────────────
#   claude -p(headless) 에서 이미지 파일 경로를 프롬프트로 주고 --allowedTools Read
#   로 Read 를 허용하면 멀티모달로 본다.
#   docs: https://code.claude.com/docs/en/headless
#         — `--allowedTools "Read"` 로 도구 자동승인, `--json-schema '{...}'` 로
#           structured_output(스키마 준수) 출력. (공식 예시 인용)
#   실측 trace (2026-06-07, claude 2.1.153): known-content PNG(파란 배경+노란 타원)를
#     `claude -p --model haiku --allowedTools Read --output-format json
#      "Read the image at <png> and describe ..."` 로 호출 →
#     결과 'A bright yellow oval centered on a deep blue background.' (정확).
#     즉 이 경로(파일경로 참조 + Read 허용)에서 vision 이 실제 작동함을 확인.
#   주의: 디렉토리/존재하지 않는 경로를 주면 NO_VISION/오답 — 반드시 실재 파일 절대경로.

import json, os, shutil, subprocess

TEXT_DISALLOWED = "Bash Read Write Edit Glob Grep WebFetch WebSearch Task"


def have_claude():
    return shutil.which("claude") is not None


def _env_subscription():
    """ANTHROPIC_API_KEY 를 떼낸 환경 — claude CLI 가 OAuth 구독으로 인증하게."""
    return {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}


def run_claude(prompt, model="sonnet", *, image_paths=None, json_schema=None,
               timeout=180):
    """claude CLI 1회 호출 (구독 빌링). 실패하면 None.

    - 텍스트:  run_claude(prompt, model)        → result 문자열
    - 비전:    image_paths=[abs, ...]           → 그 이미지를 Read 해 분석
    - 구조화:  json_schema={JSON Schema}         → structured_output(dict)

    반환: json_schema 가 있으면 dict|None, 없으면 str|None.
    """
    if not have_claude():
        return None
    args = ["claude", "-p", "--system-prompt", "", "--output-format", "json",
            "--model", model]
    if image_paths:
        # 이미지를 vision 입력으로 — 경로 참조 + Read 허용 (위 실측 trace 참조)
        refs = "\n".join(f"- {os.path.abspath(p)}" for p in image_paths)
        prompt = ("Use the Read tool to open the following image file(s), then "
                  f"do the task below.\nImage(s):\n{refs}\n\n{prompt}")
        args += ["--allowedTools", "Read"]
    else:
        # 텍스트 생성 — 도구 일절 불필요 (기존 run_claude 동작 그대로)
        args += ["--disallowed-tools", TEXT_DISALLOWED]
    if json_schema:
        args += ["--json-schema", json.dumps(json_schema, ensure_ascii=False)]
    try:
        p = subprocess.run(args, input=prompt, capture_output=True, text=True,
                           timeout=timeout, env=_env_subscription())
        if p.returncode != 0:
            return None
        data = json.loads(p.stdout)
        if data.get("is_error"):
            return None
        if json_schema:
            return data.get("structured_output")
        return str(data.get("result", "")).strip()
    except Exception:
        return None
