# AGENTS.md — boxoffice-insight

## 서비스 요약

Bridge Talk는 동아리·학원 등 모임의 구성원이 개인 주간 일정을 입력·공유하고, 관리자가 투표를 열어 참여자별 가능 시간을 비교한 뒤 약속 시간을 확정하도록 돕는 웹 서비스다. 투표별로 필요한 가용 정보만 공유하며, 참여자 미응답은 가능으로 계산하지 않는다. 채팅·봇·AI 추천·외부 캘린더 연동은 현재 범위에 포함하지 않는다.

## 먼저 확인할 문서와 저장소 상태

- 작업을 시작할 때 저장소의 `AGENTS.md`와 관련 코드·문서를 확인한다. 하위 폴더에 별도 `AGENTS.md`가 있으면 해당 범위에도 적용한다.
- 제품 요구사항은 `PRD.md`, 화면/API/처리 흐름은 `ARCHITECTURE.md`, 스택 선택은 `ADR.md`, 시간표 데이터 구조는 `ERD.md`를 기준으로 한다.
- 제공 문서 안의 **요구사항**과 **제안/TODO**를 구분한다. 제안된 시간 단위, 인증 정책, 공유 범위 등을 이미 확정된 사실로 취급하지 않는다.
- 현재 Next.js App Router/TypeScript 뼈대, 상태 API, Vitest/React Testing Library, Playwright 설정이 있다. DATA_MODE=demo에서 읽기 전용 예시 결과를 조회한다. DB 연결과 인증, 실제 시간표·투표 저장 기능은 아직 없다. 데모의 입력값과 기대 결과는 DEMO.md를 참고한다. Node.js 22.x를 사용하고 새 설정과 명령은 실제 파일에서 확인한다.
- 기술 스택 문서의 선택은 구현 권고다. 무료 호스팅/DB 한도와 약관은 배포 시점에 직접 확인하고 확인한 날짜와 조건을 기록한다.

## 반드시 지킬 제품·보안 규칙

- API 키, DB 비밀 키, Supabase secret/service role 키, 알림 제공자 자격 증명을 브라우저 코드·클라이언트 번들·네트워크 응답·로그·Git 저장소에 노출하지 않는다. 서버 환경 변수 또는 승인된 비밀 저장소에서만 읽는다.
- 브라우저는 내부 API를 호출한다. 내부 API에서 인증, 투표별 접근 권한, 입력값, 상태 전이를 검증한다. 사용자별 결과는 권한이 확인된 사용자에게만 반환한다.
- 타 참여자에게 개인 일정 제목을 노출하지 않는다. 공유 결과에는 제품의 공개 정책에 따라 가능/불가능 상태 등 최소 정보만 제공한다.
- 빈 결과, 검색 결과 없음, 입력 오류, API/네트워크 오류, DB 오류·용량 한도를 서로 다른 상태로 처리한다.
  - 정상 빈 결과는 성공 응답(예: HTTP 200, 빈 목록 또는 명시적인 empty 상태)과 “아직 제출이 없습니다” 같은 빈 상태 UI로 표현한다.
  - 검색 결과 없음은 조회가 정상 완료된 뒤 결과가 0건인 상태로 표현하며 서버/API 오류로 표시하지 않는다.
  - API·네트워크·DB 오류는 오류 응답과 재시도/다음 조치를 안내한다. 실패하거나 응답이 확인되지 않은 저장을 성공으로 알리지 않는다.
  - 부분 조회 실패를 완전한 결과처럼 보여주지 않는다.
- 가용성은 후보 시간 구간 전체가 바쁜 일정과 겹치지 않을 때만 가능으로 판정한다. 겹침 조건은 `candidateStart < busyEnd && busyStart < candidateEnd`다.
- 응답 상태(`pending/submitted`)와 투표 상태(`notVoted/voted`)를 분리한다. 미응답자는 가능 인원에 포함하지 않는다.
- 후보별 인원은 사용자 기준으로 중복 없이 센다. 동률은 자동 확정하지 않는다. 개설자만 최종 일정을 확정할 수 있다.
- 투표, 재제출, 확정, 결과 집계는 DB를 기준으로 처리한다. 캐시는 기준 데이터로 사용하지 않으며 투표·마감·확정 판단을 캐시 값으로 수행하지 않는다. 관련 변경 후 결과 캐시를 무효화한다.
- 알림 외부 API 실패가 투표/확정 저장을 취소하지 않게 한다. 알림은 P1에서 선택된 제공자와 재시도 정책을 따른다. P0 핵심 흐름은 외부 API에 의존하지 않는다.
- 범위가 바뀌어 채팅, 봇, AI 추천, 외부 캘린더 연동을 추가하려면 사용자의 명시 요구와 관련 문서 갱신이 먼저 필요하다.
- 미결정 정책은 짧은 TODO로 남기고 제품 동작을 임의로 단정하지 않는다. 안전하고 일관된 구현에 꼭 필요한 결정이 막혀 있으면 독립 작업은 계속하고, 막힌 지점과 선택지를 보고한다.

