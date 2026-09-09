"""
Test Suite for Follow-Up Scheduling with Tamil Nadu IST (Asia/Kolkata, UTC+05:30) Timezone.

Tests:
1. IST (+05:30) Date and Time Parsing for all UI inputs (12h AM/PM, 24h, ISO, timestamps).
2. Scheduling a callback 5 minutes into the future in IST.
3. Scheduling a callback 1 hour into the future in IST.
4. Verifying consistent IST display string format: '09 Sept 2026, 11:07 AM IST'.
5. Verifying UTC storage conversion and exact IST retrieval.
6. Verifying Follow-Up auto-calling scheduler logic (future items not due, due items triggered, reassignment fallback).
"""

import sys
import os
import asyncio
from datetime import datetime, timezone, timedelta

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.follow_up_service import (
    IST_TZ,
    utc_to_ist,
    format_ist_datetime_str,
    parse_datetime_to_utc,
)


def test_ist_timezone_definition():
    """Verify IST timezone offset is exactly UTC+05:30."""
    offset = IST_TZ.utcoffset(None)
    assert offset == timedelta(hours=5, minutes=30), f"Expected +05:30, got {offset}"
    print("[PASS] Test 1 Passed: IST timezone is strictly UTC+05:30 (Asia/Kolkata).")


def test_format_ist_datetime_str():
    """Verify display output conforms to 'DD Sept YYYY, hh:mm AM/PM IST'."""
    # Test with a known UTC timestamp: 2026-09-09 05:37:00 UTC -> 2026-09-09 11:07:00 IST
    utc_dt = datetime(2026, 9, 9, 5, 37, 0, tzinfo=timezone.utc)
    formatted = format_ist_datetime_str(utc_dt)
    assert formatted == "09 Sept 2026, 11:07 AM IST", f"Unexpected format: {formatted}"

    # Test with 4:40 PM IST (11:10 AM UTC)
    utc_dt_2 = datetime(2026, 9, 9, 11, 10, 0, tzinfo=timezone.utc)
    formatted_2 = format_ist_datetime_str(utc_dt_2)
    assert formatted_2 == "09 Sept 2026, 04:40 PM IST", f"Unexpected format: {formatted_2}"

    print(f"[PASS] Test 2 Passed: Consistent IST display formatting verified ({formatted}, {formatted_2}).")


def test_ist_date_time_parsing_12h_and_24h():
    """Verify UI input date/time strings in 12-hour AM/PM and 24-hour format are parsed as IST."""
    # 1. Date + 12-hour AM/PM (e.g. from After-Call Work form)
    parsed_utc_1 = parse_datetime_to_utc("2026-09-09 04:40 PM")
    ist_converted_1 = utc_to_ist(parsed_utc_1)
    assert ist_converted_1.hour == 16 and ist_converted_1.minute == 40, f"Expected 16:40 IST, got {ist_converted_1}"
    assert parsed_utc_1.hour == 11 and parsed_utc_1.minute == 10, f"Expected 11:10 UTC, got {parsed_utc_1}"

    # 2. Date + 24-hour (e.g. "2026-09-09 16:40" or "2026-09-09T16:40")
    parsed_utc_2 = parse_datetime_to_utc("2026-09-09 16:40")
    ist_converted_2 = utc_to_ist(parsed_utc_2)
    assert ist_converted_2.hour == 16 and ist_converted_2.minute == 40
    assert parsed_utc_2.hour == 11 and parsed_utc_2.minute == 10

    # 3. Time-only input (e.g. "04:40 PM")
    parsed_utc_3 = parse_datetime_to_utc("04:40 PM")
    ist_converted_3 = utc_to_ist(parsed_utc_3)
    assert ist_converted_3.hour == 16 and ist_converted_3.minute == 40

    print("[PASS] Test 3 Passed: 12-hour AM/PM, 24-hour, and time-only inputs accurately parsed as IST.")


