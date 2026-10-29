from __future__ import annotations

from pathlib import Path

import yaml
from fastapi.testclient import TestClient


def test_notes_update_keeps_omitted_properties_and_explicit_null_clears_parent(web_client):
    parent_id, node_id = "editing/parent", "editing/child"
    assert web_client.post("/api/graph/nodes", json={"id": parent_id, "canonical_name": "Parent"}).status_code == 200
    created = web_client.post("/api/graph/nodes", json={
        "id": node_id, "canonical_name": "Child", "node_kind": "skill",
        "aliases": ["kept alias"], "tags": ["kept tag"], "subject": "数学",
        "description": "kept description", "source": "kept source", "primary_parent_id": parent_id,
        "layout_x": 10, "layout_y": 20,
    })
    assert created.status_code == 200, created.text
    updated = web_client.put(f"/api/graph/nodes/{node_id}", json={
        "canonical_name": "Child", "notes": [{"id": "n1", "body": "new note"}],
    })
    assert updated.status_code == 200, updated.text
    node = next(item for item in web_client.get("/api/graph/nodes").json()["nodes"] if item["id"] == node_id)
    assert node["aliases"] == ["kept alias"]
    assert node["tags"] == ["kept tag"]
    assert node["node_kind"] == "skill"
    assert node["source"] == "kept source"
    assert node["description"] == "kept description"
    assert node["primary_parent_id"] == parent_id
    cleared = web_client.put(f"/api/graph/nodes/{node_id}", json={
        "canonical_name": "Child", "primary_parent_id": None, "subject": None,
        "description": None, "layout_x": None, "layout_y": None,
    })
    assert cleared.status_code == 200, cleared.text
    node = next(item for item in web_client.get("/api/graph/nodes").json()["nodes"] if item["id"] == node_id)
    assert node["primary_parent_id"] is None
    assert node["subject"] is None
    assert node["description"] is None
    assert node["layout_x"] is None and node["layout_y"] is None
    assert node["notes"][0]["body"] == "new note"


def test_conflicting_relation_delete_returns_a_validation_error(web_client, monkeypatch):
    from solaire.web.routers import graph
    headers = _teacher_headers(web_client)
    def conflicting(*args, **kwargs):
        raise ValueError("同一关系编号存在冲突，请指定图谱")
    monkeypatch.setattr(graph, "delete_node_relation", conflicting)
    response = web_client.delete("/api/graph/relations/conflicting", headers=headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "同一关系编号存在冲突，请指定图谱"


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _bootstrap_admin(client: TestClient) -> str:
    r = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    assert r.status_code == 200
    return str(r.json()["token"])


def _teacher_headers(client: TestClient) -> dict[str, str]:
    admin_token = _bootstrap_admin(client)
    school = client.post("/api/schools", json={"name": "Graph School"}, headers=_headers(admin_token))
    assert school.status_code == 200
    school_id = str(school.json()["school"]["id"])
    account = client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "graph_school", "password": "secret123", "display_name": "Graph School"},
        headers=_headers(admin_token),
    )
    assert account.status_code == 200
    school_login = client.post("/api/auth/login", json={"username": "graph_school", "password": "secret123"})
    assert school_login.status_code == 200
    teacher = client.post(
        "/api/school/teachers",
        json={"username": "graph_teacher", "password": "teacher123", "display_name": "Graph Teacher"},
        headers=_headers(str(school_login.json()["token"])),
    )
    assert teacher.status_code == 200
    teacher_login = client.post("/api/auth/login", json={"username": "graph_teacher", "password": "teacher123"})
    assert teacher_login.status_code == 200
    return _headers(str(teacher_login.json()["token"]))


def _write_choice_question(root: Path, qid: str) -> None:
    # qid: 科目/题集/题内 id
    ns, inner = qid.rsplit("/", 1)
    subj, coll = ns.split("/", 1)
    lib = root / "resource" / subj / coll
    lib.mkdir(parents=True, exist_ok=True)
    path = lib / f"{inner}.yaml"
    payload = {
        "id": inner,
        "type": "choice",
        "content": f"题目 {inner}",
        "options": {"A": "1", "B": "2", "C": "3", "D": "4"},
        "answer": "A",
        "analysis": "",
        "metadata": {},
    }
    path.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")


