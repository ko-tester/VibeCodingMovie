from __future__ import annotations

import json
import os
import re
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8000"))
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
UPSTREAM_TIMEOUT_SECONDS = 5
MAX_RESPONSE_BYTES = 2_000_000
BIGINT_MAX = 9_223_372_036_854_775_807
JS_SAFE_INTEGER_MAX = 9_007_199_254_740_991
INSIGHTS_WORKERS = 4
PERIODS = {"daily", "weekly", "weekend"}


def load_local_env() -> None:
    """Load only non-overridden server settings; never print their values."""
    env_path = ROOT / ".env.local"
    if not env_path.is_file():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            name = name.strip()
            if name not in {"DATA_MODE", "KOBIS_API_KEY", "PORT"} or name in os.environ:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            os.environ[name] = value
    except OSError:
        # Missing/unreadable local configuration is handled as an API configuration error.
        return


load_local_env()
DATA_MODE = os.environ.get("DATA_MODE", "").strip().lower()
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "").strip()

# Synthetic records for DATA_MODE=demo. These are not KOBIS production data.
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
EMPTY_DATE = "2026-09-06"


class ApiFailure(Exception):
    def __init__(self, status: int, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.retryable = retryable


def now_seoul() -> str:
    try:
        value = datetime.now(ZoneInfo("Asia/Seoul"))
    except Exception:
        value = datetime.now().astimezone()
    return value.isoformat(timespec="seconds")


def parse_iso_date(value: str) -> date:
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError("invalid ISO date")
    return parsed


def parse_nonnegative_int(value: object, field: str, *, minimum: int = 0, maximum: int = BIGINT_MAX) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]+", value):
        raise ApiFailure(502, "KOBIS_INVALID_DATA", "KOBIS 응답의 숫자 형식이 올바르지 않습니다.")
    parsed = int(value)
    if parsed < minimum or parsed > maximum:
        raise ApiFailure(502, "KOBIS_INVALID_DATA", "KOBIS 응답 수치가 허용 범위를 벗어났습니다.")
    return parsed


