# 영화 박스오피스 인사이트 구현 계획서

**상태:** Supabase 저장·캐시 코드와 migration 작성 완료. 실제 프로젝트 설정/연결 검증은 사용자 설정 완료 후 진행.
**기준 문서:** `../PRD.md`, `../ARCHITECTURE.md`, `../AGENTS.md`

## 0. 범위와 전제

F1과 F2 화면은 `index.html`, `styles.css`, `app.js`로 구성되고 `server.py`의 내부 API를 호출한다. `DATA_MODE=demo`는 기존 가상 fixture를, `DATA_MODE=live`는 서버 전용 KOBIS/Supabase 키를 사용한다. F1은 DB cache-first 단일 조건 조회, F2는 각 날짜를 같은 cache-first 경로로 조회해 메모리 집계한다. DB 함수와 migration은 작성했으며 실제 Supabase 적용/검증은 사용자 설정 후 진행한다.

요청에 따라 Supabase를 정규화된 KOBIS 응답의 저장·캐시로 사용한다. `save_box_office_period`가 세 테이블을 단일 DB 트랜잭션으로 교체하고 `read_box_office_period`가 조회한다. DB 오류 시 만료되지 않은 결과만 캐시로 사용하고, miss/read error에서는 KOBIS로 우회한다. 공개 목록 데이터만 저장하며 API 키는 저장하지 않는다. ERD에 원문 컬럼이 없으므로 검증용 원문 JSON은 `.boxoffice-source/`에 로컬 비공개 파일로 보관한다.

아래 TTL과 시간 제한은 초기 제안값이다. 실제 KOBIS 응답 필드, 일간·주간·주말 요청 규칙, 호출 제한·이용 조건, DB 저장 허용 범위는 구현 전에 공식 문서와 계정 조건으로 확인한다.

## 1. 화면 상태

| 상태 | 발생 조건 | 화면 동작 | 내부 결과 |
|---|---|---|---|
| 초기/대기 | 아직 조회하지 않았거나 조건을 고르는 중 | 날짜와 기간 선택 안내 | API 호출 없음 |
| 로딩 | 목록 또는 인사이트 요청 중 | 스켈레톤/진행 표시, 중복 조회 방지 | 요청 중임을 표시하고 제한 시간 내 응답 대기 |
| 성공 | 유효한 데이터가 1건 이상 | 표·차트·요약 지표 표시, 조회 시점 표기 | `200`, 정규화된 `data`와 `meta` |
| 정상 빈 결과 | 조회는 성공했으나 해당 조건의 영화가 0건 | “선택한 조건의 데이터가 없습니다”, 날짜·기간 변경 안내 | `200`, `data.movies: []`, `meta.total: 0` |
| 검색 결과 없음 | 전체 조회는 성공했지만 `q` 검색 후 일치 0건 | “검색 결과가 없습니다”, 검색어 지우기 | `200`, 빈 `movies`; 검색어와 원본 결과 수를 `meta`에 표시 |
| 인사이트 정상 빈 결과 | 요청 기간의 날짜별 조회는 모두 성공했지만 합산 대상 박스오피스 데이터가 0건 | “선택한 기간에 표시할 데이터가 없습니다”, 기간 변경 안내 | `200`, 빈 `series`와 `topMovies`, `meta.daysComplete === meta.daysRequested` |
| 인사이트 데이터 부족 | 인사이트 기간 중 일부 날짜 조회가 아직 준비되지 않음 | 부분 합계를 완전한 수치처럼 표시하지 않고 누락 일수와 다시 시도 안내 | `503 INCOMPLETE_DATA` 또는 별도 `incomplete` 상태; `daysComplete < daysRequested` |
| 오류 | 잘못된 입력, 외부 API 오류/형식 오류, 시간 초과, 서비스 설정 오류 | 오류 원인에 맞는 안내와 재시도; 정상 빈 결과로 표시하지 않음 | `400`, `502`, `503`, `504` 등과 공통 `error` 구조 |
| 캐시 저장 실패 | 원본 KOBIS 응답은 유효하지만 DB RPC 저장 실패 | 신선한 원본 결과를 표시하되 저장되지 않았음을 경고 | `200`으로 유효한 원본 반환, `meta.cache.persisted: false`; 민감값 없이 안전한 내부 코드만 기록 |

