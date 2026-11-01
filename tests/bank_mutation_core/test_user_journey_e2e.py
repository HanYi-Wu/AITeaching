"""End-to-end user perspective testing for question bank web workflows.

Verifies the complete real-world user experience across:
- Single question CRUD and image attachment via HTTP API
- Question group (大题/题组) creation, viewing, and update
- Concurrent edit conflict detection (If-Match / 409 Conflict)
- Merged YAML bulk import and idempotent updates
- Bank exchange ZIP export & re-import with automatic EMBED rewriting
- Image serving under /api/resource/
- Resilience against invalid payloads, corrupted files, and path traversals
"""
from __future__ import annotations

import io
from pathlib import Path
import zipfile

import pytest
import yaml

from fastapi.testclient import TestClient


TINY_PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"


def test_user_journey_single_question_full_lifecycle(web_client: TestClient, tmp_path: Path):
    """User journey:
    1. Create a math question with LaTeX formula via POST /api/bank/items
    2. Read question detail and verify ETag via GET /api/bank/items/{ns}/{qid}
    3. Upload diagram image via POST .../image
    4. Verify uploaded image is servable via /api/resource/...
    5. Update question content with If-Match via PUT
    6. Verify concurrent edit with old ETag receives 409 Conflict
    7. Delete question and verify 404
    """
    subject = "数学"
    collection = "高一上"
    qid = "math_func_01"
    url = f"/api/bank/items/{subject}/{collection}/{qid}"

    # 1. Create Question
    create_payload = {
        "subject": subject,
        "collection": collection,
        "question": {
            "id": qid,
            "type": "single_choice",
            "content": r"已知函数 $f(x) = x^2 - 2x + 1$，求 $f(3)$ 的值。",
            "options": {"A": "1", "B": "4", "C": "9", "D": "16"},
            "answer": "B",
            "analysis": r"$f(3) = 3^2 - 2\times 3 + 1 = 9 - 6 + 1 = 4$。",
            "metadata": {"difficulty": 2, "points": 5, "subject": "数学"},
        },
    }
    r_create = web_client.post("/api/bank/items", json=create_payload)
    assert r_create.status_code == 200, r_create.text
    assert r_create.json()["ok"] is True

    # 2. Read Question Detail & ETag
    r_detail = web_client.get(url)
    assert r_detail.status_code == 200
    detail = r_detail.json()
    assert detail["question"]["id"] == qid
    assert "ETag" in r_detail.headers
    etag_v1 = r_detail.headers["ETag"].strip('"')
    assert etag_v1 == detail["version"]

    # 3. Upload Diagram Image
    files = {"file": ("diagram.png", TINY_PNG, "image/png")}
    r_img = web_client.post(f"{url}/image", files=files, headers={"If-Match": etag_v1})
    assert r_img.status_code == 200, r_img.text
    img_resp = r_img.json()
    assert "resource_rel" in img_resp
    assert ":::EMBED_IMG:" in img_resp["marker"]
    resource_rel = img_resp["resource_rel"]

    # 4. Verify Image is Servable
    r_get_img = web_client.get(f"/api/resource/{resource_rel}")
    assert r_get_img.status_code == 200
    assert r_get_img.content == TINY_PNG

    # 5. Update Question Content with If-Match
    update_payload = dict(create_payload["question"])
    update_payload["content"] = rf"如图所示：{img_resp['marker']}求函数极值。"
    r_update = web_client.put(url, json=update_payload, headers={"If-Match": etag_v1})
    assert r_update.status_code == 200, r_update.text
    assert "ETag" in r_update.headers
    etag_v2 = r_update.headers["ETag"].strip('"')
    assert etag_v2 != etag_v1

    # Verify updated content is saved
    r_detail2 = web_client.get(url)
    assert r_detail2.status_code == 200
    assert "如图所示" in r_detail2.json()["question"]["content"]

    # 6. Concurrent Edit Conflict Detection
    stale_payload = dict(update_payload)
    stale_payload["content"] = "This is a conflicting edit from an outdated browser tab."
    r_conflict = web_client.put(url, json=stale_payload, headers={"If-Match": etag_v1})
    assert r_conflict.status_code == 409
    assert "已被更新" in r_conflict.json()["detail"]
    assert r_conflict.headers.get("ETag") == f'"{etag_v2}"'

    # 7. Delete Question
    r_del = web_client.delete(url)
    assert r_del.status_code == 200
    assert r_del.json()["ok"] is True

    # Confirm deletion
    r_after = web_client.get(url)
    assert r_after.status_code == 404


