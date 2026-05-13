# Задачи по итогам аудита

> Сформировано: 2026-05-11 на основе [FULL_PROJECT_AUDIT_REPORT.md](FULL_PROJECT_AUDIT_REPORT.md).
> Задачи отсортированы по приоритету: P0 (блокеры) → P1 (важные) → P2 (улучшения) → P3 (тех. долг).
> Каждая задача независима для одного PR, кроме явно указанных зависимостей.

---

## P0 — блокеры до production

### T-C1 · Исправить миграцию 0019: таблица `conversations` → `message_conversations`

- **Приоритет:** P0
- **Описание:** В `_FK_RULES` пять записей ссылаются на несуществующую таблицу `conversations`. Реальное имя — `message_conversations` (см. `__tablename__` в [models/messaging.py:11](../backend/app/models/messaging.py)). Из-за `if not _table_exists(...)` записи молча скипаются, CASCADE для `message_conversations` и `messages.conversation_id`, `conversation_read_states.conversation_id` не применяется.
- **Файлы:** [backend/app/migrations/0019_fk_ondelete_cascade.py](../backend/app/migrations/0019_fk_ondelete_cascade.py) строки 51-56.
- **Конкретные изменения:**
  ```python
  ("message_conversations", "classroom_id", "classrooms", "CASCADE"),
  ("message_conversations", "teacher_id", "users", "CASCADE"),
  ("message_conversations", "student_id", "users", "CASCADE"),
  ("messages", "conversation_id", "message_conversations", "CASCADE"),
  ("messages", "sender_id", "users", "CASCADE"),
  ("conversation_read_states", "conversation_id", "message_conversations", "CASCADE"),
  ("conversation_read_states", "user_id", "users", "CASCADE"),
  ```
- **Критерии приёмки:**
  1. На свежей PG после `flask upgrade-db` query `SELECT delete_rule FROM information_schema.referential_constraints` для всех 7 строк выдаёт `CASCADE`.
  2. Тест TT-01 (см. ниже) зелёный.
- **Тесты:** TT-01 `test_migration_0019_applies_all_fk_cascade`.
- **Риски:** Если в БД уже есть orphan `message_conversations.classroom_id`, ALTER упадёт. Перед prod-deploy сделать smoke на staging-копии.
- **Зависимости:** —

---

### T-C2 · Исправить миграцию 0019: `staff_direct_messages.thread_id → staff_direct_threads`

- **Приоритет:** P0
- **Описание:** Запись `("staff_direct_messages", "thread_id", "users", "CASCADE")` указывает неверный целевой таблицей `users` (FK реально ссылается на `staff_direct_threads`).
- **Файлы:** [backend/app/migrations/0019_fk_ondelete_cascade.py:59](../backend/app/migrations/0019_fk_ondelete_cascade.py).
- **Конкретные изменения:**
  ```python
  ("staff_direct_messages", "thread_id", "staff_direct_threads", "CASCADE"),
  ```
- **Критерии приёмки:**
  1. `flask upgrade-db` завершается успешно на свежей PG.
  2. Constraint `fk_staff_direct_messages_thread_id_staff_direct_threads` создан с `ON DELETE CASCADE`.
- **Тесты:** TT-01.
- **Риски:** —
- **Зависимости:** T-C1 (один и тот же файл).

---

### T-C3 · Исправить миграцию 0019: `support_tickets.user_id` (не `author_user_id`)

- **Приоритет:** P0
- **Описание:** Колонка `support_tickets.author_user_id` не существует. Реальная — `user_id` (см. [models/support.py:19](../backend/app/models/support.py)).
- **Файлы:** [backend/app/migrations/0019_fk_ondelete_cascade.py:86](../backend/app/migrations/0019_fk_ondelete_cascade.py).
- **Конкретные изменения:**
  ```python
  ("support_tickets", "user_id", "users", "CASCADE"),
  ```
- **Критерии приёмки:** см. T-C1.
- **Тесты:** TT-01.
- **Риски:** —
- **Зависимости:** T-C1 (один файл).

---

### T-H1 · Запретить ре-сабмит assignment после `checked`

