from datetime import UTC, datetime

from solaire.web.student_service import _publication_datetime, _publication_availability


def test_legacy_chinese_wall_time_and_offset_are_equivalent():
    expected = datetime(2026, 9, 18, 2, 27, tzinfo=UTC)
    assert _publication_datetime('2026-09-18T10:27') == expected
    assert _publication_datetime('2026-09-18T10:27+08:00') == expected
    assert _publication_datetime('2026-09-18T02:27Z') == expected


def test_expired_publication_is_closed():
    assert not _publication_availability({'status': 'published', 'end_at': '2000-01-01T10:28'})[0]
