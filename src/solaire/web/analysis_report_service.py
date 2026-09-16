"""Export paper analysis as spreadsheet and PDF reports."""

from __future__ import annotations

from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.chart import BarChart, RadarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


def _number(value: Any, default: float = 0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(_safe_text(item) for item in value)
    if isinstance(value, dict):
        return ", ".join(f"{key}: {_safe_text(item)}" for key, item in value.items())
    return str(value)


def _excel_value(value: Any) -> Any:
    if isinstance(value, (list, tuple, dict)):
        return _safe_text(value)
    return value


def _write_table(ws, headers: list[str], rows: list[list[Any]]) -> None:
    ws.append(headers)
    for row in rows:
        ws.append([_excel_value(value) for value in row])
        for cell in ws[ws.max_row]:
            if isinstance(cell.value, str):
                cell.data_type = "s"  # User-controlled names must never become Excel formulas.
    header_fill = PatternFill("solid", fgColor="E2E8F0")
    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for index, header in enumerate(headers, start=1):
        width = max(12, min(42, len(header) + 4))
        for cell in ws.iter_cols(min_col=index, max_col=index, min_row=2):
            for item in cell:
                width = max(width, min(42, len(_safe_text(item.value)) + 2))
        ws.column_dimensions[get_column_letter(index)].width = width


def _add_summary_chart(ws) -> None:
    if ws.max_row < 2:
        return
    chart = BarChart()
    chart.title = "Paper analysis summary"
    chart.y_axis.title = "Value"
    chart.x_axis.title = "Metric"
    data = Reference(ws, min_col=2, min_row=1, max_row=ws.max_row)
    cats = Reference(ws, min_col=1, min_row=2, max_row=ws.max_row)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)
    chart.height = 7
    chart.width = 14
    ws.add_chart(chart, "D2")


def _add_radar_chart(ws) -> None:
    if ws.max_row < 2:
        return
    chart = RadarChart()
    chart.title = "Capability radar"
    data = Reference(ws, min_col=2, min_row=1, max_row=ws.max_row)
    cats = Reference(ws, min_col=1, min_row=2, max_row=ws.max_row)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)
    chart.height = 8
    chart.width = 10
    ws.add_chart(chart, "D2")


