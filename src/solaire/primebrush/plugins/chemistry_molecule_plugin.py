"""化学二维结构式插件（SMILES → SVG，RDKit 渲染）。"""

from __future__ import annotations

import html
from collections import OrderedDict
from threading import RLock
from typing import TYPE_CHECKING

from solaire.primebrush.common.canvas import normalize_canvas
from solaire.primebrush.common.models import ChemistryMoleculeModel
from solaire.primebrush.plugin_base import PrimeBrushPlugin

if TYPE_CHECKING:
    from solaire.primebrush.common.models import PrimeBrushDoc


def _svg_placeholder(title: str, subtitle: str, width: float, height: float) -> str:
    safe_t = html.escape(title, quote=True)
    safe_s = html.escape(subtitle, quote=True)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">'
        f'<rect fill="#f8fafc" width="100%" height="100%" stroke="#e2e8f0"/>'
        f'<text x="50%" y="42%" dominant-baseline="middle" text-anchor="middle" '
        f'font-size="14" fill="#475569" font-family="sans-serif">{safe_t}</text>'
        f'<text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" '
        f'font-size="12" fill="#64748b" font-family="monospace">{safe_s}</text>'
        "</svg>"
    )


_MAX_CACHED_SMILES_LENGTH = 4096
_MAX_CACHED_SVG_CHARS = 256_000
_MAX_CACHED_SVG_ITEMS = 32
_SMILES_SVG_CACHE: OrderedDict[tuple[str, int, int], str] = OrderedDict()
_SMILES_SVG_CACHE_LOCK = RLock()


def _render_smiles_to_svg_rdkit(smiles: str, width: int, height: int) -> str:
    from rdkit import Chem
    from rdkit.Chem.Draw import rdMolDraw2D

    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        raise ValueError("invalid SMILES")
    drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def _smiles_to_svg_rdkit(smiles: str, width: int, height: int) -> str:
    """Render a molecule and retain only small, reusable SVG results."""
    cacheable_input = len(smiles) <= _MAX_CACHED_SMILES_LENGTH
    key = (smiles, width, height)
    if cacheable_input:
        with _SMILES_SVG_CACHE_LOCK:
            if key in _SMILES_SVG_CACHE:
                svg = _SMILES_SVG_CACHE[key]
                _SMILES_SVG_CACHE.move_to_end(key)
                return svg

    svg = _render_smiles_to_svg_rdkit(smiles, width, height)
    if cacheable_input and len(svg) <= _MAX_CACHED_SVG_CHARS:
        with _SMILES_SVG_CACHE_LOCK:
            # Prefer an entry populated by a concurrent render of this key.
            existing = _SMILES_SVG_CACHE.get(key)
            if existing is not None:
                _SMILES_SVG_CACHE.move_to_end(key)
                return existing
            _SMILES_SVG_CACHE[key] = svg
            while len(_SMILES_SVG_CACHE) > _MAX_CACHED_SVG_ITEMS:
                _SMILES_SVG_CACHE.popitem(last=False)
    return svg


def _clear_smiles_svg_cache() -> None:
    with _SMILES_SVG_CACHE_LOCK:
        _SMILES_SVG_CACHE.clear()


class ChemistryMoleculePlugin(PrimeBrushPlugin):
    @property
    def type_names(self) -> frozenset[str]:
        return frozenset({"chemistry_molecule"})

    def parse_block(self, block: dict) -> PrimeBrushDoc:
        return ChemistryMoleculeModel.model_validate(block)

    def render_doc(self, doc: PrimeBrushDoc, *, seed: int | None) -> str:
        assert isinstance(doc, ChemistryMoleculeModel)
        w, h, _ = normalize_canvas(doc.canvas if hasattr(doc, "canvas") else None)
        wi, hi = int(w), int(h)
        notation = (doc.notation or "").strip().upper()
        if notation != "SMILES":
            return _svg_placeholder("当前仅支持一种结构式写法（见用户手册）", doc.value or "—", w, h)
        if not (doc.value or "").strip():
            return _svg_placeholder("请填写结构式内容", "", w, h)
        try:
            return _smiles_to_svg_rdkit(doc.value, wi, hi)
        except ImportError:
            return _svg_placeholder("当前显示为示意图占位；安装化学结构式扩展后可显示完整结构", doc.value, w, h)
        except Exception:
            return _svg_placeholder("无法根据当前内容生成示意图", doc.value, w, h)