- **Приоритет:** P0
- **Описание:** В `submit_assignment` ученик может перезаписать `checked` submission, что стирает оценку учителя.
- **Файлы:** [backend/app/api/student.py:1246-1271](../backend/app/api/student.py).
- **Конкретные изменения:**
  ```python
  if existing:
      if existing.status == 'checked':
          return {
              "message": "Это задание уже проверено учителем. Попросите вернуть на доработку.",
              "code": "submission_already_checked",
          }, 400
      existing.answer = answer
      existing.score = 0  # будет пересчитан после проверки
      existing.status = "pending_review"
      existing.feedback = None
  else:
      ...
  ```
- **Критерии приёмки:**
  1. Тест TT-02 зелёный.
  2. Ручной сценарий: teacher ставит `checked` + score=10; student POST submit → 400.
- **Тесты:** TT-02 `test_submit_assignment_blocked_after_checked`.
- **Риски:** UX-breakage: студент должен сначала попросить учителя «вернуть на доработку». Это требует UI-кнопки в teacher-workspace. Добавить endpoint `POST /api/teacher/submissions/<id>/reopen` отдельно (P1).

---

### T-H5 · Валидация `external_url` в useful_tasks

- **Приоритет:** P0 (XSS-vector)
- **Описание:** Admin может сохранить `javascript:...` или `data:...` URL → XSS у учеников.
- **Файлы:** [backend/app/api/useful.py:207, 238-240](../backend/app/api/useful.py).
- **Конкретные изменения:**
  ```python
  def _validate_external_url(value) -> tuple[str | None, tuple[dict, int] | None]:
      raw = str(value or "").strip()
      if not raw:
          return None, None
      if not (raw.startswith("https://") or raw.startswith("http://")):
          return None, ({"message": "external_url должен начинаться с http:// или https://"}, 400)
      if len(raw) > 500:
          return None, ({"message": "external_url слишком длинный (макс. 500)."}, 400)
      return raw, None
  ```
  В `admin_create_useful` и `admin_update_useful` вызвать `_validate_external_url(data.get('external_url'))`.
- **Критерии приёмки:**
  1. TT-03, TT-04 зелёные.
  2. `POST /admin {external_url: "javascript:..."}` → 400.
- **Тесты:** TT-03, TT-04.

---

## P1 — важные

### T-H2 · Ужесточить decorator в staff_messaging /threads/<id>/*

- **Приоритет:** P1
- **Описание:** Defense in depth: добавить role-list к трём endpoint'ам.
- **Файлы:** [backend/app/api/staff_messaging.py:96, 120, 145](../backend/app/api/staff_messaging.py).
- **Конкретные изменения:**
  ```python
  @staff_messaging_bp.get("/threads/<int:thread_id>/messages")
  @auth_required([UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.TEACHER])
  def list_thread_messages(user: User, thread_id: int):
      ...
  ```
  Аналогично для `post_thread_message` и `mark_thread_read`.
- **Критерии приёмки:** TT-15 зелёный.
- **Тесты:** TT-15.

---

### T-H3 · Валидация полей в admin /admins POST

- **Приоритет:** P1
- **Описание:** Email-формат, full_name-длина, убрать `xp=2000`.
- **Файлы:** [backend/app/api/admin.py:1162-1200](../backend/app/api/admin.py).
- **Конкретные изменения:**
  ```python
  from .auth import is_valid_email
  ...
  email = (data.get('email') or '').strip().lower()
  if not email or not is_valid_email(email):
      return {'message': 'Укажите корректный email нового администратора.'}, 400
  full_name = str(data.get('full_name') or 'Администратор').strip()[:120]
  ...
  admin = User(
      full_name=full_name,
      email=email,
      password_hash=hash_password(password),
      role=UserRole.ADMIN,
      age_group='adult',
      xp=0,
  )
  ```
- **Критерии приёмки:** TT-07, TT-08, TT-09 зелёные.
- **Тесты:** TT-07, TT-08, TT-09.

---

### T-H4 · Валидация полей в admin /modules POST + PATCH

