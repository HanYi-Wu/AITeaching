"""Logical organization only: never change question IDs, source files or images."""
from __future__ import annotations

import sqlite3
import hashlib
from contextlib import contextmanager
from pathlib import Path

from solaire.web.bank_service import list_bank_entries


def _path(value: str, *, root: bool = False) -> str:
    value = value.strip()
    if not value and root:
        return ''
    parts = value.split('/')
    if (not value or len(value) > 240 or len(parts) > 12
            or any(p in ('', '.', '..') or p != p.strip() for p in parts)
            or any(ord(c) < 32 or c in '\\:*?"<>|' for c in value)):
        raise ValueError('目录路径无效：使用 / 分隔子目录，不允许空名称、.. 或特殊字符')
    return value


@contextmanager
def _db(root: Path, owner_id: str = ''):
    directory = root / '.solaire'
    if owner_id:
        directory = directory / 'bank_organization' / hashlib.sha256(owner_id.encode()).hexdigest()
    directory.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(directory / 'bank-folders.sqlite3', timeout=15)
    try:
        db.execute('CREATE TABLE IF NOT EXISTS folders (path TEXT PRIMARY KEY)')
        db.execute('CREATE TABLE IF NOT EXISTS assignments (qid TEXT PRIMARY KEY, folder TEXT NOT NULL)')
        with db:
            yield db
    finally:
        db.close()


def _snapshot(db):
    return {'folders': [r[0] for r in db.execute('SELECT path FROM folders ORDER BY path')],
            'assignments': dict(db.execute('SELECT qid, folder FROM assignments'))}


def read(root: Path, *, owner_id: str = '') -> dict:
    with _db(root, owner_id) as db:
        return _snapshot(db)


def _parents(db, path):
    parts = path.split('/')
    for n in range(1, len(parts) + 1):
        db.execute('INSERT OR IGNORE INTO folders VALUES (?)', ('/'.join(parts[:n]),))


def act(root: Path, action: str, *, path: str = '', target: str = '', qualified_ids: list[str] | None = None, owner_id: str = '') -> dict:
    path = _path(path, root=action == 'move')
    with _db(root, owner_id) as db:
        db.execute('BEGIN IMMEDIATE')
        state = _snapshot(db)
        folders = set(state['folders'])
        if action == 'create':
            if path in folders:
                raise ValueError('目录已存在')
            _parents(db, path)
        elif action == 'move':
            ids = list(dict.fromkeys(qualified_ids or []))
            if not ids or len(ids) > 500:
                raise ValueError('请选择 1 至 500 道题目')
            if path and path not in folders:
                raise ValueError('目标目录不存在')
            known = {item['qualified_id'] for item in list_bank_entries(root)}
            if any(qid not in known for qid in ids):
                raise ValueError('部分题目不存在或不属于当前教师，未移动任何题目')
            for qid in ids:
                if path:
                    db.execute('INSERT OR REPLACE INTO assignments VALUES (?, ?)', (qid, path))
                else:
                    db.execute('DELETE FROM assignments WHERE qid=?', (qid,))
        elif action in ('rename', 'remove'):
            if path not in folders:
                raise ValueError('目录不存在')
            descendants = [p for p in folders if p == path or p.startswith(path + '/')]
            if action == 'rename':
                target = _path(target)
                if target in folders or target.startswith(path + '/'):
                    raise ValueError('目标目录已存在，或位于自身子目录中')
                for old in descendants:
                    _path(target + old[len(path):])
                _parents(db, target)
                for old in descendants:
                    new = target + old[len(path):]
                    db.execute('INSERT OR IGNORE INTO folders VALUES (?)', (new,))
                    db.execute('UPDATE assignments SET folder=? WHERE folder=?', (new, old))
            else:
                parent = path.rpartition('/')[0]
                for old in descendants:
                    if parent:
                        db.execute('UPDATE assignments SET folder=? WHERE folder=?', (parent, old))
                    else:
                        db.execute('DELETE FROM assignments WHERE folder=?', (old,))
            db.executemany('DELETE FROM folders WHERE path=?', [(p,) for p in descendants])
        else:
            raise ValueError('未知目录操作')
        return _snapshot(db)
