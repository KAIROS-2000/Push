"""Application-owned schema migrations.

This lightweight migration layer is intentionally dependency-free so the
existing Docker/CI flow can move away from runtime DDL before a full Alembic
adoption. Migration modules are applied in lexical order by
``app.core.migrations.upgrade_database``.
"""

