"""Pydantic models for per-file question YAML (standalone or type: group)."""

from __future__ import annotations

import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Annotated, Any, Iterator, Literal, Union, get_args

from pydantic import BaseModel, Field, TypeAdapter, model_validator
from typing_extensions import Self

ChoiceQuestionType = Literal["single_choice", "multiple_choice"]
LegacyChoiceType = Literal["choice"]
QuestionType = Literal["single_choice", "multiple_choice", "fill", "judge", "short_answer", "reasoning", "essay"]
QuestionTypeOrLegacyChoice = QuestionType | LegacyChoiceType
_QUESTION_TYPE_VALUES = frozenset(get_args(QuestionType))

CHOICE_QUESTION_TYPES = frozenset({"single_choice", "multiple_choice"})
LEGACY_CHOICE_TYPE = "choice"
_ANSWER_OPTION_RE = re.compile(r"[A-Z]")


def infer_choice_type_from_answer(answer: object) -> ChoiceQuestionType:
    from solaire.common.answer_logic import PREFIX, branches, decode
    if str(answer or '').startswith(PREFIX):
        alternatives = branches(decode(str(answer)))
        return 'multiple_choice' if any(len({letter for value in branch for letter in _ANSWER_OPTION_RE.findall(value.upper())}) > 1 for branch in alternatives) else 'single_choice'
    letters = _ANSWER_OPTION_RE.findall(str(answer or "").upper())
    unique = set(letters)
    return "multiple_choice" if len(unique) >= 2 else "single_choice"


def _valid_judge_answer(answer: str) -> bool:
    if answer in {'T', 'F'}:
        return True
    from solaire.common.answer_logic import PREFIX, branches, decode
    if not answer.startswith(PREFIX):
        return False
    alternatives = branches(decode(answer))
    return all(len(branch) == 1 and next(iter(branch)).upper() in {'T', 'F'} for branch in alternatives)


def _copy_metadata_value(value: Any, memo: dict[int, Any]) -> Any:
    """Copy YAML containers cheaply while preserving aliases and recursive data."""
    if type(value) is dict:
        identity = id(value)
        if identity in memo:
            return memo[identity]
        clone: dict[Any, Any] = {}
        memo[identity] = clone
        for key, child in value.items():
            clone[_copy_metadata_value(key, memo)] = _copy_metadata_value(child, memo)
        return clone
    if type(value) is list:
        identity = id(value)
        if identity in memo:
            return memo[identity]
        clone_list: list[Any] = []
        memo[identity] = clone_list
        clone_list.extend(_copy_metadata_value(child, memo) for child in value)
        return clone_list
    if type(value) is set:
        identity = id(value)
        if identity not in memo:
            memo[identity] = value.copy()
        return memo[identity]
    if value is None or isinstance(value, (str, bytes, int, float, bool, complex)):
        return value
    # SafeLoader scalar types are immutable; this fallback also handles unusual
    # values installed by callers after parsing without sharing mutable state.
    return deepcopy(value, memo)


def _clone_group_metadata(value: object) -> dict[str, Any]:
    """Preserve the historical ``dict(value)`` coercion while isolating nested data."""
    if not value:
        return {}
    return _copy_metadata_value(dict(value), {})


def is_choice_type(qtype: object) -> bool:
    return qtype in CHOICE_QUESTION_TYPES or qtype == LEGACY_CHOICE_TYPE


def normalize_legacy_choice_type(qtype: object, answer: object) -> object:
    if qtype == LEGACY_CHOICE_TYPE:
        return infer_choice_type_from_answer(answer)
    return qtype


def infer_unified_choice_type(items: object) -> ChoiceQuestionType:
    if isinstance(items, list):
        for it in items:
            if isinstance(it, dict) and infer_choice_type_from_answer(it.get("answer")) == "multiple_choice":
                return "multiple_choice"
            answer = getattr(it, "answer", None)
            if answer is not None and infer_choice_type_from_answer(answer) == "multiple_choice":
                return "multiple_choice"
    return "single_choice"

# --- Unified group bodies (no `type` field; implied by parent.unified) ---


