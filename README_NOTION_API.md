# Notion API -> Inblog JSON Server

이 서버는 Notion DB 2개(카테고리/아티클)를 읽어, 메인 사이트가 쓰는 JSON 스펙으로 변환합니다.

## 1) 준비

1. `.env.notion.example`를 참고해 환경 변수를 설정합니다.
2. Notion Integration을 만들고 DB 접근 권한을 부여합니다.
3. DB 필드명을 아래와 같이 맞춥니다.

### 카테고리 DB 필드
- `카테고리명` (Title)
- `슬러그` (Text)
- `정렬순서` (Number)
- `노출` (Checkbox)
- `설명` (Text, optional)

### 아티클 DB 필드
- `문서제목` (Title)
- `문서슬러그` (Text)
- `상위카테고리` (Relation -> 카테고리 DB)
- `카테고리내정렬` (Number)
- `상태` (Select: draft/review/published/archived)
- `노출` (Checkbox)
- `요약` (Text)
- `목차` (Text, optional)
- `본문데이터` (Long text, optional, JSON string)

`본문데이터` 예시:

```json
[
  { "id": "sec_1", "subtitle": "소개", "body": "첫 문단\n둘째 문단" },
  { "id": "sec_2", "subtitle": "진행 기준", "body": "기준 설명" }
]
```

## 2) 실행

```bash
NOTION_TOKEN=... \
NOTION_CATEGORIES_DB_ID=... \
NOTION_ARTICLES_DB_ID=... \
node notion-inblog-server.js
```

기본 포트: `8787`

## 3) API

- `GET /api/health`
- `GET /api/inblog/content`
  - 기본: `visible=true` + `status=published`만 반환
  - `?preview=1` 사용 시 전체 항목 반환
  - `?refresh=1` 사용 시 캐시 무시하고 즉시 재조회
- `POST /api/inblog/refresh`
  - 서버 캐시 강제 갱신

## 4) 메인 사이트 연동 팁

현재 프론트는 localStorage 기반입니다. 운영 전환 시에는 프론트 데이터 소스를 아래처럼 바꾸면 됩니다.

1. 초기 로드: `/api/inblog/content`
2. 30~60초 간격 재요청 또는 배포 트리거 시 `refresh=1`
3. 실패 시 마지막 캐시(localStorage) fallback
