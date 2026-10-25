from __future__ import annotations

import argparse
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import ApiFailure, normalize_kobis_response, parse_iso_date, fetch_live_response, normalize_stored_snapshot
from supabase_store import (
    SupabaseStoreError,
    configured,
    read_box_office_period,
    read_original_response,
)


FIELDS = (
    "movieCode", "rank", "title", "releaseDate", "revenue", "totalRevenue", "audience", "totalAudience"
)


def canonical(movies: list[dict]) -> list[dict]:
    return [
        {field: movie.get(field) for field in FIELDS}
        for movie in sorted(movies, key=lambda item: (item.get("rank", 0), item.get("movieCode", "")))
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="저장본, 저장 당시 KOBIS 원문, 새 KOBIS 조회를 읽기 전용으로 대조합니다.")
    parser.add_argument("--date", required=True, help="조회 기준일 YYYY-MM-DD")
    parser.add_argument("--period", required=True, choices=("daily", "weekly", "weekend"), help="조회 기간 유형")
    args = parser.parse_args()

    try:
        if parse_iso_date(args.date).isoformat() != args.date:
            raise ValueError
    except ValueError:
        print("조회 날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식을 사용하세요.")
        return 1

    if not configured():
        print("Supabase 연결 설정이 없습니다. .env.local의 SUPABASE_URL과 SUPABASE_SECRET_KEY를 확인하세요.")
        return 1

    try:
        saved_period = read_box_office_period(args.period, args.date)
    except SupabaseStoreError as exc:
        print(f"저장본을 읽지 못했습니다 ({exc.code}). 설정과 DB 함수를 확인하세요.")
        return 1

    if isinstance(saved_period, list) and len(saved_period) == 1:
        saved_period = saved_period[0]
    if saved_period is None:
        print(f"저장된 데이터가 없습니다: {args.period} / {args.date}")
        return 2

    try:
        stored_movies, collected_at, _expires_at = normalize_stored_snapshot(saved_period, args.period, args.date)
    except SupabaseStoreError:
        print("DB 저장본의 형식이 올바르지 않아 비교할 수 없습니다.")
        return 1

    original_payload = read_original_response(args.period, args.date, collected_at)
    original_matches = False
    if original_payload is None:
        print("① 저장 당시 KOBIS 원문 ↔ DB: 비교 불가 (원문 보관 파일을 찾지 못했습니다)")
    else:
        try:
            original_movies = normalize_kobis_response(args.period, original_payload)
            original_matches = canonical(original_movies) == canonical(stored_movies)
            label = "일치" if original_matches else "불일치"
            print(f"① 저장 당시 KOBIS 원문 ↔ DB: {label} ({len(original_movies)}건 / {len(stored_movies)}건)")
        except ApiFailure as exc:
            print(f"① 저장 당시 KOBIS 원문 ↔ DB: 비교 불가 ({exc.code})")

    fresh_matches = False
    try:
        _fresh_payload, fresh_movies = fetch_live_response(args.period, args.date)
        fresh_matches = canonical(fresh_movies) == canonical(stored_movies)
        label = "일치" if fresh_matches else "불일치"
        print(f"② 새 KOBIS 조회 ↔ DB: {label} ({len(fresh_movies)}건 / {len(stored_movies)}건)")
    except ApiFailure as exc:
        print(f"② 새 KOBIS 조회 ↔ DB: 비교 불가 ({exc.code}: {exc.message})")

    if original_matches and fresh_matches:
        print("결과: 모든 비교가 일치합니다. 종료 코드 0")
        return 0
    print("결과: 불일치 또는 비교 불가 항목이 있습니다. 종료 코드 1")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