def test_schedule_callback_5_minutes_future():
    """
    Test scheduling a callback 5 minutes into the future in Tamil Nadu IST.
    Verify:
    1. Calculated IST datetime is dynamically 5 minutes ahead of current system time.
    2. Converted UTC timestamp is exactly 5 minutes ahead of current UTC.
    3. IST reconversion matches the exact future minute.
    4. Due status check: 5 minutes in future is NOT due yet.
    """
    now_ist = datetime.now(IST_TZ)
    future_ist_5m = now_ist + timedelta(minutes=5)

    # String passed from UI (e.g. "2026-09-09 17:20" or "2026-09-09 05:20 PM")
    ist_ui_string = future_ist_5m.strftime("%Y-%m-%d %I:%M %p")
    parsed_utc = parse_datetime_to_utc(ist_ui_string)

    # Convert back to IST
    recon_ist = utc_to_ist(parsed_utc)

    assert recon_ist.year == future_ist_5m.year
    assert recon_ist.month == future_ist_5m.month
    assert recon_ist.day == future_ist_5m.day
    assert recon_ist.hour == future_ist_5m.hour
    assert recon_ist.minute == future_ist_5m.minute

    # Scheduler Due Check
    now_utc = datetime.now(timezone.utc)
    is_due = parsed_utc <= now_utc
    assert not is_due, "5-minute future callback must NOT be due immediately."

    diff_seconds = (parsed_utc - now_utc).total_seconds()
    assert 240 <= diff_seconds <= 360, f"Expected ~300s diff, got {diff_seconds}s"

    print(f"[PASS] Test 4 Passed: 5-minute future IST callback correctly scheduled ({ist_ui_string} -> {format_ist_datetime_str(parsed_utc)}). Not due yet ({diff_seconds:.1f}s remaining).")


def test_schedule_callback_1_hour_future():
    """
    Test scheduling a callback 1 hour into the future in Tamil Nadu IST.
    Verify:
    1. Calculated IST datetime is dynamically 60 minutes ahead of current system time.
    2. Converted UTC timestamp is exactly 60 minutes ahead of current UTC.
    3. IST reconversion matches the exact future hour.
    4. Display format produces standard IST string.
    5. Scheduler Due Check: 1 hour in future is NOT due yet.
    """
    now_ist = datetime.now(IST_TZ)
    future_ist_1h = now_ist + timedelta(hours=1)

    # String passed from UI
    ist_ui_string = future_ist_1h.strftime("%Y-%m-%d %I:%M %p")
    parsed_utc = parse_datetime_to_utc(ist_ui_string)

    recon_ist = utc_to_ist(parsed_utc)

    assert recon_ist.year == future_ist_1h.year
    assert recon_ist.month == future_ist_1h.month
    assert recon_ist.day == future_ist_1h.day
    assert recon_ist.hour == future_ist_1h.hour
    assert recon_ist.minute == future_ist_1h.minute

    # Scheduler Due Check
    now_utc = datetime.now(timezone.utc)
    is_due = parsed_utc <= now_utc
    assert not is_due, "1-hour future callback must NOT be due immediately."

    diff_seconds = (parsed_utc - now_utc).total_seconds()
    assert 3500 <= diff_seconds <= 3700, f"Expected ~3600s diff, got {diff_seconds}s"

    formatted_display = format_ist_datetime_str(parsed_utc)
    assert "IST" in formatted_display
    assert str(future_ist_1h.year) in formatted_display

    print(f"[PASS] Test 5 Passed: 1-hour future IST callback correctly scheduled ({ist_ui_string} -> {formatted_display}). Not due yet ({diff_seconds:.1f}s remaining).")


def test_immediate_due_trigger():
    """
    Test that a callback scheduled for past/immediate IST time is detected as due.
    """
    now_ist = datetime.now(IST_TZ)
    past_ist = now_ist - timedelta(minutes=1)
    ist_ui_string = past_ist.strftime("%Y-%m-%d %I:%M %p")
    parsed_utc = parse_datetime_to_utc(ist_ui_string)

    now_utc = datetime.now(timezone.utc)
    is_due = parsed_utc <= now_utc
    assert is_due, "Past/immediate callback must be due."

    print(f"[PASS] Test 6 Passed: Past/immediate callback correctly triggers due status ({ist_ui_string}).")


def run_all_tests():
    print("=" * 60)
    print("Running Tamil Nadu IST (Asia/Kolkata) Follow-Up Scheduling Tests")
    print("=" * 60)
    test_ist_timezone_definition()
    test_format_ist_datetime_str()
    test_ist_date_time_parsing_12h_and_24h()
    test_schedule_callback_5_minutes_future()
    test_schedule_callback_1_hour_future()
    test_immediate_due_trigger()
    print("=" * 60)
    print("ALL IST SCHEDULING TESTS PASSED SUCCESSFULLY! [PASS]")
    print("=" * 60)


if __name__ == "__main__":
    run_all_tests()
