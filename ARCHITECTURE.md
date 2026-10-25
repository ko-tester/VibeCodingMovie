# 구현 메모

## 데모 구성

`index.html`, `styles.css`, `app.js`가 화면을 구성하고, `server.py`가 내부 API를 제공한다. `DATA_MODE=demo`는 기존 fixture를 그대로 사용하고 DB를 호출하지 않는다. `DATA_MODE=live`는 서버 전용 KOBIS·Supabase 비밀값으로 동작한다. F1은 같은 유형·기준일의 DB 캐시를 먼저 확인한 뒤 miss/만료 때 KOBIS를 조회하고 검증 결과를 저장한다. F2도 같은 경로를 날짜별로 재사용해 7·14·30일 자료를 메모리 집계한다. SQL RPC 저장은 영화 → 조회 기간 → 실적 순서로 한 트랜잭션에서 교체한다.

## 실제 연동 경계

브라우저는 내부 API만 호출하며 KOBIS/Supabase 비밀값을 받지 않는다. 서버는 `.env.local`에서만 `KOBIS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 읽는다. 요청 URL, Authorization 헤더, 응답 원문은 로그에 남기지 않는다. 검증된 KOBIS 원문은 ERD 컬럼을 늘리지 않기 위해 Git 제외·정적 제공 차단된 `.boxoffice-source/`에 검증 보조 자료로 보관한다. DB 원자성은 세 테이블 저장 트랜잭션에 적용된다.

## 화면 상태

F1 목록은 로딩, 성공, 정상 빈 결과, 검색 결과 없음, 오류 상태를 구분한다. live는 `source`에 `KOBIS Open API` 또는 `Supabase 캐시`를 표시한다. 저장소 읽기 실패 시 KOBIS로 우회하고 경고를 표시하며, 쓰기 실패 시 검증된 KOBIS 응답을 반환하고 저장 실패 경고를 표시한다. KOBIS도 실패하면 502/503/504 오류 상태를 보여준다. 데모는 기존 fixture와 `2026-09-06` 정상 빈 결과를 유지한다.

## 미결정 사항

- 주간·주말 조회 기준일과 주차 경계 규칙을 더 폭넓은 실제 날짜로 확인
- Supabase 프로젝트에 migration 적용 및 `.env.local`의 서버 비밀값 설정 후 실제 DB 캐시·검증 명령 확인 필요
- F2 live는 각 날짜별로 DB 캐시를 먼저 보고 miss 때 KOBIS를 호출한다. 7·14·30일 첫 miss는 여러 날짜 API 호출을 만들 수 있음
- 배포 시 무료 플랜의 최신 이용 조건 확인
