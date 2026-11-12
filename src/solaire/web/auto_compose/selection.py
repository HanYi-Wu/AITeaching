"""Template-compatible selection with joint difficulty and knowledge targets.

The flow graph keeps type/section capacities and difficulty quotas together.
Knowledge coverage uses rarity weights, bounded reweighting and safe swaps;
the caller reports achieved targets rather than claiming infeasible guarantees.
"""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass
import math
import random

from solaire.exam_compiler.models.template import ExamTemplate
from solaire.web.auto_compose.catalog import Candidate
from solaire.web.schemas.auto_compose import AutoComposeBody


def apportion(total: int, weights: dict[str, float]) -> dict[str, int]:
    """Largest-remainder allocation; preserves total and deterministic ties."""
    if not weights:
        return {}
    maximum = max(weights.values())
    if maximum <= 0:
        return {key: 0 for key in weights}
    scaled = {key: value / maximum for key, value in weights.items()}
    denominator = math.fsum(scaled.values())
    quotas = {key: total * value / denominator for key, value in scaled.items()}
    result = {key: math.floor(value) for key, value in quotas.items()}
    order = sorted(weights, key=lambda key: (-(quotas[key] - result[key]), key))
    for key in order[: total - sum(result.values())]:
        result[key] += 1
    return result


def matches_type(actual: str, expected: str) -> bool:
    if expected == "practice":
        return True
    if expected == "choice":
        return actual in {"choice", "single_choice", "multiple_choice"}
    return actual == expected


@dataclass(frozen=True)
class Slot:
    section_id: str
    section_type: str
    target_type: str
    count: int

    def accepts(self, candidate: Candidate) -> bool:
        return matches_type(candidate.type, self.section_type) and matches_type(candidate.type, self.target_type)


def build_slots(template: ExamTemplate, body: AutoComposeBody) -> tuple[list[Slot], dict[str, int], dict[str, int]]:
    sections = [section for section in template.sections if section.type != "text"]
    ids = [section.section_id for section in template.sections]
    if len(ids) != len(set(ids)):
        raise ValueError("模板的小节标识存在重复，请先修正模板")
    if not sections:
        raise ValueError("模板没有可放置题目的小节")
    unknown = set(body.section_counts) - {section.section_id for section in sections}
    if unknown:
        raise ValueError("小节题量包含模板外或说明小节：" + "、".join(sorted(unknown)))
    slots: list[Slot] = []
    counts = {section.section_id: 0 for section in template.sections}
    if body.type_distribution:
        targets = apportion(body.total_count, body.type_distribution)
        for qtype, count in targets.items():
            if count == 0:
                continue
            compatible = [section for section in sections if (
                section.type == "practice" or section.type == qtype
                or (section.type == "choice" and qtype in {"single_choice", "multiple_choice"})
                or (qtype == "choice" and section.type in {"single_choice", "multiple_choice"})
            )]
            if not compatible:
                raise ValueError(f"当前模板没有可放置 {qtype} 题型的小节，请调整模板或题型比例")
            weights = {section.section_id: float(section.required_count) for section in compatible}
            if not any(weights.values()):
                weights = {key: 1.0 for key in weights}
            allocation = apportion(count, weights)
            for section in compatible:
                amount = allocation[section.section_id]
                if amount:
                    slots.append(Slot(section.section_id, section.type, qtype, amount))
                    counts[section.section_id] += amount
    else:
        weights = {section.section_id: float(section.required_count) for section in sections}
        if not any(weights.values()):
            weights = {key: 1.0 for key in weights}
        allocation = body.section_counts or apportion(body.total_count, weights)
        targets: dict[str, int] = {}
        for section in sections:
            count = allocation.get(section.section_id, 0)
            slots.append(Slot(section.section_id, section.type, section.type, count))
            counts[section.section_id] = count
            targets[section.type] = targets.get(section.type, 0) + count
    return slots, counts, targets


@dataclass
class _Edge:
    to: int
    reverse: int
    capacity: int
    cost: int


class _Flow:
    def __init__(self):
        self.graph: list[list[_Edge]] = []

    def node(self) -> int:
        self.graph.append([])
        return len(self.graph) - 1

    def edge(self, source: int, dest: int, capacity: int, cost: int = 0) -> _Edge:
        forward = _Edge(dest, len(self.graph[dest]), capacity, cost)
        backward = _Edge(source, len(self.graph[source]), 0, -cost)
        self.graph[source].append(forward)
        self.graph[dest].append(backward)
        return forward

    def fill(self, source: int, sink: int, limit: int) -> None:
        # Successive shortest augmenting paths, including residual reassignment.
        # There are few graph nodes (type/difficulty cells, not one per question).
        for _ in range(limit):
            distance = [math.inf] * len(self.graph)
            previous: list[tuple[int, int] | None] = [None] * len(self.graph)
            distance[source] = 0
            queue = deque([source])
            queued = {source}
            while queue:
                node = queue.popleft()
                queued.remove(node)
                for index, edge in enumerate(self.graph[node]):
                    if edge.capacity and distance[edge.to] > distance[node] + edge.cost:
                        distance[edge.to] = distance[node] + edge.cost
                        previous[edge.to] = (node, index)
                        if edge.to not in queued:
                            queued.add(edge.to)
                            queue.append(edge.to)
            if previous[sink] is None:
                break
            node = sink
            while node != source:
                parent, index = previous[node]  # type: ignore[misc]
                edge = self.graph[parent][index]
                edge.capacity -= 1
                self.graph[node][edge.reverse].capacity += 1
                node = parent