def build_paper_analysis_workbook(analysis: dict[str, Any]) -> bytes:
    wb = Workbook()
    summary = analysis.get("summary") or {}
    proctoring = analysis.get("proctoring") or {}
    paper = analysis.get("paper") or {}

    publication = next((p for p in analysis.get('publications', []) if p['id'] == analysis.get('publication_id')), {})
    students = list(analysis.get('students') or [])
    ranked = sorted((s for s in students if s.get('score_percent') is not None), key=lambda s: -float(s['score_percent']))
    ranks = {}
    for position, student in enumerate(ranked, start=1):
        ranks.setdefault(float(student['score_percent']), position)
    status_names = {'completed': '已提交待批改', 'in_progress': '答题中', 'not_started': '未开始'}
    report = wb.create_sheet('成绩单', 0)
    _write_table(report, ['排名', '学号', '姓名', '班级', '批改状态', '得分', '卷面满分', '得分率（%）', '答题用时（秒）', '切屏次数', '发布批次', '批次编号'], [
        [ranks.get(float(s['score_percent'])) if s.get('score_percent') is not None else None,
         s.get('student_no'), s.get('display_name'), s.get('class_names'),
         '已批改' if s.get('score_percent') is not None else status_names.get(s.get('status'), s.get('status')),
         s.get('score') if s.get('score_percent') is not None else None, s.get('max_score'), s.get('score_percent'),
         s.get('time_spent_seconds'), s.get('screen_switch_count'), publication.get('title'), analysis.get('publication_id')]
        for s in sorted(students, key=lambda s: (s.get('score_percent') is None, -float(s.get('score_percent') or 0), str(s.get('student_no') or '')))
    ])
    questions = analysis.get('questions') or []
    _write_table(wb.create_sheet('逐题成绩', 1), ['学号', '姓名', '批改状态', *[f"{q.get('header') or q['question_id']}（满分{q.get('score_per_item', '-')}）" for q in questions]], [
        [s.get('student_no'), s.get('display_name'), '已批改' if s.get('score_percent') is not None else '未完成批改',
         *[(s.get('question_scores') or {}).get(q['question_id']) for q in questions]] for s in students
    ])
    wb.active = 0

    ws = wb['Sheet']
    ws.title = "summary"
    summary_rows = [
        ["title", paper.get("title") or paper.get("exam_id")],
        ["subject", paper.get("subject")],
        ["total_students", summary.get("total_students")],
        ["completed_students", summary.get("completed_students")],
        ["in_progress_students", summary.get("in_progress_students")],
        ["not_started_students", summary.get("not_started_students")],
        ["completion_rate", summary.get("completion_rate")],
        ["average_score", summary.get("average_score")],
        ["average_time_seconds", summary.get("average_time_seconds")],
        ["screen_switch_count", proctoring.get("screen_switch_count")],
        ["screen_switch_duration_ms", proctoring.get("screen_switch_duration_ms")],
        ["flagged_student_count", proctoring.get("flagged_student_count")],
        ["exceeded_student_count", proctoring.get("exceeded_student_count")],
    ]
    _write_table(ws, ["metric", "value"], summary_rows)
    _add_summary_chart(ws)

    student_rows = []
    for item in analysis.get("students") or []:
        student_rows.append(
            [
                item.get("student_no"),
                item.get("display_name"),
                item.get("account_username"),
                item.get("class_names"),
                item.get("status"),
                item.get("score"),
                item.get("max_score"),
                item.get("score_percent"),
                item.get("time_spent_seconds"),
                item.get("screen_switch_count"),
                item.get("screen_switch_limit"),
                item.get("screen_switch_exceeded"),
            ]
        )
    _write_table(
        wb.create_sheet("students"),
        [
            "student_no",
            "display_name",
            "account_username",
            "classes",
            "status",
            "score",
            "max_score",
            "score_percent",
            "time_spent_seconds",
            "screen_switch_count",
            "screen_switch_limit",
            "screen_switch_exceeded",
        ],
        student_rows,
    )

    class_rows = []
    for item in analysis.get("classes") or []:
        class_rows.append(
            [
                item.get("class_name"),
                item.get("class_grade"),
                item.get("student_count"),
                item.get("completed_count"),
                item.get("in_progress_count"),
                item.get("not_started_count"),
                item.get("completion_rate"),
                item.get("average_score"),
                item.get("average_time_seconds"),
                item.get("screen_switch_count"),
            ]
        )
    _write_table(
        wb.create_sheet("classes"),
        [
            "class_name",
            "class_grade",
            "student_count",
            "completed_count",
            "in_progress_count",
            "not_started_count",
            "completion_rate",
            "average_score",
            "average_time_seconds",
            "screen_switch_count",
        ],
        class_rows,
    )

    question_rows = []
    for item in analysis.get("questions") or []:
        question_rows.append(
            [
                item.get("question_id"),
                item.get("header"),
                item.get("section_id"),
                item.get("type"),
                item.get("score_per_item"),
                item.get("answered_count"),
                item.get("scored_count"),
                item.get("correct_count"),
                item.get("wrong_count"),
                item.get("accuracy_rate"),
                item.get("average_score_percent"),
                item.get("risk_level"),
            ]
        )
    _write_table(
        wb.create_sheet("questions"),
        [
            "question_id",
            "header",
            "section_id",
            "type",
            "score_per_item",
            "answered_count",
            "scored_count",
            "correct_count",
            "wrong_count",
            "accuracy_rate",
            "average_score_percent",
            "risk_level",
        ],
        question_rows,
    )

    module_rows = []
    for item in analysis.get("modules") or []:
        module_rows.append(
            [
                item.get("module_id"),
                item.get("label"),
                item.get("question_count"),
                item.get("student_count"),
                item.get("answered_count"),
                item.get("scored_count"),
                item.get("correct_count"),
                item.get("wrong_count"),
                item.get("average_score_percent"),
                item.get("accuracy_rate"),
                item.get("risk_level"),
            ]
        )
    _write_table(
        wb.create_sheet("modules"),
        [
            "module_id",
            "label",
            "question_count",
            "student_count",
            "answered_count",
            "scored_count",
            "correct_count",
            "wrong_count",
            "average_score_percent",
            "accuracy_rate",
            "risk_level",
        ],
        module_rows,
    )

    radar_ws = wb.create_sheet("radar")
    radar_rows = [[item.get("label") or item.get("id"), item.get("value")] for item in analysis.get("radar") or []]
    _write_table(radar_ws, ["axis", "value"], radar_rows)
    _add_radar_chart(radar_ws)

    stream = BytesIO()
    wb.save(stream)
    return stream.getvalue()