class ChoiceBody(BaseModel):
    content: str
    options: dict[str, str]
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _choice_opts(self) -> Self:
        if not self.options:
            raise ValueError("choice requires non-empty options")
        return self


class FillBody(BaseModel):
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class JudgeBody(BaseModel):
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class ShortAnswerBody(BaseModel):
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class ReasoningBody(BaseModel):
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class EssayBody(BaseModel):
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


UnifiedBody = Union[ChoiceBody, FillBody, JudgeBody, ShortAnswerBody, ReasoningBody, EssayBody]

# --- Mixed group items (each row has explicit `type`) ---


class TaggedChoice(BaseModel):
    type: Literal["single_choice", "multiple_choice", "choice"] = "single_choice"
    content: str
    options: dict[str, str]
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_choice(cls, data: Any) -> Any:
        if isinstance(data, dict):
            out = dict(data)
            out["type"] = normalize_legacy_choice_type(out.get("type"), out.get("answer"))
            return out
        return data

    @model_validator(mode="after")
    def _choice_opts(self) -> Self:
        if not self.options:
            raise ValueError("choice requires non-empty options")
        return self


class TaggedFill(BaseModel):
    type: Literal["fill"] = "fill"
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaggedJudge(BaseModel):
    type: Literal["judge"] = "judge"
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _tf(self) -> Self:
        if not _valid_judge_answer(self.answer):
            raise ValueError("judge answer must be T or F")
        return self


class TaggedShortAnswer(BaseModel):
    type: Literal["short_answer"] = "short_answer"
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaggedReasoning(BaseModel):
    type: Literal["reasoning"] = "reasoning"
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaggedEssay(BaseModel):
    type: Literal["essay"] = "essay"
    content: str
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


GroupMixedSubItem = Annotated[
    Union[TaggedChoice, TaggedFill, TaggedJudge, TaggedShortAnswer, TaggedReasoning, TaggedEssay],
    Field(discriminator="type"),
]
_MIXED_SUBITEM_ADAPTER = TypeAdapter(GroupMixedSubItem)


class QuestionItem(BaseModel):
    """Standalone question (file root) or a synthetic row expanded from a group (hydrate-only extras)."""

    id: str
    type: QuestionType
    content: str
    options: dict[str, str] | None = None
    answer: str
    analysis: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    # Hydrate / pipeline only — omit from author YAML
    group_material: str | None = None
    unified: bool | str | None = None
    group_root_id: str | None = None
    group_member_index: int | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_choice(cls, data: Any) -> Any:
        if isinstance(data, dict):
            out = dict(data)
            out["type"] = normalize_legacy_choice_type(out.get("type"), out.get("answer"))
            return out
        return data

    @model_validator(mode="after")
    def _shape(self) -> Self:
        if is_choice_type(self.type):
            if not self.options:
                raise ValueError("choice requires non-empty options")
        else:
            if self.options is not None:
                raise ValueError("non-choice must not have options key in bank YAML")
        if self.type == "judge" and not _valid_judge_answer(self.answer):
            raise ValueError("judge answer must be T or F")
        return self


def _metadata_projection_is_safe(value: object, seen: set[int] | None = None) -> bool:
    """Check whether lint can read metadata without invoking deepcopy hooks."""
    value_type = type(value)
    if value is None or value_type in (str, bytes, int, float, bool, complex):
        return True
    if value_type not in (dict, list, tuple, set):
        return False
    if seen is None:
        seen = set()
    identity = id(value)
    if identity in seen:
        return True
    seen.add(identity)
    if value_type is dict:
        return all(
            _metadata_projection_is_safe(key, seen) and _metadata_projection_is_safe(child, seen)
            for key, child in value.items()
        )
    return all(_metadata_projection_is_safe(child, seen) for child in value)