- **Приоритет:** P1
- **Описание:** Обязательность slug + format, валидный age_group, color, order_index.
- **Файлы:** [backend/app/api/admin.py:982-1039](../backend/app/api/admin.py).
- **Конкретные изменения:**
  ```python
  import re
  _SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
  _COLOR_RE = re.compile(r'^#[0-9A-Fa-f]{6}$')
  VALID_AGE_GROUPS = {'junior', 'middle', 'senior'}
  VALID_ICONS = {'sparkles', 'book-open', 'code', 'rocket', 'star', 'gamepad', 'compass'}  # adjust
  
  slug = (data.get('slug') or '').strip().lower()
  if not _SLUG_RE.match(slug):
      return {'message': 'Slug обязателен (только латиница, цифры и дефисы).'}, 400
  age_group = (data.get('age_group') or 'middle').strip().lower()
  if age_group not in VALID_AGE_GROUPS:
      return {'message': f'age_group должен быть {sorted(VALID_AGE_GROUPS)}.'}, 400
  color = (data.get('color') or '#4A90D9').strip()
  if not _COLOR_RE.match(color):
      return {'message': 'color должен быть в формате #RRGGBB.'}, 400
  order_index = _safe_int(data.get('order_index'), Module.query.count() + 1, minimum=1, maximum=1000)
  ```
- **Критерии приёмки:** TT-10, TT-11 зелёные.
- **Тесты:** TT-10, TT-11.

---

### T-H6 · Ограничить cosmetics ролями {STUDENT, PARENT}

- **Приоритет:** P1
- **Описание:** Admin/teacher не должны покупать косметику.
- **Файлы:** [backend/app/api/cosmetics.py:20, 33, 80](../backend/app/api/cosmetics.py).
- **Конкретные изменения:**
  ```python
  from ..models.user import UserRole
  
  @cosmetics_bp.get("/cosmetics")
  @auth_required([UserRole.STUDENT, UserRole.PARENT])
  def list_cosmetics(user: User):
      ...
  
  @cosmetics_bp.post("/cosmetics/purchase")
  @auth_required([UserRole.STUDENT, UserRole.PARENT])
  def purchase_cosmetic(user: User):
      ...
  
  @cosmetics_bp.post("/cosmetics/equip")
  @auth_required([UserRole.STUDENT, UserRole.PARENT])
  def equip_cosmetic(user: User):
      ...
  ```
- **Критерии приёмки:** TT-05, TT-06 зелёные.
- **Тесты:** TT-05, TT-06.

---

### T-M1 · Убрать email из payload support tickets

- **Приоритет:** P1
- **Описание:** PII leak — student/parent видит email staff.
- **Файлы:** [backend/app/services/support_tickets.py:43-51](../backend/app/services/support_tickets.py).
- **Конкретные изменения:**
  ```python
  def _user_payload(user: User | None, *, include_email: bool = False) -> dict | None:
      if user is None:
          return None
      payload = {"id": user.id, "full_name": user.full_name, "role": user.role.value}
      if include_email:
          payload["email"] = user.email
      return payload
  ```
  В `message_payload` / `staff_ticket_rows` / `ticket_detail_payload` передавать `include_email=viewer.role in _STAFF_ROLES`.
- **Критерии приёмки:** TT-13.
- **Тесты:** TT-13.

---

### T-M4 · Admin создаётся с `xp=0`

- **Приоритет:** P1
- **Описание:** Семантика XP — только для учеников.
- **Файлы:** [backend/app/api/admin.py:1182](../backend/app/api/admin.py).
- **Конкретные изменения:** `xp=2000` → `xp=0`.
- **Критерии приёмки:** TT-09.
- **Тесты:** TT-09.
- **Зависимости:** T-H3 (один файл).

---

### T-M6 · Audit log для teacher.grade_submission