def _pdf_font_name() -> str:
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont

        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        return "STSong-Light"
    except Exception:
        return "Helvetica"


def _pdf_table(rows: list[list[Any]], *, widths: list[int] | None = None):
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle

    table = Table([[_safe_text(cell) for cell in row] for row in rows], colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                ("FONTNAME", (0, 0), (-1, -1), _pdf_font_name()),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ]
        )
    )
    return table


def _summary_bar_chart(analysis: dict[str, Any]):
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Drawing

    summary = analysis.get("summary") or {}
    proctoring = analysis.get("proctoring") or {}
    values = [
        _number(summary.get("completion_rate")),
        _number(summary.get("average_score")),
        max(0, 100 - _number(proctoring.get("exceeded_student_count")) * 20),
        _number((analysis.get("radar") or [{}])[-1].get("value") if analysis.get("radar") else 0),
    ]
    drawing = Drawing(440, 150)
    chart = VerticalBarChart()
    chart.x = 36
    chart.y = 28
    chart.height = 95
    chart.width = 360
    chart.data = [values]
    chart.categoryAxis.categoryNames = ["Completion", "Score", "Integrity", "Mastery"]
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = 100
    chart.valueAxis.valueStep = 20
    drawing.add(chart)
    return drawing


def _radar_drawing(analysis: dict[str, Any]):
    import math

    from reportlab.graphics.shapes import Drawing, Line, Polygon, String
    from reportlab.lib import colors

    axes = analysis.get("radar") or []
    drawing = Drawing(220, 180)
    if not axes:
        return drawing
    cx, cy, radius = 110, 88, 58
    points: list[float] = []
    for index, axis in enumerate(axes):
        angle = -math.pi / 2 + 2 * math.pi * index / len(axes)
        outer_x = cx + radius * math.cos(angle)
        outer_y = cy + radius * math.sin(angle)
        drawing.add(Line(cx, cy, outer_x, outer_y, strokeColor=colors.HexColor("#CBD5E1")))
        label = _safe_text(axis.get("label") or axis.get("id"))[:12]
        drawing.add(String(outer_x - 24, outer_y, label, fontSize=6, fillColor=colors.HexColor("#334155")))
        value = max(0, min(100, _number(axis.get("value")))) / 100
        points.extend([cx + radius * value * math.cos(angle), cy + radius * value * math.sin(angle)])
    drawing.add(Polygon(points, strokeColor=colors.HexColor("#0F172A"), fillColor=colors.HexColor("#DBEAFE"), fillOpacity=0.55))
    return drawing


