import sys
from pathlib import Path

import pytest

from solaire.exam_compiler import __version__
from tools.release_verify.update_smoke import smoke_candidate


def test_candidate_smoke_exercises_real_login_and_validates_version():
    repository = Path(__file__).resolve().parents[1]
    python = Path(sys.executable)
    smoke_candidate(repository, python, __version__)
    with pytest.raises(ValueError, match="version or health"):
        smoke_candidate(repository, python, "999.0.0")
