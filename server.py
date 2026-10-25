from __future__ import annotations

import json
import os
from datetime import date, datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8000"))
DATA_MODE = os.environ.get("DATA_MODE", "").strip().lower()
EMPTY_DATE = "2026-09-06"

# Synthetic records for the local demo. They are not KOBIS production data.
MOVIES = [
    {"movieCode": "M001", "rank": 1, "title": "달빛 항해", "releaseDate": "2026-08-20", "revenue": 1834200000, "audience": 184206, "totalAudience": 13126474, "genre": "드라마", "tag": "달"},
    {"movieCode": "M002", "rank": 2, "title": "바다의 노래", "releaseDate": "2026-08-28", "revenue": 1248600000, "audience": 128384, "totalAudience": 11916851, "genre": "미스터리", "tag": "바"},
    {"movieCode": "M003", "rank": 3, "title": "도시의 밤", "releaseDate": "2026-08-12", "revenue": 972300000, "audience": 101652, "totalAudience": 11506724, "genre": "액션", "tag": "밤"},
    {"movieCode": "M004", "rank": 4, "title": "여름의 지도", "releaseDate": "2026-07-30", "revenue": 621540000, "audience": 63512, "totalAudience": 8793210, "genre": "애니메이션", "tag": "여"},
    {"movieCode": "M005", "rank": 5, "title": "마지막 편지", "releaseDate": "2026-08-02", "revenue": 386210000, "audience": 40284, "totalAudience": 7521084, "genre": "드라마", "tag": "편"},
    {"movieCode": "M006", "rank": 6, "title": "작은 행성", "releaseDate": "2026-08-10", "revenue": 218760000, "audience": 22614, "totalAudience": 5128491, "genre": "SF", "tag": "행"},
    {"movieCode": "M007", "rank": 7, "title": "바람의 노래", "releaseDate": "2026-07-14", "revenue": 187430000, "audience": 19402, "totalAudience": 2210468, "genre": "판타지", "tag": "바"},
    {"movieCode": "M008", "rank": 8, "title": "오후 네 시", "releaseDate": "2026-06-23", "revenue": 125800000, "audience": 13178, "totalAudience": 3531186, "genre": "로맨스", "tag": "4"},
    {"movieCode": "M009", "rank": 9, "title": "파일럿", "releaseDate": "2026-07-31", "revenue": 96350000, "audience": 10031, "totalAudience": 4718269, "genre": "코미디", "tag": "P"},
    {"movieCode": "M010", "rank": 10, "title": "탈주의 끝", "releaseDate": "2026-07-03", "revenue": 74820000, "audience": 7906, "totalAudience": 2561995, "genre": "액션", "tag": "탈"},
]
PERIODS = {"daily", "weekly", "weekend"}


def now_seoul() -> str:
    try:
        value = datetime.now(ZoneInfo("Asia/Seoul"))
    except Exception:
        value = datetime.now().astimezone()
    return value.isoformat(timespec="seconds")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status: int, body: dict) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def fail(self, status: int, code: str, message: str, retryable: bool = False) -> None:
        self.send_json(status, {"error": {"code": code, "message": message, "retryable": retryable}, "meta": {"source": "KOBIS_DEMO"}})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/boxoffice":
            return super().do_GET()

        if DATA_MODE != "demo":
            return self.fail(503, "DATA_MODE_DISABLED", "데모 모드가 활성화되지 않았습니다. DATA_MODE=demo로 서버를 실행하세요.")

        params = parse_qs(parsed.query, keep_blank_values=True)
        date_value = params.get("date", [""])[0]
        period = params.get("period", ["daily"])[0]
        query = params.get("q", [""])[0].strip()
        state = params.get("state", ["auto"])[0]

        try:
            parsed_date = date.fromisoformat(date_value)
            if parsed_date.isoformat() != date_value:
                raise ValueError("date must use zero-padded ISO format")
        except ValueError:
            return self.fail(400, "INVALID_DATE", "조회 날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.")
        if period not in PERIODS:
            return self.fail(400, "INVALID_PERIOD", "기간 유형은 daily, weekly, weekend 중 하나여야 합니다.")
        if len(query) > 100:
            return self.fail(400, "QUERY_TOO_LONG", "검색어는 100자 이내로 입력하세요.")
        if state == "error":
            return self.fail(502, "UPSTREAM_SIMULATED_ERROR", "데모에서 상위 API 오류를 재현했습니다.", True)

        if state == "empty" or date_value == EMPTY_DATE:
            movies = []
        else:
            movies = [dict(movie) for movie in MOVIES]
        total_before_search = len(movies)
        if query:
            movies = [movie for movie in movies if query.casefold() in movie["title"].casefold()]

        self.send_json(200, {
            "data": {"movies": movies},
            "meta": {
                "date": date_value,
                "period": period,
                "query": query or None,
                "total": len(movies),
                "totalBeforeSearch": total_before_search,
                "source": "KOBIS 공개 API 샘플 fixture (DATA_MODE=demo)",
                "collectedAt": now_seoul(),
            },
        })


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Box Office demo server: http://{HOST}:{PORT}/  (DATA_MODE={DATA_MODE or 'disabled'})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