def _select_once(candidates: list[Candidate], slots: list[Slot], difficulty_target: dict[str, int],
                 weights: dict[str, float], rng: random.Random) -> dict[str, list[Candidate]]:
    flow = _Flow()
    source, sink = flow.node(), flow.node()
    difficulties = {candidate.difficulty for candidate in candidates} | set(difficulty_target)
    difficulty_nodes = {key: flow.node() for key in sorted(difficulties)}
    cells: dict[tuple[str, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        cells[(candidate.type, candidate.difficulty)].append(candidate)
    cell_nodes = {key: flow.node() for key in cells}
    slot_nodes = [flow.node() for _ in slots]
    total = sum(slot.count for slot in slots)
    for key, node in difficulty_nodes.items():
        if difficulty_target:
            flow.edge(source, node, difficulty_target.get(key, 0))
            flow.edge(source, node, total, 1_000_000_000)
        else:
            flow.edge(source, node, total)
    question_edges: list[tuple[Candidate, _Edge]] = []
    for key, pool in cells.items():
        for candidate in pool:
            reward = min(100_000, round(sum(weights.get(point, 0) for point in candidate.knowledge)))
            edge = flow.edge(difficulty_nodes[key[1]], cell_nodes[key], 1, -reward + rng.randrange(50))
            question_edges.append((candidate, edge))
    allocation_edges: list[tuple[tuple[str, str], int, _Edge]] = []
    for key, pool in cells.items():
        for index, slot in enumerate(slots):
            if slot.count and slot.accepts(pool[0]):
                edge = flow.edge(cell_nodes[key], slot_nodes[index], slot.count)
                allocation_edges.append((key, index, edge))
    for index, slot in enumerate(slots):
        flow.edge(slot_nodes[index], sink, slot.count)
    flow.fill(source, sink, total)
    selected_cells: dict[tuple[str, str], list[Candidate]] = defaultdict(list)
    for candidate, edge in question_edges:
        if edge.capacity == 0:
            selected_cells[(candidate.type, candidate.difficulty)].append(candidate)
    result: dict[str, list[Candidate]] = defaultdict(list)
    for key, index, edge in allocation_edges:
        count = flow.graph[edge.to][edge.reverse].capacity
        for _ in range(count):
            result[slots[index].section_id].append(selected_cells[key].pop())
    return dict(result)


def _improve(selected: dict[str, list[Candidate]], candidates: list[Candidate], points: set[str], required: int) -> None:
    """Swap only identical type/difficulty cells, preserving every flow constraint."""
    pools: dict[tuple[str, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        pools[(candidate.type, candidate.difficulty)].append(candidate)
    used = {candidate.qid for pool in selected.values() for candidate in pool}
    covered = Counter(point for pool in selected.values() for candidate in pool for point in candidate.knowledge & points)
    fingerprints = Counter(candidate.fingerprint for pool in selected.values() for candidate in pool)
    # Strictly improve coverage up to its requested target, then exact uniqueness.
    # A bounded pass avoids unbounded search on large user banks.
    for _ in range(3):
        changed = False
        for pool in selected.values():
            for index, old in enumerate(pool):
                old_points = old.knowledge & points
                old_coverage = min(required, len(covered))
                best: Candidate | None = None
                best_gain = (0, 0)
                for candidate in pools[(old.type, old.difficulty)]:
                    if candidate.qid in used:
                        continue
                    new_points = candidate.knowledge & points
                    lost = sum(covered[point] == 1 for point in old_points - new_points)
                    gained = len(new_points - covered.keys())
                    coverage_gain = min(required, len(covered) + gained - lost) - old_coverage
                    duplicate_gain = int(fingerprints[old.fingerprint] > 1) - int(
                        fingerprints[candidate.fingerprint] - int(old.fingerprint == candidate.fingerprint) > 0)
                    if (coverage_gain, duplicate_gain) > best_gain:
                        best, best_gain = candidate, (coverage_gain, duplicate_gain)
                if best is None:
                    continue
                used.remove(old.qid)
                used.add(best.qid)
                fingerprints[old.fingerprint] -= 1
                fingerprints[best.fingerprint] += 1
                for point in old_points:
                    covered[point] -= 1
                    if covered[point] == 0:
                        del covered[point]
                covered.update(best.knowledge & points)
                pool[index] = best
                changed = True
        if not changed:
            break


def choose_questions(candidates: list[Candidate], slots: list[Slot], body: AutoComposeBody) -> dict[str, list[Candidate]]:
    points = set(body.knowledge_points)
    required = math.ceil(len(points) * body.coverage_ratio - 1e-12)
    availability = Counter(point for candidate in candidates for point in candidate.knowledge & points)
    weights = {point: 10_000 / max(1, availability[point]) for point in points}
    difficulty_target = apportion(body.total_count, body.difficulty_distribution)
    rng = random.Random(body.seed)
    best: dict[str, list[Candidate]] = {}
    best_score = (-1, -math.inf, -math.inf, -math.inf)
    for _ in range(5 if points else 1):
        selected = _select_once(candidates, slots, difficulty_target, weights, rng)
        _improve(selected, candidates, points, required)
        flat = [candidate for pool in selected.values() for candidate in pool]
        actual_difficulty = Counter(candidate.difficulty for candidate in flat)
        covered = set().union(*(candidate.knowledge & points for candidate in flat)) if flat else set()
        deviation = sum(abs(actual_difficulty[key] - difficulty_target.get(key, 0))
                        for key in set(actual_difficulty) | set(difficulty_target)) if difficulty_target else 0
        duplicate_count = len(flat) - len({candidate.fingerprint for candidate in flat})
        score = (len(flat), -deviation, min(required, len(covered)), -duplicate_count)
        if score > best_score:
            best, best_score = selected, score
        if len(covered) >= required:
            break
        for point in points - covered:
            weights[point] = min(50_000, weights[point] * 4)
    return best