## 프로젝트 명령어

Node.js 22.x 기준이며 `.node-version`은 22.23.4다. 설치는 `npm ci`를 사용한다. Playwright 브라우저는 최초 한 번 `npx playwright install chromium`으로 설치한다.

| 목적 | 명령어 | 현재 상태 |
|---|---|---|
| 개발 서버 | `npm run dev` | Next.js 개발 서버, http://127.0.0.1:3000 |
| 프로덕션 빌드 | `npm run build` | Next.js 프로덕션 빌드 |
| 프로덕션 실행 | `npm run start` | 빌드 후 실행 |
| 린트 | `npm run lint` | ESLint, 경고도 실패 |
| 타입 검사 | `npm run typecheck` | Next.js 타입 생성 후 tsc |
| 단위/컴포넌트 테스트 | `npm run test` | Vitest + React Testing Library |
| 화면 테스트 | `npm run test:e2e` | Playwright Chromium, 데스크톱/모바일 |

새 스크립트를 추가하면 실제 동작과 필요한 환경 변수를 확인하고 이 표를 갱신한다. 사용자가 테스트나 검증을 요청하지 않은 경우 임의로 테스트를 추가하거나 실행하지 않는다.

## Git 브랜치 및 커밋 규칙

- 현재 브랜치는 `master`다. 기본 브랜치를 임의로 이름 변경하거나 저장소 구조를 재초기화하지 않는다.
- 기능 작업 브랜치는 `feat/<짧은-설명>`, 버그 수정은 `fix/<짧은-설명>`, 문서 변경은 `docs/<짧은-설명>`, 유지보수는 `chore/<짧은-설명>` 형식을 사용한다. 브랜치를 만들거나 바꾸기 전 기존 상태와 사용자 지시를 확인한다.
- 커밋 메시지는 변경 목적을 짧고 구체적으로 적는다. 기존 저장소의 한국어 메시지 스타일을 유지한다. 예: `시간표 응답 데이터 모델 추가`.
- 커밋 요청이 있을 때만 커밋한다. 요청 범위의 파일만 포함하고, 커밋 전 변경 상태를 확인한다.
- 비밀 정보, 로컬 환경 파일, 생성된 빌드 산출물을 커밋하지 않는다. 사용자 허가 없이 기존 변경을 되돌리거나 덮어쓰지 않는다.
- 강제 푸시, 히스토리 재작성, 원격 브랜치 삭제는 명시적인 요청 없이는 하지 않는다.

## AI 작업·보고 방식

- 저장소와 관련 문서를 먼저 확인한 뒤 작업한다. 기존 구조가 없으면 이를 알리고, 스택·인증·DB·명령어를 이미 설치된 것처럼 가정하지 않는다.
- 여러 단계 작업은 실행 전 핵심 접근을 간단히 공유하고, 진행 중에는 의미 있는 상태나 정책 결정을 알린다. 질문이 필요한 경우에도 답을 기다리는 동안 독립적으로 진행할 수 있는 작업은 계속한다.
- **일반 모드 보고**와 **Plan Mode 보고**를 혼합하지 않는다.
  - 일반 모드에서는 실행 전 설명을 계획으로 표시하고, 완료 보고에는 실제로 변경한 내용과 확인한 결과만 적는다.
  - Plan Mode를 실제로 사용한 경우에는 최종 보고에서 **Plan Mode 계획**과 **실행 결과**를 별도 항목으로 나눈다. 계획만 세우고 구현하지 않았다면 구현 완료처럼 표현하지 않는다.
  - 단순한 내부 체크리스트를 Plan Mode 결과라고 부르지 않는다.
- 최종 보고는 한국어로 간결히 작성하고, 변경 파일, 주요 결정, 실행하거나 실행하지 않은 검증, 미완료 항목/한계를 구분한다. 확인하지 않은 성공이나 테스트 결과를 주장하지 않는다.
- 사용자에게 보이는 질문은 결정을 실제로 막는 정보가 있을 때만 한다. 선택지가 있으면 영향이 분명한 짧은 대안으로 묻는다.

## 문서 갱신 규칙

- 요구사항이나 범위를 바꾸면 `PRD.md`를 갱신한다.
- 요청/응답 흐름, 캐시, 보안 경계, 서비스 간 책임을 바꾸면 `ARCHITECTURE.md`를 갱신한다.
- 기술 스택 선택이나 기존 선택을 바꾸면 `ADR.md`에 맥락·대안·결정·근거·결과를 기록한다.
- 테이블, 키, 관계, 제약을 바꾸면 `ERD.md`를 갱신하고 관련 문서와 일치하는지 확인한다.


<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