- **Приоритет:** P1
- **Описание:** Сейчас grading логируется только в `SiteActivityLog` (per-request). Семантический audit отсутствует.
- **Файлы:** [backend/app/api/teacher.py:669-681](../backend/app/api/teacher.py).
- **Конкретные изменения:** Добавить запись в `AdminAuditLog` (или новый `TeacherAuditLog` если хотим разделение):
  ```python
  db.session.add(
      AdminAuditLog(
          actor_user_id=current_user.id,
          actor_role=current_user.role.value,
          action='submission_graded',
          entity_type='assignment_submission',
          entity_id=submission.id,
          entity_label=f"submission#{submission.id}",
          details_json={
              'previous_score': previous_score,
              'next_score': submission.score,
              'previous_status': previous_status,
              'next_status': submission.status,
              'student_id': submission.student_id,
              'assignment_id': submission.assignment_id,
              'feedback_length': len(submission.feedback or ''),
          },
      )
  )
  ```
- **Критерии приёмки:** TT-16 зелёный.
- **Тесты:** TT-16.

---

### T-M7 · State machine в support_tickets.staff_set_status

- **Приоритет:** P1
- **Файлы:** [backend/app/services/support_tickets.py:303-318](../backend/app/services/support_tickets.py).
- **Конкретные изменения:**
  ```python
  _ALLOWED_TRANSITIONS = {
      'open': {'in_progress', 'resolved', 'closed'},
      'in_progress': {'resolved', 'closed', 'open'},
      'resolved': {'closed', 'in_progress'},
      'closed': {'open'},  # re-open allowed
  }
  ...
  current = ticket.status
  if status not in _ALLOWED_TRANSITIONS.get(current, set()) and status != current:
      return None, ({"message": f"Недопустимый переход {current} → {status}."}, 400)
  ```
- **Тесты:** TT-14.

---

### T-M11 · Убрать email из staff_messaging service `_user_payload`

- **Приоритет:** P1
- **Описание:** Хотя staff-thread между двумя staff-членами, защита в глубину — убрать email и тут.
- **Файлы:** [backend/app/services/staff_messaging.py:41-49](../backend/app/services/staff_messaging.py).

---

### T-M12 · Truncate `full_name` в auth.register

- **Приоритет:** P1
- **Файлы:** [backend/app/api/auth.py:195](../backend/app/api/auth.py).
- **Конкретные изменения:**
  ```python
  full_name=str(data.get('full_name') or '').strip()[:120],
  ```
- **Тесты:** TT-12.

---

### T-T01 · Тест миграции 0019 — assert на CASCADE

- **Приоритет:** P0 (тест для предотвращения регрессов C-1..C-3)
- **Файл:** добавить [backend/tests/test_migration_0019.py](../backend/tests/test_migration_0019.py).
- **Содержимое:**
  ```python
  # Pseudocode
  from app.migrations import _FK_RULES  # need to expose
  for table, column, ref_table, action in _FK_RULES:
      delete_rule = query_delete_rule(table, column)
      assert delete_rule == action.upper()
  ```
- **Критерии приёмки:** все 45 FK имеют ожидаемый rule.

---

### T-T-tests · Добавить недостающие тесты

- **Приоритет:** P1
- **Список:** TT-02, TT-03, TT-04, TT-05, TT-06, TT-07, TT-08, TT-09, TT-10, TT-11, TT-12, TT-13, TT-14, TT-15, TT-16, TT-17, TT-18, TT-19, TT-20 (см. §14 отчёта).
- **Критерии приёмки:** все 20 тестов зелёные на CI.

---

## P2 — улучшения

### T-M5 · `_safe_int` с границами для `passing_score`, `duration_minutes` в `create_module_lesson`

- **Файл:** [admin.py:1077-1099](../backend/app/api/admin.py).

### T-M9 · Frontend декомпозиция крупных компонентов

- **Файлы:** `shared-lesson-builder.tsx`, `lesson-player.tsx`, `teacher-workspace.tsx`, `admin-tools.tsx`, `messages-page-view.tsx`.

### T-M10 · Backend декомпозиция `student.py`

- **Файлы:** разбить `student.py` (52 KB) на:
  - `student_dashboard.py`
  - `student_lessons.py`
  - `student_classes.py`
  - `student_parent_link.py`
  - `student_leaderboard.py`

### T-M14 · Валидация slug-длины в useful_tasks

- **Файл:** [useful.py:232-233](../backend/app/api/useful.py).

### T-L1 · `submit_assignment` `score=NULL` до проверки