def normalize_movie(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise ApiFailure(502, "KOBIS_INVALID_DATA", "KOBIS 응답의 영화 항목 형식이 올바르지 않습니다.")
    required_text = ("movieCd", "movieNm")
    if any(not isinstance(raw.get(name), str) or not raw[name].strip() for name in required_text):
        raise ApiFailure(502, "KOBIS_INVALID_DATA", "KOBIS 응답에 필수 영화 정보가 없습니다.")

    open_date_raw = raw.get("openDt", "")
    if open_date_raw is None:
        open_date_raw = ""
    if not isinstance(open_date_raw, str):
        raise ApiFailure(502, "KOBIS_INVALID_DATA", "KOBIS 응답의 개봉일 형식이 올바르지 않습니다.")
    open_date_raw = open_date_raw.strip()
    if open_date_raw:
        try:
            parse_iso_date(open_date_raw)
        except ValueError as exc:
            raise ApiFailure(502, "KOBIS_INVALID_DATA", "KOBIS 응답의 개봉일 형식이 올바르지 않습니다.") from exc

    return {
        "movieCode": raw["movieCd"].strip(),
        "rank": parse_nonnegative_int(raw.get("rank"), "rank", minimum=1, maximum=10),
        "title": raw["movieNm"].strip(),
        "releaseDate": open_date_raw or None,
        "revenue": parse_nonnegative_int(raw.get("salesAmt"), "salesAmt"),
        "audience": parse_nonnegative_int(raw.get("audiCnt"), "audiCnt"),
        "totalAudience": parse_nonnegative_int(raw.get("audiAcc"), "audiAcc"),
        "totalRevenue": parse_nonnegative_int(raw.get("salesAcc"), "salesAcc"),
        "genre": "",
        "tag": raw["movieNm"].strip()[:1],
    }


def fetch_live_movies(period: str, target_date: str) -> list[dict]:
    if not KOBIS_API_KEY:
        raise ApiFailure(503, "KOBIS_API_KEY_MISSING", "서버에 KOBIS API 키가 설정되지 않았습니다.")

    target_dt = target_date.replace("-", "")
    if period == "daily":
        endpoint = KOBIS_DAILY_URL
        list_field = "dailyBoxOfficeList"
        params = {"key": KOBIS_API_KEY, "targetDt": target_dt, "itemPerPage": "10"}
    else:
        endpoint = KOBIS_WEEKLY_URL
        list_field = "weeklyBoxOfficeList"
        # KOBIS weekGb: 0 = Monday-Sunday weekly, 1 = Friday-Sunday weekend.
        week_gb = "0" if period == "weekly" else "1"
        params = {"key": KOBIS_API_KEY, "targetDt": target_dt, "weekGb": week_gb, "itemPerPage": "10"}

    request = Request(
        f"{endpoint}?{urlencode(params)}",
        headers={"Accept": "application/json", "User-Agent": "BoxOfficeInsights/1.0"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise ApiFailure(502, "KOBIS_UPSTREAM_HTTP_ERROR", "KOBIS API가 정상 응답을 반환하지 않았습니다.", True)
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as exc:
        if exc.code == 429:
            raise ApiFailure(503, "KOBIS_RATE_LIMITED", "KOBIS API 호출 한도에 도달했습니다.", True) from exc
        if exc.code in {401, 403}:
            raise ApiFailure(503, "KOBIS_AUTH_FAILED", "KOBIS API 인증을 확인할 수 없습니다.") from exc
        raise ApiFailure(502, "KOBIS_UPSTREAM_HTTP_ERROR", "KOBIS API가 정상 응답을 반환하지 않았습니다.", True) from exc
    except (TimeoutError, socket.timeout) as exc:
        raise ApiFailure(504, "KOBIS_TIMEOUT", "KOBIS API 응답 시간이 초과되었습니다.", True) from exc
    except URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise ApiFailure(504, "KOBIS_TIMEOUT", "KOBIS API 응답 시간이 초과되었습니다.", True) from exc
        raise ApiFailure(502, "KOBIS_CONNECTION_FAILED", "KOBIS API에 연결하지 못했습니다.", True) from exc
    except OSError as exc:
        raise ApiFailure(502, "KOBIS_CONNECTION_FAILED", "KOBIS API에 연결하지 못했습니다.", True) from exc

    if len(body) > MAX_RESPONSE_BYTES:
        raise ApiFailure(502, "KOBIS_RESPONSE_TOO_LARGE", "KOBIS 응답 크기가 허용 범위를 넘었습니다.")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiFailure(502, "KOBIS_INVALID_JSON", "KOBIS 응답을 JSON으로 해석할 수 없습니다.") from exc

    if not isinstance(payload, dict):
        raise ApiFailure(502, "KOBIS_INVALID_RESPONSE", "KOBIS 응답 구조가 올바르지 않습니다.")
    if "faultInfo" in payload:
        raise ApiFailure(502, "KOBIS_REJECTED_REQUEST", "KOBIS API가 요청을 처리하지 못했습니다. 서버 설정과 요청 조건을 확인하세요.")
    result = payload.get("boxOfficeResult")
    if not isinstance(result, dict) or list_field not in result or not isinstance(result[list_field], list):
        raise ApiFailure(502, "KOBIS_INVALID_RESPONSE", "KOBIS 응답에 박스오피스 목록이 없습니다.")

    raw_movies = result[list_field]
    if len(raw_movies) > 10:
        raise ApiFailure(502, "KOBIS_INVALID_RESPONSE", "KOBIS 응답 항목 수가 요청 한도를 넘었습니다.")
    return [normalize_movie(movie) for movie in raw_movies]


def fetch_live_insights(end_date: date, days: int, limit: int) -> dict:
    """Aggregate complete daily KOBIS responses in memory; do not persist or cache them."""
    start_date = end_date - timedelta(days=days - 1)
    requested_dates = [start_date + timedelta(days=offset) for offset in range(days)]
    daily_movies: dict[str, list[dict]] = {}
    failures: list[ApiFailure] = []

    with ThreadPoolExecutor(max_workers=INSIGHTS_WORKERS) as pool:
        futures = {
            pool.submit(fetch_live_movies, "daily", target.isoformat()): target.isoformat()
            for target in requested_dates
        }
        for future in as_completed(futures):
            target = futures[future]
            try:
                daily_movies[target] = future.result()
            except ApiFailure as failure:
                failures.append(failure)
            except Exception:
                failures.append(ApiFailure(502, "KOBIS_INVALID_RESPONSE", "KOBIS 응답을 처리하지 못했습니다.", True))

    if failures:
        # Never report a partial range as a complete insight result.
        priority = next((failure for failure in failures if failure.status in {503, 504}), failures[0])
        raise ApiFailure(priority.status, "INSIGHTS_INCOMPLETE", "일부 날짜의 박스오피스 데이터를 확인하지 못해 인사이트를 계산하지 못했습니다.", True)

    series = []
    totals_by_movie: dict[str, dict] = {}
    total_revenue = 0
    total_audience = 0
    for target in requested_dates:
        movies = daily_movies[target.isoformat()]
        day_revenue = sum(movie["revenue"] for movie in movies)
        day_audience = sum(movie["audience"] for movie in movies)
        total_revenue += day_revenue
        total_audience += day_audience
        series.append({"date": target.isoformat(), "revenue": day_revenue, "audience": day_audience})
        for movie in movies:
            entry = totals_by_movie.setdefault(movie["movieCode"], {
                "movieCode": movie["movieCode"],
                "title": movie["title"],
                "releaseDate": movie["releaseDate"],
                "revenue": 0,
                "audience": 0,
            })
            entry["revenue"] += movie["revenue"]
            entry["audience"] += movie["audience"]

    if any(value > JS_SAFE_INTEGER_MAX for value in (total_revenue, total_audience)):
        raise ApiFailure(502, "INSIGHTS_VALUE_OUT_OF_RANGE", "인사이트 합계가 브라우저에서 안전하게 표시할 수 있는 범위를 넘었습니다.")

    ranked = sorted(totals_by_movie.values(), key=lambda item: (-item["revenue"], item["title"]))
    top_movies = []
    for rank, movie in enumerate(ranked[:limit], start=1):
        if movie["revenue"] > JS_SAFE_INTEGER_MAX or movie["audience"] > JS_SAFE_INTEGER_MAX:
            raise ApiFailure(502, "INSIGHTS_VALUE_OUT_OF_RANGE", "영화별 인사이트 합계가 표시 범위를 넘었습니다.")
        top_movies.append({
            **movie,
            "rank": rank,
            "share": movie["revenue"] / total_revenue if total_revenue else 0,
        })

    return {
        "data": {
            "series": series,
            "topMovies": top_movies,
            "summary": {
                "totalRevenue": total_revenue,
                "totalAudience": total_audience,
                "averageRevenue": round(total_revenue / days),
            },
        },
        "meta": {
            "mode": "live",
            "source": "KOBIS Open API",
            "rangeStart": start_date.isoformat(),
            "rangeEnd": end_date.isoformat(),
            "daysRequested": days,
            "daysComplete": len(daily_movies),
            "collectedAt": now_seoul(),
        },
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args: object) -> None:
        # Suppress request URLs and upstream details so credentials can never enter server logs.
        return

    def send_json(self, status: int, body: dict, retry_after: str | None = None) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        if retry_after:
            self.send_header("Retry-After", retry_after)
        self.end_headers()
        self.wfile.write(encoded)

    def fail(self, failure: ApiFailure) -> None:
        self.send_json(failure.status, {
            "error": {"code": failure.code, "message": failure.message, "retryable": failure.retryable},
            "meta": {"mode": DATA_MODE or "disabled"},
        }, "30" if failure.code == "KOBIS_RATE_LIMITED" else None)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/mode":
            self.send_json(200, {"mode": DATA_MODE if DATA_MODE in {"demo", "live"} else "disabled"})
            return
        if parsed.path == "/api/boxoffice":
            self.handle_boxoffice(parsed.query)
            return
        if parsed.path == "/api/insights":
            self.handle_insights(parsed.query)
            return
        decoded_path = unquote(parsed.path)
        path_parts = [part for part in decoded_path.split("/") if part]
        if any(part.startswith(".") for part in path_parts) or decoded_path.lower().endswith(".py"):
            self.send_error(404)
            return
        return super().do_GET()

    def handle_boxoffice(self, raw_query: str) -> None:
        if DATA_MODE not in {"demo", "live"}:
            return self.fail(ApiFailure(503, "DATA_MODE_DISABLED", "DATA_MODE를 demo 또는 live로 설정하세요."))

        params = parse_qs(raw_query, keep_blank_values=True)
        date_value = params.get("date", [""])[0]
        period = params.get("period", ["daily"])[0]
        query = params.get("q", [""])[0].strip()
        state = params.get("state", ["auto"])[0]
        try:
            parse_iso_date(date_value)
        except ValueError:
            return self.fail(ApiFailure(400, "INVALID_DATE", "조회 날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다."))
        if period not in PERIODS:
            return self.fail(ApiFailure(400, "INVALID_PERIOD", "기간 유형은 daily, weekly, weekend 중 하나여야 합니다."))
        if len(query) > 100:
            return self.fail(ApiFailure(400, "QUERY_TOO_LONG", "검색어는 100자 이내로 입력하세요."))

        if DATA_MODE == "demo":
            if state == "error":
                return self.fail(ApiFailure(502, "UPSTREAM_SIMULATED_ERROR", "데모에서 상위 API 오류를 재현했습니다.", True))
            movies = [] if state == "empty" or date_value == EMPTY_DATE else [dict(movie) for movie in MOVIES]
            total_before_search = len(movies)
            if query:
                movies = [movie for movie in movies if query.casefold() in movie["title"].casefold()]
            source = "KOBIS 공개 API 샘플 fixture (DATA_MODE=demo)"
        else:
            try:
                movies = fetch_live_movies(period, date_value)
            except ApiFailure as failure:
                return self.fail(failure)
            total_before_search = len(movies)
            if query:
                movies = [movie for movie in movies if query.casefold() in movie["title"].casefold()]
            source = "KOBIS Open API"

        self.send_json(200, {
            "data": {"movies": movies},
            "meta": {
                "mode": DATA_MODE,
                "date": date_value,
                "period": period,
                "query": query or None,
                "total": len(movies),
                "totalBeforeSearch": total_before_search,
                "source": source,
                "collectedAt": now_seoul(),
            },
        })

    def handle_insights(self, raw_query: str) -> None:
        if DATA_MODE != "live":
            return self.fail(ApiFailure(503, "INSIGHTS_LIVE_ONLY", "실데이터 인사이트는 DATA_MODE=live에서 사용할 수 있습니다."))
        params = parse_qs(raw_query, keep_blank_values=True)
        end_date_raw = params.get("endDate", [""])[0]
        try:
            end_date = parse_iso_date(end_date_raw)
        except ValueError:
            return self.fail(ApiFailure(400, "INVALID_DATE", "종료 날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다."))

        days_raw = params.get("days", [""])[0]
        limit_raw = params.get("limit", [""])[0]
        if days_raw not in {"7", "14", "30"}:
            return self.fail(ApiFailure(400, "INVALID_RANGE", "인사이트 기간은 7, 14, 30일 중 하나여야 합니다."))
        if limit_raw not in {"5", "10"}:
            return self.fail(ApiFailure(400, "INVALID_LIMIT", "Top 개수는 5 또는 10이어야 합니다."))

        try:
            result = fetch_live_insights(end_date, int(days_raw), int(limit_raw))
        except ApiFailure as failure:
            return self.fail(failure)
        self.send_json(200, result)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Box Office server: http://{HOST}:{PORT}/ (DATA_MODE={DATA_MODE or 'disabled'})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
