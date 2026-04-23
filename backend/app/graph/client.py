"""Neo4j driver singleton."""

from __future__ import annotations

from functools import lru_cache

from neo4j import Driver, GraphDatabase

from app.config import get_settings


@lru_cache(maxsize=1)
def get_driver() -> Driver:
    s = get_settings()
    return GraphDatabase.driver(s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password))


def close_driver() -> None:
    get_driver.cache_clear()
