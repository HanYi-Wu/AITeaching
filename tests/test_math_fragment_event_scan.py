from solaire.exam_compiler.pipeline.math_fragment_check import _scan_math_static


def test_event_scanner_clears_escape_state_across_plain_text_gaps() -> None:
    special, delimiter = _scan_math_static(r"\x_")
    assert [code for code, _message in special] == ["latex_underscore"]
    assert delimiter == []

    special, delimiter = _scan_math_static(r"\x$")
    assert special == []
    assert len(delimiter) == 1
    assert "单个" in delimiter[0]
