"""Deterministic frontend build stamp generator and verifier.

Binds frontend build output (web/dist) to normalized web source inputs and git revision.
"""

from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import json
import posixpath
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote, urlsplit

SCHEMA_NAME = "sol-edu-frontend-build-stamp"
FORMAT_VERSION = 2

EXCLUDED_DIRS = {
    "dist",
    "node_modules",
    ".git",
    ".turbo",
    ".vite",
    ".cache",
    "coverage",
    "__pycache__",
    "pdfjs",
}

EXCLUDED_FILES = {
    "build-stamp.json",
    ".build-stamp.json",
    ".DS_Store",
    "Thumbs.db",
}


class _LocalResourceParser(HTMLParser):
    """Collect local resource references that must exist in a frontend build."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if value and (name == "src" or (name == "href" and tag == "link")):
                self.references.append(value)


def validate_frontend_references(index_html: bytes, output_paths: set[str]) -> None:
    """Reject an index that points to missing local scripts, styles, or other resources."""
    parser = _LocalResourceParser()
    parser.feed(index_html.decode("utf-8"))
    for reference in parser.references:
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        path = unquote(parsed.path)
        if path.startswith("/"):
            relative = path.lstrip("/")
        else:
            relative = posixpath.normpath(path)
        if relative in {"", "."}:
            relative = "index.html"
        elif relative.endswith("/"):
            relative += "index.html"
        if relative == ".." or relative.startswith("../"):
            raise ValueError(f"Frontend index resource escapes dist: {reference}")
        if relative not in output_paths:
            raise ValueError(f"Frontend index references missing local resource: {reference}")


def compute_output_fingerprint(dist_dir: Path) -> tuple[str, list[dict[str, str]]]:
    """Hash every built frontend file except the stamp itself, including compressed copies."""
    dist_dir = Path(dist_dir).resolve()
    if not dist_dir.is_dir():
        raise ValueError(f"Frontend output directory is missing: {dist_dir}")

    items: list[dict[str, str]] = []
    index_html: bytes | None = None
    for path in dist_dir.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Frontend output must not contain symlinks: {path}")
        if not path.is_file():
            continue
        relative_path = path.relative_to(dist_dir).as_posix()
        if relative_path == "build-stamp.json":
            continue
        digest = hashlib.sha256()
        with path.open("rb") as source:
            if relative_path == "index.html":
                index_html = source.read()
                digest.update(index_html)
            else:
                for chunk in iter(lambda: source.read(65536), b""):
                    digest.update(chunk)
        items.append({"path": relative_path, "sha256": digest.hexdigest()})

    items.sort(key=lambda item: item["path"])
    output_paths = {item["path"] for item in items}
    if index_html is None:
        raise ValueError("Frontend output is missing index.html")
    validate_frontend_references(index_html, output_paths)

    composite = hashlib.sha256()
    for item in items:
        composite.update(f"{item['path']}:{item['sha256']}\n".encode("utf-8"))
    return composite.hexdigest(), items


def compute_input_fingerprint(web_dir: Path) -> tuple[str, list[dict[str, str]]]:
    """Compute deterministic SHA-256 fingerprint for web sources."""
    web_dir = Path(web_dir).resolve()
    items: list[dict[str, str]] = []

    for path in web_dir.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(web_dir)
        if any(part in EXCLUDED_DIRS for part in rel.parts):
            continue
        if path.name in EXCLUDED_FILES:
            continue
        posix_path = rel.as_posix()
        hasher = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                hasher.update(chunk)
        items.append({"path": posix_path, "sha256": hasher.hexdigest()})

    items.sort(key=lambda x: x["path"])
    composite = hashlib.sha256()
    for item in items:
        composite.update(f"{item['path']}:{item['sha256']}\n".encode("utf-8"))

    return composite.hexdigest(), items


def get_git_metadata(repo_root: Path) -> tuple[str, bool | str]:
    """Get commit revision and dirty state for web directory."""
    try:
        rev = subprocess.check_output(
            ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except Exception:
        rev = "unknown"

    try:
        out = subprocess.check_output(
            ["git", "-C", str(repo_root), "status", "--porcelain", "--", "web"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        git_dirty = bool(out)
    except Exception:
        git_dirty = "unknown"

    return rev, git_dirty


def create_stamp(web_dir: Path, repo_root: Path | None = None) -> dict:
    """Create a stamp for the source inputs and complete built frontend output."""
    web_dir = Path(web_dir).resolve()
    repo_root = Path(repo_root).resolve() if repo_root else web_dir.parent
    fingerprint, inputs = compute_input_fingerprint(web_dir)
    output_fingerprint, outputs = compute_output_fingerprint(web_dir / "dist")
    revision, git_dirty = get_git_metadata(repo_root)

    return {
        "schema": SCHEMA_NAME,
        "format_version": FORMAT_VERSION,
        "revision": revision,
        "git_dirty": git_dirty,
        "fingerprint": fingerprint,
        "input_count": len(inputs),
        "inputs": inputs,
        "output_fingerprint": output_fingerprint,
        "output_count": len(outputs),
        "outputs": outputs,
    }


def write_stamp(stamp: dict, dest_path: Path) -> Path:
    """Write stamp dictionary to file as formatted JSON."""
    dest_path = Path(dest_path).resolve()
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_text(
        json.dumps(stamp, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return dest_path


def validate_stamp_schema(stamp: dict) -> None:
    """Validate stamp schema structure and version."""
    if not isinstance(stamp, dict):
        raise ValueError("Stamp content must be a JSON object")
    if stamp.get("schema") != SCHEMA_NAME:
        raise ValueError(
            f"Invalid stamp schema: expected '{SCHEMA_NAME}', got '{stamp.get('schema')}'"
        )
    if stamp.get("format_version") != FORMAT_VERSION:
        raise ValueError(
            f"Unsupported stamp format version: expected {FORMAT_VERSION}, got {stamp.get('format_version')}"
        )
    if not stamp.get("fingerprint") or not isinstance(stamp.get("fingerprint"), str):
        raise ValueError("Stamp is missing valid 'fingerprint'")
    if len(stamp["fingerprint"]) != 64 or any(
        char not in "0123456789abcdef" for char in stamp["fingerprint"]
    ):
        raise ValueError("Stamp 'fingerprint' must be a SHA-256 hex digest")
    if not isinstance(stamp.get("revision"), str) or not stamp["revision"]:
        raise ValueError("Stamp is missing valid 'revision'")
    git_dirty = stamp.get("git_dirty")
    if not isinstance(git_dirty, bool) and git_dirty != "unknown":
        raise ValueError("Stamp 'git_dirty' must be a boolean or 'unknown'")
    if not isinstance(stamp.get("inputs"), list):
        raise ValueError("Stamp is missing valid 'inputs' list")
    if (
        not isinstance(stamp.get("input_count"), int)
        or isinstance(stamp["input_count"], bool)
        or stamp["input_count"] != len(stamp["inputs"])
    ):
        raise ValueError("Stamp 'input_count' does not match its inputs")

    previous_path = None
    for item in stamp["inputs"]:
        if not isinstance(item, dict):
            raise ValueError("Stamp input entries must be objects")
        input_path = item.get("path")
        digest = item.get("sha256")
        if (
            not isinstance(input_path, str)
            or not input_path
            or input_path.startswith("/")
            or "\\" in input_path
            or any(part in {"", ".", ".."} for part in input_path.split("/"))
        ):
            raise ValueError("Stamp input paths must be normalized relative POSIX paths")
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or any(char not in "0123456789abcdef" for char in digest)
        ):
            raise ValueError("Stamp input sha256 values must be SHA-256 hex digests")
        if previous_path is not None and input_path <= previous_path:
            raise ValueError("Stamp inputs must have unique paths in sorted order")
        previous_path = input_path

    output_fingerprint = stamp.get("output_fingerprint")
    if (
        not isinstance(output_fingerprint, str)
        or len(output_fingerprint) != 64
        or any(char not in "0123456789abcdef" for char in output_fingerprint)
    ):
        raise ValueError("Stamp is missing valid 'output_fingerprint'")
    if not isinstance(stamp.get("outputs"), list):
        raise ValueError("Stamp is missing valid 'outputs' list")
    if (
        not isinstance(stamp.get("output_count"), int)
        or isinstance(stamp["output_count"], bool)
        or stamp["output_count"] != len(stamp["outputs"])
    ):
        raise ValueError("Stamp 'output_count' does not match its outputs")

    output_paths: set[str] = set()
    previous_path = None
    for item in stamp["outputs"]:
        if not isinstance(item, dict):
            raise ValueError("Stamp output entries must be objects")
        output_path = item.get("path")
        digest = item.get("sha256")
        if (
            not isinstance(output_path, str)
            or not output_path
            or output_path.startswith("/")
            or "\\" in output_path
            or any(part in {"", ".", ".."} for part in output_path.split("/"))
            or output_path == "build-stamp.json"
        ):
            raise ValueError("Stamp output paths must be normalized relative POSIX paths")
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or any(char not in "0123456789abcdef" for char in digest)
        ):
            raise ValueError("Stamp output sha256 values must be SHA-256 hex digests")
        if previous_path is not None and output_path <= previous_path:
            raise ValueError("Stamp outputs must have unique paths in sorted order")
        output_paths.add(output_path)
        previous_path = output_path
    if "index.html" not in output_paths:
        raise ValueError("Stamp output list must include index.html")

    composite = hashlib.sha256()
    for item in stamp["outputs"]:
        composite.update(f"{item['path']}:{item['sha256']}\n".encode("utf-8"))
    if composite.hexdigest() != output_fingerprint:
        raise ValueError("Stamp output fingerprint does not match its outputs")


def verify_stamp(
    dist_dir: Path,
    web_dir: Path | None = None,
    repo_root: Path | None = None,
    expected_revision: str | None = None,
    expected_fingerprint: str | None = None,
) -> dict:
    """Verify build stamp in dist_dir against web sources or expected values."""
    dist_dir = Path(dist_dir).resolve()
    stamp_file = dist_dir / "build-stamp.json"
    if not stamp_file.is_file():
        raise FileNotFoundError(f"Missing build stamp: {stamp_file}")

    try:
        stamp = json.loads(stamp_file.read_text(encoding="utf-8"))
    except Exception as e:
        raise ValueError(f"Corrupted or invalid build stamp JSON: {e}") from e

    validate_stamp_schema(stamp)

    current_output_fp, current_outputs = compute_output_fingerprint(dist_dir)
    if (
        stamp["output_fingerprint"] != current_output_fp
        or stamp["outputs"] != current_outputs
    ):
        raise ValueError(
            "Frontend output content mismatch: dist files differ from the build stamp"
        )

    if expected_fingerprint and stamp["fingerprint"] != expected_fingerprint:
        raise ValueError(
            f"Fingerprint mismatch: stamp has '{stamp['fingerprint']}', expected '{expected_fingerprint}'"
        )

    if expected_revision is not None and stamp["revision"] != expected_revision:
        raise ValueError(
            f"Revision mismatch: stamp has '{stamp['revision']}', expected '{expected_revision}'"
        )

    if web_dir is not None:
        current_fp, current_inputs = compute_input_fingerprint(Path(web_dir))
        if stamp["fingerprint"] != current_fp or stamp["inputs"] != current_inputs:
            raise ValueError(
                f"Source content fingerprint mismatch: dist stamp has '{stamp['fingerprint']}', but current web sources compute to '{current_fp}'"
            )

    return stamp


def main() -> int:
    parser = argparse.ArgumentParser(description="Frontend build stamp generator and verifier")
    subparsers = parser.add_subparsers(dest="command", required=True)

    gen_parser = subparsers.add_parser("generate", help="Generate build-stamp.json")
    gen_parser.add_argument("--web-dir", type=Path, default=Path("web"))
    gen_parser.add_argument("--repo-root", type=Path, default=None)
    gen_parser.add_argument("--output", type=Path, default=Path("web/dist/build-stamp.json"))

    verify_parser = subparsers.add_parser("verify", help="Verify build-stamp.json")
    verify_parser.add_argument("--dist-dir", type=Path, default=Path("web/dist"))
    verify_parser.add_argument("--web-dir", type=Path, default=None)
    verify_parser.add_argument("--repo-root", type=Path, default=None)
    verify_parser.add_argument("--expected-commit", type=str, default=None)
    verify_parser.add_argument("--expected-fingerprint", type=str, default=None)

    fp_parser = subparsers.add_parser("fingerprint", help="Compute input fingerprint only")
    fp_parser.add_argument("--web-dir", type=Path, default=Path("web"))

    args = parser.parse_args()

    if args.command == "generate":
        stamp = create_stamp(args.web_dir, args.repo_root)
        write_stamp(stamp, args.output)
        print(f"Build stamp written to {args.output} (fingerprint: {stamp['fingerprint']})")
        return 0

    if args.command == "verify":
        try:
            stamp = verify_stamp(
                dist_dir=args.dist_dir,
                web_dir=args.web_dir,
                repo_root=args.repo_root,
                expected_revision=args.expected_commit,
                expected_fingerprint=args.expected_fingerprint,
            )
            print(f"Build stamp verified: fingerprint={stamp['fingerprint']}, revision={stamp.get('revision')}")
            return 0
        except Exception as e:
            print(f"Build stamp verification failed: {e}", file=sys.stderr)
            return 1

    if args.command == "fingerprint":
        fp, items = compute_input_fingerprint(args.web_dir)
        print(f"Fingerprint: {fp} ({len(items)} inputs)")
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