def build_paper_analysis_pdf(analysis: dict[str, Any]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

    stream = BytesIO()
    doc = SimpleDocTemplate(
        stream,
        pagesize=A4,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
    )
    font_name = _pdf_font_name()
    styles = getSampleStyleSheet()
    for style in styles.byName.values():
        style.fontName = font_name
    story: list[Any] = []
    paper = analysis.get("paper") or {}
    summary = analysis.get("summary") or {}
    proctoring = analysis.get("proctoring") or {}

    story.append(Paragraph(_safe_text(paper.get("title") or paper.get("exam_id") or "Analysis Report"), styles["Title"]))
    story.append(Paragraph(f"{_safe_text(paper.get('subject'))} / {_safe_text(paper.get('exam_id'))}", styles["Normal"]))
    story.append(Spacer(1, 8))
    story.append(_summary_bar_chart(analysis))
    story.append(Spacer(1, 8))
    story.append(_radar_drawing(analysis))
    story.append(Spacer(1, 8))
    story.append(
        _pdf_table(
            [
                ["Metric", "Value"],
                ["Total students", summary.get("total_students")],
                ["Completed", summary.get("completed_students")],
                ["Completion rate", f"{summary.get('completion_rate')}%"],
                ["Average score", summary.get("average_score")],
                ["Screen switches", proctoring.get("screen_switch_count")],
                ["Exceeded switch limit", proctoring.get("exceeded_student_count")],
            ],
            widths=[150, 260],
        )
    )
    story.append(Spacer(1, 12))

    story.append(Paragraph("Class Report", styles["Heading2"]))
    class_rows = [["Class", "Students", "Completed", "Completion", "Average", "Switches"]]
    for item in (analysis.get("classes") or [])[:30]:
        class_rows.append(
            [
                item.get("class_name"),
                item.get("student_count"),
                item.get("completed_count"),
                f"{item.get('completion_rate')}%",
                item.get("average_score"),
                item.get("screen_switch_count"),
            ]
        )
    story.append(_pdf_table(class_rows))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Module Report", styles["Heading2"]))
    module_rows = [["Module", "Questions", "Answered", "Score %", "Accuracy", "Risk"]]
    for item in (analysis.get("modules") or [])[:30]:
        module_rows.append(
            [
                item.get("label") or item.get("module_id"),
                item.get("question_count"),
                item.get("answered_count"),
                item.get("average_score_percent"),
                item.get("accuracy_rate"),
                item.get("risk_level"),
            ]
        )
    story.append(_pdf_table(module_rows))
    story.append(PageBreak())

    story.append(Paragraph("Question Report", styles["Heading2"]))
    question_rows = [["Question", "Module", "Answered", "Accuracy", "Score %", "Risk"]]
    for item in (analysis.get("questions") or [])[:80]:
        question_rows.append(
            [
                item.get("header") or item.get("question_id"),
                item.get("section_id"),
                item.get("answered_count"),
                item.get("accuracy_rate"),
                item.get("average_score_percent"),
                item.get("risk_level"),
            ]
        )
    story.append(_pdf_table(question_rows))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Student Personal Analysis", styles["Heading2"]))
    student_rows = [["Student", "No.", "Classes", "Status", "Score %", "Time", "Switches"]]
    for item in (analysis.get("students") or [])[:120]:
        student_rows.append(
            [
                item.get("display_name"),
                item.get("student_no"),
                item.get("class_names"),
                item.get("status"),
                item.get("score_percent"),
                item.get("time_spent_seconds"),
                f"{item.get('screen_switch_count')}/{item.get('screen_switch_limit')}",
            ]
        )
    story.append(_pdf_table(student_rows))
    doc.build(story)
    return stream.getvalue()


def analysis_report_filename(analysis: dict[str, Any], suffix: str) -> str:
    paper = analysis.get("paper") or {}
    raw = _safe_text(paper.get("title") or paper.get("exam_id") or "paper-analysis")
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in raw).strip("_") or "paper-analysis"
    return f"{safe}-analysis.{suffix}"
