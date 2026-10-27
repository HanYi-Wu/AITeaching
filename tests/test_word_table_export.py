"""Check table structure in actual Word archives when the converter is available."""
import shutil
import zipfile
from xml.etree import ElementTree as ET

import pytest
import yaml

from solaire.exam_compiler.pipeline.docx import build_exam_docx
from tests.test_exam_docx_export import _write_minimal_exam_project


@pytest.mark.parametrize("location", ["content", "option"])
def test_word_tables_at_question_or_option_start_remain_real_tables(tmp_path, location):
    if not shutil.which("pandoc"):
        pytest.skip("Word converter unavailable")
    exam = _write_minimal_exam_project(tmp_path)
    path = tmp_path / "resource/math/set/q1.yaml"
    question = yaml.safe_load(path.read_text(encoding="utf-8"))
    table = "| Heading A | Heading B |\n|---|---|\n| Cell A | Cell B |"
    if location == "content":
        question["content"] = table
    else:
        question["options"]["A"] = table
    path.write_text(yaml.safe_dump(question, allow_unicode=True), encoding="utf-8")
    student, teacher = build_exam_docx(exam, tmp_path / "output")
    for document in (student, teacher):
        with zipfile.ZipFile(document) as package:
            root = ET.fromstring(package.read("word/document.xml"))
        tables = root.findall(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tbl")
        assert any("Heading A" in "".join(table.itertext()) and "Cell B" in "".join(table.itertext()) for table in tables)
