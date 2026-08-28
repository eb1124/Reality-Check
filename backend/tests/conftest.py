import pytest
from fastapi.testclient import TestClient

from app import database
from app.main import app


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Point every test at its own fresh, isolated SQLite file so runs are
    deterministic and never depend on or pollute a shared/dev database."""
    db_path = tmp_path / "test_verification.db"
    monkeypatch.setenv(database.ENV_VAR, str(db_path))
    database.init_db()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