- **Файл:** [student.py:1257](../backend/app/api/student.py).
- **Конкретное изменение:** убрать «фейковый» score `100 if len >= 10 else 60`, ставить `score=None` (NULL) до проверки. Модель `AssignmentSubmission.score` сейчас `nullable=False, default=0` — придётся миграция:
  ```sql
  ALTER TABLE assignment_submissions ALTER COLUMN score DROP NOT NULL;
  ```
  Или продолжать использовать `score=0`, но не отдавать его в payload как окончательный — добавить `is_graded=False`.

### T-L3 · `/api/achievements` ограничить student/parent

- **Файл:** [student.py:1118-1131](../backend/app/api/student.py).
- **Изменение:** `@auth_required([UserRole.STUDENT, UserRole.PARENT])`.

### T-L6 · Удалить in-process `_global_leaderboard_cache`

- **Файл:** [student.py:96-98](../backend/app/api/student.py).
- **Изменение:** убрать dict; полагаться только на Redis. Если Redis недоступен — вычислять заново каждый раз (медленно, но cache-shared между workers).

---

## P3 — тех. долг

### T-L7 · Декомпозиция `seed/bootstrap.py`

- Разбить на тематические файлы (avatars, frames, themes, modules, demo_data, superadmin).

### T-Alembic · Перейти на Alembic

- **Описание:** Custom runner не поддерживает downgrade, нет dep-graph, нет `CREATE INDEX CONCURRENTLY`.
- **Шаги:**
  1. `alembic init backend/app/alembic`.
  2. `alembic stamp 0019_fk_ondelete_cascade` после применения текущих миграций.
  3. Удалить `core/migrations.py` или оставить как legacy-shim.
  4. Обновить CI и cli.py.

### T-Sentry · Добавить Sentry (Glitchtip self-hosted)

- **Шаги:** init в `__init__.py`, env var `SENTRY_DSN`, sample_rate в production.

### T-Prometheus · Метрики

- **Шаги:** `prometheus_flask_exporter`, эндпоинт `/metrics`, healthcheck-расширение.

### T-nsjail · Внедрить nsjail в judge-runner

- **Описание:** Defense in depth поверх Docker.
- **Шаги:** Dockerfile добавить `apt install nsjail libseccomp2`, runner вызывает `nsjail --chroot / --rlimit_as 128 --seccomp_policy=... -- python -I /work/main.py`.

### T-e2e · Playwright E2E

- **Сценарии:** student-journey, teacher-journey, parent-journey.

### T-frontend-tests · Vitest + React Testing Library

- **Целевые компоненты:** auth-form, lesson-player.

### T-OpenAPI · OpenAPI спецификация

- **Шаги:** flask-smorest, авто-генерация `frontend/src/types/index.ts` из spec через `openapi-typescript`.

### T-pin-digests · Inline Docker digest'ы в compose

- **Шаги:** запустить `scripts/pin-images.sh`, закоммитить результат.

### T-git-filter-repo · Очистить .env из git-истории

- **Шаги:**
  ```bash
  git clone --mirror <repo>
  git filter-repo --path .env --invert-paths
  git push --force origin --all --tags
  ```
  + отозвать GigaChat-ключ в кабинете Сбера, уведомить контрибьюторов.

### T-cosmetic-rename · Переименовать `иужчина1.png` → `мужчина1.png`

- **Файлы:** [media/avatars/иужчина1.png](../media/avatars/), [models/cosmetics.py:34](../backend/app/models/cosmetics.py).
- **Шаги:** `git mv media/avatars/иужчина1.png media/avatars/мужчина1.png` + изменить `"file": "иужчина1.png"` → `"file": "мужчина1.png"`.

---

## Сводка по задачам

| Приоритет | Кол-во | Блокеры |
|-----------|--------|---------|
| P0 | 5 (T-C1, T-C2, T-C3, T-H1, T-H5) + 1 тест (T-T01) | ✅ блокер production |
| P1 | 9 (T-H2/H3/H4/H6, T-M1/M4/M6/M7/M11/M12) + 19 тестов | до пилота |
| P2 | 7 | до 10 школ |
| P3 | 9 | плановый |
| **Итого** | **30+ задач** | — |

---

*Конец списка задач.*