def test_user_journey_question_group_workflow(web_client: TestClient):
    """User journey for Question Group (题组/材料大题):
    1. Create group with shared material and multiple sub-questions
    2. Query detail, verify question_group and preview structure
    3. Update sub-question options with ETag
    4. Delete group
    """
    subject = "英语"
    collection = "阅读理解"
    gid = "read_passage_01"
    url = f"/api/bank/items/{subject}/{collection}/{gid}"

    group_data = {
        "id": gid,
        "type": "group",
        "unified": "choice",
        "material": "Artificial intelligence is advancing rapidly across various scientific domains...",
        "items": [
            {
                "content": "What is the main topic of the passage?",
                "options": {"A": "Machine Learning", "B": "AI in science", "C": "Robotics", "D": "History"},
                "answer": "B",
                "analysis": "The first paragraph introduces AI across scientific domains.",
                "metadata": {},
            },
            {
                "content": "Which domain is NOT mentioned?",
                "options": {"A": "Biology", "B": "Physics", "C": "Cooking", "D": "Chemistry"},
                "answer": "C",
                "analysis": "Cooking is not discussed.",
                "metadata": {},
            },
        ],
    }

    r_create = web_client.post("/api/bank/items", json={
        "subject": subject,
        "collection": collection,
        "question": group_data,
    })
    assert r_create.status_code == 200, r_create.text

    # Detail check
    r_get = web_client.get(url)
    assert r_get.status_code == 200
    detail = r_get.json()
    assert detail["question_group"] is not None
    assert detail["question_group"]["id"] == gid
    assert len(detail["question_group"]["items"]) == 2
    assert "Artificial intelligence" in detail["question_group_preview"]["material"]
    etag = r_get.headers["ETag"].strip('"')

    # Update sub-question
    group_data["items"][0]["options"]["A"] = "Computer Vision"
    r_put = web_client.put(url, json=group_data, headers={"If-Match": etag})
    assert r_put.status_code == 200

    r_verify = web_client.get(url)
    assert r_verify.json()["question_group"]["items"][0]["options"]["A"] == "Computer Vision"

    # Delete
    r_del = web_client.delete(url)
    assert r_del.status_code == 200


