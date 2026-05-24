
```mermaid
flowchart TD
    subgraph 전략 수립 (Strategy)
        A1(브랜드 방향성 설정):::human
        A2(시장/트렌드/경쟁사 리서치):::ai
        A3(핵심 메시지/USP 도출):::human
        A4(브랜드 전략 브리프 작성):::aihuman
    end

    subgraph 아이디어 발산 (Ideation)
        B1(키워드 브레인스토밍):::aihuman
        B2(콘셉트 후보 도출):::human
        B3(무드보드 제작):::ai
        B4(로고/시각 스케치):::human
        B5(콘셉트 평가 및 선정):::human
    end

    subgraph 프로토타입 개발 (Prototyping)
        C1(로고 벡터 디자인):::aihuman
        C2(색상/폰트 시스템 개발):::aihuman
        C3(그래픽 스타일 정의):::human
        C4(Mockup 제작):::ai
        C5(프로토타입 문서화):::aihuman
    end

    A1 --> A2 --> A3 --> A4 --> B1 --> B2 --> B3 --> B4 --> B5 --> C1 --> C2 --> C3 --> C4 --> C5

    %% 스타일 지정
    classDef human fill:#ffcccb,stroke:#000,stroke-width:1px,color:#000;
    classDef ai fill:#add8e6,stroke:#000,stroke-width:1px,color:#000;
    classDef aihuman fill:#fceabb,stroke:#000,stroke-width:1px,color:#000;
```
