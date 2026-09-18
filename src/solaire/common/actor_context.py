"""Request/task-local identity for filesystem access; never a process-global user."""
from contextvars import ContextVar
import hashlib

actor = ContextVar('eh_content_actor', default=None)


def teacher_key() -> str | None:
    user = actor.get()
    if not user or user.get('role') != 'teacher':
        return None
    if not user.get('id'):
        raise PermissionError('教师身份无效')
    return hashlib.sha256(str(user['id']).encode()).hexdigest()


def assert_private_bank_path(project_root, path):
    key = teacher_key()
    if not key:
        return
    # Windows paths are case-insensitive; alternate casing must not bypass ACLs.
    relative = tuple(part.casefold() for part in path.resolve().relative_to(project_root.resolve()).parts)
    if len(relative) >= 2 and relative[:2] == ('resource', '__teachers'):
        if len(relative) < 3 or relative[2] != key:
            raise PermissionError('无权访问其他教师的题库')
    if len(relative) >= 2 and relative[:2] == ('.solaire', 'bank_exports'):
        if len(relative) < 3 or relative[2] != key:
            raise PermissionError('无权访问其他教师的导出文件')
    if len(relative) >= 2 and relative[0] == '.solaire' and relative[1] in ('legacy_bank_snapshot', 'bank_quarantine'):
        raise PermissionError('历史题库备份仅管理员可访问')