def test_graph_api_m1_node_relation_binding(web_client, tmp_path: Path) -> None:
    root = tmp_path.resolve()
    # 题目文件供「按节点反查题目」使用
    qid = "数学/高考真题/demo_choice_001"
    _write_choice_question(root, qid)

    node_a = "math/func/derivative"
    node_b = "math/func/extrema"

    r1 = web_client.post(
        "/api/graph/nodes",
        json={"id": node_a, "canonical_name": "导数", "subject": "数学", "aliases": []},
    )
    assert r1.status_code == 200, r1.text

    r2 = web_client.post(
        "/api/graph/nodes",
        json={"id": node_b, "canonical_name": "极值", "subject": "数学", "aliases": []},
    )
    assert r2.status_code == 200, r2.text

    rel = web_client.post(
        "/api/graph/relations",
        json={"from_node_id": node_a, "to_node_id": node_b, "relation_type": "prerequisite"},
    )
    assert rel.status_code == 200, rel.text
    rel_json = rel.json()
    assert "relation_id" in rel_json

    bind = web_client.post(
        "/api/graph/bindings",
        json={"question_qualified_id": qid, "node_id": node_a},
    )
    assert bind.status_code == 200, bind.text

    qs = web_client.get(f"/api/graph/nodes/{node_a}/questions")
    assert qs.status_code == 200, qs.text
    data = qs.json()
    assert data["questions"]
    assert qid in {q["qualified_id"] for q in data["questions"]}

    # update node
    upd = web_client.put(
        f"/api/graph/nodes/{node_a}",
        json={"id": node_a, "canonical_name": "导数（更新）", "subject": "数学", "aliases": []},
    )
    assert upd.status_code == 200, upd.text

    nodes = web_client.get("/api/graph/nodes").json()["nodes"]
    a_node = next(n for n in nodes if n["id"] == node_a)
    assert a_node["canonical_name"] == "导数（更新）"

    # delete relation
    del_rel = web_client.delete(f"/api/graph/relations/{rel_json['relation_id']}")
    assert del_rel.status_code == 200, del_rel.text

    # unbind
    unbind = web_client.post(
        "/api/graph/bindings/unbind",
        json={"question_qualified_id": qid, "node_id": node_a},
    )
    assert unbind.status_code == 200, unbind.text

    qs2 = web_client.get(f"/api/graph/nodes/{node_a}/questions")
    assert qs2.status_code == 200, qs2.text
    data2 = qs2.json()
    assert qid not in {q["qualified_id"] for q in data2["questions"]}


def test_graph_batch_bind_unbind_question_nodes_and_index(web_client, tmp_path: Path) -> None:
    root = tmp_path.resolve()
    q1 = "数学/高考真题/batch_q1"
    q2 = "数学/高考真题/batch_q2"
    _write_choice_question(root, q1)
    _write_choice_question(root, q2)
    node_a = "math/func/derivative"
    assert web_client.post(
        "/api/graph/nodes",
        json={"id": node_a, "canonical_name": "导数", "subject": "数学", "aliases": []},
    ).status_code == 200

    bb = web_client.post(
        f"/api/graph/nodes/{node_a}/bind-batch",
        json={"qualified_ids": [q1, q2]},
    )
    assert bb.status_code == 200, bb.text
    assert bb.json()["added"] == 2

    qn = web_client.get("/api/graph/question-nodes", params={"qualified_id": q1})
    assert qn.status_code == 200, qn.text
    names = {n["canonical_name"] for n in qn.json()["nodes"]}
    assert "导数" in names

    idx = web_client.get("/api/graph/question-bindings-index")
    assert idx.status_code == 200, idx.text
    index = idx.json()["index"]
    assert q1 in index and q2 in index
    assert node_a in {x["id"] for x in index[q1]}

    ub = web_client.request(
        "DELETE",
        f"/api/graph/nodes/{node_a}/unbind-batch",
        json={"qualified_ids": [q1, q2]},
    )
    assert ub.status_code == 200, ub.text
    assert ub.json()["removed"] == 2