검색어가 비어 있으면 검색 결과 없음 상태가 아니라 전체 조회 결과를 표시한다. 이전 조건의 결과를 새 조건의 결과처럼 남기지 않으며, 로딩 중에는 이전 데이터가 보일 경우 이전 조회 조건임을 명확히 표시한다.

## 2. 계층별 책임

| 계층 | 책임 | 하지 않는 일 |
|---|---|---|
| 화면(브라우저) | 날짜·기간·검색어 입력, 내부 API 호출, 로딩/성공/빈 결과/검색 결과 없음/오류 상태 표현, 단위와 현지화된 숫자 표시, 인사이트 범위 및 Top 개수 선택 | KOBIS 직접 호출, API 키·DB 키 보관, KOBIS 원문 파싱, 미확인 값을 0으로 대체, 기간 매출을 임의 추정 |
| 내부 API(서버) | 입력 검증, 날짜·기간 캐시 조회, 서버 비밀값 확인, KOBIS 호출 및 시간 제한, 응답 스키마·숫자 검증/정규화, 검색 및 집계, 오류 코드 변환, DB 원자적 저장, 출처·시각 기록 | 브라우저에 외부 키 전달, 오류/부분 결과를 정상 성공으로 위장 |
| 데이터베이스 | ERD의 세 테이블에 영화·조회 기간·기간별 실적을 원자적으로 저장하고, 기간별 만료 시각과 저장본을 읽음 | 계정·개인정보 저장, KOBIS 원문/API 키 저장, 만료된 캐시를 최신 결과인 것처럼 반환 |

DB는 조회 캐시로 사용하며, KOBIS 실적의 원본 기준은 외부 응답이다. DB 저장본은 유효기간 안에서만 사용한다. 사용자별 데이터나 계정은 저장하지 않는다.

## 3. 내부 API 계약

### 박스오피스 목록

`GET /api/boxoffice?date=YYYY-MM-DD&period=daily|weekly|weekend&q={optional}`

### 기간 인사이트

`GET /api/insights?endDate=YYYY-MM-DD&days=7|14|30&limit=5|10`

두 API 모두 외부 KOBIS 키를 받지 않는다. `q`는 서버에서 공백을 정리한 뒤 영화명 부분 일치로 적용한다. 캐시 식별자는 ERD의 `(period_type, base_date)`이며, 검색은 저장된 전체 목록에 적용한다.

#### 요청 파라미터

| API | 파라미터 | 검증 및 의미 |
|---|---|---|
| `/api/boxoffice` | `date` | 필수. 실제 달력 날짜인 `YYYY-MM-DD`; 날짜 형식 오류는 400 |
| `/api/boxoffice` | `period` | 필수. `daily`, `weekly`, `weekend`만 허용. KOBIS 공식 파라미터 매핑은 구현 전에 확인 |
| `/api/boxoffice` | `q` | 선택. trim 후 부분 검색. 길이 상한을 서버에서 적용(초기 제안 100자) |
| `/api/insights` | `endDate` | 필수. 집계 구간 마지막 날짜, `YYYY-MM-DD` |
| `/api/insights` | `days` | 필수. `7`, `14`, `30` 중 하나 |
| `/api/insights` | `limit` | 필수. `5`, `10` 중 하나 |

#### 성공 응답 구조

목록 API의 응답 예시. 금액과 관객 수는 서버가 검증한 뒤 JSON 숫자로 반환한다.

