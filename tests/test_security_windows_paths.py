"""Windows path aliases must retain containment and private-bank checks."""

from pathlib import PureWindowsPath
from unittest.mock import Mock

import pytest

from solaire.common import actor_context
from solaire.common.security import PathEscapesProjectRoot, assert_within_project


@pytest.mark.parametrize(
    "root,target,allowed",
    [
        (r"C:\project", r"\\?\C:\project\resource\item.yaml", True),
        (r"\\?\C:\project", r"C:\project\resource\item.yaml", True),
        (r"\\server\share\project", r"\\?\UNC\server\share\project\item.yaml", True),
        (r"C:\project", r"\\?\C:\project-other\item.yaml", False),
        (r"C:\project", r"\\?\D:\project\item.yaml", False),
        (r"\\server\share\project", r"\\?\UNC\other\share\project\item.yaml", False),
    ],
)
def test_windows_namespaces_do_not_change_containment(
    monkeypatch, root, target, allowed
):
    policy = Mock()
    monkeypatch.setattr(actor_context, "assert_private_bank_path", policy)
    project = Mock(resolve=lambda: PureWindowsPath(root))
    path = Mock(resolve=lambda: PureWindowsPath(target))
    if allowed:
        resolved = assert_within_project(project, path)
        policy.assert_called_once()
        assert not str(resolved).startswith("\\\\?\\")
    else:
        with pytest.raises(PathEscapesProjectRoot):
            assert_within_project(project, path)
        policy.assert_not_called()