def test_graph_nodes_list_includes_file_link_count(web_client, tmp_path: Path) -> None:
    root = tmp_path.resolve()
    res_dir = root / "resource" / "资料"
    res_dir.mkdir(parents=True, exist_ok=True)
    (res_dir / "a.txt").write_text("a", encoding="utf-8")
    (res_dir / "b.txt").write_text("b", encoding="utf-8")
    node_id = "math/func/derivative"
    assert web_client.post(
        "/api/graph/nodes",
        json={"id": node_id, "canonical_name": "导数", "subject": "数学", "aliases": []},
    ).status_code == 200
    assert web_client.post(
        "/api/graph/file-links",
        json={"node_id": node_id, "relative_path": "资料/a.txt"},
    ).status_code == 200
    assert web_client.post(
        "/api/graph/file-links",
        json={"node_id": node_id, "relative_path": "资料/b.txt"},
    ).status_code == 200
    nodes = web_client.get("/api/graph/nodes").json()["nodes"]
    row = next(n for n in nodes if n["id"] == node_id)
    assert row.get("file_link_count") == 2


def test_graph_taxonomy_and_auto_node_id(web_client, tmp_path: Path) -> None:
    tx = web_client.get("/api/graph/taxonomy")
    assert tx.status_code == 200, tx.text
    assert "subjects" in tx.json() and "levels" in tx.json()

    parent = "math/parent"
    web_client.post(
        "/api/graph/nodes",
        json={
            "canonical_name": "父节点",
            "parent_node_id": None,
            "id": parent,
            "aliases": [],
            "subject": "数学",
        },
    )
    r = web_client.post(
        "/api/graph/nodes",
        json={
            "canonical_name": "子知识点",
            "parent_node_id": parent,
            "aliases": [],
            "subject": "数学",
        },
    )
    assert r.status_code == 200, r.text
    child_id = r.json()["node_id"]
    assert child_id.startswith(parent + "/")

    rels = web_client.get("/api/graph/relations").json()["relations"]
    assert any(
        x["from_node_id"] == child_id and x["to_node_id"] == parent and x["relation_type"] == "part_of"
        for x in rels
    )


def test_graph_export_import_creates_new_graph(web_client, tmp_path: Path) -> None:
    created = web_client.post("/api/graph/graphs", json={"display_name": "数学"})
    assert created.status_code == 200, created.text
    slug = created.json()["slug"]
    node = web_client.post(
        "/api/graph/nodes",
        params={"graph": slug},
        json={"id": "math/algebra", "canonical_name": "代数", "subject": "数学", "aliases": []},
    )
    assert node.status_code == 200, node.text

    exported = web_client.get(f"/api/graph/graphs/{slug}/export")
    assert exported.status_code == 200, exported.text
    bundle = exported.json()["bundle"]
    assert bundle["display_name"] == "数学"
    assert bundle["state"]["nodes"][0]["id"] == "math/algebra"

    imported = web_client.post("/api/graph/graphs/import", json={"bundle": bundle})
    assert imported.status_code == 200, imported.text
    imported_slug = imported.json()["slug"]
    assert imported_slug != slug
    imported_nodes = web_client.get("/api/graph/nodes", params={"graph": imported_slug})
    assert imported_nodes.status_code == 200, imported_nodes.text
    assert imported_nodes.json()["nodes"][0]["canonical_name"] == "代数"


def test_teacher_graph_is_isolated_from_global_graph(web_client, tmp_path: Path) -> None:
    global_node = web_client.post(
        "/api/graph/nodes",
        json={"id": "global/node", "canonical_name": "全局节点", "subject": "数学", "aliases": []},
    )
    assert global_node.status_code == 200, global_node.text
    teacher_headers = _teacher_headers(web_client)

    teacher_initial = web_client.get("/api/graph/nodes", headers=teacher_headers)
    assert teacher_initial.status_code == 200, teacher_initial.text
    assert teacher_initial.json()["nodes"] == []

    teacher_node = web_client.post(
        "/api/graph/nodes",
        json={"id": "teacher/node", "canonical_name": "教师节点", "subject": "数学", "aliases": []},
        headers=teacher_headers,
    )
    assert teacher_node.status_code == 200, teacher_node.text
    teacher_nodes = web_client.get("/api/graph/nodes", headers=teacher_headers).json()["nodes"]
    assert {node["id"] for node in teacher_nodes} == {"teacher/node"}

    global_nodes = web_client.get("/api/graph/nodes").json()["nodes"]
    assert {node["id"] for node in global_nodes} == {"global/node"}
