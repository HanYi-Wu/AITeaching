"""ZIP extracted tree resource indexing for fast embed image resolution."""
from __future__ import annotations

import os
from pathlib import Path


class ExtractedZipIndex:
    """Pre-indexed directory representation of an extracted exchange ZIP package.

    Eliminates O(N * M) recursive directory walks when resolving image references.
    """

    def __init__(self, extract_root: Path):
        self.extract_root = extract_root.resolve()
        self.files_by_rel: dict[str, Path] = {}
        self.files_by_name: dict[str, list[Path]] = {}
        self.image_dirs: list[Path] = []

        # Traverse once in sorted order to ensure deterministic behavior
        for root, dirs, files in os.walk(self.extract_root):
            root_path = Path(root).resolve()
            if root_path.name == "image":
                self.image_dirs.append(root_path)
            for f in sorted(files):
                p = root_path / f
                try:
                    rel = p.relative_to(self.extract_root).as_posix()
                    self.files_by_rel[rel] = p
                except ValueError:
                    pass
                self.files_by_name.setdefault(f, []).append(p)
        self.image_dirs.sort()

    def resolve_embed(self, rel: str) -> Path | None:
        """Resolve an embed image reference using identical precedence to legacy logic:

        1. Exact relative path from extract root
        2. image/<basename> under extract root
        3. <sorted rglob(image)>/<basename>
        4. Unique single match across entire extract tree by basename
        """
        rel = rel.strip().replace("\\", "/")
        if not rel or ".." in rel or rel.startswith("/"):
            return None

        # 1. Exact relative path
        p1 = (self.extract_root / rel).resolve()
        try:
            p1.relative_to(self.extract_root)
        except ValueError:
            return None
        if p1.is_file():
            return p1

        base = Path(rel).name

        # 2. extract_root / "image" / base
        p2 = (self.extract_root / "image" / base).resolve()
        if p2.is_file():
            try:
                p2.relative_to(self.extract_root)
                return p2
            except ValueError:
                pass

        # 3. image_dirs (sorted rglob("image"))
        for img_dir in self.image_dirs:
            p3 = (img_dir / base).resolve()
            if p3.is_file():
                try:
                    p3.relative_to(self.extract_root)
                    return p3
                except ValueError:
                    pass

        # 4. Unique match across entire tree by basename
        matches = self.files_by_name.get(base, [])
        if len(matches) == 1 and matches[0].is_file():
            return matches[0]

        return None