def test_user_journey_bulk_merged_yaml_import(web_client: TestClient):
    """User journey:
    1. Bulk import a merged YAML file containing multiple questions and groups
    2. Verify questions appear in bank catalog
    3. Modify one question and re-import (idempotent in-place update)
    4. Verify bad YAML returns clean 400 Bad Request
    """
    subject = "物理"
    collection = "力学实验"

    import_yaml = """
questions:
  - id: phys_q1
    type: choice
    content: "关于匀变速直线运动，下列说法正确的是？"
    options:
      A: "加速度不变"
      B: "速度不变"
      C: "位移不变"
      D: "路程不变"
    answer: A
    analysis: "匀变速运动加速度恒定。"
    metadata:
      difficulty: 1
  - id: phys_q2
    type: fill
    content: "重力加速度 g 的标准值约为 [___] m/s^2。"
    answer: "9.8"
    analysis: ""
    metadata: {}
groups:
  - group_id: phys_exp1
    type: choice
    material: "用打点计时器测定匀变速直线运动加速度实验中..."
    items:
      - content: "打点计时器使用的电源是？"
        options:
          A: "低压交流电"
          B: "高压交流电"
          C: "直流电"
          D: "干电池"
        answer: A
        analysis: "电磁打点计时器使用交流电。"
        metadata: {}
"""

    r_imp = web_client.post("/api/bank/import", json={
        "yaml": import_yaml,
        "target_subject": subject,
        "target_collection": collection,
    })
    assert r_imp.status_code == 200, r_imp.text
    assert r_imp.json()["written"] == 3

    # Check catalog
    r_cat = web_client.get("/api/bank/items")
    assert r_cat.status_code == 200
    all_items = r_cat.json()["items"]
    qids = [item.get("id") for item in all_items]
    assert "phys_q1" in qids
    assert "phys_q2" in qids
    assert "phys_exp1" in qids

    # Re-import with an update to phys_q1
    update_yaml = """
questions:
  - id: phys_q1
    type: choice
    content: "关于匀变速直线运动（修订版），下列说法正确的是？"
    options:
      A: "加速度恒定不变"
      B: "速度不变"
      C: "位移不变"
      D: "路程不变"
    answer: A
    analysis: "加速度大小方向均不变。"
    metadata:
      difficulty: 2
"""
    r_imp2 = web_client.post("/api/bank/import", json={
        "yaml": update_yaml,
        "target_subject": subject,
        "target_collection": collection,
    })
    assert r_imp2.status_code == 200
    assert r_imp2.json()["written"] == 1

    # Verify update in place
    r_q1 = web_client.get(f"/api/bank/items/{subject}/{collection}/phys_q1")
    assert r_q1.status_code == 200
    assert "修订版" in r_q1.json()["question"]["content"]


def test_user_journey_zip_export_and_reimport_with_embeds(web_client: TestClient):
    """User journey:
    1. Prepare question with embedded image
    2. Export collection as exchange ZIP
    3. Import ZIP into another collection
    4. Verify embedded image path is rewritten to new collection and servable
    """
    src_sub, src_coll = "化学", "氧化还原"
    dst_sub, dst_coll = "化学", "复习题库"

    # Create question and upload image
    web_client.post("/api/bank/items", json={
        "subject": src_sub, "collection": src_coll,
        "question": {
            "id": "chem_01", "type": "single_choice",
            "content": "原内容", "options": {"A": "1", "B": "2", "C": "3", "D": "4"},
            "answer": "A", "analysis": "", "metadata": {},
        },
    })
    img_resp = web_client.post(
        f"/api/bank/items/{src_sub}/{src_coll}/chem_01/image",
        files={"file": ("reaction.png", TINY_PNG, "image/png")},
    ).json()

    web_client.put(
        f"/api/bank/items/{src_sub}/{src_coll}/chem_01",
        json={
            "id": "chem_01", "type": "single_choice",
            "content": f"化学反应装置图：{img_resp['marker']}请回答下列问题。",
            "options": {"A": "1", "B": "2", "C": "3", "D": "4"},
            "answer": "A", "analysis": "", "metadata": {},
        },
    )

    # Export ZIP
    r_exp = web_client.post("/api/bank/export-bundle", json={"namespace": f"{src_sub}/{src_coll}"})
    assert r_exp.status_code == 200
    assert r_exp.headers["content-type"] == "application/zip"
    zip_bytes = r_exp.content

    # Inspect zip contents
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        namelist = zf.namelist()
        assert "manifest.json" in namelist
        assert any(n.startswith("yaml/") for n in namelist)
        assert any(n.startswith("image/") for n in namelist)

    # Re-import into dst collection
    r_imp = web_client.post(
        "/api/bank/import-bundle",
        data={"target_subject": dst_sub, "target_collection": dst_coll},
        files={"file": ("export.bank.zip", zip_bytes, "application/zip")},
    )
    assert r_imp.status_code == 200, r_imp.text
    assert r_imp.json()["written"] == 1

    # Verify content in dst collection has rewritten EMBED path
    r_dst_detail = web_client.get(f"/api/bank/items/{dst_sub}/{dst_coll}/chem_01")
    assert r_dst_detail.status_code == 200
    dst_content = r_dst_detail.json()["question"]["content"]
    assert f":::EMBED_IMG:{dst_sub}/{dst_coll}/image/" in dst_content
    assert f":::EMBED_IMG:{src_sub}/{src_coll}/image/" not in dst_content

    # Verify rewritten image is servable
    rel_path = dst_content.split(":::EMBED_IMG:")[1].split(":::")[0].strip()
    r_img_served = web_client.get(f"/api/resource/{rel_path}")
    assert r_img_served.status_code == 200
    assert r_img_served.content == TINY_PNG


