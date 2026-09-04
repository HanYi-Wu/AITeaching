from solaire.web.auth_service import authenticate_user
from solaire.web.school_service import create_school, import_students


def test_short_account_and_unique_student_number_login_preserve_password(tmp_path):
    school = create_school(tmp_path, name='School A')
    student = import_students(tmp_path, school_id=school['id'], students=[{'student_no':'20260001','display_name':'Student'}])['students'][0]
    username, password = student['account_username'], student['initial_password']
    assert len(username) == 9 and username[0] == 's' and username[1:].isdigit()
    assert authenticate_user(tmp_path, username, password)
    assert authenticate_user(tmp_path, '20260001', password)
    assert authenticate_user(tmp_path, '20260001', 'wrong') is None
    second = create_school(tmp_path, name='School B')
    import_students(tmp_path, school_id=second['id'], students=[{'student_no':'20260001','display_name':'Other Student'}])
    assert authenticate_user(tmp_path, '20260001', password) is None
    assert authenticate_user(tmp_path, username, password)
