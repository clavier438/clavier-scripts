

좋은 포인트예요.  
정리하면:

---

## 1. status랑 featured는 역할이 완전히 다릅니다

- **status**
    
    - 값: draft, published (나중에 archived 정도 추가 가능)
        
    - 의미: **온·오프 / 공개 여부**
        
    - 예:
        
        - draft → 에디터만 보기, 프론트에는 절대 안 뜸
            
        - published → 조건에 맞으면 어디서든 노출 가능
            
- **featured (True/False)**
    
    - 의미: **"지금 제일 앞에 세우고 싶은 것"에 꽂는 플래그**
        
    - status가 published인 것 중에서도,
        
        - 홈 히어로
            
        - 리스트에서 상단 "추천" 영역  
            에 쓰려고 따로 표시해 둔 거예요.
            

---

## 2. 실제로 어디에 쓰라고 설계해둔 거냐면

지금 CSV 구조 기준으로 보면, featured=True인 스토리는 주로 **“지금 일어나는 일”을 노출하는 레이어**에서 쓰게 됩니다.

예를 들면:

1. **홈 첫 화면(싱글 섹션)**
    
    - 현재 시즌에 맞는, featured=True인 스토리 1개:
        
        - "지금, 효우당은 화전의 때입니다" (봄)
            
        - "겨울 종가의 풍경" (겨울)
            
    - 쿼리 느낌:
        
        - where status='published' and featured=true and season='spring' limit 1
            
2. **“다른 이야기” 작은 카드 리스트**
    
    - featured 중에서, 지금 시즌은 메인으로 쓰고  
        나머지 시즌/타입의 featured 스토리를 2~4개 정도 카드로 나열
        
    - 쿼리 느낌:
        
        - where status='published' and featured=true and id != current_story order by order limit 4
            
3. **오퍼 페이지 상단 “에디토리얼 강조”**
    
    - /Offers에서 상단에 1~2개만 “추천 스토리”로 띄우고 싶을 때
        
    - 그때도 featured=True인 것만 써서:
        
        - "시즌오퍼" 태그 + featured
            
        - "절기오퍼" 태그 + featured  
            이런 식으로 조합해서 쓸 수 있습니다.
            

즉, **“에디토리얼 중에서도 지금 이걸 밀고 있다”는 신호**라고 보면 됩니다.

---

## 3. 운영 관점에서의 사용 규칙 제안

실제 운영할 때 헷갈리지 않게, 이렇게 구분해서 쓰면 좋아요:

1. **status**
    

- 새 글 쓸 때: 기본 draft
    
- 다 쓴 후 검수 끝: published
    
- 더 이상 쓰고 싶지 않거나, 시즌 완전히 끝났을 때:
    
    - 그냥 published 유지하고 쿼리에서 제외해도 되고
        
    - 아예 archived 같은 값 하나 더 정의해서 빼도 됨
        
    - 핵심은 “노출 여부”는 **항상 status로 제어**한다는 것
        

2. **featured**
    

- “지금 메인에 올릴 스토리인가?”만 보고 결정
    
- 한 시즌에 보통:
    
    - 메인 스토리 1개 (홈 상단)
        
    - 서브로 도는 스토리 몇 개 (오퍼/체험 등)  
        정도에만 True 주고, 나머지는 전부 False
        
- 시즌이 바뀌면:
    
    - 기존 featured를 False로 내리고
        
    - 새 시즌 스토리 1~2개만 True로 올림
        

이렇게 하면:

- **노출/비노출** → status
    
- **노출되는 것 중에 “전면 배치”할 것** → featured  
    으로 완전히 분리됩니다.
    

---

## 4. 지금 우리가 만든 구조랑 딱 맞춰 보면

지금까지 같이 그렸던 구조에서:

- 홈 첫 화면 “화전의 때” 싱글 섹션
    
    - → featured=True인 스토리 딱 1개 사용
        
- 아래로 스크롤하면 “다른 이야기”
    
    - → 나머지 featured=True들 중에서 2~3개
        

그리고 오퍼 리스트나 체험 리스트는 **스토리 레벨 말고 items 쪽**에서 구성하니까, 굳이 featured 안 써도 되고요.

요약하면: **featured는 “지금 제일 앞에 세우고 싶은 스토리들 전용 필터”**라고 생각하고,  
온/오프는 끝까지 status만 가지고 가면 됩니다.

