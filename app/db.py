from psycopg_pool import ConnectionPool

from app import config

_pool = None


def abrir():
    global _pool
    _pool = ConnectionPool(
        config.DATABASE_URL,
        min_size=2,
        max_size=config.POOL_MAX,
        timeout=config.POOL_TIMEOUT,
        open=True,
    )
    try:
        _pool.wait(timeout=8)
    except Exception:
        _pool.close()
        raise


def cerrar():
    if _pool is not None:
        _pool.close()


def pool():
    return _pool
