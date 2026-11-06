"""Nomes anatômicos dos pontos do modelo, para documentos gerados no backend.

Cópia de `points` em frontend/src/planning/regions.js; tests/test_point_labels.py compara os dois.
"""

POINT_LABELS = {
    "testa": {
        "frontal_lateral_d": "Frontal lateral D",
        "frontal_medial_d": "Frontal medial D",
        "frontal_central": "Frontal central",
        "frontal_medial_e": "Frontal medial E",
        "frontal_lateral_e": "Frontal lateral E",
    },
    "glabela": {
        "procero": "Prócero",
        "corrugador_medial_d": "Corrugador medial D",
        "corrugador_medial_e": "Corrugador medial E",
        "corrugador_lateral_d": "Corrugador lateral D",
        "corrugador_lateral_e": "Corrugador lateral E",
    },
    "temporas": {"tempora": "Têmpora"},
    "periorbital": {"superior": "Pé de galinha superior", "medio": "Pé de galinha médio", "inferior": "Pé de galinha inferior"},
    "olheiras": {"sulco_lacrimal": "Sulco lacrimal"},
    "nariz": {
        "radix": "Radix",
        "dorso": "Dorso",
        "ponta": "Ponta",
        "columela": "Columela",
        "nasal_d": "Nasal D (bunny lines)",
        "nasal_e": "Nasal E (bunny lines)",
    },
    "zigomatico": {"arco": "Arco zigomático", "eminencia": "Eminência zigomática"},
    "malar": {"lateral": "Malar lateral", "medial": "Malar medial"},
    "submalar": {"depressao": "Depressão submalar"},
    "nasolabial": {"sulco": "Sulco nasolabial"},
    "gengival": {"llsan": "LLSAN"},
    "boca": {
        "arco_cupido_d": "Arco do cupido D",
        "arco_cupido_e": "Arco do cupido E",
        "comissura_d": "Comissura D",
        "comissura_e": "Comissura E",
        "perioral_d": "Perioral D",
        "perioral_e": "Perioral E",
        "vermelhao_superior": "Vermelhão superior",
        "vermelhao_inferior": "Vermelhão inferior",
    },
    "marionete": {"superior": "Marionete superior", "inferior": "Marionete inferior"},
    "dao": {"dao": "Depressor do ângulo da boca"},
    "mento": {"pogonio": "Pogônio (projeção)", "mentual_d": "Mentual D", "mentual_e": "Mentual E"},
    "prejowl": {"sulco": "Sulco pré-jowl"},
    "mandibula": {"angulo": "Ângulo mandibular", "corpo": "Corpo mandibular"},
    "masseter": {
        "superior": "Masseter superior",
        "inferior_anterior": "Masseter inferior anterior",
        "inferior_posterior": "Masseter inferior posterior",
    },
    "platisma": {"borda_anterior": "Borda mandibular anterior", "borda_posterior": "Borda mandibular posterior", "banda": "Banda cervical"},
}


def point_label(region: str, key: str) -> str:
    """Nome do ponto; "" para ponto sem nome (adicionado à mão ou de plano antigo)."""
    return POINT_LABELS.get(region, {}).get(key, "")
