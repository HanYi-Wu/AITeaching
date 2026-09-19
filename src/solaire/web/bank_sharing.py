"""Expiring bearer invitations contain an immutable, bounded private-bank snapshot."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import shutil
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

from solaire.common.actor_context import actor, teacher_key
from solaire.web.bank_folders import _db, _parents, _snapshot, read
from solaire.web.bank_service import get_question_detail, list_bank_entries
from solaire.web.platform_db import default_platform_root
from solaire.web.security import assert_within_project, safe_filename_component
from solaire.web.teacher_bank import bank_resource_root

_EMBED = re.compile(r':::EMBED_(IMG|SVG|PDF):([^\r\n]+?):::')
_MAX_BYTES = 50 * 1024 * 1024


def _owner() -> str:
    user = actor.get()
    if not user or user.get('role') != 'teacher' or not user.get('id'):
        raise PermissionError('仅已登录教师可使用题库邀请')
    return str(user['id'])


@contextmanager
def _shares():
    directory = default_platform_root()
    directory.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(directory / 'bank-shares.sqlite3', timeout=15)
    try:
        con.execute('CREATE TABLE IF NOT EXISTS invitations (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, expires TEXT NOT NULL, payload TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)')
        con.execute('CREATE TABLE IF NOT EXISTS redemptions (digest TEXT NOT NULL, recipient TEXT NOT NULL, PRIMARY KEY(digest,recipient))')
        with con:
            yield con
    finally:
        con.close()


def _hash(code: str) -> str:
    if not 16 <= len(code.strip()) <= 100:
        raise ValueError('邀请码无效')
    return hashlib.sha256(code.strip().encode()).hexdigest()


def create(root: Path, path: str) -> dict:
    owner = _owner()
    state = read(root, owner_id=owner)
    if not path or path not in state['folders']:
        raise ValueError('请选择存在的文件夹，不可分享整个根目录')
    ids = [entry['qualified_id'] for entry in list_bank_entries(root)
           if state['assignments'].get(entry['qualified_id'], '') == path
           or state['assignments'].get(entry['qualified_id'], '').startswith(path + '/')]
    if len(ids) > 300:
        raise ValueError('每次分享最多300题，请拆分文件夹')
    assets: dict[str, str] = {}
    records = []
    asset_bytes = 0
    for qid in ids:
        detail = get_question_detail(root, qid)
        record = detail.get('question') or detail.get('question_group')
        serialized = json.dumps(record, ensure_ascii=False)
        # Traverse strings, not JSON escapes, so non-ASCII and backslash paths remain exact.
        def collect(value):
            nonlocal asset_bytes
            if isinstance(value, str):
                for match in _EMBED.finditer(value):
                    resource_path = match[2].replace('\\', '/')
                    if resource_path in assets:
                        continue
                    source = (root / 'resource' / resource_path).resolve()
                    assert_within_project(root, source)
                    if not source.is_relative_to(bank_resource_root(root).resolve()) or not source.is_file():
                        raise ValueError('题目图片缺失或不属于当前教师，未生成邀请')
                    size = source.stat().st_size
                    asset_bytes += size
                    if asset_bytes > _MAX_BYTES:
                        raise ValueError('分享图片总量不能超过50MB')
                    assets[resource_path] = base64.b64encode(source.read_bytes()).decode()
            elif isinstance(value, dict):
                for child in value.values(): collect(child)
            elif isinstance(value, list):
                for child in value: collect(child)
        collect(record)
        records.append({'record': json.loads(serialized), 'subject': detail['subject'] or 'main', 'folder': state['assignments'][qid][len(path):].lstrip('/')})
    payload = json.dumps({'name': path.rsplit('/', 1)[-1], 'folders': [p[len(path):].lstrip('/') for p in state['folders'] if p == path or p.startswith(path + '/')], 'records': records, 'assets': assets}, ensure_ascii=False)
    if len(payload.encode()) > 72 * 1024 * 1024:
        raise ValueError('分享内容过大')
    code = 'EH-' + secrets.token_urlsafe(24)
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    with _shares() as con:
        con.execute('INSERT INTO invitations VALUES (?,?,?,?,0)', (_hash(code), owner, expires, payload))
    return {'code': code, 'expires_at': expires, 'question_count': len(records), 'name': path.rsplit('/', 1)[-1]}


def revoke(code: str) -> dict:
    with _shares() as con:
        result = con.execute('UPDATE invitations SET revoked=1 WHERE digest=? AND owner=?', (_hash(code), _owner()))
        if not result.rowcount:
            raise ValueError('邀请不存在或不属于当前教师')
    return {'ok': True}


def redeem(root: Path, code: str) -> dict:
    owner = _owner()
    digest = _hash(code)
    library = bank_resource_root(root)
    collection = 'shared_' + uuid.uuid4().hex
    staging = library / ('.share-' + uuid.uuid4().hex)
    final = library / 'shared' / collection
    assert_within_project(root, final)
    if not final.resolve().is_relative_to(library.resolve()):
        raise PermissionError('分享目标必须位于自己的题库')
    copied_paths: list[Path] = []
    try:
        with _shares() as con:
            con.execute('BEGIN IMMEDIATE')
            row = con.execute('SELECT owner,expires,payload,revoked FROM invitations WHERE digest=?', (digest,)).fetchone()
            if not row or row[3] or datetime.fromisoformat(row[1]) <= datetime.now(timezone.utc):
                raise ValueError('邀请码不存在、已撤销或已过期')
            if row[0] == owner:
                raise ValueError('无需导入自己的邀请')
            if con.execute('SELECT 1 FROM redemptions WHERE digest=? AND recipient=?', (digest, owner)).fetchone():
                raise ValueError('此邀请已导入，不重复复制')
            payload = json.loads(row[2])
            name = payload['name']
            with _db(root, owner) as organization:
                organization.execute('BEGIN IMMEDIATE')
                if name in _snapshot(organization)['folders']:
                    raise ValueError('根目录已存在同名文件夹，请先重命名已有目录')
                staging.mkdir(parents=True)
                replacements = {}
                for index, (original, encoded) in enumerate(payload['assets'].items()):
                    extension = Path(original).suffix.lower()
                    if extension not in {'.png','.jpg','.jpeg','.webp','.gif','.svg','.pdf'}:
                        raise ValueError('不支持的图片附件格式')
                    relative = f'image/{index}{extension}'
                    destination = staging / relative
                    destination.parent.mkdir(exist_ok=True)
                    destination.write_bytes(base64.b64decode(encoded, validate=True))
                    prefix = f'__teachers/{teacher_key()}/' if teacher_key() else ''
                    replacements[original] = f'{prefix}shared/{collection}/{relative}'
                def rewrite(value):
                    if isinstance(value, str):
                        return _EMBED.sub(lambda m: f':::EMBED_{m[1]}:{replacements.get(m[2].replace(chr(92), "/"), m[2])}:::', value)
                    if isinstance(value, list): return [rewrite(v) for v in value]
                    if isinstance(value, dict): return {k: rewrite(v) for k,v in value.items()}
                    return value
                for folder in payload['folders']:
                    _parents(organization, '/'.join(filter(None, [name, folder])))
                for index, entry in enumerate(payload['records']):
                    record = rewrite(entry['record'])
                    qid = f'q{index+1}'
                    record['id'] = qid
                    metadata = dict(record.get('metadata') or {})
                    metadata['shared_original_source'] = metadata.get('source', '')
                    metadata['source'] = '教师分享'
                    record['metadata'] = metadata
                    subject = safe_filename_component(entry['subject'])
                    if not subject or subject.startswith('.') or subject == '__teachers':
                        raise ValueError('分享题目学科名称无效')
                    question_dir = staging / '.questions' / subject
                    question_dir.mkdir(parents=True, exist_ok=True)
                    (question_dir / f'{qid}.yaml').write_text(yaml.safe_dump(record, allow_unicode=True, sort_keys=False), encoding='utf-8')
                    folder = '/'.join(filter(None, [name, entry['folder']]))
                    organization.execute('INSERT INTO assignments VALUES (?,?)', (f'{subject}/{collection}/{qid}', folder))
                questions = staging / '.questions'
                for directory in list(questions.iterdir()) if questions.is_dir() else []:
                    target = library / directory.name / collection
                    assert_within_project(root, target)
                    if not target.resolve().is_relative_to(library.resolve()):
                        raise PermissionError('分享题目目标必须位于自己的题库')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    directory.rename(target)
                    copied_paths.append(target)
                final.parent.mkdir(parents=True, exist_ok=True)
                staging.rename(final)
                copied_paths.append(final)
                con.execute('INSERT INTO redemptions VALUES (?,?)', (digest, owner))
                result = _snapshot(organization)
        return {**result, 'question_count': len(payload['records']), 'name': name}
    except Exception:
        # Only paths created by this invocation can be removed; existing bank files are untouched.
        if staging.is_dir(): shutil.rmtree(staging)
        for created in copied_paths:
            if created.is_dir(): shutil.rmtree(created)
        raise