```json
{
  "data": {
    "movies": [
      {
        "rank": 1,
        "title": "예시 영화",
        "releaseDate": "2026-10-01",
        "revenue": 123456789,
        "audience": 12345,
        "totalAudience": 678901
      }
    ]
  },
  "meta": {
    "requestId": "req_example",
    "date": "2026-10-24",
    "period": "daily",
    "query": null,
    "total": 1,
    "totalBeforeSearch": 10,
    "source": "KOBIS Open API",
    "collectedAt": "2026-10-24T12:00:00Z",
    "cache": {
      "status": "miss_saved",
      "expiresAt": "2026-10-25T12:00:00Z",
      "persisted": true
    }
  }
}
```

`meta.total`은 검색 적용 후 개수이고 `meta.totalBeforeSearch`는 검색 전 개수다. 정상 빈 결과는 `200`과 `data.movies: []`, 두 개수가 모두 0인 응답이다. 검색 결과 없음도 `200`이지만 `meta.query`가 설정되어 `total: 0`, `totalBeforeSearch > 0`이다. 이 둘은 오류 응답이 아니다.

인사이트 성공 응답의 `data`는 `series: [{date, revenue, audience}]`, `topMovies: [{rank, title, revenue, audience, share}]`, `summary: {totalRevenue, totalAudience, averageRevenue}`를 포함한다. 현재 F2 `meta`에는 `mode`, `source`, `rangeStart`, `rangeEnd`, `daysRequested`, `daysComplete`, `collectedAt`, 필요 시 `warning`이 있다. 저장소 source는 날짜별 조회 결과를 종합해 표시한다. 기간의 모든 날짜가 확인되지 않으면 완전한 집계 성공으로 반환하지 않는다.

#### 실패 응답과 HTTP 코드

```json
{
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "데이터 제공처 응답 시간이 초과되었습니다.",
    "retryable": true,
    "details": null
  },
  "meta": { "requestId": "req_example", "coverage": null }
}
```

| HTTP | 사용 조건 | 예시 코드 | 화면 처리 |
|---|---|---|---|
| 400 | 필수 파라미터 누락, 형식 오류, 허용되지 않은 기간·범위 | `INVALID_DATE`, `INVALID_PERIOD`, `INVALID_RANGE` | 입력 수정 안내. 자동 재시도하지 않음 |
| 502 | KOBIS 비정상 응답, 잘못된 JSON/스키마, 숫자 문자열 검증 실패, 불완전한 상위 응답 | `UPSTREAM_INVALID_RESPONSE`, `UPSTREAM_BAD_GATEWAY` | 제공처 오류 안내와 사용자 재시도 |
| 503 | API 키 미설정, 서비스 비활성, 상위 제공처 호출 한도/회로 차단, 인사이트 기간의 필수 날짜 미확보 | `SERVICE_NOT_CONFIGURED`, `UPSTREAM_UNAVAILABLE`, `INCOMPLETE_DATA` | 잠시 후 재시도 안내; `INCOMPLETE_DATA`는 `error.details`/`meta.coverage`에 필요한 일수와 확보 일수를 담음; `Retry-After`가 있으면 표시 |
| 504 | KOBIS 요청이 상위 시간 제한 초과 | `UPSTREAM_TIMEOUT` | 재시도 안내, 빈 결과로 취급하지 않음 |
| 500 | 예상하지 못한 서버 오류 또는 내부 집계 오류 | `INTERNAL_ERROR` | 일반 오류 안내와 요청 ID 제공 |

DB 캐시 읽기/쓰기만 실패하고 KOBIS 응답이 유효하면 200과 원본 데이터를 반환한다. 이때 `meta.cache.persisted`를 `false`로 설정하고 화면에 안전한 경고를 표시한다. KOBIS까지 실패하면 해당 상위 호출의 502/503/504 오류를 반환하며, 읽기 실패 경고가 있으면 오류 `meta.warning`에 함께 담는다.

## 4. 요청 처리, 만료 기간, 시간 제한

