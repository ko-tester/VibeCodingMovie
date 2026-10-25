# KOBIS Open API 연동 가이드

**범위:** 읽기 전용 KOBIS 호출 → 응답 검증/정규화 → 내부 API 응답. 이 단계에서는 DB 저장과 캐시를 하지 않는다.

API 키는 서버 프로세스가 `.env.local`에서 읽는 `KOBIS_API_KEY`로만 사용한다. 브라우저 응답·로그·문서에는 키나 키를 포함한 외부 URL을 기록하지 않는다. `DATA_MODE`와 키를 바꾼 뒤에는 서버를 재시작한다.

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

금액·관객·순위 값은 JSON 내부에서 문자열로 올 수 있으므로 서버에서 `[0-9]+` 형식인지 확인한 뒤 정수로 바꾼다. 쉼표, 소수점, 부호, 공백만 있는 값은 허용하지 않는다. JSON 응답에서는 안전한 정수로 반환한다. 이 단계에서는 ERD 매핑까지 정하지만 실제 DB 저장은 수행하지 않는다.

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

이 경로는 `DATA_MODE=live`에서 제공된다. 서버는 `endDate`를 포함하는 연속 기간의 각 날짜에 일별 KOBIS API를 한 번씩 호출하며, 동시에 실행하는 외부 요청은 최대 4개다. 모든 날짜 조회와 검증이 성공한 경우에만 200을 반환하고, 일부 날짜만 성공한 합계는 반환하지 않는다. 날짜 수만큼 상위 API 요청(최대 30회)이 발생하며 서버 캐시나 DB 저장은 하지 않는다. 따라서 기간/종료일 조건으로 다시 조회하면 KOBIS를 다시 호출한다.

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

인사이트 요청은 총괄 타임아웃 하나 대신 날짜별 5초 타임아웃을 적용한다. 30일 요청은 최대 4개씩 처리되므로 대기 시간이 길어질 수 있다. 반복 조회 부하를 줄이는 저장·캐시는 다음 단계에서 다룬다.

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

## 저장 전 검증 규칙

이번 단계에서 저장은 하지 않지만, 아래 검증을 모두 통과한 전체 목록만 내부 API 응답에 사용하고 다음 단계의 저장 입력으로 넘긴다.

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
| 정상 빈 목록 | 구조가 유효한 빈 배열은 성공 200, 저장 시에는 조회 기간 행만 두고 실적 행이 0개가 됨 |

## 실행 모드와 검증 방법

- `DATA_MODE=demo`: 이전의 가짜 fixture와 데모용 상태 미리보기를 유지한다. `.env.local`의 키는 사용하지 않는다.
- `DATA_MODE=live`: 서버가 `.env.local`의 `KOBIS_API_KEY`를 읽어 KOBIS를 호출한다. `GET /api/mode`는 모드명만 반환하며 키는 반환하지 않는다.
- live로 실행하려면 `.env.local`에 키가 있는지 확인하고 `DATA_MODE=live`로 서버를 재시작한다. 실제 값을 화면·명령 출력·로그·문서에 붙여 넣지 않는다.
- 현재 기본 로컬 주소는 `http://127.0.0.1:8000/`이다. live F1은 `http://127.0.0.1:8000/api/boxoffice?date=2026-09-06&period=daily` 요청에서, F2는 `/api/insights?endDate=2026-10-24&days=7&limit=10` 요청에서 각각 실제 API 결과를 확인한다. 실패 시 응답의 내부 오류 코드만 확인하고 키나 URL 전체를 복사하지 않는다.
- demo는 `http://127.0.0.1:8002/api/mode`의 `demo` 응답과 `date=2026-09-05` 샘플 목록으로 확인한다. `date=2026-09-06`은 가상 정상 빈 결과를 반환하며, `q=바다`는 일치 항목을 반환하고, 없는 제목은 `total=0`, `totalBeforeSearch>0`이다.
- 이번 검증 결과: live `2026-09-06`은 10건, 첫 항목은 `오디세이`; demo 정상 빈 결과는 0건; demo `바다` 검색은 1건; 일치 제목이 없는 검색은 0건(검색 전 10건). API 오류 미리보기는 502를 반환했다.
- F2 live 추가 확인: 종료일 `2026-10-24`, 7일 요청에서 `daysComplete=7`, 시계열 7일, Top 영화 10개를 반환했고 기간 Top 10 합산 매출은 10,630,796,890원이었다.

## 이번 단계에서 하지 않는 일

- ERD 테이블 생성 및 DB 저장
- 캐시, TTL, 저장본 대조
- 서버/DB 캐시 및 실적 저장
