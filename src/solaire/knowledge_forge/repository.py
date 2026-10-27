"""Compatibility exports for graph persistence and domain operations."""

from solaire.knowledge_forge.storage import (
    _load_meta,
    _save_meta,
    _load_subject_state,
    _save_subject_state,
    _get_default_slug,
    _load_state,
    load_graph,
)
from solaire.knowledge_forge.subjects import (
    list_graphs,
    create_graph,
    delete_graph,
    rename_graph,
    export_graph,
    import_graph,
    get_taxonomy,
    set_taxonomy,
)
from solaire.knowledge_forge.node_index import (
    _collect_node_ids_and_kinds,
    _find_node_slug,
    generate_unique_node_id,
    _resolve_target_subject_slug,
)
from solaire.knowledge_forge.nodes import (
    list_concept_nodes,
    count_nodes_by_kind,
    get_concept_node,
    create_concept_node,
    create_concept_nodes_batch,
    update_concept_node,
    delete_concept_node,
)
from solaire.knowledge_forge.relations import (
    _find_relation_slug,
    list_node_relations,
    create_node_relation,
    create_node_relations_batch,
    delete_node_relation,
    update_node_relation,
)
from solaire.knowledge_forge.bindings import (
    bind_question_to_node,
    unbind_question_from_node,
    list_questions_for_node,
    list_nodes_for_question,
    bind_questions_batch,
    bind_question_nodes_batch,
    unbind_questions_batch,
)
from solaire.knowledge_forge.resources import (
    list_resource_files,
    list_file_links_for_node,
    attach_file_to_node,
    _find_file_link_slug,
    detach_file_link,
)
