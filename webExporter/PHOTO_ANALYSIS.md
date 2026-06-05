# Photo Analysis — 사진 후처리 디자인 스터디 모듈

`photoAnalysis.py` — WebSiteExporter 의 **독립 동반 모듈**. 한 사이트(지정 스코프)의 사진을
전수 수집하고, 각 사진이 **어떤 후처리를 거쳤는지** 객관적으로 측정한 뒤, 비슷한 룩끼리
**컨셉**으로 묶어주고, 그 사이트 사진들의 **일반적인 후처리 레시피**를 정리해준다.

> 디자인 레퍼런스/스터디 용도. `webSiteExporter.py` 를 건드리지 않는 모듈식 추가라
> 다른 작업과 충돌하지 않는다.

## 무엇을 측정하나

결과물 픽셀에서 역추적한 "후처리 지문":

| 그룹 | 지표 |
|---|---|
| 톤/노출 | 노출, 전역 대비, 블랙포인트(블랙 리프트=matte), 화이트포인트, 다이내믹 레인지, 섀도/하이라이트 클리핑 |
| 컬러 | 색온도(웜·쿨), 틴트(그린·마젠타), 채도, 비비드니스 |
| 그레이딩 | **split-tone** — 섀도 vs 하이라이트 색 캐스트 (시네마틱 틸-오렌지 자동 탐지) |
| 질감 | **비네팅**, **그레인/노이즈**(필름 그레인), **샤프닝**(아쿠턴스), 로컬 대비(클래리티) |
| 색 | 도미넌트 팔레트 (hex + 비율) |

그 다음 이 지표들로 사진을 **k-means 클러스터링** → 컨셉(룩)이 여러 개면 자동으로 나눠준다
(실루엣 점수로 개수 자동 결정, 단일 룩이면 1개로 유지).

## 설치

```bash
pip install pillow numpy            # 분석 (필수)
pip install playwright              # --from 모드(사이트 직접 수집)만
playwright install chromium
```

## 사용법

### 모드 A — 사이트에서 직접 수집

```bash
# 같은 도메인 전체 (기본 스코프)
python photoAnalysis.py --from https://example.com -o ./study

# 스코프 좁히기: /work 경로만, 최대 15페이지
python photoAnalysis.py --from https://example.com --path-prefix /work -m 15 -o ./study
```

### 모드 B — 이미 받아둔 폴더 분석 (익스포터와 파이프라인 연결)

```bash
# 1) 익스포터로 사진 다운로드
python webSiteExporter.py https://example.com --download-images -o ./exports

# 2) 받은 폴더를 분석
python photoAnalysis.py --dir ./exports/images -o ./study
```

## 옵션

| 옵션 | 기본 | 설명 |
|---|---|---|
| `--from URL` / `--dir PATH` | (택1, 필수) | 수집 소스 |
| `--output, -o` | `./photo-study` | 출력 디렉터리 |
| `--clusters, -k` | 자동 | 컨셉 개수 강제 (기본 1~6 자동 감지) |
| `--max-pages, -m` | `30` | (--from) 방문 페이지 상한 (0=무제한) |
| `--path-prefix` | 없음 | (--from) 이 경로로 시작하는 URL만 |
| `--allow-cross-origin` | off | (--from) 외부 도메인 이미지/링크 허용 |
| `--scroll-time, -s` | `8` | (--from) 페이지당 스크롤 시간(초) |

## 산출물

```
study/
  report.md                 ← 디자인 스터디 리포트 (컨셉별 + 전체 후처리 레시피)
  analysis.json             ← 측정값 전체 (이미지별/컨셉별/전체)
  palette_overall.png       ← 전체 도미넌트 팔레트 스와치
  palette_concept_N.png     ← 컨셉별 팔레트
  contact_concept_N.png     ← 컨셉별 대표 사진 컨택트시트
  images/                   ← (--from 모드) 다운로드 원본
```

## 한계

- sRGB(감마) 공간 통계 기반 **추정**. 원본 Lightroom/Capture One 설정값이 아니라 결과물에서
  역추적한 지문이다. 압축 아티팩트가 그레인 추정에 섞일 수 있다.
- 컨셉 분리는 후처리 룩 기준이지 피사체/주제 기준이 아니다 (색·톤이 비슷하면 주제가 달라도 한 컨셉).
- 아이콘/로고(64px 미만, 3KB 미만)는 자동 제외.