![text/csv](https://sana.ai/public-static/sana-ai-files/csvIcon.svg)

story_blocks-Grid view.csv

CSV

Open

![text/csv](https://sana.ai/public-static/sana-ai-files/csvIcon.svg)

pages-Grid view.csv

CSV

Open

![text/csv](https://sana.ai/public-static/sana-ai-files/csvIcon.svg)

subitems-Grid view.csv

CSV

Open

![text/csv](https://sana.ai/public-static/sana-ai-files/csvIcon.svg)

stories-Grid view.csv

CSV

Open

![text/csv](https://sana.ai/public-static/sana-ai-files/csvIcon.svg)

items-Grid view (1).csv

CSV

Open

![text/csv](https://sana.ai/public-static/sana-ai-files/csvIcon.svg)

tags-Grid view.csv

CSV

Open

archived는 어떻게 관리하는거야 ?

J

Answering

Answering

archived는 “완전히 숨기되, 기록은 남겨두는 상태”로 쓰면 됩니다.  
온·오프(status) 안에 한 단계 더 넣는 느낌으로 정리해볼게요.

---

## 1. 스토리 라이프사이클 3단계

하나의 스토리/오퍼가 지나가는 단계:

1. **draft**
    
    - 막 쓰는 중, 실험/임시
        
    - 프론트엔드 어디에도 절대 안 노출
        
2. **published**
    
    - 지금 또는 나중에 쓸 수 있는 **살아있는 콘텐츠**
        
    - 쿼리에 따라
        
        - 메인(홈, 리스트)에 나오기도 하고
            
        - 시즌이 아니면 안 나오기도 함
            
    - 핵심: “언제든 다시 꺼내 쓸 수 있다”는 상태
        
3. **archived**
    
    - **다시는 손님에게 보여줄 일은 없지만**,  
        기록·참조·통계를 위해 남겨두고 싶은 것
        
    - 예: 2025년 한정 오퍼, 끝난 캠페인, 테스트용 스토리 등
        

---

## 2. 쿼리 레벨에서의 사용법

프론트엔드에서 기본 룰을 이렇게 가져가면 편합니다:

- **일반 페이지(홈, 오퍼 리스트, 스토리 목록 등)**
    
    Sql
    
    `WHERE status = 'published'`
    
    → archived는 아예 포함 안 함
    
- **어드민 / 에디터 화면**
    
    - “현재 쓰는 콘텐츠”: status in ('draft', 'published')
        
    - “예전 캠페인 아카이브 보기”: status = 'archived'
        
- **통계 / 히스토리 분석**
    
    - status in ('published', 'archived')  
        → 과거 캠페인까지 포함해서 성과 비교
        

중요한 건 **프론트엔드 쿼리에서 archived는 기본적으로 걸러준다**는 것.  
그래야 “옛날 오퍼가 실수로 다시 노출”되는 일이 없습니다.

---

## 3. 언제 published → archived로 바꾸나?

간단한 기준을 두면 좋아요:

- **시즌이 끝났고, 같은 형식의 오퍼를 다시 쓸 계획이 없다**  
    → archived
    
- **내년에도 비슷한 포맷으로 재활용 가능하다**  
    (텍스트/이미지만 조금 바꾸면 다시 쓸 수 있음)  
    → published 유지, 단지 쿼리에서 현재 시즌이 아니면 안 불러오기
    

예시:

- 매년 하는 “봄 · 화전” 오퍼
    
    - → 구조는 계속 쓰고, 텍스트/날짜만 바꿈
        
    - 이건 published 상태에서 매년 업데이트
        
- 단 한 번만 했던 “10주년 기념 오퍼”
    
    - 다시는 안 할 특별 기획
        
    - 시즌 종료 후 archived
        

---

## 4. featured랑의 조합

정리하면:

- **status**
    
    - draft / published / archived
        
    - “살아있는가/죽었는가”를 관리
        
- **featured (True/False)**
    
    - status='published'인 것들 안에서만 의미 있음
        
    - “지금 메인으로 밀고 있는 것인가?”
        

그래서 이런 상태 조합만 쓰는 걸 추천합니다:

- 작업 중: status=draft, featured=False
    
- 공개 중이지만 서브: status=published, featured=False
    
- 공개 + 메인 강조: status=published, featured=True
    
- 완전 종료: status=archived, featured=False (여기선 featured 안 씀)
    

이렇게 정해두면, 나중에 쿼리 짤 때도 머릿속이 깔끔합니다:

- 홈 메인: WHERE status='published' AND featured=true
    
- 어떤 리스트든: WHERE status='published'
    
- 아카이브 페이지: WHERE status='archived'
    

Create

Sources

Default

Sana can make mistakes. Double check important info.