### 처리 순서

1. **입력 검증:** URL 파라미터의 날짜, 기간 enum, `days`, `limit`, 검색어 길이와 문자를 검사한다. 실패 시 `400`; 캐시·외부 호출·DB 쓰기는 하지 않는다.
2. **캐시 조회:** 목록 API는 `(period_type, base_date)`로 `read_box_office_period`를 호출한다. `expiresAt > now`면 저장본을 반환하고 외부 호출은 생략한다. 검색어는 캐시 키에 넣지 않고 읽은 전체 목록에 적용한다. 인사이트는 날짜별 목록 API와 같은 읽기 경로를 사용한다.
3. **외부 호출:** 저장본이 없거나 만료됐거나 DB 읽기에 실패한 경우에만 서버에서 KOBIS를 호출한다. 허용된 파라미터로 요청하고 원문 응답을 필드별로 검증한다. 숫자 문자열은 누락·비숫자·범위를 검사한 후 변환한다. 실패하면 502/503/504로 종료하고 잘못된 응답을 저장하지 않는다.
4. **저장:** 정규화된 전체 목록(검색어 적용 전)을 `save_box_office_period` 한 번으로 저장한다. 함수 안에서 같은 기간 잠금과 `collected_at` 비교를 한 뒤 영화 → 기간 → 실적 순서로 저장하고 기존 실적을 통째로 교체한다. DB 쓰기가 실패하면 신선한 유효 응답을 계속 전달하되 캐시 미저장 경고를 표시한다.
5. **저장 결과 및 대조:** 각 요청에서 원문·저장본·신선 KOBIS 3자 비교를 반복하지 않는다. 필요할 때 `npm run verify:data -- --date=YYYY-MM-DD --period=daily`가 DB 읽기 RPC와 저장 당시 원문 파일을 읽고, 신선 KOBIS를 한 번 조회해 세 값을 비교한다.
6. **검색·응답:** 서버에서 `q`를 적용하고, 정규화된 `data`와 출처·조회 시각·캐시 상태를 담은 `meta`를 반환한다. 정상 결과 0건은 200으로 끝낸다.

캐시 적중 경로에는 외부 호출과 저장 단계가 없다. 저장·대조는 캐시 미스/만료 경로에서만 수행한다. 오래된 캐시는 이 초안에서 stale 응답으로 대체하지 않는다. 상위 호출이 실패하면 PRD에 따라 오류 상태를 보여준다.

### 초기 운영값 제안

| 설정 | 초기값 제안 | 만료/시간 초과 시 동작 |
|---|---:|---|
| 성공 응답 캐시 TTL | 24시간 | 만료 후 KOBIS 재조회 |
| 정상 빈 결과 캐시 TTL | 1시간 | 빈 결과도 기간 행으로 저장하되 더 짧게 만료 |
| 원문 응답 보존 | `.boxoffice-source/` 로컬 비공개 파일 | ERD에 원문 컬럼을 추가하지 않음. 휘발성 배포 파일시스템에서는 `verify:data`의 원문 비교가 불가능할 수 있음 |
| 스냅샷 보존 기간 | 만료 데이터 정리 정책 미구현 | `expires_at`으로 유효 여부를 판정하며, 만료 행/영화 마스터 정리는 별도 운영 작업 |
| KOBIS 호출 제한 시간 | 5초 | 초과하면 504. 자동 반복 재시도는 하지 않음 |
| Supabase 읽기 RPC | 4초 | 실패하면 KOBIS로 우회하고 경고를 반환 |
| Supabase 저장 RPC | 8초 | 실패해도 검증된 KOBIS 결과를 반환하고 저장 실패 경고를 표시 |
| 내부 API 총 제한 시간 | 현재 별도 총괄 timeout 없음 | KOBIS 5초 및 Supabase RPC 제한을 개별 적용; F2 최대 30일은 응답이 더 오래 걸릴 수 있음 |
| 동시 같은 기간 저장 | advisory transaction lock 및 `collected_at` 비교 | DB 저장은 직렬화하고 오래된 요청은 거절; 동시에 시작한 KOBIS 조회 자체는 중복될 수 있음 |

