"""SolEdu offline answer scanner uploader (stdlib-only Tk application)."""

from __future__ import annotations

import json
import mimetypes
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"}
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024


class ApiClient:
    def __init__(self) -> None:
        self.base_url = ""
        self.token = ""

    def configure(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def request(self, path: str, *, method: str = "GET", data: bytes | None = None, content_type: str | None = None):
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if content_type:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                detail = json.loads(raw.decode("utf-8")).get("detail")
            except Exception:
                detail = raw.decode("utf-8", errors="replace") or str(exc)
            raise RuntimeError(str(detail)) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"无法连接服务器：{exc.reason}") from exc
        return json.loads(raw.decode("utf-8")) if raw else {}

    def json_request(self, path: str, payload: dict[str, object]):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        return self.request(path, method="POST", data=data, content_type="application/json")

    def upload(self, path: str, fields: dict[str, str], files: list[Path]):
        boundary = f"----SolEdu{uuid.uuid4().hex}"
        chunks: list[bytes] = []
        for key, value in fields.items():
            chunks.extend(
                [
                    f"--{boundary}\r\n".encode(),
                    f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode(),
                    value.encode("utf-8"),
                    b"\r\n",
                ]
            )
        for file_path in files:
            mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
            chunks.extend(
                [
                    f"--{boundary}\r\n".encode(),
                    f'Content-Disposition: form-data; name="files"; filename="{file_path.name}"\r\n'.encode("utf-8"),
                    f"Content-Type: {mime}\r\n\r\n".encode(),
                    file_path.read_bytes(),
                    b"\r\n",
                ]
            )
        chunks.append(f"--{boundary}--\r\n".encode())
        return self.request(
            path,
            method="POST",
            data=b"".join(chunks),
            content_type=f"multipart/form-data; boundary={boundary}",
        )


class UploaderApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("SolEdu 线下答卷采集器")
        self.geometry("820x620")
        self.minsize(760, 560)
        self.client = ApiClient()
        self.papers: list[dict[str, object]] = []
        self.classes: list[dict[str, object]] = []
        self.students: list[dict[str, object]] = []
        self.selected_files: list[Path] = []
        self.student_request_id = 0
        self._build_ui()

    def _build_ui(self) -> None:
        root = ttk.Frame(self, padding=16)
        root.pack(fill="both", expand=True)
        ttk.Label(root, text="线下答卷照片采集", font=("Microsoft YaHei UI", 18, "bold")).pack(anchor="w")
        ttk.Label(root, text="照片按页码顺序上传；AI 只生成建议，最终分数请回到教师端复核。", foreground="#555").pack(anchor="w", pady=(2, 14))

        login = ttk.LabelFrame(root, text="1. 登录服务器", padding=10)
        login.pack(fill="x")
        self.server = tk.StringVar(value="http://127.0.0.1:5173")
        self.username = tk.StringVar()
        self.password = tk.StringVar()
        for col in range(6):
            login.columnconfigure(col, weight=1 if col in {1, 3} else 0)
        ttk.Label(login, text="服务地址").grid(row=0, column=0, sticky="w")
        ttk.Entry(login, textvariable=self.server, width=28).grid(row=0, column=1, sticky="ew", padx=(6, 12))
        ttk.Label(login, text="教师账号").grid(row=0, column=2, sticky="w")
        ttk.Entry(login, textvariable=self.username, width=16).grid(row=0, column=3, sticky="ew", padx=(6, 12))
        ttk.Label(login, text="密码").grid(row=0, column=4, sticky="w")
        ttk.Entry(login, textvariable=self.password, show="*", width=16).grid(row=0, column=5, sticky="ew", padx=(6, 12))
        ttk.Button(login, text="登录并加载", command=self.login).grid(row=0, column=6)

        selection = ttk.LabelFrame(root, text="2. 选择试卷与学生", padding=10)
        selection.pack(fill="x", pady=12)
        selection.columnconfigure(1, weight=1)
        selection.columnconfigure(3, weight=1)
        ttk.Label(selection, text="试卷").grid(row=0, column=0, sticky="w")
        self.paper_box = ttk.Combobox(selection, state="readonly")
        self.paper_box.grid(row=0, column=1, sticky="ew", padx=(6, 14))
        ttk.Label(selection, text="班级").grid(row=0, column=2, sticky="w")
        self.class_box = ttk.Combobox(selection, state="readonly")
        self.class_box.grid(row=0, column=3, sticky="ew", padx=(6, 0))
        self.class_box.bind("<<ComboboxSelected>>", lambda _event: self.load_students())
        ttk.Label(selection, text="学生").grid(row=1, column=0, sticky="w", pady=(10, 0))
        self.student_box = ttk.Combobox(selection, state="readonly")
        self.student_box.grid(row=1, column=1, sticky="ew", padx=(6, 14), pady=(10, 0))

        files = ttk.LabelFrame(root, text="3. 选择多张答卷照片", padding=10)
        files.pack(fill="both", expand=True)
        toolbar = ttk.Frame(files)
        toolbar.pack(fill="x")
        ttk.Button(toolbar, text="选择照片", command=self.choose_files).pack(side="left")
        ttk.Button(toolbar, text="清空", command=self.clear_files).pack(side="left", padx=8)
        ttk.Label(toolbar, text="支持 JPG、PNG、WebP、BMP、TIFF、HEIC/HEIF；最多 20 张").pack(side="right")
        self.file_list = tk.Listbox(files, height=12)
        self.file_list.pack(fill="both", expand=True, pady=(10, 0))

        footer = ttk.Frame(root)
        footer.pack(fill="x", pady=(12, 0))
        self.status = tk.StringVar(value="请先登录")
        ttk.Label(footer, textvariable=self.status).pack(side="left")
        self.upload_button = ttk.Button(footer, text="上传该学生答卷", command=self.upload, state="disabled")
        self.upload_button.pack(side="right")

    def _background(self, work, done, on_error=None) -> None:
        def failed(exc: Exception) -> None:
            messagebox.showerror("操作失败", str(exc))
            self.status.set("操作失败，请查看提示")
            if on_error is not None:
                on_error()

        def runner() -> None:
            try:
                result = work()
            except Exception as exc:
                self.after(0, lambda error=exc: failed(error))
                return
            self.after(0, lambda: done(result))
        threading.Thread(target=runner, daemon=True).start()

    def login(self) -> None:
        server = self.server.get().strip()
        username = self.username.get().strip()
        password = self.password.get()
        self.client.configure(server)
        self.status.set("正在登录并加载数据...")
        self.upload_button.configure(state="disabled")

        def work():
            login = self.client.json_request("/api/auth/login", {"username": username, "password": password})
            self.client.token = str(login["token"])
            papers = self.client.request("/api/papers?delivery_mode=offline&status=all&page=1&page_size=100")
            paper_items = list(papers.get("papers", []))
            for page in range(2, int(papers.get("total_pages") or 1) + 1):
                next_page = self.client.request(
                    f"/api/papers?delivery_mode=offline&status=all&page={page}&page_size=100"
                )
                paper_items.extend(next_page.get("papers", []))
            classes = self.client.request("/api/teacher/classes")
            offline_papers = [item for item in paper_items if item.get("delivery_mode") == "offline"]
            return offline_papers, classes.get("classes", [])

        def done(result) -> None:
            self.papers, self.classes = result
            self.paper_box["values"] = [f"{item.get('title')}｜{item.get('subject')}｜{item.get('delivery_mode')}" for item in self.papers]
            self.class_box["values"] = [f"{item.get('name')}｜{item.get('grade') or ''}" for item in self.classes]
            if self.papers:
                self.paper_box.current(0)
            if self.classes:
                self.class_box.current(0)
                self.load_students()
            self.upload_button.configure(state="normal")
            self.status.set("登录成功，请选择学生和照片")

        self._background(work, done)

    def load_students(self) -> None:
        index = self.class_box.current()
        if index < 0:
            return
        self.student_request_id += 1
        request_id = self.student_request_id
        raw_class_id = str(self.classes[index]["id"])
        class_id = urllib.parse.quote(raw_class_id)
        self.status.set("正在加载学生...")

        def done(result) -> None:
            current_index = self.class_box.current()
            if (
                request_id != self.student_request_id
                or current_index < 0
                or str(self.classes[current_index]["id"]) != raw_class_id
            ):
                return
            self.students = result.get("students", [])
            self.student_box["values"] = [f"{item.get('student_no')}｜{item.get('display_name')}" for item in self.students]
            if self.students:
                self.student_box.current(0)
            self.status.set(f"已加载 {len(self.students)} 名学生")

        self._background(lambda: self.client.request(f"/api/teacher/classes/{class_id}/students"), done)

    def choose_files(self) -> None:
        chosen = filedialog.askopenfilenames(
            title="按页码顺序选择答卷照片",
            filetypes=[("答卷照片", "*.jpg *.jpeg *.png *.webp *.bmp *.tif *.tiff *.heic *.heif"), ("所有文件", "*.*")],
        )
        valid = [Path(item) for item in chosen if Path(item).suffix.lower() in SUPPORTED_EXTENSIONS]
        if len(valid) > 20:
            messagebox.showwarning("照片过多", "每名学生最多选择 20 张照片")
            valid = valid[:20]
        oversized = [item.name for item in valid if item.stat().st_size > MAX_FILE_BYTES]
        if oversized:
            messagebox.showwarning("照片过大", f"每张照片不能超过 15MB：{oversized[0]}")
            return
        if sum(item.stat().st_size for item in valid) > MAX_TOTAL_BYTES:
            messagebox.showwarning("答卷过大", "单名学生的照片总大小不能超过 100MB")
            return
        self.selected_files = valid
        self._refresh_files()

    def clear_files(self) -> None:
        self.selected_files = []
        self._refresh_files()

    def _refresh_files(self) -> None:
        self.file_list.delete(0, tk.END)
        for index, item in enumerate(self.selected_files, start=1):
            self.file_list.insert(tk.END, f"第 {index} 页｜{item.name}｜{item.stat().st_size / 1024 / 1024:.2f} MB")

    def upload(self) -> None:
        if self.paper_box.current() < 0 or self.class_box.current() < 0 or self.student_box.current() < 0:
            messagebox.showwarning("信息不完整", "请选择试卷、班级和学生")
            return
        if not self.selected_files:
            messagebox.showwarning("尚未选择照片", "请至少选择一张答卷照片")
            return
        paper = self.papers[self.paper_box.current()]
        klass = self.classes[self.class_box.current()]
        student = self.students[self.student_box.current()]
        if not messagebox.askyesno("确认上传", f"确认上传 {student.get('display_name')} 的 {len(self.selected_files)} 张答卷照片？"):
            return
        self.upload_button.configure(state="disabled")
        self.status.set("正在上传，请勿关闭窗口...")

        def work():
            paper_id = urllib.parse.quote(str(paper["paper_id"]))
            return self.client.upload(
                f"/api/papers/{paper_id}/offline-submissions",
                {"class_id": str(klass["id"]), "student_id": str(student["id"])},
                self.selected_files,
            )

        def done(result) -> None:
            self.upload_button.configure(state="normal")
            count = result.get("attempt", {}).get("scan_image_count", len(self.selected_files))
            self.status.set(f"上传成功：{student.get('display_name')}，共 {count} 张")
            messagebox.showinfo("上传成功", "答卷已进入教师端在线提交批改，可运行 AI 预批改。")
            self.clear_files()

        self._background(work, done, lambda: self.upload_button.configure(state="normal"))


if __name__ == "__main__":
    UploaderApp().mainloop()
