"""Request/task-local identity for filesystem access; never a process-global user."""
from contextvars import ContextVar
import hashlib
import yaml

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
    if len(relative) >= 3 and relative[0] == 'exams':
        from solaire.web.platform_db import connect, default_platform_root, platform_db_path
        platform = default_platform_root()
        if platform_db_path(platform).is_file():
            actual = path.resolve().relative_to(project_root.resolve()).parts
            exam_id = '/'.join(actual[1:3])
            with connect(platform) as con:
                owners = {
                    str(row[0]) for row in con.execute(
                        'SELECT owner_teacher_id FROM paper_records WHERE exam_id = ? COLLATE NOCASE',
                        (exam_id,),
                    ) if row[0]
                }
                owners.update(str(row[0]) for row in con.execute(
                    'SELECT DISTINCT ep.teacher_id FROM exam_publications ep '
                    'JOIN paper_records p ON p.id=ep.paper_id WHERE p.exam_id = ? COLLATE NOCASE',
                    (exam_id,),
                ) if row[0])
            if owners and owners != {str(actor.get()['id'])}:
                raise PermissionError('无权访问其他教师的试卷')
        actual = path.resolve().relative_to(project_root.resolve()).parts
        workspace = project_root.resolve().joinpath(*actual[:3])
        document = workspace / 'exam.yaml'
        if document.is_file():
            try:
                raw = yaml.safe_load(document.read_text(encoding='utf-8'))
                metadata = raw.get('metadata') or {} if isinstance(raw, dict) else {}
                owner = str(metadata.get('owner_teacher_id') or '').strip()
            except (OSError, ValueError, AttributeError, yaml.YAMLError) as exc:
                raise ValueError('试卷归属信息无法读取') from exc
            if owner and owner != str(actor.get()['id']):
                raise PermissionError('无权访问其他教师的试卷')
    if len(relative) >= 2 and relative[:2] == ('resource', '__teachers'):
        if len(relative) < 3 or relative[2] != key:
            raise PermissionError('无权访问其他教师的题库')
    if len(relative) >= 2 and relative[0] == '.solaire' and relative[1] in {'bank_exports', 'bank_organization'}:
        if len(relative) < 3 or relative[2] != key:
            raise PermissionError('无权访问其他教师的题库资料')
    if len(relative) >= 2 and relative[0] == '.solaire' and relative[1] in ('legacy_bank_snapshot', 'bank_quarantine'):
        raise PermissionError('历史题库备份仅管理员可访问')
