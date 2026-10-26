from datetime import UTC, datetime

import pytest

from solaire.web.paper_service import (
    DELIVERY_MODES,
    PUBLICATION_STATUSES,
    SUBMISSION_MODES,
    _normalized_schedule,
)
from solaire.web.student_service import _publication_availability, _publication_datetime
from solaire.web.papers.publication_policy import (
    ensure_publication_status_transition,
    normalize_delivery_mode,
    normalize_publication_status,
    normalize_submission_mode,
    normalize_time_limit,
)


def test_legacy_chinese_wall_time_and_offset_are_equivalent():
    expected = datetime(2026, 9, 18, 2, 27, tzinfo=UTC)
    assert _publication_datetime('2026-09-18T10:27') == expected
    assert _publication_datetime('2026-09-18T10:27+08:00') == expected
    assert _publication_datetime('2026-09-18T02:27Z') == expected


def test_expired_publication_is_closed():
    assert not _publication_availability({'status': 'published', 'end_at': '2000-01-01T10:28'})[0]


def test_schedule_rejects_reversed_times():
    assert _normalized_schedule('2026-09-18T10:27', '2026-09-18T10:28') == ('2026-09-18T02:27:00+00:00', '2026-09-18T02:28:00+00:00')
    with pytest.raises(ValueError):
        _normalized_schedule('2026-09-18T10:28', '2026-09-18T10:27')


def test_publication_policy_validation_and_legacy_exports():
    assert DELIVERY_MODES == {'offline', 'online'}
    assert PUBLICATION_STATUSES == {'draft', 'published', 'paused', 'closed', 'revoked'}
    assert SUBMISSION_MODES == {'online', 'image_manual', 'image_ai'}
    assert normalize_delivery_mode(' online ') == 'online'
    assert normalize_publication_status(' ') == 'published'
    assert normalize_submission_mode(' ') == 'online'
    assert normalize_time_limit(-5) is None
    assert normalize_time_limit('', empty_as_zero=True) is None
    ensure_publication_status_transition('revoked', 'revoked')

    with pytest.raises(ValueError, match='delivery_mode must be offline or online'):
        normalize_delivery_mode('mobile')
    with pytest.raises(ValueError, match='invalid publication status'):
        normalize_publication_status('deleted')
    with pytest.raises(ValueError, match='submission_mode must be online, image_manual, or image_ai'):
        normalize_submission_mode('paper')
    with pytest.raises(ValueError, match='已撤回的发布不能直接恢复'):
        ensure_publication_status_transition('revoked', 'published')


def test_time_limit_update_keeps_strict_integer_conversion():
    with pytest.raises(ValueError):
        normalize_time_limit('')
