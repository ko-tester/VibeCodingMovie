"""Server-only Supabase RPC helpers. Secret values are never included in errors."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen


class SupabaseStoreError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


ROOT = Path(__file__).resolve().parent
SOURCE_ARCHIVE = ROOT / ".boxoffice-source"


def configured() -> bool:
    return bool(os.environ.get("SUPABASE_URL", "").strip() and os.environ.get("SUPABASE_SECRET_KEY", "").strip())


def _rpc(function_name: str, payload: dict, timeout: float = 4.0, method: str = "POST"):
    base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    secret = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not base_url or not secret:
        raise SupabaseStoreError("SUPABASE_NOT_CONFIGURED")
    parsed_url = urlsplit(base_url)
    local_host = parsed_url.hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        parsed_url.scheme not in {"https", "http"}
        or not parsed_url.hostname
        or (parsed_url.scheme != "https" and not local_host)
        or parsed_url.username
        or parsed_url.password
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise SupabaseStoreError("SUPABASE_INVALID_URL")

    url = f"{base_url}/rest/v1/rpc/{quote(function_name, safe='')}"
    body = None
    if method == "GET":
        url += "?" + urlencode(payload)
    else:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "apikey": secret,
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method=method,
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            response_body = response.read(4_000_000)
            if response.status < 200 or response.status >= 300:
                raise SupabaseStoreError("SUPABASE_HTTP_ERROR")
    except HTTPError as exc:
        # Never include the HTTP error body, URL, or request headers in exceptions.
        if exc.code in {401, 403}:
            raise SupabaseStoreError("SUPABASE_AUTH_ERROR") from None
        raise SupabaseStoreError("SUPABASE_HTTP_ERROR") from None
    except (TimeoutError, OSError, URLError):
        raise SupabaseStoreError("SUPABASE_CONNECTION_ERROR") from None

    try:
        return json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise SupabaseStoreError("SUPABASE_INVALID_RESPONSE") from None


def read_box_office_period(period_type: str, base_date: str):
    return _rpc("read_box_office_period", {
        "p_period_type": period_type,
        "p_base_date": base_date,
    }, method="GET")


def save_box_office_period(
    period_type: str,
    base_date: str,
    source: str,
    collected_at: str,
    expires_at: str,
    movies: list[dict],
):
    rows = [{
        "movie_code": movie["movieCode"],
        "movie_name": movie["title"],
        "release_date": movie["releaseDate"],
        "rank": movie["rank"],
        "revenue": movie["revenue"],
        "total_revenue": movie["totalRevenue"],
        "audience": movie["audience"],
        "total_audience": movie["totalAudience"],
    } for movie in movies]
    return _rpc("save_box_office_period", {
        "p_period_type": period_type,
        "p_base_date": base_date,
        "p_source": source,
        "p_collected_at": collected_at,
        "p_expires_at": expires_at,
        "p_movies": rows,
    }, timeout=8.0)


def _snapshot_path(period_type: str, base_date: str, collected_at: str) -> Path:
    from datetime import date

    if period_type not in {"daily", "weekly", "weekend"}:
        raise ValueError("invalid period")
    if date.fromisoformat(base_date).isoformat() != base_date:
        raise ValueError("invalid date")
    timestamp = datetime.fromisoformat(collected_at.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError("timestamp must have timezone")
    stamp = timestamp.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return SOURCE_ARCHIVE / f"{period_type}_{base_date}_{stamp}.json"


def save_original_response(period_type: str, base_date: str, collected_at: str, payload: dict) -> bool:
    """Keep the raw validated KOBIS response outside the ERD schema for verify:data."""
    target = _snapshot_path(period_type, base_date, collected_at)
    try:
        SOURCE_ARCHIVE.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=SOURCE_ARCHIVE, prefix=".tmp-", suffix=".json", delete=False
        ) as handle:
            temporary = Path(handle.name)
            json.dump({
                "periodType": period_type,
                "baseDate": base_date,
                "collectedAt": collected_at,
                "response": payload,
            }, handle, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary, target)
        return True
    except OSError:
        try:
            if "temporary" in locals():
                temporary.unlink(missing_ok=True)
        except OSError:
            pass
        return False


def read_original_response(period_type: str, base_date: str, collected_at: str):
    path = _snapshot_path(period_type, base_date, collected_at)
    try:
        with path.open("r", encoding="utf-8") as handle:
            saved = json.load(handle)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(saved, dict):
        return None
    if saved.get("periodType") != period_type or saved.get("baseDate") != base_date:
        return None
    saved_at = saved.get("collectedAt")
    try:
        saved_time = datetime.fromisoformat(str(saved_at).replace("Z", "+00:00")).astimezone(timezone.utc)
        expected_time = datetime.fromisoformat(collected_at.replace("Z", "+00:00")).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None
    if saved_time != expected_time or not isinstance(saved.get("response"), dict):
        return None
    return saved["response"]


def prune_original_responses(period_type: str, base_date: str, keep_collected_at: str) -> None:
    keep = _snapshot_path(period_type, base_date, keep_collected_at)
    pattern = f"{period_type}_{base_date}_*.json"
    try:
        for candidate in SOURCE_ARCHIVE.glob(pattern):
            if candidate != keep:
                candidate.unlink(missing_ok=True)
    except OSError:
        # A stale archive can make verification inconvenient, but does not invalidate DB data.
        return
