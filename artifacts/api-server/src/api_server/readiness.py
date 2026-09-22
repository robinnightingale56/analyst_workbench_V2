"""Read-only checks; never initialize or migrate the database."""
from sqlalchemy import select, text


def database_readiness() -> dict:
    try:
        from .db import Base, engine
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            # Selecting zero rows checks table/column presence and SELECT access.
            for table in Base.metadata.sorted_tables:
                connection.execute(select(table).limit(0))
        return {"ready": True}
    except Exception:
        # Driver messages can contain credentials, SQL, and hostnames.
        return {"ready": False, "reason": "DATABASE_UNAVAILABLE_OR_SCHEMA_INCOMPLETE"}