def _question_item_projection_is_valid(row: _GroupQuestionProjection) -> bool:
    """Mirror QuestionItem's field and after-validator checks for its trusted fast path."""
    if any(
        type(value) is not str
        for value in (row.id, row.type, row.content, row.answer, row.analysis)
    ):
        return False
    if row.type not in _QUESTION_TYPE_VALUES:
        return False
    options = row.options if row.copies_options else None
    if is_choice_type(row.type):
        if type(options) is not dict or not options:
            return False
        if any(type(key) is not str or type(value) is not str for key, value in options.items()):
            return False
    elif options is not None:
        return False
    if row.type == "judge" and not _valid_judge_answer(row.answer):
        return False
    metadata = row.metadata
    if type(metadata) is not dict or any(type(key) is not str for key in metadata):
        return False
    if not _metadata_projection_is_safe(metadata):
        return False
    group_material = row.group_material
    if group_material is not None and type(group_material) is not str:
        return False
    unified = row.unified
    if unified is not None and type(unified) not in (bool, str):
        return False
    group_root_id = row.group_root_id
    if group_root_id is not None and type(group_root_id) is not str:
        return False
    group_member_index = row.group_member_index
    return group_member_index is None or type(group_member_index) is int


@dataclass(frozen=True, slots=True)
class _GroupQuestionProjection:
    """Read-only row view shared by static linting and hydrated model materialization."""

    id: str
    type: object
    content: object
    options: object
    answer: object
    analysis: object
    metadata: object
    group_material: object
    unified: object
    group_root_id: object
    group_member_index: object
    copies_options: bool

    def to_question_item(self) -> QuestionItem:
        # Match the established isolation/coercion semantics of group flattening.
        return _materialize_group_question_row(
            id=self.id,
            type=self.type,
            content=self.content,
            options=self.options,
            answer=self.answer,
            analysis=self.analysis,
            metadata=self.metadata,
            group_material=self.group_material,
            unified=self.unified,
            group_root_id=self.group_root_id,
            group_member_index=self.group_member_index,
            copies_options=self.copies_options,
        )

    def iter_text_fields(self) -> Iterator[tuple[str, str]]:
        if not _question_item_projection_is_valid(self):
            item = self.to_question_item()
            if (item.content or "").strip():
                yield "content", item.content
            if (item.answer or "").strip():
                yield "answer", item.answer
            if (item.analysis or "").strip():
                yield "analysis", item.analysis
            if item.options:
                for key, value in item.options.items():
                    if (value or "").strip():
                        yield f"option_{key}", value
            return

        for field, value in (
            ("content", self.content),
            ("answer", self.answer),
            ("analysis", self.analysis),
        ):
            if (value or "").strip():
                yield field, value  # type: ignore[misc]
        if self.options:
            # Like the former QuestionItem construction, lint sees a stable option snapshot.
            for key, value in dict(self.options).items():  # type: ignore[arg-type]
                if (value or "").strip():
                    yield f"option_{key}", value


def _materialize_group_question_row(
    *,
    id: str,
    type: object,
    content: object,
    options: object,
    answer: object,
    analysis: object,
    metadata: object,
    group_material: object,
    unified: object,
    group_root_id: object,
    group_member_index: object,
    copies_options: bool,
) -> QuestionItem:
    """Construct the validated row model from the canonical group projection fields."""
    # Preserve the legacy evaluation order: metadata copying happened before the
    # choice-options snapshot when a group row was flattened.
    copied_metadata = _clone_group_metadata(metadata)
    copied_options = dict(options) if copies_options else None  # type: ignore[arg-type]
    return QuestionItem(
        type=type,
        options=copied_options,
        id=id,
        content=content,
        answer=answer,
        analysis=analysis,
        metadata=copied_metadata,
        group_material=group_material,
        unified=unified,
        group_root_id=group_root_id,
        group_member_index=group_member_index,
    )


