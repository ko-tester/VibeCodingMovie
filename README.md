# 영화 박스오피스 인사이트 대시보드

영화진흥위원회 KOBIS 박스오피스 화면입니다. `server.py`는 `DATA_MODE=demo`에서 가상 fixture를, `DATA_MODE=live`에서 서버 전용 KOBIS API를 제공합니다. Supabase 캐시 설정이 되어 있으면 live 조회는 저장본을 먼저 사용합니다.

## 실행

Windows CMD에서 demo 모드를 실행합니다.

```cmd
cd /d C:\Users\USER\Desktop\boxoffice-insights
set DATA_MODE=demo
set PORT=8000
python server.py
```

그 다음 브라우저에서 `http://127.0.0.1:8000/`을 엽니다. 서버는 `Ctrl+C`로 종료합니다. Python 표준 라이브러리만 사용하며 API 키, DB, 패키지 설치는 필요하지 않습니다. `DATA_MODE`가 `demo`가 아니면 API는 `503 DATA_MODE_DISABLED`를 반환합니다.

실제 KOBIS 연동은 `.env.local`에 `DATA_MODE=live`와 `KOBIS_API_KEY`를 설정하고 실행합니다. 서버가 시작할 때 두 설정을 읽으며, 키 값은 화면·로그·문서에 복사하지 마세요.

```cmd
set DATA_MODE=live
set PORT=8000
python server.py
```

live 모드는 F1 목록과 F2 인사이트가 모두 KOBIS 데이터를 사용합니다. Supabase가 연결되면 같은 날짜·기간의 유효 저장본을 먼저 사용하고, 없거나 만료된 경우에만 KOBIS를 조회합니다. F2는 7·14·30일의 일별 Top 10 자료를 서버에서 집계합니다. demo 모드는 이전 가상 fixture를 유지하며 DB를 호출하지 않습니다.

`.env.local`은 서버가 시작할 때 읽으며, 키와 모드를 바꾸면 서버를 재시작해야 합니다. 실제 응답은 내부 API를 통해서만 브라우저에 전달됩니다. `.env.local`은 Git에서 제외됩니다. 연동 표와 오류/검증 규칙은 [docs/API_GUIDE.md](docs/API_GUIDE.md)를 참고하세요.

## F1 상태 확인

기본 날짜는 `2026-09-05`이며 샘플 결과가 표시됩니다. 주소 뒤에 아래 쿼리를 붙여 각각 확인할 수 있습니다.

| 상태 | URL 뒤 쿼리 | 기대 결과 |
|---|---|---|
| 성공 | `?date=2026-09-05` | 샘플 영화 목록, 조회 건수·출처·응답 생성 시각 |
| 정상 빈 결과 | `?date=2026-09-06` | 결과 0건, 기간 데이터가 없는 정상 응답이며 오류가 아니라는 안내 |
| 검색 결과 있음 | `?date=2026-09-05&q=바다` | `바다의 노래` 등 제목에 “바다”가 포함된 영화 |
| 검색 결과 없음 | `?date=2026-09-05&q=없는영화` | 전체 데이터는 조회됐지만 검색 일치가 없다는 별도 안내 |
| 로딩 | `?date=2026-09-05&state=loading` | 로딩 표시를 유지. “조회 조건으로 확인”으로 바꾸면 조회를 시작 |
| 오류 | `?date=2026-09-05&state=error` | API 502 데모 오류와 재시도 안내 |

상태 메뉴에서 자동 조회, 로딩, 정상 빈 결과, 오류 미리보기를 바꿀 수도 있습니다. 정상 빈 결과는 조회 날짜를 `2026-09-06`으로 선택하는 방법으로도 확인합니다. demo의 `source`는 샘플 fixture 출처를 설명하며, 표기 시각은 데모 응답 생성 시각입니다. 현재 포트 8000에서 보안 API 서버가 live 모드로 실행 중입니다.

## 범위

- 날짜·일간/주간/주말 선택과 영화명 부분 검색
- 순위·영화명·개봉일·매출·관객수·누적 관객수 목록
- 조회 건수·샘플 출처·응답 생성 시각
- 정상 빈 결과·검색 결과 없음·로딩·오류 구분
- demo 인사이트는 가상 시계열, live 인사이트는 일별 KOBIS Top 10 집계입니다.

`DATA_MODE=live`의 Supabase migration 적용, 서버 비밀값 설정, 캐시 동작 확인 순서는 [docs/API_GUIDE.md](docs/API_GUIDE.md)를 참고하세요. 설정 완료 전에는 DB 연결 없이 KOBIS live 응답으로 fallback합니다. API 키와 Supabase secret을 브라우저 코드에 입력하지 마세요. 배포 전 Vercel Hobby 조건을 확인하세요.
