"""O catálogo do backend (documentos impressos) é cópia do catálogo do front: os dois não podem divergir."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from apps.clinical.models import Region
from apps.clinical.point_labels import POINT_LABELS, point_label

REGIONS_JS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "planning" / "regions.js"


def test_catalog_matches_the_frontend():
    node = shutil.which("node")
    if not node or not REGIONS_JS.exists():
        pytest.skip("precisa do node e do código do frontend")
    script = (
        f"import {{ REGIONS }} from {json.dumps(REGIONS_JS.as_uri())};"
        "console.log(JSON.stringify(Object.fromEntries(REGIONS.map((r) => [r.key, r.points]))))"
    )
    out = subprocess.run([node, "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == POINT_LABELS


def test_catalog_covers_every_region():
    assert set(POINT_LABELS) == set(Region.values)


def test_point_label():
    assert point_label("glabela", "procero") == "Prócero"
    assert point_label("glabela", "") == ""
    assert point_label("regiao_antiga", "qualquer") == ""
