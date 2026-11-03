"""Limite simples de tentativas de login, em memória (por processo).

Contagem por e-mail + IP em janela deslizante. Suficiente para uma instância única;
com vários workers/servidores, trocar por um armazenamento compartilhado (ex.: Redis).
"""

import time
from collections import defaultdict, deque

MAX_FAILURES = 5
WINDOW_SECONDS = 15 * 60

_failures: dict[tuple[str, str], deque[float]] = defaultdict(deque)


def _recent(key: tuple[str, str], now: float) -> deque[float]:
    q = _failures[key]
    while q and now - q[0] > WINDOW_SECONDS:
        q.popleft()
    if not q:
        _failures.pop(key, None)
    return q


def retry_after(email: str, ip: str) -> int:
    """Segundos até liberar o login; 0 se não estiver bloqueado."""
    now = time.monotonic()
    key = (email.lower(), ip)
    q = _recent(key, now)
    if len(q) >= MAX_FAILURES:
        return max(1, int(WINDOW_SECONDS - (now - q[0])))
    return 0


def register_failure(email: str, ip: str) -> None:
    now = time.monotonic()
    key = (email.lower(), ip)
    _recent(key, now)
    _failures[key].append(now)


def reset(email: str | None = None, ip: str | None = None) -> None:
    if email is None:
        _failures.clear()
    else:
        _failures.pop((email.lower(), ip or ""), None)
