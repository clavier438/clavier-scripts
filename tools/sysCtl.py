#!/usr/bin/env python3
"""
sysCtl — 맥 시스템 상태를 *사람이 읽게 해석*해 주는 진단 CLI

"컴퓨터 왜 느려?" 에 매번 같은 진단(메모리 포화·스왑·무거운 앱 묶음)을
손으로 top/ps/sysctl 파싱하지 않고 한 줄로 받는다.

사용법:
  sysCtl                 # 종합 진단 (메모리/CPU/스왑 + 무거운 앱 TOP + 해석·권고)
  sysCtl apps            # 앱별 메모리 묶음만 (Claude·Chrome 인스턴스 합산)
  sysCtl mem             # 메모리/스왑 요약만
  sysCtl --help

설계: workerCtl 의 front-door+verb 패턴. 외부 의존 없음(stdlib만) — 시스템
진단은 airtable/doppler/claude 바퀴를 안 쓰므로 자족. 색은 ANSI 인라인.
"""

import os
import subprocess
import re
import sys
from collections import defaultdict

# repo freshness 체크 (git fetch + main ff-pull) — 없는 환경에서도 동작하게 선택적
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass

# ── 색 (cli-color.mjs 와 같은 팔레트, Python 인라인) ──────────
_C = {
    "bold": "1", "dim": "2", "cyan": "36", "green": "32",
    "yellow": "33", "red": "31", "gray": "90",
}
_USE_COLOR = sys.stdout.isatty()
def _c(name, s):
    if not _USE_COLOR:
        return s
    return f"\033[{_C[name]}m{s}\033[0m"
bold   = lambda s: _c("bold", s)
dim    = lambda s: _c("dim", s)
cyan   = lambda s: _c("cyan", s)
green  = lambda s: _c("green", s)
yellow = lambda s: _c("yellow", s)
red    = lambda s: _c("red", s)
gray   = lambda s: _c("gray", s)


def sh(cmd):
    """셸 명령 실행, stdout 문자열 반환 (실패 시 빈 문자열)."""
    try:
        return subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=15
        ).stdout
    except Exception:
        return ""


def sysctl(key, default=""):
    out = sh(f"sysctl -n {key}").strip()
    return out or default


def human_mb(mb):
    """MB(float) → 보기 좋은 단위."""
    if mb >= 1024:
        return f"{mb/1024:.1f}G"
    return f"{mb:.0f}M"


# ── 수집 ──────────────────────────────────────────────────────
def gather():
    d = {}

    # 하드웨어 (빠른 sysctl, system_profiler 보다 빠름)
    d["mem_total_gb"] = round(int(sysctl("hw.memsize", "0") or 0) / 1024**3)
    d["ncpu"] = int(sysctl("hw.ncpu", "0") or 0)
    d["chip"] = sysctl("machdep.cpu.brand_string") or sysctl("hw.model")
    d["model"] = sysctl("hw.model")

    # top 한 컷 — PhysMem/CPU/Load 라인
    top = sh("top -l 1 -n 0")
    d["phys_used_mb"] = d["phys_unused_mb"] = d["wired_mb"] = d["compressor_mb"] = 0.0
    m = re.search(r"PhysMem:\s*([\d.]+)([MG])\s+used\s*\(([\d.]+)([MG])\s+wired,\s*([\d.]+)([MG])\s+compressor\)\s*,\s*([\d.]+)([MG])\s+unused", top)
    if m:
        def to_mb(v, u):
            v = float(v)
            return v * 1024 if u == "G" else v
        d["phys_used_mb"]   = to_mb(m.group(1), m.group(2))
        d["wired_mb"]       = to_mb(m.group(3), m.group(4))
        d["compressor_mb"]  = to_mb(m.group(5), m.group(6))
        d["phys_unused_mb"] = to_mb(m.group(7), m.group(8))
    mc = re.search(r"CPU usage:.*?([\d.]+)% idle", top)
    d["cpu_idle"] = float(mc.group(1)) if mc else None

    # Load average
    la = sysctl("vm.loadavg")  # { 3.63 3.13 3.10 }
    lm = re.findall(r"[\d.]+", la)
    d["load"] = [float(x) for x in lm[:3]] if lm else []

    # 스왑
    sw = sh("sysctl -n vm.swapusage")  # total = X used = Y free = Z
    su = re.search(r"used\s*=\s*([\d.]+)M", sw)
    st = re.search(r"total\s*=\s*([\d.]+)M", sw)
    d["swap_used_mb"]  = float(su.group(1)) if su else 0.0
    d["swap_total_mb"] = float(st.group(1)) if st else 0.0

    # 커널 메모리 압박 레벨 — macOS 가 직접 매기는 권위 신호
    #   1 = 정상, 2 = 경고, 4 = 위험. free(여유) 보다 이게 진실에 가깝다
    #   (macOS 는 여유 메모리를 캐시로 늘 낮게 유지하므로 free 만으로는 오판).
    try:
        d["pressure"] = int(sysctl("kern.memorystatus_vm_pressure_level", "1"))
    except ValueError:
        d["pressure"] = 1

    # 디스크 /
    df = sh("df -g / | tail -1").split()
    if len(df) >= 4:
        d["disk_avail_gb"] = df[3]
        d["disk_cap"] = df[4] if len(df) > 4 else "?"
    else:
        d["disk_avail_gb"] = "?"; d["disk_cap"] = "?"

    # 프로세스 → 앱별 묶음
    d["apps"] = group_processes()
    return d