def _tagged_question_projection(
    t: GroupMixedSubItem,
    *,
    group_id: str,
    member_index: int,
    material: str,
    unified_false: bool,
    materialize: bool = False,
) -> _GroupQuestionProjection | QuestionItem:
    row_id = f"{group_id}__{member_index:02d}"
    content = t.content
    answer = t.answer
    analysis = t.analysis or ""
    metadata = t.metadata
    if isinstance(t, TaggedChoice):
        item_type, options, copies_options = t.type, t.options, True
    elif isinstance(t, TaggedFill):
        item_type, options, copies_options = "fill", None, False
    elif isinstance(t, TaggedJudge):
        item_type, options, copies_options = "judge", None, False
    elif isinstance(t, TaggedShortAnswer):
        item_type, options, copies_options = "short_answer", None, False
    elif isinstance(t, TaggedReasoning):
        item_type, options, copies_options = "reasoning", None, False
    else:
        item_type, options, copies_options = "essay", None, False
    row_unified = False if unified_false else None
    factory = _materialize_group_question_row if materialize else _GroupQuestionProjection
    return factory(
        id=row_id,
        type=item_type,
        content=content,
        options=options,
        answer=answer,
        analysis=analysis,
        metadata=metadata,
        group_material=material,
        unified=row_unified,
        group_root_id=group_id,
        group_member_index=member_index,
        copies_options=copies_options,
    )


def _unified_question_projection(
    body: UnifiedBody,
    *,
    ut: QuestionType,
    group_id: str,
    member_index: int,
    material: str,
    unified_val: str,
    materialize: bool = False,
) -> _GroupQuestionProjection | QuestionItem:
    row_id = f"{group_id}__{member_index:02d}"
    content = body.content
    answer = body.answer
    analysis = body.analysis or ""
    metadata = body.metadata
    if is_choice_type(ut):
        assert isinstance(body, ChoiceBody)
        item_type, options, copies_options = ut, body.options, True
    elif ut == "fill":
        item_type, options, copies_options = "fill", None, False
    elif ut == "judge":
        item_type, options, copies_options = "judge", None, False
    elif ut == "short_answer":
        item_type, options, copies_options = "short_answer", None, False
    elif ut == "reasoning":
        item_type, options, copies_options = "reasoning", None, False
    else:
        item_type, options, copies_options = "essay", None, False
    factory = _materialize_group_question_row if materialize else _GroupQuestionProjection
    return factory(
        id=row_id,
        type=item_type,
        content=content,
        options=options,
        answer=answer,
        analysis=analysis,
        metadata=metadata,
        group_material=material,
        unified=unified_val,
        group_root_id=group_id,
        group_member_index=member_index,
        copies_options=copies_options,
    )


