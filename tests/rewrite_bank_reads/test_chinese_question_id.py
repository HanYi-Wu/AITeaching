from urllib.parse import quote


def test_chinese_question_id_roundtrips_create_encoded_read_save_and_list(web_client):
    record = {"id": "第一题_函数", "type": "fill", "content": "求 $x^2$", "answer": "1"}
    created = web_client.post("/api/bank/items", json={"subject": "数学", "collection": "中文题库", "question": record})
    assert created.status_code == 200, created.text
    qid = created.json()["qualified_id"]
    assert qid == "数学/中文题库/第一题_函数"
    path = "/api/bank/items/" + quote(qid, safe="/")
    response = web_client.get(path)
    assert response.status_code == 200
    assert response.json()["question"]["id"] == record["id"]
    updated = {**record, "content": "已修改的中文题目"}
    saved = web_client.put(path, json=updated, headers={"If-Match": response.json()["version"]})
    assert saved.status_code == 200, saved.text
    assert web_client.get(path).json()["question"]["content"] == updated["content"]
    items = web_client.get("/api/bank/items").json()["items"]
    assert sum(row["qualified_id"] == qid for row in items) == 1
