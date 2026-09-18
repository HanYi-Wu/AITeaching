from datetime import UTC, datetime

from solaire.web.student_service import _publication_datetime, _publication_availability


def test_legacy_chinese_wall_time_and_offset_are_equivalent():
    expected = datetime(2026, 9, 18, 2, 27, tzinfo=UTC)
    assert _publication_datetime('2026-09-18T10:27') == expected
    assert _publication_datetime('2026-09-18T10:27+08:00') == expected
    assert _publication_datetime('2026-09-18T02:27Z') == expected


def test_expired_publication_is_closed():
    assert not _publication_availability({'status': 'published', 'end_at': '2000-01-01T10:28'})[0]


def test_schedule_rejects_reversed_times():
    import pytest
    from solaire.web.paper_service import _normalized_schedule
    assert _normalized_schedule('2026-09-18T10:27', '2026-09-18T10:28') == ('2026-09-18T02:27:00+00:00', '2026-09-18T02:28:00+00:00')
    with pytest.raises(ValueError):
        _normalized_schedule('2026-09-18T10:28', '2026-09-18T10:27')
