"""Verify a delivery against an explicit repository commit."""

import argparse
import json
import sys
import subprocess
import tarfile
import zipfile
from pathlib import Path

from .source import VerificationError, verify_source_archive
from .offline import verify_offline_bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["source", "offline"])
    parser.add_argument("archive", type=Path)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--ref", default="HEAD")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--checksum", type=Path)
    args = parser.parse_args()
    try:
        result = (
            verify_source_archive(args.archive, args.repo, args.ref)
            if args.kind == "source"
            else verify_offline_bundle(
                args.archive, args.repo, args.ref, checksum=args.checksum
            )
        )
    except (
        VerificationError,
        OSError,
        ValueError,
        subprocess.CalledProcessError,
        tarfile.TarError,
        zipfile.BadZipFile,
    ) as exc:
        print(f"Verification failed: {exc}", file=sys.stderr)
        return 1
    document = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(document + "\n", encoding="utf-8")
    print(document)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