class QuestionGroupRecord(BaseModel):
    """Root record: one file, one id for the whole passage."""

    id: str
    type: Literal["group"] = "group"
    material: str
    unified: bool | str
    items: list[Any]

    @model_validator(mode="before")
    @classmethod
    def _reject_true_unified(cls, data: Any) -> Any:
        if isinstance(data, dict) and data.get("unified") is True:
            raise ValueError("unified cannot be true; use false or a question type name")
        return data

    @model_validator(mode="after")
    def _validate_items(self) -> Self:
        if not self.items:
            raise ValueError("group items must be non-empty")
        u = self.unified
        if u is False:
            parsed: list[GroupMixedSubItem] = []
            for it in self.items:
                if isinstance(it, dict) and it.get("type") == "group":
                    raise ValueError("nested group is not allowed")
                row = _MIXED_SUBITEM_ADAPTER.validate_python(it)
                parsed.append(row)
            object.__setattr__(self, "items", parsed)
            return self
        if isinstance(u, str):
            if u == LEGACY_CHOICE_TYPE:
                u = infer_unified_choice_type(self.items)
                object.__setattr__(self, "unified", u)
            if u == "group":
                raise ValueError("unified cannot be 'group'")
            if u not in (
                "single_choice",
                "multiple_choice",
                "fill",
                "judge",
                "short_answer",
                "reasoning",
                "essay",
            ):
                raise ValueError(f"invalid unified type: {u!r}")
            ut: QuestionType = u  # type: ignore[assignment]
            model = {
                "single_choice": ChoiceBody,
                "multiple_choice": ChoiceBody,
                "fill": FillBody,
                "judge": JudgeBody,
                "short_answer": ShortAnswerBody,
                "reasoning": ReasoningBody,
                "essay": EssayBody,
            }[ut]
            out: list[UnifiedBody] = []
            for it in self.items:
                if isinstance(it, dict) and it.get("type") is not None:
                    raise ValueError("unified group items must not have a 'type' field")
                body = model.model_validate(it)
                if ut == "judge" and not _valid_judge_answer(body.answer):
                    raise ValueError("judge answer must be T or F")
                if is_choice_type(ut) and isinstance(body, ChoiceBody) and not body.options:
                    raise ValueError("choice requires non-empty options")
                out.append(body)  # type: ignore[arg-type]
            object.__setattr__(self, "items", out)
            return self
        raise ValueError("unified must be false or a question type name")

    def _iter_rows(
        self,
        *,
        materialize: bool,
    ) -> Iterator[_GroupQuestionProjection | QuestionItem]:
        """Yield canonical projected fields as views or validated row models."""
        if self.unified is False:
            for i, row in enumerate(self.items):
                yield _tagged_question_projection(
                    row,
                    group_id=self.id,
                    member_index=i + 1,
                    material=self.material,
                    unified_false=True,
                    materialize=materialize,
                )
            return
        ut = self.unified
        assert isinstance(ut, str)
        for i, body in enumerate(self.items):
            assert isinstance(
                body,
                (ChoiceBody, FillBody, JudgeBody, ShortAnswerBody, ReasoningBody, EssayBody),
            )
            yield _unified_question_projection(
                body,
                ut=ut,  # type: ignore[arg-type]
                group_id=self.id,
                member_index=i + 1,
                material=self.material,
                unified_val=ut,
                materialize=materialize,
            )

    def iter_projected_rows(self) -> Iterator[_GroupQuestionProjection]:
        """Yield lightweight row views for consumers that do not need QuestionItems."""
        yield from self._iter_rows(materialize=False)  # type: ignore[misc]

    def iter_flattened(self) -> Iterator[QuestionItem]:
        """Yield per-row QuestionItems with hydrate fields set (for pipeline)."""
        yield from self._iter_rows(materialize=True)  # type: ignore[misc]

    def flatten(self) -> list[QuestionItem]:
        """Compatibility wrapper returning a new list on every call."""
        return list(self.iter_flattened())


BankRecord = QuestionItem | QuestionGroupRecord


def parse_bank_root(data: dict[str, Any]) -> BankRecord:
    """Parse a single root object from one YAML file."""
    t = data.get("type")
    if t == "group":
        return QuestionGroupRecord.model_validate(data)
    if t in (
        "choice",
        "single_choice",
        "multiple_choice",
        "fill",
        "judge",
        "short_answer",
        "reasoning",
        "essay",
    ):
        return QuestionItem.model_validate(data)
    raise ValueError(f"unknown or missing type on question root: {t!r}")


def strip_hydrate_fields(item: QuestionItem) -> QuestionItem:
    """Author-roundtrip: drop pipeline-only fields."""
    return item.model_copy(
        update={
            "group_material": None,
            "unified": None,
            "group_root_id": None,
            "group_member_index": None,
        }
    )


def question_item_to_author_dict(item: QuestionItem) -> dict[str, Any]:
    """Serialize standalone question for YAML (no hydrate fields, no options for non-choice)."""
    q = strip_hydrate_fields(item)
    d = q.model_dump(mode="json", exclude_none=True)
    if not is_choice_type(q.type) and "options" in d:
        del d["options"]
    return d


def question_group_to_author_dict(g: QuestionGroupRecord) -> dict[str, Any]:
    """Serialize group root for YAML."""
    if g.unified is False:
        items_out: list[dict[str, Any]] = []
        for row in g.items:
            assert not isinstance(row, dict)
            items_out.append(row.model_dump(mode="json", exclude_none=True))
        return {
            "id": g.id,
            "type": "group",
            "material": g.material,
            "unified": False,
            "items": items_out,
        }
    ut = g.unified
    assert isinstance(ut, str)
    items_u: list[dict[str, Any]] = []
    for body in g.items:
        assert not isinstance(body, dict)
        items_u.append(body.model_dump(mode="json", exclude_none=True))
    return {
        "id": g.id,
        "type": "group",
        "material": g.material,
        "unified": ut,
        "items": items_u,
    }
