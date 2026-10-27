"""Class membership captured with an assignment or explicitly before a transfer."""
from __future__ import annotations

import sqlite3


def freeze_attempt_class_memberships(
    con: sqlite3.Connection, attempt_ids: list[str], *, captured_at: str,
) -> int:
    """Freeze newly created assignments in the caller's transaction."""
    ids = list(dict.fromkeys(attempt_ids))
    frozen = 0
    for start in range(0, len(ids), 400):
        chunk = ids[start:start + 400]
        placeholders = ",".join("?" for _ in chunk)
        invalid = con.execute(
            f"""SELECT s.student_no, COUNT(DISTINCT cs.class_id) AS class_count
                FROM student_attempts sa
                JOIN students s ON s.id=sa.student_id
                LEFT JOIN class_students cs ON cs.student_id=sa.student_id
                LEFT JOIN publication_classes pc
                  ON pc.publication_id=sa.publication_id AND pc.class_id=cs.class_id
                WHERE sa.id IN ({placeholders}) AND sa.class_membership_frozen=0
                GROUP BY sa.id
                HAVING COUNT(DISTINCT cs.class_id)>1 OR COUNT(pc.class_id)=0 LIMIT 1""",
            chunk,
        ).fetchone()
        if invalid is not None:
            if invalid["class_count"] > 1:
                raise ValueError(f"学生 {invalid['student_no']} 的班级归属存在冲突，请先由学校管理员核对")
            raise ValueError(f"学生 {invalid['student_no']} 当前班级不在本次发布范围，请刷新名单后重试")
        con.execute(
            f"""INSERT OR IGNORE INTO attempt_class_snapshots
                (attempt_id,class_id,class_name,class_grade,captured_at,source)
                SELECT acm.attempt_id,acm.class_id,acm.class_name,acm.class_grade,?,'assignment'
                FROM attempt_class_memberships acm
                JOIN student_attempts sa ON sa.id=acm.attempt_id
                WHERE sa.id IN ({placeholders}) AND sa.class_membership_frozen=0""",
            (captured_at, *chunk),
        )
        cursor = con.execute(
            f"UPDATE student_attempts SET class_membership_frozen=1 WHERE id IN ({placeholders}) AND class_membership_frozen=0",
            chunk,
        )
        frozen += cursor.rowcount
    return frozen


def freeze_legacy_student_class_memberships(
    con: sqlite3.Connection, student_id: str, *, captured_at: str,
) -> int:
    """Preserve the visible legacy associations before changing current enrollment.

    The source records the capture at transfer time, not a reconstructed original
    exam-time class. Even unknown empty associations are frozen against later
    reassignment. The caller owns the transaction and connection.
    """
    rows = con.execute(
        """SELECT acm.attempt_id,acm.class_id,acm.class_name,acm.class_grade
           FROM attempt_class_memberships acm JOIN student_attempts sa ON sa.id=acm.attempt_id
           WHERE sa.student_id=? AND sa.class_membership_frozen=0""",
        (student_id,),
    ).fetchall()
    con.executemany(
        """INSERT OR IGNORE INTO attempt_class_snapshots
           (attempt_id,class_id,class_name,class_grade,captured_at,source)
           VALUES (?,?,?,?,?,'transfer_capture')""",
        [(row["attempt_id"], row["class_id"], row["class_name"], row["class_grade"], captured_at) for row in rows],
    )
    cursor = con.execute(
        "UPDATE student_attempts SET class_membership_frozen=1 WHERE student_id=? AND class_membership_frozen=0",
        (student_id,),
    )
    return cursor.rowcount