수치는 서비스 약속이 아니라 구현 시작을 위한 제안값이다. KOBIS의 실제 제한·갱신 특성과 Supabase Free의 현재 저장 한도 및 정책을 확인해 확정하고, 확인 날짜와 출처를 PRD/ADR에 기록한다.

인사이트는 보존 기간 내 일간 스냅샷을 이용해 집계한다. 초기 구축에서 누락 날짜를 채울 때에는 KOBIS 호출 제한을 확인하고 제한된 속도의 백필 작업으로 수행한다. 구간 데이터가 준비되지 않으면 부분 합계를 완전한 결과처럼 표시하지 않고 `INCOMPLETE_DATA`로 응답한다. 백필 완료 전에 차트에 임의의 생성값을 연결하지 않는다.

## 5. 우선순위와 완료 기준

| 순서/우선순위 | 작업 | 완료 기준 |
|---|---|---|
| 0 · 결정 사항 | KOBIS 필드·일간/주간/주말 파라미터·요청 제한 확인, API 키 준비, DB 캐시 도입 여부와 저장 허용 범위 결정, Vercel Hobby 및 Supabase Free 조건 확인 | 실제 공식 규칙과 제품 가정이 분리 기록되고, DB 도입 결정이 PRD/ADR에 반영됨 |
| 1 · P0 API 계약 | 요청/응답 타입, 필수 필드, 오류 형식, 캐시 키·정규화 스키마 정의 | 위 두 GET 계약과 `data/meta` 및 `error/meta` 구조가 PRD·ARCHITECTURE와 일치하고 클라이언트에 비밀값 필드가 없음 |
| 2 · P0 내부 API와 KOBIS 어댑터 | **완료:** 서버 측 입력 검증, API 키 읽기, 5초 요청 제한, KOBIS 호출, 문자열 숫자 검증/정규화, 오류 매핑 | live 날짜 2026-09-06 조회에서 10건 반환 확인. 오류/빈 결과 구분 및 비밀값 비노출 확인 |
| 3 · P0 스냅샷 캐시 | **코드/migration 작성 완료, Supabase 적용 대기:** ERD 세 테이블, 24h/1h TTL, 트랜잭션 RPC, 저장본 읽기, DB 실패 시 KOBIS 우회 | Migration을 적용하고 `.env.local`을 설정한 뒤 실제 hit/miss·만료·원자성 확인 |
| 4 · P0 목록 화면 연결 | **완료:** 데모 fixture 또는 live 내부 API 결과를 목록에 표시, 실제 날짜·기간·검색 조건 전달 | 날짜·기간·검색 조건이 API에 반영됨. demo 상태와 live 실데이터 확인 |
| 5 · P0 인사이트 | **구현:** 7·14·30일 live 일간 집계, Top 5/10, 총매출·관객·일평균 및 기간 누락 오류 | 전체 날짜 조회가 성공해야 집계를 반환하며, 각 날짜는 Supabase 캐시 miss일 때만 상위 API 호출 |
| 6 · P1 운영 준비 | 요청/오류/캐시 지표, 비밀값 환경 설정, 보존 정책, 배포 조건 기록 | 로그에 키나 불필요한 원문이 없고, 배포 조건·확인일·한도가 기록되며 무료 한도 초과 대응이 정해짐 |

기존 `AGENTS.md`에 따라 사용자가 테스트나 검증을 요청하지 않은 경우 테스트를 추가하거나 실행하지 않는다. 각 완료 기준은 구현 시 필요한 검증의 기대 결과이며, 실행 여부는 별도로 기록한다.

## 6. 현재 데모와 구현 범위 비교

