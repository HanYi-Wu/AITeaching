"""School, teacher, class, and student management services."""

from __future__ import annotations

import secrets
import uuid
from pathlib import Path
from typing import Any

from solaire.web.auth_service import hash_password, utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict

from solaire.web.school.common import (
    MAX_PAGE_SIZE,
    VALID_ACCOUNT_STATUSES,
    _cell_text,
    _clean_status,
    _contains_query,
    _fetch_required,
    _new_id,
    _new_student_password,
    _new_student_username,
    _page,
)
from solaire.web.school.accounts import (
    bulk_update_students,
    bulk_update_teachers,
    create_school_user,
    create_teacher,
    create_user,
    reset_student_password,
    reset_teacher_password,
    update_teacher,
)
from solaire.web.school.roster import (
    assign_teacher_class,
    list_students,
    list_teacher_class_assignments,
    list_teachers,
    query_students,
    query_teachers,
    remove_teacher_class_assignment,
    set_teacher_subjects,
    update_student,
)
from solaire.web.school.importer import (
    import_classes,
    import_students,
    import_teacher_class_assignments,
    import_teachers,
)
from solaire.web.school.organization import (
    create_class,
    create_school,
    delete_class,
    get_school,
    list_classes,
    list_schools,
    query_classes,
    query_schools,
    update_class,
)


































def update_school_ai_enabled(root: Path, *, school_id: str, ai_enabled: bool) -> dict[str, Any]:
    init_platform_db(root)
    now = utc_now()
    with connect(root) as con:
        existing = con.execute("SELECT 1 FROM schools WHERE id = ?", (school_id,)).fetchone()
        if existing is None:
            raise ValueError("school not found")
        con.execute(
            "UPDATE schools SET ai_enabled = ?, updated_at = ? WHERE id = ?",
            (1 if ai_enabled else 0, now, school_id),
        )
        row = con.execute("SELECT * FROM schools WHERE id = ?", (school_id,)).fetchone()
    school = row_to_dict(row)
    if school is None:
        raise RuntimeError("failed to update school")
    return school
