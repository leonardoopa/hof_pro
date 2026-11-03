"""Páginas HTML imprimíveis (Ctrl+P > Salvar como PDF). Só são servidas por rotas autenticadas."""

from html import escape

CSS = """
body{font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#222;max-width:820px;margin:24px auto;padding:0 20px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px}
.meta{color:#666;font-size:13px;margin:0 0 16px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f2f2f2}
.term{white-space:pre-wrap;border:1px solid #ccc;padding:12px 14px;border-radius:6px}
.sig{border-bottom:1px solid #222;display:inline-block;padding:4px 24px}.sig img{max-height:110px;display:block}
.hash{font:12px ui-monospace,Menlo,monospace;word-break:break-all;background:#f6f6f6;padding:8px;border-radius:4px}
.btn{margin:0 0 16px;padding:8px 14px;font:inherit;cursor:pointer}
@media print{.btn{display:none}body{margin:0}}
"""


def esc(value) -> str:
    return escape("" if value is None else str(value))


def page(title: str, body: str) -> str:
    return (
        f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>{esc(title)}</title>'
        f'<style>{CSS}</style></head><body>'
        '<button class="btn" onclick="window.print()">Imprimir / salvar como PDF</button>'
        f"{body}</body></html>"
    )