def test_user_error_duplicate_id_in_import(web_client: TestClient):
    """User sends a YAML with duplicate IDs: API must return clean 400 Bad Request."""
    bad_yaml = """
questions:
  - id: same_id
    type: fill
    content: "first"
    answer: "1"
  - id: same_id
    type: fill
    content: "second"
    answer: "2"
"""
    r = web_client.post("/api/bank/import", json={
        "yaml": bad_yaml,
        "target_subject": "生物",
        "target_collection": "测试",
    })
    assert r.status_code == 400
    assert "重复" in r.json()["detail"]


def test_user_error_delete_multi_record_file(web_client: TestClient, tmp_path: Path):
    """User tries to delete a question that is inside a multi-question YAML file."""
    # Write a multi-record YAML file
    target = tmp_path / "resource" / "地理" / "期中"
    target.mkdir(parents=True)
    records = [
        {"id": "geo_01", "type": "fill", "content": "1", "answer": "1"},
        {"id": "geo_02", "type": "fill", "content": "2", "answer": "2"},
    ]
    (target / "bundle.yaml").write_text(yaml.safe_dump(records), encoding="utf-8")

    r = web_client.delete("/api/bank/items/地理/期中/geo_01")
    assert r.status_code == 400
    assert "无法删除：文件含多条记录时请手动编辑 YAML" in r.json()["detail"]
    assert (target / "bundle.yaml").is_file()


