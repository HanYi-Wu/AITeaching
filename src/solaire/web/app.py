"""FastAPI application: project binding, questions, templates, validate, export."""

from __future__ import annotations

from solaire.web.routers.exams import router as exams_router

from solaire.web.routers.analysis import router as analysis_router

from solaire.web.routers.graph import router as graph_router

from solaire.web.routers.bank import router as bank_router

from solaire.web.routers.templates import router as templates_router

from solaire.web.routers.projects import router as projects_router

from solaire.web.routers.system import router as system_router

from solaire.web.host_dialogs import _pick_directory_dialog, _pick_executable_dialog

from solaire.web.request_context import _require_root, bind_request_context

import asyncio
import contextvars
import json
import logging
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock
from typing import Annotated, Any, Literal, Union

import yaml
from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from solaire.common.runtime_config import load_runtime_config

load_runtime_config()

from solaire.exam_compiler.facade import (
    EditorMetadataDefaultsBody,
    ExamConfig,
    QuestionGroupRecord,
    QuestionItem,
    SelectedSection,
    TEMPLATE_EDITOR_LAYOUT_BUILTIN_KEYS_ORDERED,
    TemplateParsedResponse,
    load_all_questions,
    load_template,
    materialize_metadata_defaults_for_editor,
    strip_hydrate_fields,
)
from solaire.primebrush.api import parse_primebrush, render as render_primebrush

from solaire.web import bundled_paths, extension_registry, help_docs, recent_projects, state, system_tools
from solaire.web.agent_api import router as agent_router
from solaire.web.actor_scope import teacher_graph_root
from solaire.web.auth_api import extract_session_token, require_platform_root, router as auth_router
from solaire.web.auth_service import get_session_user
from solaire.web.bank_exchange import export_bank_exchange_zip, import_bank_exchange_zip
from solaire.web.paper_api import router as paper_router
from solaire.web.public_access import allowed_origins, enforce_public_access, redact_project_root
from solaire.web.student_api import router as student_router
from solaire.web.result_service import (
    compute_statistics,
    delete_score_batch,
    find_exported_docx_path,
    find_exported_pdf_path,
    generate_score_template,
    get_exam_summary,
    get_score_analysis,
    import_scores,
    list_exam_results,
    open_docx_with_default_app,
    open_pdf_with_default_app,
)
from solaire.edu_analysis.core import (
    delete_script_api,
    get_job,
    get_script_api,
    invoke_tool,
    list_jobs_api,
    list_scripts_api,
    list_tools,
    run_builtin,
    run_script_with_request_id,
    save_script_doc,
)
from solaire.edu_analysis.diagnosis import (
    class_heatmap_v1,
    knowledge_diagnosis_v1,
    student_knowledge_diagnosis_v1,
    teaching_suggestions_v1,
)
from solaire.web.bank_service import (
    collections_list,
    create_question_selection_export,
    delete_question,
    delete_question_collection,
    expand_question_for_web,
    get_question_detail,
    import_merged_yaml,
    list_bank_entries,
    list_subjects,
    question_exists,
    question_selection_export_path,
    rename_question_collection,
    save_bank_record,
    save_question,
    upload_bank_image,
)
from solaire.web.graph_service import (
    attach_file_to_node,
    bind_question_to_node,
    bind_questions_batch,
    count_nodes_by_kind,
    create_concept_node,
    create_graph,
    create_node_relation,
    delete_concept_node,
    delete_graph,
    delete_node_relation,
    detach_file_link,
    export_graph,
    generate_unique_node_id,
    get_concept_node,
    get_taxonomy,
    import_graph,
    list_concept_nodes,
    list_file_links_for_node,
    list_graphs,
    list_node_relations,
    list_nodes_for_question,
    list_questions_for_node,
    list_resource_files,
    load_graph,
    rename_graph,
    set_taxonomy,
    unbind_question_from_node,
    unbind_questions_batch,
    update_concept_node,
    update_node_relation,
)
from solaire.web.library_discovery import discover_question_library_refs
from solaire.web.exam_workspace_service import (
    create_workspace_from_exam,
    delete_exam_workspace,
    exam_id_from_labels,
    exam_yaml_path,
    list_exam_workspaces,
    load_exam_workspace,
    mark_exported,
    resolve_template_under_project,
    save_exam_workspace,
    save_exam_workspace_after_export_failure,
)
from solaire.web.exam_service import (
    VALIDATE_EXAM_NAME,
    discard_build_yaml_backup,
    ensure_probe_list_yaml,
    exam_export_error_detail_short,
    export_docx,
    export_pdfs,
    export_preview_pdfs,
    find_export_conflict,
    restore_build_yaml_from_backup,
    run_validate,
    snapshot_build_yaml_before_export,
    write_build_exam_yaml,
    write_exam_yaml,
    write_preview_exam_yaml,
)
from solaire.web.project_layout import ensure_project_layout
from solaire.web.platform_db import init_platform_db
from solaire.web.security import (
    assert_within_project,
    content_disposition_attachment,
    safe_filename_component,
    safe_project_name,
    unique_child_dir,
)
from solaire.web.result_service import ResultServiceAdapter
from solaire.web.school_api import router as school_router
from solaire.edu_analysis.ports import configure as _configure_edu_analysis
from solaire.web.remediation_service import create_remediation_draft, plan_remediation_draft

# 在模块加载时注入 edu_analysis 所需的数据访问实现，解除 edu_analysis 对 web 层的反向依赖
_configure_edu_analysis(result_port=ResultServiceAdapter())


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    state.init_from_env()
    yield


app = FastAPI(title="OriginReach API", version="1.6.7", lifespan=_lifespan)
app.include_router(agent_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(school_router, prefix="/api")
app.include_router(paper_router, prefix="/api")
app.include_router(student_router, prefix="/api")

app.include_router(exams_router)

app.include_router(analysis_router)

app.include_router(graph_router)

app.include_router(bank_router)

app.include_router(templates_router)

app.include_router(projects_router)

app.include_router(system_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Solaire-Session",
        "X-Solaire-Control-Token",
    ],
)

app.middleware("http")(bind_request_context)


# ---------------------------------------------------------------------------
# Result / Score Analysis
# ---------------------------------------------------------------------------


