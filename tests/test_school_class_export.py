"""The school export boundary must use the selected school's actual class."""
from io import BytesIO
from openpyxl import load_workbook
from tests.test_platform_school_api import _school_headers


def test_school_account_export_filters_class_and_preserves_all_export(web_client):
    headers, _ = _school_headers(web_client)
    class_ids = []
    expected = {}
    for i in range(2):
        response = web_client.post("/api/school/classes", json={"name": f"班级{i}"}, headers=headers)
        assert response.status_code == 200
        class_id = response.json()["class"]["id"]
        class_ids.append(class_id)
        response = web_client.post("/api/school/students/import", headers=headers,
                                   json={"class_id": class_id, "students": [{"student_no": f"S{i}", "display_name": f"学生{i}"}]})
        assert response.status_code == 200
        expected[class_id] = response.json()["students"][0]
    for class_id in class_ids:
        response = web_client.get("/api/school/students/export.xlsx", params={"class_id": class_id}, headers=headers)
        assert response.status_code == 200
        rows = list(load_workbook(BytesIO(response.content)).active.iter_rows(values_only=True))
        assert len(rows) == 2
        student = expected[class_id]
        assert rows[1][0] == student["student_no"]
        assert rows[1][3:] == (student["account_username"], student["initial_password"])
    response = web_client.get("/api/school/students/export.xlsx", headers=headers)
    assert response.status_code == 200
    rows = list(load_workbook(BytesIO(response.content)).active.iter_rows(values_only=True))
    assert {row[0] for row in rows[1:]} == {"S0", "S1"}
    assert web_client.get("/api/school/students/export.xlsx", params={"class_id": "unknown"}, headers=headers).status_code == 404
    assert web_client.get("/api/school/students/export.xlsx", params={"class_id": ""}, headers=headers).status_code == 422


def test_school_cannot_export_another_schools_class(web_client):
    headers, _ = _school_headers(web_client)
    admin = web_client.post("/api/auth/login", json={"username": "admin", "password": "secret123"}).json()["token"]
    admin_headers = {"Authorization": f"Bearer {admin}"}
    school_id = web_client.post("/api/schools", json={"name": "Other School"}, headers=admin_headers).json()["school"]["id"]
    web_client.post(f"/api/schools/{school_id}/school-users", headers=admin_headers,
                    json={"username": "school_b", "password": "secret123", "display_name": "School B"})
    token = web_client.post("/api/auth/login", json={"username": "school_b", "password": "secret123"}).json()["token"]
    klass = web_client.post("/api/school/classes", json={"name": "Private Class"}, headers={"Authorization": f"Bearer {token}"}).json()["class"]
    response = web_client.get("/api/school/students/export.xlsx", params={"class_id": klass["id"]}, headers=headers)
    assert response.status_code == 404


def test_school_report_options_preserve_publication_class_pairing_and_school_scope(web_client):
    from contextlib import closing
    from solaire.web.auth_api import require_platform_root
    from solaire.web.platform_db import connect
    from solaire.web.school.organization import create_class, create_school

    headers, school_id = _school_headers(web_client)
    teacher = web_client.post("/api/school/teachers", headers=headers,
                             json={"username": "export_teacher", "password": "secret123", "display_name": "教师", "subjects": ["数学"]})
    assert teacher.status_code == 200
    teacher_id = teacher.json()["teacher"]["id"]
    classes = [web_client.post("/api/school/classes", headers=headers, json={"name": name}).json()["class"]
               for name in ("旧班", "新班")]
    root = require_platform_root()
    foreign_school = create_school(root, name="其他学校")
    foreign_class = create_class(root, school_id=foreign_school["id"], name="外校班级")
    with closing(connect(root)) as con, con:
        con.execute("INSERT INTO paper_records (id,exam_id,title,subject,owner_teacher_id,school_id,created_at,updated_at) VALUES ('p-export','合成/数学','合成试卷','数学',?,?,?,?)",
                    (teacher_id, school_id, "2026-11-01", "2026-11-01"))
        for publication_id, class_id, created_at in (("old-pub", classes[0]["id"], "2026-10-01"), ("new-pub", classes[1]["id"], "2026-11-01")):
            con.execute("INSERT INTO exam_publications (id,paper_id,teacher_id,title,status,created_at,updated_at) VALUES (?,'p-export',?,?,'published',?,?)",
                        (publication_id, teacher_id, publication_id, created_at, created_at))
            con.execute("INSERT INTO publication_classes (publication_id,class_id) VALUES (?,?)", (publication_id, class_id))
        con.execute("INSERT INTO publication_classes (publication_id,class_id) VALUES ('new-pub',?)", (foreign_class["id"],))
    response = web_client.get("/api/school/papers/p-export/export-options", headers=headers)
    assert response.status_code == 200
    records = response.json()["publications"]
    assert [record["id"] for record in records] == ["new-pub", "old-pub"]
    assert [record["classes"][0]["id"] for record in records] == [classes[1]["id"], classes[0]["id"]]
    assert all(klass["id"] != foreign_class["id"] for record in records for klass in record["classes"])
    # Explicit old publication permits the old class even though the latest is a different class.
    response = web_client.get("/api/papers/p-export/analysis.xlsx", headers=headers,
                              params={"publication_id": "old-pub", "class_id": classes[0]["id"]})
    assert response.status_code == 200
    assert load_workbook(BytesIO(response.content)).sheetnames
    assert web_client.get("/api/school/papers/unknown/export-options", headers=headers).status_code == 404
    assert web_client.get("/api/school/papers/p-export/export-options").status_code in {401, 403}
