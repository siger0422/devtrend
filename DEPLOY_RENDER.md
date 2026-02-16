# Render 배포 가이드

## 1) Git 업로드 전 체크
- `.env.notion.local` 파일은 업로드하지 마세요.
- `.notion-cache.json` 파일은 업로드하지 마세요.
- 이 저장소에는 이미 `.gitignore`가 설정되어 있습니다.

## 2) Render 배포
1. GitHub에 이 프로젝트를 push
2. Render에서 **New + > Blueprint** 선택
3. 저장소 연결 후 `render.yaml` 적용
4. 환경변수 입력
   - `NOTION_TOKEN`
   - `NOTION_CATEGORIES_DB_ID`
   - `NOTION_ARTICLES_DB_ID`
   - 필요 시 `PUBLIC_ORIGIN` (기본 `*`)

## 3) 보안 기본값
- `ENABLE_ADMIN_PAGE=false` (기본)  
  -> 공개 URL에서 `/admin.html` 접근 차단

## 4) 공개 URL
- 배포 완료 후 Render가 발급한 URL이 메인 사이트 주소입니다.
- 메인 페이지는 `/` 또는 `/index.html`
- API 헬스체크: `/api/health`

## 5) Admin 보호(권장)
- Vercel 사용 시 `middleware.js`가 `/admin.html` 접근을 Basic Auth로 보호합니다.
- 환경변수 추가:
  - `ADMIN_USER` (예: `devtrend-admin`)
  - `ADMIN_PASSWORD` (강력한 비밀번호)
