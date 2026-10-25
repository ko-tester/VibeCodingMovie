# 영화 박스오피스 인사이트

KOBIS 박스오피스 정보를 날짜·기간별로 조회하고, 최근 일별 Top 10 관측 데이터를 바탕으로 흥행 추이를 살펴보는 웹 앱입니다. 화면은 정적 HTML/CSS/JavaScript이며, `server.py`가 파일과 내부 API를 함께 제공합니다.

## 필요한 환경

- Python **3.10 이상** (권장: Python 3.12 계열)
- 인터넷 브라우저
- Node.js/npm은 일반 실행에는 필요하지 않습니다. `npm run verify:data`를 사용할 때만 필요합니다.
- 앱 실행에 별도 Python 패키지를 설치하지 않습니다. 외부 API/DB 연결은 live 설정을 마친 경우에만 사용합니다.

버전을 확인합니다.

```cmd
python --version
```

Node.js/npm은 앱 실행에 필요하지 않습니다. 설치되어 있고 `verify:data` 명령을 사용할 예정이라면 버전을 확인합니다.

```cmd
node --version
npm --version
```

## 키 없이 먼저 실행하기 (demo)

Windows CMD에서 저장소 폴더로 이동한 뒤 실행합니다.

```cmd
cd /d "C:\Users\USER\Desktop\boxoffice-insights"
set DATA_MODE=demo
set HOST=127.0.0.1
set PORT=8000
python server.py
```

브라우저에서 <http://127.0.0.1:8000/>을 엽니다. 샘플 영화와 수치는 가상 데이터입니다. 서버는 `Ctrl+C`로 종료합니다.

데모 상태를 확인할 수 있는 주소:

| 확인 항목 | URL 뒤에 붙일 쿼리 | 예상 상태 |
|---|---|---|
| 목록 성공 | `?date=2026-09-05` | 샘플 박스오피스 목록 |
| 정상 빈 결과 | `?date=2026-09-06` | 오류가 아닌 빈 기간 안내 |
| 검색 결과 있음 | `?date=2026-09-05&q=바다` | 일치 영화 |
| 검색 결과 없음 | `?date=2026-09-05&q=없는영화` | 검색 전 목록은 있으나 검색 결과 없음 |
| 오류 예시 | `?date=2026-09-05&state=error` | 재시도 가능한 데모 오류 |

## 실제 데이터(live) 연결

실제 API와 저장 캐시를 쓰려면 KOBIS와 Supabase 프로젝트 및 서버 비밀 환경변수가 필요합니다. `DATA_MODE=live`는 브라우저에서 직접 KOBIS/Supabase를 호출하지 않고 서버 내부 API를 사용합니다.

1. `.env.example`을 `.env.local`로 복사합니다.

   ```cmd
   copy .env.example .env.local
   ```

2. `.env.local`에서 아래 **환경변수 이름**을 본인의 설정으로 채웁니다.
   - `DATA_MODE`
   - `KOBIS_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
3. Supabase 프로젝트에서 `supabase/migrations/202610250001_box_office_cache.sql`을 실행합니다.
4. CMD에서 `set DATA_MODE=live` 후 `python server.py`를 실행합니다. `.env.local`에 이미 설정한 변수는 프로세스 환경변수로 덮어쓰지 않습니다.

키는 `.env.local`과 배포 서비스의 서버 환경변수 저장소에만 둡니다. `.env.local`은 Git에서 제외됩니다. 비밀값을 브라우저 코드, `README.md`/문서, URL, 스크린샷, 로그, 공개 저장소에 붙여 넣지 마세요. 배포 절차는 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)를 참고하세요.

## 인사이트 범위

인사이트는 전체 영화시장 통계가 아니라 **일별 Top 10 관측 데이터**를 요약합니다. 주간·주말 결과를 섞지 않고 영화 코드로 묶으며, 누적 수치를 날짜별로 더하지 않습니다. 순위 밖 영화의 값을 0으로 추정하지 않습니다. 빈 날짜와 실패 날짜는 차트에서 분리되고, 기간 합계와 영화 Top 5는 모든 날짜가 정상일 때만 표시됩니다.

## 명령

```cmd
python server.py
```

`package.json`에 등록된 명령은 `verify:data` 하나입니다. 로컬 `.env.local`에 live KOBIS·Supabase 설정과 해당 기간의 검증 자료가 준비되어 있을 때만 실행합니다.

```cmd
npm run verify:data -- --date=YYYY-MM-DD --period=daily
```

검증 명령은 Supabase 저장본과 새 KOBIS 조회를 비교합니다. API/DB 비밀값이 없는 demo 실행에는 필요하지 않습니다.
