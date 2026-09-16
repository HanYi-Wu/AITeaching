from io import BytesIO
from openpyxl import load_workbook
from solaire.web.analysis_report_service import build_paper_analysis_workbook


def test_grade_sheet_has_chinese_units_blanks_for_ungraded_and_safe_names():
    data={'paper':{'title':'考试'},'summary':{},'proctoring':{}, 'publication_id':'p1',
      'publications':[{'id':'p1','title':'第一次'}],
      'questions':[{'question_id':'q1','header':'=1+1','score_per_item':10}],
      'students':[
        {'student_no':'001','display_name':'=1+1','score':8,'max_score':10,'score_percent':80,'status':'completed','question_scores':{'q1':8}},
        {'student_no':'002','display_name':'待批改','score':0,'max_score':10,'score_percent':None,'status':'completed'}]}
    wb=load_workbook(BytesIO(build_paper_analysis_workbook(data)))
    assert wb.active.title=='成绩单'
    assert wb['成绩单']['C2'].value=='=1+1'
    assert wb['成绩单']['C2'].data_type=='s'
    assert wb['成绩单']['F3'].value is None
    assert wb['成绩单']['H2'].value==80
    assert wb['逐题成绩']['D2'].value==8
    assert wb['逐题成绩']['D3'].value is None
    assert wb['逐题成绩']['D1'].data_type == 's'
    assert wb['成绩单'].auto_filter.ref