def app_base_name(comm):
    """프로세스 comm 을 사용자가 아는 '앱 이름' 으로 정규화.
    'Google Chrome Helper (Renderer)' → 'Google Chrome'
    'Claude Helper (GPU)' → 'Claude'
    """
    name = comm
    name = re.sub(r"\s+Helper.*$", "", name)   # ... Helper (Renderer/GPU/...)
    name = re.sub(r"\s+\(.*\)$", "", name)      # 남은 괄호 꼬리
    return name.strip() or comm


def group_processes():
    """ps 로 전 프로세스 RSS 수집 → 앱 단위 합산."""
    out = sh("ps -Aceo rss,comm")
    groups = defaultdict(lambda: {"rss_mb": 0.0, "count": 0})
    for line in out.splitlines()[1:]:
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        try:
            rss_kb = float(parts[0])
        except ValueError:
            continue
        base = app_base_name(parts[1])
        g = groups[base]
        g["rss_mb"] += rss_kb / 1024
        g["count"] += 1
    apps = [(n, v["rss_mb"], v["count"]) for n, v in groups.items()]
    apps.sort(key=lambda x: x[1], reverse=True)
    return apps


# ── 해석 ──────────────────────────────────────────────────────
def memory_verdict(d):
    """메모리 압박 판정 → (이모지, 한줄, 색함수).

    권위 신호 = 커널 압박레벨(pressure). free(여유)는 macOS 가 캐시로 늘 낮게
    유지하므로 단독 판정 근거로 쓰지 않는다 — 스왑·압축기·pressure 조합만 본다.
    """
    comp = d["compressor_mb"]
    swap = d["swap_used_mb"]
    lvl = d.get("pressure", 1)
    if lvl >= 4 or swap > 1024 or comp > 4096:
        return ("🔴", "메모리 포화 — 압축·스왑으로 느려지는 상태", red)
    if lvl == 2 or swap > 256 or comp > 3072:
        return ("🟡", "메모리 압박 — 무거운 앱이 많음, 아직 버팀", yellow)
    return ("🟢", "메모리 여유 — 시스템 쾌적", green)


def cpu_verdict(d):
    load = d["load"][0] if d["load"] else 0
    ncpu = d["ncpu"] or 1
    ratio = load / ncpu
    if ratio > 1.5:
        return ("🔴", f"CPU 과부하 (load {load:.1f} / {ncpu}코어)", red)
    if ratio > 0.9:
        return ("🟡", f"CPU 바쁨 (load {load:.1f} / {ncpu}코어)", yellow)
    return ("🟢", f"CPU 여유 (load {load:.1f} / {ncpu}코어)", green)


# 무거운 앱이지만 보통 '닫아도 되는' 후보 판단용 시스템 프로세스 제외 목록
_SYSTEM_PROCS = {
    "kernel_task", "WindowServer", "launchd", "mds", "mds_stores",
    "corespotlightd", "mdworker", "loginwindow", "Finder", "Dock",
    "SystemUIServer", "controlcenter", "WindowManager", "logd",
}


# ── 렌더 ──────────────────────────────────────────────────────
def render_full(d):
    print()
    print(bold(cyan("  🩺 sysCtl — 시스템 진단")))
    chip = d["chip"] or d["model"]
    print(dim(f"  {chip}  ·  RAM {d['mem_total_gb']}GB  ·  {d['ncpu']}코어"))
    print()

    # 판정 줄
    em, msg, col = memory_verdict(d)
    print(f"  {em} {col(bold(msg))}")
    cem, cmsg, ccol = cpu_verdict(d)
    print(f"  {cem} {ccol(cmsg)}")
    print()

    # 메모리 표
    free = d["phys_unused_mb"]
    print(bold("  메모리"))
    print(f"    여유      {_bar_val(free, 1500, human_mb(free))}")
    print(f"    압축기    {_bar_val(d['compressor_mb'], 2048, human_mb(d['compressor_mb']), invert=True)}")
    sw_label = f"{human_mb(d['swap_used_mb'])} / {human_mb(d['swap_total_mb'])}"
    print(f"    스왑      {_bar_val(d['swap_used_mb'], 1, sw_label, invert=True)}")
    if d["cpu_idle"] is not None:
        print(f"    CPU idle  {d['cpu_idle']:.0f}%")
    print(f"    디스크 /  {green(d['disk_avail_gb'] + 'G 여유')} ({d['disk_cap']} 사용)")
    print()

    # 무거운 앱 TOP (묶음)
    print(bold("  무거운 앱 (인스턴스 합산)"))
    shown = 0
    for name, rss_mb, count in d["apps"]:
        if name in _SYSTEM_PROCS and rss_mb < 800:
            continue
        if rss_mb < 150:
            break
        inst = f"  {dim('×' + str(count))}" if count > 1 else ""
        bar = _mini_bar(rss_mb, 1500)
        print(f"    {bar} {human_mb(rss_mb):>6}  {name}{inst}")
        shown += 1
        if shown >= 8:
            break
    print()

    render_advice(d)


