# KOBIS Open API · Supabase 저장/캐시 가이드

**범위:** KOBIS 호출 → 응답 검증/정규화 → Supabase 저장/캐시 → 내부 API 응답. Supabase SQL은 준비했지만 프로젝트 설정/적용 및 실연동 검증은 사용자가 설정 완료를 알린 뒤 진행한다.

`KOBIS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`는 Python 서버가 `.env.local`에서만 읽는다. 비밀값, Authorization 헤더, 키가 포함된 URL을 화면·로그·문서에 출력하지 않는다. `DATA_MODE`나 키를 바꾼 뒤에는 서버를 재시작한다. Supabase secret key는 RLS를 우회하는 서버용 자격 증명이므로 브라우저에 전달하지 않는다. [Supabase API 키 문서](https://supabase.com/docs/guides/getting-started/api-keys)

공식 서비스는 KOBIS [Open API 서비스 안내](https://www.kobis.or.kr/kobisopenapi/homepg/main/main.do)의 [일별 박스오피스](https://www.kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceInfo.do?serviceId=searchDailyBoxOffice) 및 [주간/주말 박스오피스](https://www.kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceInfo.do?serviceId=searchWeeklyBoxOffice)다. 구현은 JSON REST 응답을 사용한다.

## 요청 파라미터

공통 기본 경로는 `/kobisopenapi/webservice/rest/boxoffice`이며 서버가 기간 유형별 메서드를 선택한다. 인증키는 KOBIS 요청에만 포함되고 내부 API에는 포함되지 않는다.

| 기간 유형 | KOBIS 메서드 | 필수/고정 파라미터 | 의미 |
|---|---|---|---|
| 일간 (`daily`) | `searchDailyBoxOfficeList.json` | `key`, `targetDt`, `itemPerPage=10` | `targetDt`는 조회 기준일 `YYYYMMDD`; 요청당 최대 10개를 받음 |
| 주간 (`weekly`) | `searchWeeklyBoxOfficeList.json` | `key`, `targetDt`, `weekGb=0`, `itemPerPage=10` | 기준일이 속한 주의 월~일 집계 |
| 주말 (`weekend`) | `searchWeeklyBoxOfficeList.json` | `key`, `targetDt`, `weekGb=1`, `itemPerPage=10` | 기준일이 속한 주의 금~일 집계 |

`multiMovieYn`, `repNationCd`, `wideAreaCd`는 첫 연동에서 보내지 않아 전체 영화·국적·지역 기준을 유지한다. 영화명 `q`는 KOBIS 파라미터가 아니며 받은 목록을 검증한 뒤 서버에서 부분 일치로 필터링한다. 요청 형식은 KOBIS의 서비스 정의를 따르며, 실제 계정·응답과 다른 점이 발견되면 구현 전에 이 문서를 갱신한다.

## KOBIS 응답과 내부 응답

KOBIS JSON의 최상위에는 `boxOfficeResult`가 오며, 일간은 `dailyBoxOfficeList`, 주간/주말은 `weeklyBoxOfficeList` 배열에 영화별 항목을 담는다. 응답에는 `boxofficeType`, `showRange` 등이 함께 올 수 있고 주간 응답에는 `yearWeekTime`이 포함될 수 있다. 요청한 `itemPerPage` 범위의 영화 목록을 사용한다.

| KOBIS 필드 | 의미 | 내부 API 필드 | ERD 컬럼 | 변환/규칙 |
|---|---|---|---|---|
| `movieCd` | 영화 코드 | `movieCode` | `movies.movie_code` | trim 후 비어 있지 않은 문자열 |
| `movieNm` | 영화명 | `title` | `movies.movie_name` | trim 후 비어 있지 않은 문자열 |
| `openDt` | 개봉일 | `releaseDate` | `movies.release_date` | `YYYY-MM-DD`를 유지. 빈 문자열은 `null` (ERD에서 NULL 허용) |
| 요청 `period` / `weekGb` | 집계 유형 | `period`, `weekGb` | `box_office_periods.period_type` | `daily`, `weekly`, `weekend`로 정규화 |
| 요청 `targetDt` | 조회 기준일 | `date` | `box_office_periods.base_date` | `YYYYMMDD`를 내부 `YYYY-MM-DD`로 변환 |
| 서버 응답 시각 | 수집 시각 | `collectedAt` | `box_office_periods.collected_at` | 서버가 ISO 8601 시간대로 생성 |
| `rank` | 기간 순위 | `rank` | `box_office_results.rank` | 숫자형 문자열을 정수로 변환, 1~10 |
| `salesAmt` | 해당 기간 매출액(원) | `revenue` | `box_office_results.revenue` | 숫자형 문자열을 정수로 변환, 0 이상 |
| `salesAcc` | 누적 매출액(원) | `totalRevenue` | `box_office_results.total_revenue` | 숫자형 문자열을 정수로 변환, 0 이상 |
| `audiCnt` | 해당 기간 관객수(명) | `audience` | `box_office_results.audience` | 숫자형 문자열을 정수로 변환, 0 이상 |
| `audiAcc` | 누적 관객수(명) | `totalAudience` | `box_office_results.total_audience` | 숫자형 문자열을 정수로 변환, 0 이상 |

금액·관객·순위 값은 JSON 내부에서 문자열로 올 수 있으므로 서버에서 `[0-9]+` 형식인지 확인한 뒤 정수로 바꾼다. 쉼표, 소수점, 부호, 공백만 있는 값은 허용하지 않는다. 검증 후 내부 API에서는 정수로 반환하고, 저장 함수에는 ERD 컬럼에 맞춰 JSONB 값으로 전달한다.

## 내부 API 계약

`GET /api/boxoffice?date=YYYY-MM-DD&period=daily|weekly|weekend&q={optional}`

성공 시 `200`과 다음 구조를 반환한다. `data.movies`에는 정규화된 영화 목록이 온다. 정상 빈 결과는 `movies: []`와 0건 메타데이터를 가진 `200`이며 검색어 불일치와 API 오류는 별도 상태다.

```json
{
  "data": {
    "movies": [
      {
        "movieCode": "영화코드",
        "rank": 1,
        "title": "영화명",
        "releaseDate": "2026-09-01",
        "revenue": 123456789,
        "totalRevenue": 987654321,
        "audience": 12345,
        "totalAudience": 678901
      }
    ]
  },
  "meta": {
    "mode": "live",
    "date": "2026-09-06",
    "period": "daily",
    "query": null,
    "total": 1,
    "totalBeforeSearch": 1,
    "source": "KOBIS Open API",
    "collectedAt": "2026-09-07T01:10:00+09:00"
  }
}
```

API 키, 외부 요청 URL, 원문 오류 본문은 응답에 포함하지 않는다. 실제 데이터가 0건이면 정상 `200` 빈 배열로 응답한다.

### 기간 인사이트

`GET /api/insights?endDate=YYYY-MM-DD&days=7|14|30&limit=5|10`

이 경로는 `DATA_MODE=live`에서 제공된다. 서버는 `endDate`를 포함하는 연속 기간의 각 날짜를 `get_live_box_office` 경로로 조회하며, 유효한 Supabase 저장본이 있으면 재사용하고 miss/만료/저장소 오류일 때만 KOBIS를 호출한다. 동시에 실행하는 외부 요청은 최대 4개다. 모든 날짜 조회와 검증이 성공한 경우에만 200을 반환하고, 일부 날짜만 성공한 합계는 반환하지 않는다. 저장본이 전혀 없을 때에는 날짜 수만큼 상위 API 요청(최대 30회)이 발생할 수 있다.

```json
{
  "data": {
    "series": [{"date":"2026-09-01","revenue":123456789,"audience":12345}],
    "topMovies": [{"movieCode":"20260001","rank":1,"title":"예시 영화","releaseDate":"2026-08-01","revenue":123456789,"audience":12345,"share":0.42}],
    "summary": {"totalRevenue":123456789,"totalAudience":12345,"averageRevenue":17636684}
  },
  "meta": {
    "mode":"live","source":"KOBIS Open API","rangeStart":"2026-08-26","rangeEnd":"2026-09-01",
    "daysRequested":7,"daysComplete":7,"collectedAt":"2026-09-02T01:10:00+09:00"
  }
}
```

`series.revenue`와 summary는 각 날짜 KOBIS 응답에 포함된 **상위 10개 영화의 합계**다. 전체 극장 매출 합계로 해석하지 않는다. 기간 Top 영화의 매출·관객은 해당 기간 중 일간 순위 10위 안에 든 날짜들의 실적을 영화 코드별로 합산한다. `share`는 그 기간 Top 10 합산 매출에서 해당 영화가 차지하는 비율이다. demo 모드에서는 기존 가상 인사이트 데이터를 유지하며 이 경로를 호출하지 않는다.

| HTTP | 내부 오류 코드 | 인사이트 처리 |
|---|---|---|
| 400 | `INVALID_DATE`, `INVALID_RANGE`, `INVALID_LIMIT` | 종료 날짜, 7/14/30일, Top 5/10 검증 실패 |
| 502 | `INSIGHTS_INCOMPLETE`, `INSIGHTS_VALUE_OUT_OF_RANGE` | 한 날짜라도 응답/수치 검증 실패 또는 합계가 표시 범위를 넘음. 부분 집계는 반환하지 않음 |
| 503 | `INSIGHTS_LIVE_ONLY`, `INSIGHTS_INCOMPLETE` | live 모드가 아니거나 호출 한도/설정 문제로 전체 기간을 확보하지 못함 |
| 504 | `INSIGHTS_INCOMPLETE` | 날짜별 KOBIS 요청 타임아웃. 전체 집계를 실패 처리 |

인사이트 요청은 총괄 타임아웃 하나 대신 날짜별 KOBIS 5초 제한과 Supabase RPC 제한을 적용한다. 30일 요청은 최대 4개씩 처리되므로 대기 시간이 길어질 수 있다. 날짜별 캐시는 `/api/boxoffice`와 같은 24시간/1시간 TTL 정책을 따른다.

## 오류 코드 매핑

| HTTP | 내부 오류 코드 | 조건 | 클라이언트 처리 |
|---|---|---|---|
| 400 | `INVALID_DATE`, `INVALID_PERIOD`, `QUERY_TOO_LONG` | 내부 입력 누락/형식 오류 또는 허용되지 않은 기간 유형 | 입력 수정 안내 |
| 502 | `KOBIS_UPSTREAM_HTTP_ERROR`, `KOBIS_CONNECTION_FAILED` | KOBIS 비정상 HTTP 응답 또는 연결 실패 | 제공처 오류 안내와 재시도 |
| 502 | `KOBIS_INVALID_JSON`, `KOBIS_INVALID_RESPONSE`, `KOBIS_INVALID_DATA`, `KOBIS_REJECTED_REQUEST` | JSON 파싱 실패, 구조/필수 필드/자료형/범위 불일치 또는 KOBIS `faultInfo` | 오류 상태. 빈 결과나 성공으로 바꾸지 않음 |
| 503 | `DATA_MODE_DISABLED`, `KOBIS_API_KEY_MISSING`, `KOBIS_AUTH_FAILED` | 서비스 모드/키 미설정 또는 인증 거부 | 서버 설정 점검 안내. 키 값은 노출하지 않음 |
| 503 | `KOBIS_RATE_LIMITED` | KOBIS HTTP 429 | `Retry-After`를 포함하고 재시도를 늦춤 |
| 504 | `KOBIS_TIMEOUT` | 외부 호출이 5초 제한을 넘김 | 타임아웃 안내와 사용자 재시도 |

정상 빈 응답은 오류 코드가 아니다. API 응답 파싱·검증 실패는 부분 데이터를 성공처럼 반환하지 않고 전체 요청을 실패 처리한다. 오류 메시지와 서버 출력에는 인증 키, 외부 URL의 query string, 예외 원문을 넣지 않는다.

## Supabase 테이블·함수·보안

Migration 파일은 [`supabase/migrations/202610250001_box_office_cache.sql`](../supabase/migrations/202610250001_box_office_cache.sql)이다. 세 테이블과 컬럼은 [`ERD.md`](../ERD.md) 정의 그대로 만들며 새 테이블·컬럼을 추가하지 않는다.

| SQL 부분 | 쉬운 설명 |
|---|---|
| `movies` | KOBIS 영화 코드별 이름과 개봉일을 한 번 보관한다. |
| `box_office_periods` | `period_type + base_date`마다 수집 시각, 출처, 만료 시각을 한 행에 보관한다. 이 행이 있어야 성공한 빈 결과도 캐시할 수 있다. |
| `box_office_results` | 기간 행과 영화 행을 연결하고 순위·매출·관객·누적 수치를 보관한다. 같은 기간 조회를 갱신할 때 이전 결과를 모두 지우고 새 결과를 넣는다. |
| Row Level Security와 권한 | 세 테이블에 RLS를 켜고 브라우저의 `anon`/`authenticated` 역할 접근을 막는다. 두 함수 실행 권한은 서버의 `service_role`에만 준다. |
| `save_box_office_period` | 영화 → 기간 → 실적 순으로 한 DB 트랜잭션에서 저장한다. 중간 SQL 오류가 나면 트랜잭션 전체가 롤백된다. 동일 기간 쓰기는 advisory lock으로 한 번에 하나씩 처리하고 `collected_at`이 더 오래된 요청은 저장하지 않는다. |
| `read_box_office_period` | 기간 종류와 기준일로 기간 행과 영화·실적을 읽는다. 만료 여부는 서버가 판정한다. |

저장 RPC에는 이미 검증된 정규화 JSON을 보낸다. 숫자, 필수 영화 정보, 최대 10건, 순위/영화 중복도 DB 함수에서 다시 확인한다. Top 10에서 빠진 영화의 실적 행은 삭제된다. 새 요청 목록이 빈 배열이면 기존 실적은 제거하고 기간 행은 유지한다.

원문 KOBIS JSON을 보관할 컬럼은 ERD에 없으므로 스키마를 늘리지 않는다. 검증용 원문은 `.boxoffice-source/` 아래 별도 로컬 파일로 저장한다. 이 디렉터리는 `.gitignore`에 포함되고 정적 서버도 숨김 경로로 제공하지 않는다. 파일은 DB 트랜잭션과 별도이므로 파일 저장에 실패하면 API 경고가 표시되고 `verify:data`는 비교 실패로 끝난다. 임시 파일 시스템을 쓰는 배포 환경에서는 영구 보존을 보장하지 않는다.

## 저장 우선 조회와 만료 정책

동일한 `(period_type, base_date)` 요청은 다음 순서로 처리한다.

1. `read_box_office_period`로 Supabase 저장본을 읽는다.
2. `expires_at`이 현재보다 뒤면 저장본을 반환하고 KOBIS를 호출하지 않는다.
3. 저장본이 없거나 만료되면 서버가 KOBIS를 한 번 조회하고 기존 검증을 거친다.
4. 정상 결과는 24시간, 성공한 빈 결과는 1시간 동안 유효하게 `expires_at`을 설정한다.
5. 원문 보관 파일을 기록한 뒤 `save_box_office_period`를 호출한다. 정상 저장이면 이번 응답은 KOBIS 출처, 다음 유효 요청은 Supabase 캐시 출처로 표시한다.

`meta.cache.status`는 `hit`, `miss_saved`, `miss_write_failed`, `unconfigured`, `stale_request_discarded` 중 하나를 반환한다. 첫 조회 출처는 `KOBIS Open API`, DB에서 읽은 조회 출처는 `저장된 데이터 (Supabase)`로 표시한다.

| 상황 | 응답 동작 | 사용자 경고 |
|---|---|---|
| 캐시 읽기 성공/유효 | HTTP 200, DB 저장본 반환, KOBIS 미호출 | `출처: 저장된 데이터 (Supabase)`; 별도 경고 없음 |
| 캐시 없음/만료 | KOBIS 조회 후 DB 저장 시도 | `출처: KOBIS Open API`; 정상 저장이면 경고 없음 |
| Supabase 설정 누락 | KOBIS로 우회, 저장 시도 없음, HTTP 200 | “Supabase 설정이 없어 저장 캐시 없이 KOBIS에서 조회했습니다.” |
| 저장소 읽기 실패 | KOBIS로 우회하고 저장도 시도. KOBIS 성공이면 HTTP 200 | “저장 결과를 읽지 못해 KOBIS에서 새로 조회했습니다.” |
| 저장 실패 | 검증된 KOBIS 응답을 HTTP 200으로 반환. 다음 요청은 다시 KOBIS를 조회 | “KOBIS 조회는 성공했지만 저장하지 못했습니다. 결과는 이번 응답에만 사용합니다.” |
| KOBIS 실패 | 만료 캐시는 사용하지 않고 실제 상위 오류에 맞춰 502/503/504 | 데이터 조회 실패 안내. 저장소 읽기도 실패했다면 함께 경고 표시 |
| 오래된 동시 요청 | DB 함수가 더 새로운 `collected_at`을 보존. 최신 저장본이 유효하면 그 값 반환 | 최신 캐시를 사용했다는 상태 표시 |

DB 읽기·쓰기 세부 오류 본문과 비밀값은 응답·로그에 남기지 않는다. 저장 장애는 `meta.warning`으로 전달해 목록의 출처 아래 경고로 보여준다. 정상 빈 결과는 계속 HTTP 200이며 1시간 캐시된다.

## `verify:data` 저장본 검증 명령

```cmd
npm run verify:data -- --date=YYYY-MM-DD --period=daily
```

`--period`에는 `daily`, `weekly`, `weekend`를 쓸 수 있다. 이 명령은 DB의 `read_box_office_period` 함수만 호출해 저장본을 읽고, 로컬 원문 파일을 다시 정규화해 대조한 다음, 같은 날짜/기간의 KOBIS API를 **한 번** 새로 호출해 비교한다. DB 데이터는 쓰거나 수정하지 않는다.

| 종료 코드 | 결과 |
|---:|---|
| 0 | 저장 당시 원문 ↔ DB, 새 KOBIS ↔ DB가 모두 일치 |
| 1 | 값이 다르거나 DB/원문/KOBIS 중 하나를 비교하지 못함 |
| 2 | DB에 해당 날짜/기간의 저장본이 아직 없음. 신규 수집 후 다시 실행 |

명령 출력은 날짜, 행 수, 일치 여부, 안전한 내부 오류 코드만 보여준다. API 키, Supabase secret, URL query, 예외 원문은 출력하지 않는다.

## Supabase 설정 순서

실제 DB 연결 확인은 프로젝트·migration·환경 설정을 마친 뒤 진행한다. 설정 완료 전에는 DB 연결과 `verify:data`를 실행하지 않는다.

1. Supabase Dashboard에서 프로젝트를 만든다. 프로젝트가 준비되면 Project URL과 서버 전용 Secret API key가 필요하다.
2. Dashboard의 **SQL Editor**에서 새 쿼리를 열고 [`supabase/migrations/202610250001_box_office_cache.sql`](../supabase/migrations/202610250001_box_office_cache.sql) 전체를 실행한다. 성공 후 세 테이블과 두 RPC 함수가 만들어졌는지 확인한다. Supabase는 SQL Editor를 통한 SQL 실행을 지원한다. [Supabase SQL Editor 안내](https://supabase.com/features/sql-editor)
3. 프로젝트의 **Connect** 또는 **Settings → API Keys** 화면에서 Project URL과 Secret key를 찾는다. 브라우저용 Publishable key를 사용하지 않는다. Secret key는 RLS를 우회하므로 오직 서버에서만 사용한다. [Supabase API 키 안내](https://supabase.com/docs/guides/getting-started/api-keys)
4. 프로젝트 루트 `.env.local`에 다음 변수 이름을 추가한다. 오른쪽 실제 값은 로컬 파일에만 입력하고, 채팅·문서·로그·화면 공유에 붙여 넣지 않는다. 기존 `DATA_MODE=live`, `KOBIS_API_KEY` 설정은 유지한다.

   ```dotenv
   SUPABASE_URL=<Project URL>
   SUPABASE_SECRET_KEY=<Secret API key>
   ```

5. 서버를 재시작한다. 먼저 F1에서 같은 날짜·기간을 한 번 조회하고, 다시 같은 조건을 조회한다. 첫 결과의 출처가 `KOBIS Open API`, 다음 결과가 `저장된 데이터 (Supabase)`인지 화면 상단에서 확인한다. 정확한 상태는 API 응답 `meta.cache.status`에서 각각 `miss_saved`, `hit`으로 확인한다.
6. 첫 조회에서 저장된 날짜로 `npm run verify:data -- --date=YYYY-MM-DD --period=daily`를 실행한다. 이 명령은 DB를 읽기만 하고, KOBIS 비교용으로 한 번 새 요청을 보낸다.

## 저장 전 검증 규칙

KOBIS 응답은 DB 저장 전에 아래 검증을 모두 통과해야 한다. 일부 항목이 잘못되면 목록 전체를 버리고 저장하지 않는다.

| 대상 | 검증 |
|---|---|
| 요청 `date` | 실제 달력 날짜이며 정확히 `YYYY-MM-DD` 형식 |
| 요청 `period` | `daily`, `weekly`, `weekend` 중 하나 |
| KOBIS 최상위 응답 | JSON object, `boxOfficeResult` object, 선택한 기간의 결과 필드가 array |
| 목록 크기 | 응답 영화 수가 요청 상한 10 이하 |
| 영화 코드/이름 | `movieCd`, `movieNm`이 문자열이고 trim 후 비어 있지 않음 |
| 개봉일 | 빈 값은 NULL. 값이 있으면 실제 날짜 `YYYY-MM-DD` |
| 순위 | 문자열 정수, 1~10 |
| 매출·관객 수 | 문자열 정수, 0~`BIGINT` 최댓값 이하. 음수·소수·쉼표·비숫자 금지 |
| 목록 전체 | 필수 항목 하나라도 이상하면 부분 결과를 반환하지 않고 `KOBIS_INVALID_DATA` |
| 정상 빈 목록 | 구조가 유효한 빈 배열은 성공 200. 기간 행은 저장하고 실적 행은 0개로 두며 TTL은 1시간 |

## 실행 모드와 검증 방법

- `DATA_MODE=demo`: 이전의 가짜 fixture와 데모용 상태 미리보기를 유지한다. `.env.local`의 키는 사용하지 않는다.
- `DATA_MODE=live`: 서버가 `.env.local`의 `KOBIS_API_KEY`를 읽어 KOBIS를 호출한다. `GET /api/mode`는 모드명만 반환하며 키는 반환하지 않는다.
- live로 실행하려면 `.env.local`에 키가 있는지 확인하고 `DATA_MODE=live`로 서버를 재시작한다. 실제 값을 화면·명령 출력·로그·문서에 붙여 넣지 않는다.
- 현재 기본 로컬 주소는 `http://127.0.0.1:8000/`이다. live F1은 `http://127.0.0.1:8000/api/boxoffice?date=2026-09-06&period=daily` 요청에서, F2는 `/api/insights?endDate=2026-10-24&days=7&limit=10` 요청에서 각각 실제 API 결과를 확인한다. 실패 시 응답의 내부 오류 코드만 확인하고 키나 URL 전체를 복사하지 않는다.
- demo는 `http://127.0.0.1:8002/api/mode`의 `demo` 응답과 `date=2026-09-05` 샘플 목록으로 확인한다. `date=2026-09-06`은 가상 정상 빈 결과를 반환하며, `q=바다`는 일치 항목을 반환하고, 없는 제목은 `total=0`, `totalBeforeSearch>0`이다.
- 이번 검증 결과: live `2026-09-06`은 10건, 첫 항목은 `오디세이`; demo 정상 빈 결과는 0건; demo `바다` 검색은 1건; 일치 제목이 없는 검색은 0건(검색 전 10건). API 오류 미리보기는 502를 반환했다.
- F2 live 추가 확인: 종료일 `2026-10-24`, 7일 요청에서 `daysComplete=7`, 시계열 7일, Top 영화 10개를 반환했고 기간 Top 10 합산 매출은 10,630,796,890원이었다.

## 현재 연결 검증 상태

- Migration SQL, 서버 RPC 저장/읽기, 캐시 처리, 원문 아카이브, `verify:data` 코드는 작성했다.
- 2026-10-25 실연동 확인: `2026-09-06 / daily` 첫 요청은 KOBIS에서 10건을 받아 `miss_saved`로 저장했고, 두 번째 요청은 `저장된 데이터 (Supabase)` 출처로 10건을 `hit` 반환했다.
- 같은 날짜의 `npm run verify:data -- --date=2026-09-06 --period=daily`는 저장 당시 원문 ↔ DB, 새 KOBIS ↔ DB 모두 10건 일치로 종료 코드 `0`을 반환했다. 검증 명령은 DB를 수정하지 않는다.
- 별도 프로세스의 `DATA_MODE=demo` 확인: 기본 목록 10건, `q=바다` 1건, 없는 영화 검색 0건(검색 전 10건), `2026-09-06` 정상 빈 결과 0건. `.env.local`을 변경하지 않고 검사했다.
- 이 확인에서는 API key와 Supabase secret 값을 출력하거나 로그에 남기지 않았다.
