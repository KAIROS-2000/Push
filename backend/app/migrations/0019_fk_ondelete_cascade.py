"""Add ON DELETE CASCADE / SET NULL to all user-owned foreign keys.

Audit finding C-4: most FKs in the schema were created via ORM without an
explicit ``ondelete``. ORM cascade only runs when the parent is removed
through the session; ``DELETE FROM users WHERE ...`` or a backup-restore
fixup that uses raw SQL leaves orphan rows in conversations, submissions,
parent links and refresh tokens, which then fail joins or expose deleted
PII at /messaging.

This migration rebinds every user-owned FK to ``ON DELETE CASCADE`` (data
that is meaningless without the parent) or ``ON DELETE SET NULL`` (audit
trails / "decided by" pointers that should survive the parent's removal).
It is a PostgreSQL-only ALTER pass; on SQLite (used by local tests) the
constraint cannot be modified in place and the migration is a no-op since
SQLite does not enforce FK ondelete on a per-statement basis anyway.
"""

from __future__ import annotations

from sqlalchemy import inspect, text

revision = "0019_fk_ondelete_cascade"
description = "Bind every user-owned FK to ON DELETE CASCADE/SET NULL (PostgreSQL only)."


# (table, column, referenced_table, action). action is "CASCADE" or "SET NULL".
_FK_RULES: list[tuple[str, str, str, str]] = [
    # Refresh tokens / sessions vanish with the account.
    ("refresh_tokens", "user_id", "users", "CASCADE"),
    # Class memberships, join requests, progress and submissions follow the student.
    ("class_memberships", "student_id", "users", "CASCADE"),
    ("class_memberships", "classroom_id", "classrooms", "CASCADE"),
    ("class_join_requests", "student_id", "users", "CASCADE"),
    ("class_join_requests", "classroom_id", "classrooms", "CASCADE"),
    # Audit-relevant "decided by admin/teacher" — keep the request, null the actor.
    ("class_join_requests", "decided_by_id", "users", "SET NULL"),
    ("user_progress", "user_id", "users", "CASCADE"),
    ("user_progress", "lesson_id", "lessons", "CASCADE"),
    ("user_achievements", "user_id", "users", "CASCADE"),
    ("user_achievements", "achievement_id", "achievements", "CASCADE"),
    ("assignment_submissions", "student_id", "users", "CASCADE"),
    ("assignment_submissions", "assignment_id", "assignments", "CASCADE"),
    ("assignments", "classroom_id", "classrooms", "CASCADE"),
    ("assignments", "lesson_id", "lessons", "SET NULL"),
    # Classroom is bound to its teacher; reassign by hand if needed (rare).
    ("classrooms", "teacher_id", "users", "CASCADE"),
    ("lessons", "module_id", "modules", "CASCADE"),
    ("tasks", "lesson_id", "lessons", "CASCADE"),
    ("quizzes", "lesson_id", "lessons", "CASCADE"),
    # Messaging — teacher↔student. Tablename is `message_conversations` (see models/messaging.py).
    ("message_conversations", "classroom_id", "classrooms", "CASCADE"),
    ("message_conversations", "teacher_id", "users", "CASCADE"),
    ("message_conversations", "student_id", "users", "CASCADE"),
    ("messages", "conversation_id", "message_conversations", "CASCADE"),
    ("messages", "sender_id", "users", "CASCADE"),
    ("conversation_read_states", "conversation_id", "message_conversations", "CASCADE"),
    ("conversation_read_states", "user_id", "users", "CASCADE"),
    # Staff direct messaging.
    ("staff_direct_messages", "thread_id", "staff_direct_threads", "CASCADE"),
    ("staff_direct_messages", "sender_id", "users", "CASCADE"),
    ("staff_direct_threads", "user_low_id", "users", "CASCADE"),
    ("staff_direct_threads", "user_high_id", "users", "CASCADE"),
    ("staff_direct_read_states", "thread_id", "staff_direct_threads", "CASCADE"),
    ("staff_direct_read_states", "user_id", "users", "CASCADE"),
    # Parent cabinet — links/notifications/messaging follow the parent OR child.
    ("parent_child_links", "parent_user_id", "users", "CASCADE"),
    ("parent_child_links", "child_user_id", "users", "CASCADE"),
    ("parent_link_codes", "child_user_id", "users", "CASCADE"),
    ("parent_safety_settings", "parent_user_id", "users", "CASCADE"),
    ("parent_safety_settings", "child_user_id", "users", "CASCADE"),
    ("parent_consent_settings", "parent_user_id", "users", "CASCADE"),
    ("parent_consent_settings", "child_user_id", "users", "CASCADE"),
    ("parent_notifications", "parent_user_id", "users", "CASCADE"),
    ("parent_notifications", "child_user_id", "users", "SET NULL"),
    ("parent_teacher_threads", "parent_user_id", "users", "CASCADE"),
    ("parent_teacher_threads", "teacher_id", "users", "CASCADE"),
    ("parent_teacher_threads", "child_user_id", "users", "CASCADE"),
    ("parent_teacher_threads", "classroom_id", "classrooms", "CASCADE"),
    ("parent_teacher_messages", "thread_id", "parent_teacher_threads", "CASCADE"),
    ("parent_teacher_messages", "sender_id", "users", "CASCADE"),
    ("parent_teacher_read_states", "thread_id", "parent_teacher_threads", "CASCADE"),
    ("parent_teacher_read_states", "user_id", "users", "CASCADE"),
    # Cosmetics — purchased items vanish with the account.
    ("user_owned_cosmetics", "user_id", "users", "CASCADE"),
    # Support tickets — keep the trail of who interacted (admins can reassign).
    ("support_tickets", "user_id", "users", "CASCADE"),
    ("support_ticket_messages", "ticket_id", "support_tickets", "CASCADE"),
    ("support_ticket_messages", "sender_id", "users", "SET NULL"),
    ("support_ticket_read_states", "ticket_id", "support_tickets", "CASCADE"),
    ("support_ticket_read_states", "user_id", "users", "CASCADE"),
]


def _existing_fk_name(conn, table: str, column: str) -> str | None:
    row = conn.execute(
        text(
            """
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_name = :table
              AND kcu.column_name = :column
              AND tc.constraint_type = 'FOREIGN KEY'
            LIMIT 1
            """
        ),
        {"table": table, "column": column},
    ).first()
    return row[0] if row else None


def _table_exists(inspector, table: str) -> bool:
    return table in set(inspector.get_table_names())


def upgrade(db) -> None:
    if db.engine.dialect.name != "postgresql":
        # SQLite cannot ALTER an existing FK constraint and the local test suite
        # rebuilds the schema fresh on every run, so a no-op here is correct.
        return

    inspector = inspect(db.engine)
    with db.engine.begin() as conn:
        for table, column, ref_table, action in _FK_RULES:
            if not _table_exists(inspector, table) or not _table_exists(inspector, ref_table):
                continue
            existing = _existing_fk_name(conn, table, column)
            if existing:
                conn.execute(
                    text(f'ALTER TABLE "{table}" DROP CONSTRAINT IF EXISTS "{existing}"')
                )
            new_name = f"fk_{table}_{column}_{ref_table}"
            conn.execute(
                text(
                    f'ALTER TABLE "{table}" '
                    f'ADD CONSTRAINT "{new_name}" '
                    f'FOREIGN KEY ("{column}") '
                    f'REFERENCES "{ref_table}" (id) '
                    f"ON DELETE {action}"
                )
            )
