"""Regression tests for graph relation consistency and graph switching."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any
import pytest
import yaml

from solaire.knowledge_forge import (
    create_concept_node,
    create_graph,
    delete_graph,
    delete_node_relation,
    ensure_graph_layout,
    export_graph,
    import_graph,
    list_concept_nodes,
    list_graphs,
    list_node_relations,
    create_node_relation,
    update_node_relation,
)
from solaire.knowledge_forge.models import GraphState, NodeRelation
from solaire.knowledge_forge.migration import _migrate_legacy_graph_state
from solaire.knowledge_forge.paths import _subject_state_path
from solaire.knowledge_forge.storage import (
    _load_meta,
    _load_subject_state,
    _save_subject_state,
)
import solaire.knowledge_forge.subjects as subjects_module


# ==============================================================================
# 跨科目关系的无损收敛与冲突保留
# ==============================================================================


def test_cross_subject_identical_relation_lossless_convergence(tmp_path: Path) -> None:
    """迁移或跨科目出现相同 relation ID、端点及完整 payload 时，做幂等去重且全局只显示一条。"""
    create_graph(tmp_path, "数学", "math")
    create_graph(tmp_path, "物理", "physics")
    create_concept_node(tmp_path, {"id": "m1", "canonical_name": "函数"}, graph="math")
    create_concept_node(tmp_path, {"id": "p1", "canonical_name": "运动"}, graph="physics")

    # 构造两个 subject 含同一稳定 relation ID、端点和完整 payload 的关系
    identical_rel = NodeRelation(
        id="rel-stable-001",
        from_node_id="m1",
        to_node_id="p1",
        relation_type="related",
    )
    math_state = _load_subject_state(tmp_path, "math")
    math_state.relations.append(identical_rel)
    _save_subject_state(tmp_path, "math", math_state)

    phys_state = _load_subject_state(tmp_path, "physics")
    phys_state.relations.append(identical_rel)
    _save_subject_state(tmp_path, "physics", phys_state)

    # 汇总入口 list_node_relations 跨科目查询
    all_rels = list_node_relations(tmp_path)
    matching = [r for r in all_rels if r["id"] == "rel-stable-001"]

    # 量化验收：全局只显示一条，关系数据语义不变
    assert len(matching) == 1
    assert matching[0]["id"] == "rel-stable-001"
    assert matching[0]["from_node_id"] == "m1"
    assert matching[0]["to_node_id"] == "p1"
    assert matching[0]["relation_type"] == "related"
    assert "conflict" not in matching[0]

    # 全局删除该关系，两个科目均被清理
    delete_node_relation(tmp_path, "rel-stable-001")
    assert len([r for r in list_node_relations(tmp_path) if r["id"] == "rel-stable-001"]) == 0
    assert len([r for r in _load_subject_state(tmp_path, "math").relations if r.id == "rel-stable-001"]) == 0
    assert len([r for r in _load_subject_state(tmp_path, "physics").relations if r.id == "rel-stable-001"]) == 0


def test_cross_subject_conflicting_payload_preserved_and_exposed(tmp_path: Path) -> None:
    """遇到同 ID 不同 payload，不得覆盖或删减任一份，逐字段保持且明确暴露冲突。"""
    create_graph(tmp_path, "数学", "math")
    create_graph(tmp_path, "物理", "physics")
    create_concept_node(tmp_path, {"id": "m1", "canonical_name": "函数"}, graph="math")
    create_concept_node(tmp_path, {"id": "p1", "canonical_name": "运动"}, graph="physics")

    # 构造同 ID 但 payload 不同的冲突 fixture
    rel_math = NodeRelation(
        id="rel-conflict-xyz",
        from_node_id="m1",
        to_node_id="p1",
        relation_type="related",
    )
    rel_phys = NodeRelation(
        id="rel-conflict-xyz",
        from_node_id="m1",
        to_node_id="p1",
        relation_type="prerequisite",  # payload 冲突
    )

    math_state = _load_subject_state(tmp_path, "math")
    math_state.relations.append(rel_math)
    _save_subject_state(tmp_path, "math", math_state)

    phys_state = _load_subject_state(tmp_path, "physics")
    phys_state.relations.append(rel_phys)
    _save_subject_state(tmp_path, "physics", phys_state)

    all_rels = list_node_relations(tmp_path)
    conflicts = [r for r in all_rels if r["id"] == "rel-conflict-xyz"]

    # 量化验收：两份数据逐字段保持且明确暴露冲突
    assert len(conflicts) == 2
    types = {r["relation_type"] for r in conflicts}
    assert types == {"related", "prerequisite"}
    for item in conflicts:
        assert item["conflict"] is True
        assert item["conflict_reason"] == "duplicate_id_conflicting_payload"
        assert item["from_node_id"] == "m1"
        assert item["to_node_id"] == "p1"

    with pytest.raises(ValueError, match="请指定科目图谱后再删除"):
        delete_node_relation(tmp_path, "rel-conflict-xyz")

    # Both conflicting versions remain until the caller supplies an explicit graph.
    assert len(_load_subject_state(tmp_path, "math").relations) == 1
    assert len(_load_subject_state(tmp_path, "physics").relations) == 1
    delete_node_relation(tmp_path, "rel-conflict-xyz", graph="math")
    assert not _load_subject_state(tmp_path, "math").relations
    assert [r.relation_type for r in _load_subject_state(tmp_path, "physics").relations] == ["prerequisite"]


def test_migration_deduplicates_each_conflicting_payload_variant() -> None:
    first = NodeRelation(id="rel-1", from_node_id="n1", to_node_id="n2", relation_type="related")
    conflicting = NodeRelation(id="rel-1", from_node_id="n1", to_node_id="n2", relation_type="prerequisite")
    state = GraphState(relations=[first, conflicting, conflicting.model_copy()])

    assert _migrate_legacy_graph_state(state)
    assert state.relations == [first, conflicting]


def test_legacy_migration_cross_subject_relation_deduplication(tmp_path: Path) -> None:
    """Legacy state.yaml 拆分为多科目后，跨科目关系在全局列表中只展示一条。"""
    graph_dir = tmp_path / "resource" / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)
    legacy = graph_dir / "state.yaml"
    legacy.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "nodes": [
                    {"id": "m1", "canonical_name": "函数概念", "subject": "数学"},
                    {"id": "p1", "canonical_name": "加速度", "subject": "物理"},
                ],
                "relations": [
                    {
                        "id": "rel-legacy-cross",
                        "from_node_id": "m1",
                        "to_node_id": "p1",
                        "relation_type": "related",
                    }
                ],
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )

    ensure_graph_layout(tmp_path)
    all_rels = list_node_relations(tmp_path)
    cross_matches = [r for r in all_rels if r["id"] == "rel-legacy-cross"]

    assert len(cross_matches) == 1
    assert cross_matches[0]["from_node_id"] == "m1"
    assert cross_matches[0]["to_node_id"] == "p1"
    assert cross_matches[0]["relation_type"] == "related"


def test_non_conflicting_relation_api_contract_preserved(tmp_path: Path) -> None:
    """非重复关系的返回格式与字段契约完全保持不变。"""
    create_graph(tmp_path, "数学", "math")
    create_concept_node(tmp_path, {"id": "n1", "canonical_name": "集合"}, graph="math")
    create_concept_node(tmp_path, {"id": "n2", "canonical_name": "子集"}, graph="math")

    rel = NodeRelation(
        id="rel-normal-1",
        from_node_id="n1",
        to_node_id="n2",
        relation_type="part_of",
    )
    st = _load_subject_state(tmp_path, "math")
    st.relations.append(rel)
    _save_subject_state(tmp_path, "math", st)

    rels = list_node_relations(tmp_path, graph="math")
    assert len(rels) == 1
    assert rels[0] == {
        "id": "rel-normal-1",
        "from_node_id": "n1",
        "to_node_id": "n2",
        "relation_type": "part_of",
    }
    assert "conflict" not in rels[0]


# ==============================================================================
# 删除图谱时的普通写失败恢复
# ==============================================================================


def test_delete_graph_retains_original_on_metadata_write_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """delete_graph 遇到 metadata 写入抛出普通 OSError 时，恢复原图文件且内容 hash 一致，metadata 仍描述原图。"""
    create_graph(tmp_path, "数学图谱", "math")
    create_concept_node(tmp_path, {"id": "m1", "canonical_name": "导数"}, graph="math")

    sp = _subject_state_path(tmp_path, "math")
    assert sp.is_file()
    hash_before = hashlib.sha256(sp.read_bytes()).hexdigest()

    # 注入故障：_save_meta 抛出 OSError
    def fail_save_meta(project_root: Path, meta: Any) -> None:
        raise OSError("Injected disk failure during metadata write")

    monkeypatch.setattr(subjects_module, "_save_meta", fail_save_meta)

    with pytest.raises(OSError, match="Injected disk failure during metadata write"):
        delete_graph(tmp_path, "math")

    # 量化验收：
    # 1. 原图文件存在且内容 hash 与调用前相同
    assert sp.is_file()
    hash_after = hashlib.sha256(sp.read_bytes()).hexdigest()
    assert hash_after == hash_before

    # 2. metadata 仍描述原图
    meta = _load_meta(tmp_path)
    assert any(sm.slug == "math" for sm in meta.subjects)
    graphs = list_graphs(tmp_path)
    assert any(g["slug"] == "math" for g in graphs)


def test_delete_graph_retains_original_if_metadata_read_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    create_graph(tmp_path, "数学图谱", "math")
    sp = _subject_state_path(tmp_path, "math")
    original_bytes = sp.read_bytes()

    def fail_load_meta(project_root: Path) -> Any:
        raise OSError("Injected metadata read failure")

    monkeypatch.setattr(subjects_module, "_load_meta", fail_load_meta)

    with pytest.raises(OSError, match="Injected metadata read failure"):
        delete_graph(tmp_path, "math")

    assert sp.is_file()
    assert sp.read_bytes() == original_bytes


def test_delete_graph_recovery_failure_reports_path_and_preserves_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """若在恢复原图文件时也发生写入失败，抛出的异常必须准确包含受影响的文件路径且不吞错。"""
    create_graph(tmp_path, "物理图谱", "physics")
    create_concept_node(tmp_path, {"id": "p1", "canonical_name": "牛顿力学"}, graph="physics")

    sp = _subject_state_path(tmp_path, "physics")
    assert sp.is_file()

    def fail_save_meta(project_root: Path, meta: Any) -> None:
        raise OSError("Primary metadata write error")

    def fail_write_bytes(path: Path, content: bytes) -> None:
        raise PermissionError("Disk is write-protected during rollback")

    monkeypatch.setattr(subjects_module, "_save_meta", fail_save_meta)
    monkeypatch.setattr(subjects_module, "write_bytes_atomic", fail_write_bytes)

    with pytest.raises(OSError) as exc_info:
        delete_graph(tmp_path, "physics")

    # 量化验收：
    # 1. 恢复失败准确报告路径
    assert str(sp) in str(exc_info.value)
    # 2. 原错误不被吞掉，作为原因保留
    assert exc_info.value.__cause__ is not None
    assert "Primary metadata write error" in str(exc_info.value.__cause__)


def test_delete_graph_normal_success_contract(tmp_path: Path) -> None:
    """在无异常注入的正常场景下，delete_graph 按原契约成功删除图文件与 metadata。"""
    create_graph(tmp_path, "化学图谱", "chemistry")
    sp = _subject_state_path(tmp_path, "chemistry")
    assert sp.is_file()

    delete_graph(tmp_path, "chemistry")

    assert not sp.exists()
    meta = _load_meta(tmp_path)
    assert not any(sm.slug == "chemistry" for sm in meta.subjects)
    graphs = list_graphs(tmp_path)
    assert not any(g["slug"] == "chemistry" for g in graphs)


def test_delete_graph_file_deletion_failure_preserves_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """文件删除本身失败时，metadata 不被修改并直接抛出异常。"""
    create_graph(tmp_path, "生物图谱", "biology")
    sp = _subject_state_path(tmp_path, "biology")
    assert sp.is_file()

    original_unlink = Path.unlink

    def failing_unlink(self: Path, *args: Any, **kwargs: Any) -> None:
        if self == sp:
            raise PermissionError("Cannot unlink file in use")
        original_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", failing_unlink)

    with pytest.raises(PermissionError, match="Cannot unlink file in use"):
        delete_graph(tmp_path, "biology")

    meta = _load_meta(tmp_path)
    assert any(sm.slug == "biology" for sm in meta.subjects)


# ==============================================================================
# 用户视角端到端综合测试（验证日常使用、多科目流转与故障重试无 Bug）
# ==============================================================================


def test_user_perspective_complete_knowledge_graph_lifecycle(tmp_path: Path) -> None:
    """用户正常使用视角：建图 -> 加知识点 -> 跨科目关联 -> 浏览 -> 修改关系 -> 删除关联 -> 导出与重新导入。"""
    # 1. 用户创建科目
    slug_math = create_graph(tmp_path, "高中数学", "math")
    slug_phys = create_graph(tmp_path, "大学物理", "physics")

    graphs = list_graphs(tmp_path)
    assert len(graphs) == 2
    assert {g["slug"] for g in graphs} == {"math", "physics"}

    # 2. 用户在各科目添加知识点
    create_concept_node(tmp_path, {"id": "math/deriv", "canonical_name": "导数基础"}, graph="math")
    create_concept_node(tmp_path, {"id": "math/integ", "canonical_name": "积分计算"}, graph="math")
    create_concept_node(tmp_path, {"id": "phys/newton2", "canonical_name": "牛顿第二定律"}, graph="physics")
    create_concept_node(tmp_path, {"id": "phys/work", "canonical_name": "动能定理"}, graph="physics")

    assert len(list_concept_nodes(tmp_path, graph="math")) == 2
    assert len(list_concept_nodes(tmp_path, graph="physics")) == 2

    # 3. 用户建立科目内部与跨科目关系
    r1_id = create_node_relation(
        tmp_path,
        {"from_node_id": "math/deriv", "to_node_id": "math/integ", "relation_type": "prerequisite"},
        graph="math",
    )
    r_cross_id = create_node_relation(
        tmp_path,
        {"from_node_id": "math/deriv", "to_node_id": "phys/newton2", "relation_type": "related"},
        graph="math",
    )
    r2_id = create_node_relation(
        tmp_path,
        {"from_node_id": "phys/newton2", "to_node_id": "phys/work", "relation_type": "part_of"},
        graph="physics",
    )

    # 4. 用户查看全局关系列表，检查是否有重复或丢失
    all_rels = list_node_relations(tmp_path)
    all_ids = {r["id"] for r in all_rels}
    assert len(all_rels) == 3
    assert all_ids == {r1_id, r_cross_id, r2_id}
    # 确保正常关系不带 conflict 标志
    assert all("conflict" not in r for r in all_rels)

    # 5. 用户更新关系类型
    update_node_relation(tmp_path, r1_id, relation_type="related", graph="math")
    updated_rels = list_node_relations(tmp_path, graph="math")
    target_r1 = next(r for r in updated_rels if r["id"] == r1_id)
    assert target_r1["relation_type"] == "related"

    # 6. 用户删除跨科目关系，全局和单科目均不再可见
    delete_node_relation(tmp_path, r_cross_id)
    remaining_rels = list_node_relations(tmp_path)
    assert len(remaining_rels) == 2
    assert r_cross_id not in {r["id"] for r in remaining_rels}

    # 7. 用户导出数学图谱并导入为新科目
    math_bundle = export_graph(tmp_path, "math")
    assert math_bundle["slug"] == "math"
    assert len(math_bundle["state"]["nodes"]) == 2

    imported_slug = import_graph(tmp_path, math_bundle, slug="math-copy")
    assert imported_slug.startswith("math-copy")
    imported_nodes = list_concept_nodes(tmp_path, graph=imported_slug)
    assert len(imported_nodes) == 2
    assert {n["id"] for n in imported_nodes} == {"math/deriv", "math/integ"}


def test_user_perspective_delete_retry_after_storage_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """用户视角：删除图谱时偶发磁盘错误，图谱原样保留未损毁；用户再次重试删除成功。"""
    slug = create_graph(tmp_path, "备用图谱", "backup-graph")
    create_concept_node(tmp_path, {"id": "b1", "canonical_name": "备用节点"}, graph=slug)

    sp = _subject_state_path(tmp_path, slug)
    original_hash = hashlib.sha256(sp.read_bytes()).hexdigest()

    # 首次删除：模拟磁盘故障
    fail = True
    real_save_meta = subjects_module._save_meta

    def maybe_failing_save_meta(project_root: Path, meta: Any) -> None:
        if fail:
            raise OSError("EIO: temporary I/O glitch")
        real_save_meta(project_root, meta)

    monkeypatch.setattr(subjects_module, "_save_meta", maybe_failing_save_meta)

    # 第一次点击删除：报错
    with pytest.raises(OSError, match="temporary I/O glitch"):
        delete_graph(tmp_path, slug)

    # 用户检查：图谱依然完整存在，数据没有被误删毁损
    assert sp.is_file()
    assert hashlib.sha256(sp.read_bytes()).hexdigest() == original_hash
    assert any(g["slug"] == slug for g in list_graphs(tmp_path))

    # 第二次重试删除：磁盘恢复正常
    fail = False
    delete_graph(tmp_path, slug)

    # 用户检查：成功清理
    assert not sp.exists()
    assert not any(g["slug"] == slug for g in list_graphs(tmp_path))
