"""host_dialogs."""

from __future__ import annotations



def _pick_executable_dialog() -> str | None:
    """Native file picker for an executable (same machine as API)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as e:
        raise RuntimeError("TKINTER_UNAVAILABLE") from e

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    try:
        path = filedialog.askopenfilename(
            title="选择程序文件",
            filetypes=[("可执行文件", "*.exe"), ("所有文件", "*.*")],
        )
    finally:
        root.destroy()
    return path or None


def _pick_directory_dialog() -> str | None:
    """
    Open a native folder picker (Tk). Runs on the same machine as the API (localhost).
    Returns None if user cancelled or closed dialog without selection.
    """
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as e:
        raise RuntimeError("TKINTER_UNAVAILABLE") from e

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    try:
        path = filedialog.askdirectory(mustexist=True)
    finally:
        root.destroy()
    return path or None