def _mini_bar(val, full, width=10):
    fill = max(0, min(width, round(val / full * width)))
    col = red if val > full else (yellow if val > full * 0.6 else green)
    return col("█" * fill) + dim("·" * (width - fill))


def _bar_val(val, full, label, invert=False):
    """값 + 미니바. invert=True 면 클수록 나쁨(빨강)."""
    width = 10
    fill = max(0, min(width, round(val / full * width))) if full else 0
    if invert:
        col = red if val > full else (yellow if val > full * 0.5 else green)
    else:
        col = green if val >= full else (yellow if val >= full * 0.4 else red)
    bar = col("█" * fill) + dim("·" * (width - fill))
    return f"{bar}  {label}"


def render_advice(d):
    em, msg, _ = memory_verdict(d)
    print(bold("  권고"))

    # Electron 인스턴스 다발 감지 (Claude/Code/Chrome 등)
    multi = [(n, c, r) for n, r, c in d["apps"] if c >= 5 and r >= 300
             and n not in _SYSTEM_PROCS]
    advised = False
    for name, count, rss in multi:
        print(f"    • {cyan(name)} 프로세스 {count}개 ({human_mb(rss)}) — "
              f"안 쓰는 창/탭/세션이 있으면 닫는 게 가장 큰 회수")
        advised = True

    # 닫아도 되는 무거운 단일 앱 후보
    closeable = [n for n, r, c in d["apps"]
                 if r >= 200 and n not in _SYSTEM_PROCS
                 and not any(n == m[0] for m in multi)]
    skip = {"Claude", "claude"}  # 작업 중일 수 있는 것
    cand = [n for n in closeable if n not in skip][:4]
    if cand:
        print(f"    • 안 쓰면 닫을 후보: {', '.join(cyan(c) for c in cand)}")
        advised = True

    if em == "🟢":
        print(f"    • {green('지금은 여유롭습니다 — 굳이 안 닫아도 됩니다.')}")
    elif em == "🔴" and d["swap_used_mb"] > 512:
        print(f"    • 스왑 누적이 큽니다 — 위 정리로 안 풀리면 {yellow('재부팅')}이 깔끔합니다.")

    if not advised:
        print(dim("    • 특별히 정리할 무거운 앱이 없습니다."))
    print()


def render_apps(d):
    print()
    print(bold(cyan("  📦 앱별 메모리 (인스턴스 합산, 상위 15)")))
    print()
    for name, rss_mb, count in d["apps"][:15]:
        if rss_mb < 50:
            break
        inst = f"  {dim('×' + str(count))}" if count > 1 else ""
        print(f"    {human_mb(rss_mb):>7}  {name}{inst}")
    print()


def render_mem(d):
    print()
    em, msg, col = memory_verdict(d)
    print(f"  {em} {col(bold(msg))}")
    print(f"     여유 {human_mb(d['phys_unused_mb'])}  ·  "
          f"압축기 {human_mb(d['compressor_mb'])}  ·  "
          f"스왑 {human_mb(d['swap_used_mb'])}/{human_mb(d['swap_total_mb'])}")
    print()


HELP = """
sysCtl — 맥 시스템 상태를 사람이 읽게 해석해 주는 진단 CLI

  sysCtl            종합 진단 (메모리·CPU·스왑 + 무거운 앱 + 해석·권고)
  sysCtl apps       앱별 메모리 묶음만
  sysCtl mem        메모리/스왑 한 줄 요약
  sysCtl --help     이 도움말
"""


def main():
    args = sys.argv[1:]
    if args and args[0] in ("--help", "-h", "help"):
        print(HELP)
        return
    d = gather()
    if not args:
        render_full(d)
    elif args[0] == "apps":
        render_apps(d)
    elif args[0] == "mem":
        render_mem(d)
    else:
        print(f"알 수 없는 명령: {args[0]}")
        print(HELP)
        sys.exit(1)


if __name__ == "__main__":
    main()