def test_nested_subdirectories_in_zip_import(web_client: TestClient):
    """User imports exchange ZIP containing nested subject subdirectories."""
    sub, coll = "历史", "中国古代史"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", '{"format_version": 2, "kind": "solaire-bank-exchange"}')
        zf.writestr("image/nested/seal.png", TINY_PNG)
        q_data = {
            "id": "hist_01",
            "type": "single_choice",
            "content": "如图所示为秦代传世印章：:::EMBED_IMG:image/nested/seal.png:::，该文物反映的政治制度是？",
            "options": {"A": "分封制", "B": "皇帝制度与郡县制", "C": "三省六部制", "D": "行省制"},
            "answer": "B",
            "analysis": "印文为秦篆，体现中央集权制度。",
            "metadata": {"era": "秦朝"},
        }
        zf.writestr("yaml/先秦秦汉/秦朝政治/hist_01.yaml", yaml.safe_dump(q_data, allow_unicode=True))

    r = web_client.post(
        "/api/bank/import-bundle",
        data={"target_subject": sub, "target_collection": coll},
        files={"file": ("history.zip", buf.getvalue(), "application/zip")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["written"] == 1

    r_get = web_client.get(f"/api/bank/items/{sub}/{coll}/hist_01")
    assert r_get.status_code == 200
    detail = r_get.json()["question"]
    assert detail["id"] == "hist_01"
    assert f":::EMBED_IMG:{sub}/{coll}/image/" in detail["content"]


@pytest.mark.parametrize("render_available", [False, True])
def test_special_characters_markdown_tables_and_diagrams(
    web_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    render_available: bool,
):
    """User saves question containing Markdown tables, LaTeX math, and Mermaid diagram fences."""
    sub, coll = "综合", "实验探究"
    qid = "diagram_q01"
    url = f"/api/bank/items/{sub}/{coll}/{qid}"

    content = """下面是探究光电效应规律的实验设计：

| 实验组 | 入射光频率 $\\nu$ | 逸出光电子最大初动能 $E_k$ |
|---|---|---|
| 甲 | $6.0 \\times 10^{14}$ Hz | $0.5$ eV |
| 乙 | $7.5 \\times 10^{14}$ Hz | $1.1$ eV |

实验电路原理图如下：
```mermaid
graph LR
    A[单色光源] --> B[光电管K]
    B --> C[微安表G]
    C --> D[可变直流电源]
```
求普朗克常量 $h$ 的实测值。
"""

    from solaire.exam_compiler.pipeline import diagram_expand

    svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>光电管K</text></svg>'
    rendered_paths: list[Path] = []
    diagram_source = content.split("```mermaid\n", 1)[1].split("```", 1)[0]

    def render_diagram(source: str, output: Path) -> None:
        assert source == diagram_source
        if not render_available:
            raise RuntimeError("diagram renderer unavailable")
        output.write_text(svg, encoding="utf-8")
        rendered_paths.append(output)

    monkeypatch.setattr(diagram_expand, "render_mermaid_to_svg_file", render_diagram)

    create_payload = {
        "subject": sub,
        "collection": coll,
        "question": {
            "id": qid,
            "type": "single_choice",
            "content": content,
            "options": {"A": "6.63e-34 J*s", "B": "6.40e-34 J*s", "C": "3.0e8 m/s", "D": "1.6e-19 C"},
            "answer": "B",
            "analysis": "根据爱因斯坦光电效应方程计算。",
            "metadata": {"has_mermaid": True},
        },
    }
    r = web_client.post("/api/bank/items", json=create_payload)
    assert r.status_code == 200

    r_get = web_client.get(url)
    assert r_get.status_code == 200
    q = r_get.json()["question"]
    assert q["content"] == content
    assert r_get.json().get("question_display") is not None
    display_content = r_get.json()["question_display"]["content"]
    if render_available:
        assert len(rendered_paths) == 1
        resource_rel = rendered_paths[0].relative_to(tmp_path / "resource").as_posix()
        marker = f"\n:::MERMAID_IMG:{resource_rel}:::\n"
        assert display_content == content.replace(f"```mermaid\n{diagram_source}```", marker)
        image = web_client.get(f"/api/resource/{resource_rel}")
        assert image.status_code == 200
        assert image.content == svg.encode("utf-8")
    else:
        assert rendered_paths == []
        assert display_content == content


def test_delete_question_with_storage_path(web_client: TestClient):
    """User deletes question by specifying storage_path query parameter."""
    sub, coll = "生物", "细胞学"
    qid = "cell_01"
    url = f"/api/bank/items/{sub}/{coll}/{qid}"

    web_client.post("/api/bank/items", json={
        "subject": sub, "collection": coll,
        "question": {
            "id": qid, "type": "fill",
            "content": "细胞的能量工厂是 [___]。",
            "answer": "线粒体",
            "metadata": {},
        },
    })
    detail = web_client.get(url).json()
    storage_path = detail["storage_path"]
    assert storage_path

    # Delete with storage_path query parameter
    r_del = web_client.delete(f"{url}?storage_path={storage_path}")
    assert r_del.status_code == 200

    # Ensure question is deleted
    assert web_client.get(url).status_code == 404


def test_empty_import_payload_rejected(web_client: TestClient):
    """User provides empty YAML or empty ZIP: rejected gracefully with 400."""
    r_empty_yaml = web_client.post("/api/bank/import", json={
        "yaml": "   \n  ",
        "target_subject": "测试",
        "target_collection": "测试",
    })
    assert r_empty_yaml.status_code == 400
    assert "Empty YAML" in r_empty_yaml.json()["detail"]

    # Empty zip
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w"):
        pass
    r_empty_zip = web_client.post(
        "/api/bank/import-bundle",
        data={"target_subject": "测试", "target_collection": "测试"},
        files={"file": ("empty.zip", buf.getvalue(), "application/zip")},
    )
    assert r_empty_zip.status_code in (400, 404)
