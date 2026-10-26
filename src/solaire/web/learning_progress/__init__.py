"""Learning progress and practice evidence package.

G7 modules (aggregation, comparison, api) are developed independently by G7.
This init is kept lightweight and does not import G7 modules.
"""

from __future__ import annotations

from solaire.web.learning_progress.baselines import (
    DEFAULT_CALCULATION_RULE_VERSION,
    freeze_personalized_baseline,
    freeze_publication_baseline,
)
from solaire.web.learning_progress.compatibility import (
    get_authoritative_source_status,
    get_authoritative_target_evidence,
    get_frozen_baseline,
)
from solaire.web.learning_progress.sources import (
    compute_batch_snapshot_hash,
    compute_online_source_snapshot_hash,
    get_graph_question_node_bindings,
    resolve_batch_student_scores,
)
from solaire.web.learning_progress.store import (
    get_frozen_baselines,
    get_practice_sources,
    insert_frozen_baseline_items,
    record_practice_source,
)
from solaire.web.learning_progress.types import (
    FrozenBaselineItem,
    PracticeSourceLink,
    ProgressComparisonStatus,
    TargetEvidenceItem,
)

__all__ = [
    "DEFAULT_CALCULATION_RULE_VERSION",
    "FrozenBaselineItem",
    "PracticeSourceLink",
    "ProgressComparisonStatus",
    "TargetEvidenceItem",
    "compute_batch_snapshot_hash",
    "compute_online_source_snapshot_hash",
    "freeze_personalized_baseline",
    "freeze_publication_baseline",
    "get_authoritative_source_status",
    "get_authoritative_target_evidence",
    "get_frozen_baseline",
    "get_frozen_baselines",
    "get_graph_question_node_bindings",
    "get_practice_sources",
    "insert_frozen_baseline_items",
    "record_practice_source",
    "resolve_batch_student_scores",
]
