from __future__ import annotations

import click
from flask import Flask, current_app
from flask.cli import with_appcontext

from .core.migrations import upgrade_database


def _ensure_models_loaded() -> None:
    from . import models  # noqa: F401


def register_commands(app: Flask) -> None:
    @app.cli.command("init-db")
    @with_appcontext
    def init_db_command() -> None:
        applied = upgrade_database()
        click.echo(f"Database migrated ({len(applied)} applied).")

    @app.cli.command("upgrade-db")
    @with_appcontext
    def upgrade_db_command() -> None:
        applied = upgrade_database()
        click.echo(f"Database migrated ({len(applied)} applied).")

    @app.cli.command("sync-runtime-schema")
    @with_appcontext
    def sync_runtime_schema_command() -> None:
        applied = upgrade_database()
        click.echo(f"Runtime schema migration compatibility completed ({len(applied)} applied).")

    @app.cli.command("seed-data")
    @click.option("--demo/--no-demo", default=None)
    @with_appcontext
    def seed_data_command(demo: bool | None) -> None:
        from .seed.bootstrap import seed_all

        enable_demo_data = current_app.config["ENABLE_DEMO_DATA"] if demo is None else demo
        seed_all(enable_demo_data=enable_demo_data)
        click.echo(f"Seed completed (demo={'on' if enable_demo_data else 'off'}).")

    @app.cli.command("bootstrap-app")
    @click.option("--demo/--no-demo", default=None)
    @with_appcontext
    def bootstrap_app_command(demo: bool | None) -> None:
        from .seed.bootstrap import seed_all

        _ensure_models_loaded()
        enable_demo_data = current_app.config["ENABLE_DEMO_DATA"] if demo is None else demo
        upgrade_database()
        seed_all(enable_demo_data=enable_demo_data)
        click.echo(f"Bootstrap completed (demo={'on' if enable_demo_data else 'off'}).")

    @app.cli.command("export-audit-logs")
    @with_appcontext
    def export_audit_logs_command() -> None:
        from .services.audit_log_archive import run_daily_admin_log_exports

        result = run_daily_admin_log_exports()
        click.echo(str(result))

    @app.cli.command("backfill-assignment-images")
    @with_appcontext
    def backfill_assignment_images_command() -> None:
        from .core.db import db
        from .services.assignment_images import backfill_assignment_placeholders

        attached = backfill_assignment_placeholders()
        db.session.commit()
        click.echo(f"Assignment placeholders attached: {attached}.")
