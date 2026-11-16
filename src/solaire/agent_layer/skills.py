"""Skill system: scan SKILL.md files (YAML frontmatter + Markdown body), progressive disclosure."""

from __future__ import annotations

import re
import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class SkillDescriptor:
    """Tier 1: lightweight catalog entry loaded at startup."""

    name: str
    label: str
    description: str
    tool_patterns: tuple[str, ...]
    suggested_user_input: str
    skill_dir: Path
    prompt_fragment: str = ""


def _parse_yaml_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split SKILL.md into (yaml_dict, markdown_body)."""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not m:
        return {}, text
    yaml_block = m.group(1)
    body = text[m.end():]
    try:
        import yaml
        data = yaml.safe_load(yaml_block) or {}
    except Exception:
        data = _simple_yaml_parse(yaml_block)
    if not isinstance(data, dict):
        return {}, body.strip()
    return data, body.strip()


def _simple_yaml_parse(block: str) -> dict[str, Any]:
    """Fallback parser when PyYAML is unavailable."""
    result: dict[str, Any] = {}
    for line in block.split("\n"):
        line = line.strip()
        if ":" in line and not line.startswith("#"):
            k, v = line.split(":", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if v:
                result[k] = v
    return result


def _scan_skill_dir(directory: Path) -> list[SkillDescriptor]:
    """Scan a directory for */SKILL.md files and return descriptors."""
    skills: list[SkillDescriptor] = []
    try:
        if not directory.is_dir():
            return skills
        children = sorted(directory.iterdir())
    except OSError:
        return skills

    for child in children:
        skill_file = child / "SKILL.md"
        try:
            if not skill_file.is_file():
                continue
            text = skill_file.read_text(encoding="utf-8")
        except Exception:
            continue
        try:
            meta, body = _parse_yaml_frontmatter(text)
        except Exception:
            continue
        if not isinstance(meta, dict):
            continue
        raw_name = meta.get("name")
        if raw_name is None:
            continue
        name = str(raw_name).strip()
        if not name:
            continue
        md = meta.get("metadata") or {}
        if not isinstance(md, dict):
            md = {}
        tp_raw = md.get("tool_patterns", "")
        if isinstance(tp_raw, str):
            tool_patterns = tuple(tp_raw.split())
        elif isinstance(tp_raw, (list, tuple)):
            tool_patterns = tuple(str(x) for x in tp_raw)
        else:
            tool_patterns = ()
        desc_raw = meta.get("description", "")
        if isinstance(desc_raw, str):
            description = desc_raw.strip()
        else:
            description = str(desc_raw).strip()

        skills.append(SkillDescriptor(
            name=name,
            label=str(md.get("label", raw_name)).strip(),
            description=description,
            tool_patterns=tool_patterns,
            suggested_user_input=str(md.get("suggested_user_input", "")).strip(),
            skill_dir=child,
            prompt_fragment=body[:5000] if body else "",
        ))
    return skills


def _builtin_skills_dir() -> Path:
    return Path(__file__).parent / "skills"


def _project_skills_dir(project_root: Path) -> Path:
    return project_root / ".solaire" / "agent" / "skills"


class _SkillCache:
    _TTL_SECONDS = 10.0
    _MAX_PROJECT_CATALOGS = 16
    _MAX_PATH_ALIASES = 32

    def __init__(self):
        self._builtin_skills: dict[str, SkillDescriptor] | None = None
        self._builtin_stamp = 0.0
        self._builtin_version = 0
        self._project_catalogs: OrderedDict[
            str, tuple[float, int, dict[str, SkillDescriptor]]
        ] = OrderedDict()
        self._path_aliases: OrderedDict[Path, tuple[float, str, Path]] = OrderedDict()
        self._lock = threading.RLock()

    @staticmethod
    def _project_path_alias(project_root: Path) -> tuple[Path, Path]:
        path = project_root if isinstance(project_root, Path) else Path(project_root)
        if path.parts and path.parts[0].startswith("~"):
            path = path.expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        return path, path

    @staticmethod
    def _canonical_project_root(project_root: Path) -> tuple[str, Path]:
        root = Path(project_root).expanduser().resolve()
        key = os.path.normcase(os.path.normpath(str(root)))
        return key, root

    def get(self, project_root: Path | None = None) -> dict[str, SkillDescriptor]:
        path_alias: Path | None = None
        unresolved_root: Path | None = None
        if project_root is not None:
            path_alias, unresolved_root = self._project_path_alias(project_root)

        with self._lock:
            now = time.monotonic()
            if (self._builtin_skills is None or
                    now - self._builtin_stamp >= self._TTL_SECONDS):
                builtin = _scan_skill_dir(_builtin_skills_dir())
                self._builtin_skills = {skill.name: skill for skill in builtin}
                self._builtin_stamp = now
                self._builtin_version += 1

            if path_alias is None:
                return self._builtin_skills
            assert unresolved_root is not None

            alias = self._path_aliases.get(path_alias)
            if alias is not None and now - alias[0] < self._TTL_SECONDS:
                project_key, canonical_root = alias[1], alias[2]
                self._path_aliases.move_to_end(path_alias)
            else:
                project_key, canonical_root = self._canonical_project_root(unresolved_root)
                self._path_aliases[path_alias] = (now, project_key, canonical_root)
                self._path_aliases.move_to_end(path_alias)
                while len(self._path_aliases) > self._MAX_PATH_ALIASES:
                    self._path_aliases.popitem(last=False)

            cached = self._project_catalogs.get(project_key)
            if (cached is not None and now - cached[0] < self._TTL_SECONDS and
                    cached[1] == self._builtin_version):
                self._project_catalogs.move_to_end(project_key)
                return cached[2]

            result = self._builtin_skills.copy()
            for skill in _scan_skill_dir(_project_skills_dir(canonical_root)):
                result[skill.name] = skill

            self._project_catalogs[project_key] = (now, self._builtin_version, result)
            self._project_catalogs.move_to_end(project_key)
            while len(self._project_catalogs) > self._MAX_PROJECT_CATALOGS:
                self._project_catalogs.popitem(last=False)
            return result

    def clear(self) -> None:
        with self._lock:
            self._builtin_skills = None
            self._builtin_stamp = 0.0
            self._builtin_version = 0
            self._project_catalogs.clear()
            self._path_aliases.clear()


_skill_cache = _SkillCache()


def _ensure_cache(project_root: Path | None = None) -> dict[str, SkillDescriptor]:
    return _skill_cache.get(project_root)


def clear_skill_cache() -> None:
    _skill_cache.clear()


def get_skill(skill_id: str | None, project_root: Path | None = None) -> SkillDescriptor | None:
    if not skill_id:
        return None
    cache = _ensure_cache(project_root)
    return cache.get(skill_id.strip())


def list_skills_public(project_root: Path | None = None) -> list[dict[str, str]]:
    cache = _ensure_cache(project_root)
    return [
        {
            "id": s.name,
            "label": s.label,
            "description": s.description,
            "suggested_user_input": s.suggested_user_input,
        }
        for s in cache.values()
    ]


def build_skill_catalog(project_root: Path | None = None) -> str:
    """Tier 1 catalog: name + description for all discovered skills."""
    cache = _ensure_cache(project_root)
    if not cache:
        return ""
    lines: list[str] = []
    for s in sorted(cache.values(), key=lambda x: x.name):
        lines.append(f"- **{s.label or s.name}**（`{s.name}`）：{s.description}")
    return "\n".join(lines)


def load_skill_content(name: str, project_root: Path | None = None) -> str | None:
    """Tier 2: load full SKILL.md body for activated skill."""
    sk = get_skill(name, project_root)
    if sk is None:
        return None
    skill_file = sk.skill_dir / "SKILL.md"
    if not skill_file.is_file():
        return None
    try:
        text = skill_file.read_text(encoding="utf-8")
    except Exception:
        return None
    _, body = _parse_yaml_frontmatter(text)
    return body or sk.prompt_fragment