| 기능/요구 | 현재 데모 상태 | 실제 구현에서 보강할 점 |
|---|---|---|
| 목록 필드와 숫자 단위 | F1은 demo fixture 또는 live KOBIS 결과를 표시. 서버가 문자열 수치를 검증·변환 | 추가 주간·주말 날짜 확인 |
| 날짜·기간 선택 | 요청 날짜·기간이 KOBIS 파라미터로 변환됨. live `2026-09-06`에서 실제 10건 확인 | 주간·주말 주차 경계 규칙을 여러 날짜로 점검 |
| 검색 | 데모와 live 모두 서버가 조회 목록에서 영화명 부분 검색 | 대량 검색/정렬 정책은 현재 10건 상한에 맞춰 유지 |
| 목록 로딩/오류/빈 결과 | 로딩, 정상 빈 결과, 검색 없음, API 오류 상태 제공 | 실제 상위 timeout 및 키 누락 오류 화면을 추가 확인 |
| 조회 건수·출처·시각 | F1은 KOBIS API 또는 Supabase 캐시 출처, 수집 시각을 표시 | Supabase 적용 후 실제 hit/miss source 표시를 확인 |
| 수치 문자열 파싱 | KOBIS 문자열 수치를 서버에서 정수로 검증·변환. 파싱 오류는 API 오류로 처리 | 완료 |
| 인사이트 구간·Top 5/10 | demo는 가상 fixture, live는 일별 DB 캐시를 먼저 확인하고 miss 날짜만 KOBIS를 호출해 기간 합산 | DB 설정 후 반복 조회에서 캐시 출처 확인 및 만료 처리 검증 |
| 인사이트 데이터 없음/불완전 기간 | live는 기간 조회 전체 성공만 표시하고, 실패 시 숫자 대신 오류 상태; demo는 기존 샘플 | 실패한 날짜를 식별하는 coverage 상세 및 저장 데이터 기반 복구는 후속 구현 |
| 데이터 출처 표시 | live F1은 KOBIS API/캐시 source, F2 응답에 API·캐시 혼합 source와 기간 수집 시각 포함 | 실제 cache hit/miss를 설정 완료 후 검증 |
| 캐시 저장·저장본 대조 | 함수/migration/검증 명령 작성. 실제 DB 연동은 사용자 설정 전이라 확인 보류 | Supabase migration 적용 후 source archive·DB 저장본·신선 KOBIS 대조를 실행 |
| API 키·DB 비밀키 | KOBIS와 Supabase secret은 서버 환경에서만 사용. 요청 로깅을 억제하고 `.env.local` 정적 제공 차단 | 사용자 설정 완료 후 연결 및 노출 차단 검증 |
| DB | Supabase migration과 RPC 함수 작성, 실제 프로젝트 연결은 설정 전 | 설정 완료 후 migration 적용 여부, RLS 및 함수 권한 검증 |
| 오류 안내/재시도 | `state=error`가 로컬 API 502를 재현하고 재시도 동작을 제공 | 원인별 오류 안내, 실제 재요청, timeout·rate limit 대응 |
| 실행 명령 | `DATA_MODE=demo` 또는 `.env.local`의 `DATA_MODE=live`로 `python server.py` 실행 | 배포 서버 스택의 개발·빌드·배포 명령 및 환경 변수 설정 |

## 구현 전 문서 동기화

- Migration 적용, `.env.local` 서버 비밀값 설정, `verify:data` 실행은 사용자가 설정 완료를 알린 뒤 진행한다.
- 원문 응답 검증 파일은 로컬 `.boxoffice-source/`에 저장되며 Vercel 같은 임시 파일 시스템에서는 지속 보장이 없다. 배포 시에는 ERD 제약을 유지하면서 승인된 영구 비공개 저장소로 이전할 필요가 있다.
- KOBIS 공식 응답/요청 제한이나 이용 조건이 이 계획의 가정과 다르면 실제 문서 기준으로 이 계획을 먼저 갱신한다.
