# Полный аудит проекта Progyx / ProgHUB

> Дата аудита: 2026-05-11
> Версия проекта на момент аудита: v1.0.3
> Аудитор: старший security/backend reviewer
> Ветка: `claude/xenodochial-jepsen-f401d5`
> Корень репозитория: `C:\Users\Administrator\Desktop\Push-main\.claude\worktrees\xenodochial-jepsen-f401d5`

---

## 1. Краткое резюме

**Общее состояние.** Платформа функционально зрелая (5 ролей, родительский кабинет, мессенджеры, изолированный judge-runner, email-канал, тикеты поддержки, аудит-журналы), большая часть критичных уязвимостей из предыдущей итерации закрыта (CSP nonce, CSRF double-submit, JWT keyring, judge-runner hardening, FK CASCADE, leaderboard cache invalidation). Однако в этой итерации аудита найдены **три новые критичные ошибки**, появившиеся в результате правок v1.0.3 (миграция 0019 содержит SQL-ошибки), и подтверждены несколько средних бизнес-логических уязвимостей, которые ранее не были закрыты.

**Готовность к production.** **Нельзя выпускать в production до исправления C-1 (миграция 0019 упадёт при `flask upgrade-db` на PostgreSQL)**, поскольку без неё нельзя поднять FK CASCADE. После C-1 + B-1 (отмена/инвариантность сдач) + B-2 (валидация admin-форм) проект пригоден для пилота в одной школе.

**Главный риск.** Миграция [0019_fk_ondelete_cascade.py](../backend/app/migrations/0019_fk_ondelete_cascade.py) содержит **три** конкретные SQL-ошибки, из-за которых `flask upgrade-db` сломается посреди транзакции на PostgreSQL. Это делает невозможным применение CASCADE, которое декларировано как закрытие защиты от orphan rows.

**Количество найденных проблем по критичности:**

| Уровень | Количество |
|---------|------------|
| Critical | 3 |
| High | 6 |
| Medium | 14 |
| Low | 10 |
| Info | 5 |
| **Итого** | **38** |

---

## 2. Методика проверки

### Изучённые директории и файлы

- `backend/app/` — все 11 blueprint'ов (`auth.py`, `student.py`, `teacher.py`, `admin.py`, `parent_cabinet.py`, `messaging.py`, `staff_messaging.py`, `cosmetics.py`, `support.py`, `useful.py`, `lesson_builder.py`).
- `backend/app/core/` — `config.py`, `security.py`, `code_judge.py`, `migrations.py`, `redis_client.py`, `throttle_redis.py`, `achievements.py`.
- `backend/app/models/` — все 10 файлов моделей (user, learning, messaging, parent_cabinet, cosmetics, staff_messaging, support, useful, media).
- `backend/app/migrations/` — 19 миграций (`0001..0019`).
- `backend/app/services/` — `support_tickets.py`, `staff_messaging.py`, `audit_log_archive.py`, `assignment_images.py`, `email_service.py`, `email_tokens.py`, `parent_*`, `teacher_query_service.py`.
- `backend/app/seed/bootstrap.py` (быстрый просмотр).
- `backend/app/__init__.py` — Flask app factory, security headers, before_request hooks.
- `backend/app/cli.py` — CLI-команды.
- `backend/tests/` — все 22 файла.
- `judge_runner/app.py`, `judge_runner/seccomp.json`, `judge_runner/Dockerfile`.
- `frontend/src/` — `proxy.ts`, `lib/api.ts`, `lib/auth-session.ts`, `app/api/[...path]/route.ts`, `components/cosmetics-shop.tsx` (статически), `package.json`.
- `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`.
- `.github/workflows/ci.yml`.
- `.env.example`, `secrets/*.example`.
- `scripts/backup.sh`, `scripts/restore.sh`, `scripts/pin-images.sh`.
- `README.md`, `Progyx_Architecture_v1.0.md`, `ARCHITECTURE.md`, `AGENTS.md`, `docs/`.

### Выполненные команды

- `python -m compileall backend judge_runner shared` — компилируется без ошибок (статическая проверка синтаксиса).
- Полная инвентаризация маршрутов: 128 routes c указанием `@auth_required([...])`-декоратора (Python-скрипт `find_routes.py`, см. tool-results).
- Grep по `__tablename__`, `db.ForeignKey`, `UniqueConstraint`, `Index`, `setattr`, `@auth_required`, `request.get_json`, `gigachat`, и др.

### Что не выполнено

- **Не запускалась** реальная миграция `flask upgrade-db` на PostgreSQL (нужна работающая БД).
- **Не запускались** unit-тесты (`unittest discover`).
- **Не выполнялся** `npm install` / `bun install` / `npm audit` / `pip-audit` (нет интернета — gitleaks / trivy / CVE-scan невозможны без внешних запросов; нужны команды отдельно).
- **Не выполнялся** Lighthouse / Playwright (нет live frontend).
- **Не запущен** judge-runner для проверки реального исполнения seccomp-профиля.
- **Не выполнялся** Docker build (требует docker daemon).

---

## 3. Карта проекта

### 3.1. Стек

- **Backend:** Flask 3.1.3, Flask-SQLAlchemy 3.1.1, SQLAlchemy 2.0.48, psycopg 3.2.12, PyJWT 2.10.1, Werkzeug 3.1.3, gunicorn 23.0.0, redis ≥5, Pillow 11.0.0.
- **Frontend:** Next.js 16.2.1, React 19.2.0, TypeScript 5.7+, Tailwind 4.2+, GSAP 3.14.2 (core + ScrollTrigger), Monaco, lucide-react, react-hot-toast.
- **Хранилища:** PostgreSQL 17, Redis 7-alpine.
- **Code execution:** standalone `judge-runner` (Python 3.12 + Node).
- **Email:** Unisender Go transactional API.
- **Инфра:** docker-compose, sidecar `db-backup`, Docker secrets для PG/Redis.

### 3.2. Точки входа

| Точка | Файл | Запуск |
|-------|------|--------|
| Backend WSGI | [backend/run.py](../backend/run.py) | `gunicorn run:app` |
| Frontend SSR | [frontend/src/app/layout.tsx](../frontend/src/app/layout.tsx) | `next start` |
| Judge-runner HTTP | [judge_runner/app.py](../judge_runner/app.py) | `python judge_runner/app.py` |
| CLI: миграции и seed | [backend/app/cli.py](../backend/app/cli.py) | `flask --app run.py bootstrap-app` |

### 3.3. Основные модули

| Модуль | Назначение |
|--------|------------|
| `api/auth` | регистрация, login, refresh, logout, email-verification, password reset |
| `api/student` | dashboard, roadmap, уроки, задания, leaderboard, parent-link codes |
| `api/teacher` | классы, заявки на вступление, кастомные уроки, проверка сдач |
| `api/parent_cabinet` | родительский dashboard, привязка ребёнка, safety/consent, уведомления, чат с учителем |
| `api/messaging` | teacher↔student conversations |
| `api/staff_messaging` | admin↔teacher, admin↔admin direct threads |
| `api/admin` | управление пользователями, модулями, телеметрия, audit log archives, медиа |
| `api/cosmetics` | каталог + покупка + экипировка |
| `api/support` | тикеты поддержки (user + staff side) |
| `api/useful` | каталог полезных задач (public + admin CRUD) |
| `api/lesson_builder` | конструктор квиза для уроков |

### 3.4. Сущности

User (5 ролей) · RefreshToken · SecurityThrottle · EmailToken · AdminAuditLog · SiteActivityLog · Module · Lesson · Task · Quiz · Achievement · UserAchievement · UserProgress · Classroom · ClassMembership · ClassJoinRequest · Assignment · AssignmentSubmission · MediaAsset · Conversation (`message_conversations`) · Message · ConversationReadState · StaffDirectThread · StaffDirectMessage · StaffDirectReadState · ParentChildLink · ParentLinkCode · ParentSafetySettings · ParentConsentSettings · ParentNotification · ParentTeacherThread · ParentTeacherMessage · ParentTeacherReadState · UserOwnedCosmetic · UsefulTask · SupportTicket · SupportTicketMessage · SupportTicketReadState.

### 3.5. Роли

- **student** — учится, сдаёт задания, состоит в классах, получает XP, привязывает родителя через одноразовый код.
- **teacher** — создаёт классы, кастомные уроки, назначает задания, проверяет сдачи, общается со студентами и родителями (по запросу через `ParentTeacherThread`).
- **parent** — полноценный аккаунт; привязка к ребёнку по одноразовому коду; чат с учителем; настройки safety/consent.
- **admin** — пользователи/модули/уроки/уведомления/полезные задания; staff-чат с учителями; модерация заявок учителей.
- **superadmin** — `admin` + управление admin-аккаунтами (create/block/delete); единственная роль, которая может удалить student/teacher.

### 3.6. Ключевые сценарии

1. Самостоятельная регистрация → email-verify → login (с защитой от brute-force через `THROTTLE_BACKEND=dual`).
2. Roadmap-обучение: forced sequence у студентов, monotonic XP, achievements при milestone.
3. Кастомный урок учителя для класса (slug-prefix `teacher-class-{id}-{age_group}`).
4. Подача задания → автограде через judge-runner → ручная проверка учителем.
5. Привязка родителя по hash-only one-time коду (`ParentLinkCode`).
6. Staff-direct-чат admin↔teacher.
7. Тикет поддержки (user → staff с state machine open/in_progress/resolved/closed).

---

## 4. Карта бизнес-логики

### 4.1. Жизненный цикл `UserProgress`

```
not_started → in_progress → completed
                ↑              ↓
                └─ needs_revision (для custom lessons)
                       ↑
                       └─ pending_review (если manual review)
```

- Score монотонен (`max(progress.score, new_score)`), его может изменить только `submit_task`/`submit_quiz` сервер-сайд.
- Statuses переписываются `_status_from_completion_percent()` после расчёта.
- **DEFECT (B-3):** `complete_lesson` для уроков без practice tasks И quizzes ставит `server_computed_percent = 100`. Если у урока есть и tasks, и quizzes, но они не сданы — `progress.score = 0` → status остаётся `not_started`. Условие в [student.py:776-779](../backend/app/api/student.py) корректное; но при отсутствии любого task/quiz и `is_published=False` урока без auth модуль может попасть в `STATE_MAP.completed`. Требует проверки.

### 4.2. Жизненный цикл `AssignmentSubmission`

```
submitted → checked (terminal)
   ↑          ↓
   └─ needs_revision
        ↑
        └─ student re-submit ──┐
                               ↓
                            submitted (loop)
```

- **DEFECT (B-1, MEDIUM):** В [student.py:1246-1271](../backend/app/api/student.py) `submit_assignment` **позволяет ученику ре-сабмитить уже `checked` (проверенное) задание**. Текущий код:
  ```python
  if existing:
      existing.answer = answer
      existing.score = max(existing.score, score)
      existing.status = "pending_review"
  ```
  Учитель ставит `score=30`, статус `checked`. Студент шлёт `submit_assignment` ещё раз с длинным ответом → `score = max(30, 100) = 100`, status = `pending_review`. **Финальная оценка учителя стёрта.**
- Проверка `submission.status` не выполняется.

### 4.3. Жизненный цикл `ClassJoinRequest`

```
pending → approved
      └→ rejected
```

- Teacher одобряет/отклоняет; `approve_join_request` создаёт `ClassMembership`. **OK.**
- State check `status != 'pending'` присутствует ([teacher.py:413, 446](../backend/app/api/teacher.py)).

### 4.4. Жизненный цикл `SupportTicket`

```
open → in_progress → resolved → closed
      ↑     ↓
      └─────┘ (admin меняет в любом направлении)
```

- **DEFECT (B-4, LOW):** `staff_set_status` принимает любой переход из любого статуса. Можно прыгнуть `closed → open` без re-create. UX-вопрос, но не critical.

### 4.5. Жизненный цикл `ParentLinkCode`

```
created (hash-only, TTL=7d)
   └→ used_at (one-time)
   └→ revoked_at (студент отменил)
```

- One-time use enforced. **OK.**

### 4.6. Бизнес-правила (где реализованы)

| Правило | Где |
|---------|-----|
| Junior age_group ⇒ нельзя кодовая практика | [models/learning.py:76-77](../backend/app/models/learning.py), [teacher.py:552](../backend/app/api/teacher.py) |
| Forced lesson sequence для student | [student.py:376-411](../backend/app/api/student.py) (`_uses_forced_lesson_sequence`, `_effective_lesson_state_for_user`) |
| Email verify gate перед login | [auth.py:433-446](../backend/app/api/auth.py) |
| Teacher approval gate перед login | [auth.py:413-423](../backend/app/api/auth.py), `teacher_approval_auth_error` |
| Owner-check classroom для teacher | [teacher.py:82-83, 489, 617, 673](../backend/app/api/teacher.py) (везде `teacher_id=current_user.id` фильтр) |
| Membership-check class для student | [student.py:1196-1198, 1250-1252](../backend/app/api/student.py) |
| Parent → child link active check | [parent_cabinet.py:47-56](../backend/app/api/parent_cabinet.py) (`_child_user_for_parent`) |
| Atomic XP spend (race-free) | [cosmetics.py:65-72](../backend/app/api/cosmetics.py) (`UPDATE users SET xp = xp - price WHERE id = ? AND xp >= price`) |
| Self-protection в admin-block/delete | [admin.py:869-870, 924-925, 1206-1207, 1261-1262](../backend/app/api/admin.py) |

---

## 5. Найденные проблемы по критичности

### [C-1] Миграция 0019_fk_ondelete_cascade ссылается на несуществующую таблицу `conversations`

- **Критичность:** Critical
- **Категория:** Data / DevOps
- **Статус:** подтверждено (статически)
- **Файл:** [backend/app/migrations/0019_fk_ondelete_cascade.py](../backend/app/migrations/0019_fk_ondelete_cascade.py)
- **Строки:** 51, 52, 53, 54, 56
- **Описание:** В списке `_FK_RULES` записаны записи для таблицы `conversations`, но фактическое имя таблицы — `message_conversations` (см. [models/messaging.py:11](../backend/app/models/messaging.py)). Из-за защитного условия `if not _table_exists(inspector, table)` миграция **молча скипнет** эти 5 FK. CASCADE для `conversations.classroom_id/teacher_id/student_id`, `messages.conversation_id`, `conversation_read_states.conversation_id` **не будет применён**.
- **Доказательство:**
  - `__tablename__ = "message_conversations"` в [models/messaging.py:11](../backend/app/models/messaging.py).
  - Записи в миграции на строках 51-56: `("conversations", ...)` и `("messages", "conversation_id", "conversations", "CASCADE")`.
- **Безопасный сценарий воспроизведения:** запустить `flask --app run.py upgrade-db` на PostgreSQL; миграция «пройдёт успешно», но `\d+ message_conversations` покажет, что FK без `ON DELETE`. Прямой `DELETE FROM users` или `DELETE FROM classrooms` оставит orphan rows.
- **Влияние:** Декларация v1.0.3 «закрыто P0-блокер orphan rows» не соответствует факту: 5 ключевых FK всё ещё без CASCADE. Любой ручной cleanup БД создаёт мусорные строки.
- **Вероятность:** 100% при выполнении миграции.
- **Рекомендация:** Заменить `"conversations"` на `"message_conversations"` во всех 5 строках (51, 52, 53, 54 (ref), 56 (ref)).
- **Минимальная правка:** строки 51-56 в `_FK_RULES`.
- **Какие тесты добавить:** регресс — после миграции выполнить `SELECT * FROM information_schema.referential_constraints WHERE constraint_schema = 'public' AND delete_rule = 'NO ACTION'` и assert, что таблица `message_conversations` не присутствует.
- **Связанные риски:** C-2, C-3.

### [C-2] Миграция 0019 указывает FK `staff_direct_messages.thread_id → users` (должно быть `→ staff_direct_threads`)

- **Критичность:** Critical
- **Категория:** Data
- **Статус:** подтверждено
- **Файл:** [backend/app/migrations/0019_fk_ondelete_cascade.py](../backend/app/migrations/0019_fk_ondelete_cascade.py)
- **Строка:** 59
- **Описание:** Запись `("staff_direct_messages", "thread_id", "users", "CASCADE")` неверна. В [models/staff_messaging.py:63](../backend/app/models/staff_messaging.py): `thread_id = db.Column(db.Integer, db.ForeignKey("staff_direct_threads.id"), nullable=False)`. Миграция попытается выполнить `ALTER TABLE staff_direct_messages ADD CONSTRAINT fk_... FOREIGN KEY (thread_id) REFERENCES users (id) ON DELETE CASCADE`, что **упадёт с ошибкой PostgreSQL** «foreign key constraint cannot be implemented» (детали 23503: existing thread_id values don't match users.id).
- **Доказательство:** [models/staff_messaging.py:63](../backend/app/models/staff_messaging.py) показывает `ForeignKey("staff_direct_threads.id")`.
- **Безопасный сценарий воспроизведения:** запустить `flask upgrade-db` на PostgreSQL с не-пустой таблицей `staff_direct_messages`. Миграция упадёт. Без существующих данных — также упадёт, так как PostgreSQL не позволит создать FK с несовместимыми типами/референсами (минимум — `ERROR: there is no unique constraint matching given keys for referenced table "users"` if columns match by chance, but typically other errors first).
- **Влияние:** Любой апгрейд БД на pristine PG прервётся; CASCADE не применится для остальных таблиц после этой строки в порядке выполнения; новая база не сможет быть инициализирована штатным `bootstrap-app`.
- **Вероятность:** 100%.
- **Рекомендация:** Заменить `("staff_direct_messages", "thread_id", "users", "CASCADE")` → `("staff_direct_messages", "thread_id", "staff_direct_threads", "CASCADE")`.
- **Минимальная правка:** строка 59 в `_FK_RULES`.
- **Какие тесты добавить:** `test_migration_0019_ondelete_applied` — после применения проверить, что для каждого FK из `_FK_RULES` `delete_rule != 'NO ACTION'`.
- **Связанные риски:** C-3.

### [C-3] Миграция 0019 указывает несуществующую колонку `support_tickets.author_user_id`

- **Критичность:** Critical
- **Категория:** Data
- **Статус:** подтверждено
- **Файл:** [backend/app/migrations/0019_fk_ondelete_cascade.py](../backend/app/migrations/0019_fk_ondelete_cascade.py)
- **Строка:** 86
- **Описание:** Запись `("support_tickets", "author_user_id", "users", "CASCADE")` неверна. В [models/support.py:19](../backend/app/models/support.py) колонка называется `user_id`, не `author_user_id`. Миграция попытается выполнить `ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS "fk_..."` (no-op, IF EXISTS) + `ADD CONSTRAINT ... FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE CASCADE`, что **упадёт с PostgreSQL `ERROR: column "author_user_id" does not exist`**.
- **Доказательство:** [models/support.py:19](../backend/app/models/support.py): `user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)`.
- **Безопасный сценарий воспроизведения:** запустить миграцию на свежей БД (после успешного применения 0001-0018). Транзакция упадёт в `db.engine.begin()` блоке → откат всех ALTER в этой миграции.
- **Влияние:** Невозможность применить FK CASCADE для всех таблиц после этой строки; rollback всей миграции 0019 в одной транзакции → ни одна из 45 строк не применится.
- **Вероятность:** 100%.
- **Рекомендация:** Заменить `"author_user_id"` → `"user_id"`.
- **Минимальная правка:** строка 86.
- **Какие тесты добавить:** см. C-2.
- **Связанные риски:** C-1, C-2 (все три критичных проблемы — в одной миграции).

### [H-1] `submit_assignment` позволяет ученику стереть оценку учителя путём ре-сабмита

- **Критичность:** High
- **Категория:** Business Logic
- **Статус:** подтверждено
- **Файл:** [backend/app/api/student.py](../backend/app/api/student.py)
- **Строки:** 1246-1271 (`submit_assignment`)
- **Описание:** После того как учитель проверил сдачу (`submission.status = 'checked'` и поставил произвольный score), ученик может вызвать `POST /api/assignments/<id>/submit` ещё раз. Код безусловно:
  ```python
  existing.answer = answer
  existing.score = max(existing.score, score)  # score = 100 if len >= 10 else 60
  existing.status = "pending_review"
  ```
  - Если учитель поставил score=30 → новый score=max(30,100)=100.
  - Статус возвращается в `pending_review`, что заставляет учителя проверять снова.
  - `existing.feedback` не сбрасывается, но визуально учитель не знает, что student переписал.
- **Доказательство:** см. строки 1218-1225 в [student.py](../backend/app/api/student.py).
- **Безопасный сценарий воспроизведения:**
  1. Student регистрируется, вступает в класс.
  2. Teacher назначает assignment.
  3. Student сдаёт «ok» (короткий ответ → score=60).
  4. Teacher проверяет, ставит score=10, status=checked.
  5. Student шлёт `POST /assignments/<id>/submit` c body длиннее 10 символов → score=max(10,100)=100, status=pending_review.
- **Влияние:** Студент может бесконечно «крутить» score вверх и отменять решение учителя.
- **Вероятность:** Высокая (тривиально).
- **Рекомендация:**
  - Запретить ре-сабмит, если `existing.status == 'checked'` (или ввести явный teacher-action «вернуть на доработку»).
  - Не использовать `max(existing.score, score)` — оставить `existing.score` неизменным до повторной проверки.
  - Сбрасывать `existing.feedback = None` при ре-сабмите.
- **Минимальная правка:**
  ```python
  if existing:
      if existing.status == 'checked':
          return {"message": "Это задание уже проверено учителем. Попросите вернуть на доработку."}, 400
      existing.answer = answer
      existing.score = 0  # будет переоценено учителем
      existing.status = "pending_review"
      existing.feedback = None
  ```
- **Какие тесты добавить:** `test_submit_assignment_blocked_after_checked` — student не может перезаписать checked submission.
- **Связанные риски:** B-1.

### [H-2] `messaging /threads/<id>/*` доступны любой роли через `@auth_required()` (defense-in-depth)

- **Критичность:** High (но компенсировано внутренним check'ом)
- **Категория:** Security / Architecture
- **Статус:** частично подтверждено (эксплуатация невозможна, но decorator неточен)
- **Файл:** [backend/app/api/staff_messaging.py](../backend/app/api/staff_messaging.py)
- **Строки:** 96, 120, 145
- **Описание:** `list_thread_messages`, `post_thread_message`, `mark_thread_read` помечены `@auth_required()` без role-list. Защита делегирована в `user_can_access_thread(user, thread)` (line 102), которая проверяет `user.id ∈ {thread.user_low_id, thread.user_high_id}`. Поскольку student/parent никогда не становятся участниками staff-thread (start_thread admin-only, peer_id ограничен в service), эксплуатация невозможна. Но любая ошибка в service-слое (например, баг в `start_thread_with_message_from_staff`, добавляющий не-staff peer) сразу станет уязвимостью.
- **Доказательство:** строки 96-97, 120-121, 145-146 в [staff_messaging.py](../backend/app/api/staff_messaging.py).
- **Безопасный сценарий воспроизведения:** Если кто-то рефакторит `start_thread_with_message_from_staff` и забудет валидацию peer-роли, student сможет вызывать `GET /staff-messaging/threads/<id>/messages` для thread, в котором он стал участником через баг.
- **Влияние:** Раскрытие переписки admin↔teacher для скомпрометированного student-аккаунта.
- **Рекомендация:** ужесточить decorator: `@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.TEACHER])` на всех trio endpoints.
- **Минимальная правка:** добавить role-list в три декоратора.
- **Какие тесты добавить:** `test_student_cannot_access_staff_thread_messages` — student с активным session получает 403 на GET/POST `/staff-messaging/threads/<id>/messages`.

### [H-3] `admin /admins` POST не валидирует email-формат, full_name-длину; admin создаётся с `xp=2000` без объяснения

- **Критичность:** High
- **Категория:** Business Logic / Architecture
- **Статус:** подтверждено
- **Файл:** [backend/app/api/admin.py](../backend/app/api/admin.py)
- **Строки:** 1162-1200
- **Описание:**
  1. `email = (data.get('email') or '').strip().lower()` — нет regex-проверки. Можно создать admin с email `'admin@'` или `'1'`.
  2. `full_name=data.get('full_name', 'Администратор')` — нет ограничения длины. На PostgreSQL `VARCHAR(120)` упадёт DataError.
  3. `xp=2000` хардкодит стартовый XP. Admin/superadmin не должен иметь XP (он не учится). Это позволяет admin покупать косметику за «бесплатно» — bizzare business logic.
  4. `phone=None` (не передаётся). OK для admin.
- **Доказательство:** см. строки 1166, 1177, 1182.
- **Безопасный сценарий воспроизведения:** SuperAdmin вызывает `POST /admin/admins {email:"x@",full_name:"a"*5000,password:"GoodPass123!"}` → SQLAlchemy/PG DataError, transaction откатится; на SQLite — пройдёт.
- **Влияние:** Crash в production при невалидных данных; нелогичная XP-экономика.
- **Рекомендация:**
  - Применить `is_valid_email(email)` (как в `auth.py:83`).
  - `str(data.get('full_name') or 'Администратор')[:120].strip()`.
  - Убрать `xp=2000` (поставить `xp=0`). Если есть UX-причина — задокументировать в комментарии модели.
- **Какие тесты добавить:** `test_create_admin_rejects_invalid_email`, `test_create_admin_truncates_long_name`, `test_admin_does_not_receive_starting_xp`.

### [H-4] `admin /modules` POST принимает все поля без валидации (slug=None, age_group, color, order_index)

- **Критичность:** High
- **Категория:** Business Logic
- **Статус:** подтверждено
- **Файл:** [backend/app/api/admin.py](../backend/app/api/admin.py)
- **Строки:** 982-1011
- **Описание:**
  - `slug=data.get('slug')` — если не передан, будет `None`. Модель `Module.slug` имеет `nullable=False, unique=True`. Запрос упадёт `IntegrityError`.
  - `age_group=data.get('age_group', 'middle')` — не валидируется против `VALID_AGE_GROUPS = {junior, middle, senior}`. Admin может создать модуль с `age_group='invalid'`, и ученики этого age_group никогда его не увидят (filter не сработает).
  - `order_index=int(data.get('order_index', Module.query.count() + 1))` — если `data['order_index']` — string `'abc'`, словит `ValueError`, вернётся 500.
  - `color` — может быть произвольной строкой, не CSS-валидной.
  - `icon` — не валидируется.
- **Доказательство:** см. строки 986-995.
- **Безопасный сценарий воспроизведения:** admin шлёт `POST /admin/modules {}` (пустое тело) — словит `IntegrityError` (slug=None violates NOT NULL).
- **Влияние:** Хрупкие admin-операции; 500-ошибки вместо валидируемых 400. Возможны «мусорные» модули с невалидным age_group.
- **Рекомендация:** Валидировать каждое поле: `slug` обязательно + regex `^[a-z0-9-]+$`; `age_group ∈ VALID_AGE_GROUPS`; `order_index` через `_safe_int(...)`; `color` — `^#[0-9a-fA-F]{6}$`; `icon` — whitelist.
- **Какие тесты добавить:** `test_create_module_requires_slug`, `test_create_module_validates_age_group`.

### [H-5] `useful_tasks.external_url` принимается без валидации схемы — потенциальный XSS-вектор

- **Критичность:** High
- **Категория:** Security / Business Logic
- **Статус:** подтверждено
- **Файл:** [backend/app/api/useful.py](../backend/app/api/useful.py)
- **Строки:** 207, 238-240
- **Описание:** `external_url=str(data.get('external_url') or '').strip() or None`. Admin может сохранить:
  - `javascript:alert(document.cookie)`
  - `data:text/html,<script>...</script>`
  - `file:///etc/passwd`
  Когда frontend рендерит `<a href="{external_url}">` (см. [frontend/src/components/useful-tasks-page.tsx](../frontend/src/components/useful-tasks-page.tsx)), без sanitizer ловится XSS у ученика, клик-jacking, SSRF из браузера.
- **Доказательство:** строка 207 в [useful.py](../backend/app/api/useful.py); схема не проверяется.
- **Безопасный сценарий воспроизведения:** скомпрометированный admin (или social-engineered) создаёт useful_task с `external_url="javascript:alert(1)"`. Любой student/teacher/parent кликнет → XSS в их сессии.
- **Влияние:** XSS, кража токенов (через CSP должен блокироваться, но style-src `unsafe-inline` всё ещё open), session hijack student/teacher/parent.
- **Рекомендация:**
  ```python
  url = str(data.get('external_url') or '').strip()
  if url and not url.startswith(('http://', 'https://')):
      return {'message': 'external_url должен начинаться с http:// или https://'}, 400
  ```
- **Какие тесты добавить:** `test_useful_external_url_rejects_javascript_scheme`, `test_useful_external_url_rejects_data_scheme`.

### [H-6] Cosmetics доступны admin/superadmin/teacher — могут тратить XP без объяснения

- **Критичность:** High (low real impact, high architectural smell)
- **Категория:** Business Logic
- **Статус:** подтверждено
- **Файл:** [backend/app/api/cosmetics.py](../backend/app/api/cosmetics.py)
- **Строки:** 20-31, 33-77, 80-121
- **Описание:** Все три endpoint'а `@auth_required()` без role-list. Admin получает `xp=2000` при создании (H-3) и может купить любой premium-предмет. Teacher / parent имеют XP=0 по умолчанию, но если они каким-либо образом получили XP (legacy data или баг achievement-системы) — также могут купить.
- **Доказательство:** см. cosmetics.py + admin.py:1182.
- **Безопасный сценарий воспроизведения:** SuperAdmin создаёт нового admin → admin логинится → `GET /api/cosmetics` показывает 30 предметов с `owned=true` для всех под xp ≤ 2000.
- **Влияние:** Семантика «XP-экономика» только для учеников нарушена.
- **Рекомендация:** ограничить cosmetics-endpoint'ы только `{STUDENT, PARENT}`:
  ```python
  @cosmetics_bp.get("/cosmetics")
  @auth_required([UserRole.STUDENT, UserRole.PARENT])
  ```
- **Какие тесты добавить:** `test_admin_cannot_buy_cosmetic`, `test_teacher_cannot_buy_cosmetic`.

### [M-1] Email leak в support tickets payload

- **Критичность:** Medium
- **Категория:** Security (PII)
- **Статус:** подтверждено
- **Файл:** [backend/app/services/support_tickets.py](../backend/app/services/support_tickets.py)
- **Строки:** 43-51 (`_user_payload`), 166 (`message_payload`)
- **Описание:** В `_user_payload` возвращается `email`. `message_payload` использует его в сообщениях. Когда student/teacher/parent открывает свой ticket и получает ответ admin, payload содержит email admin'а. Это аналог уже закрытой проблемы в [messaging.py](../backend/app/api/messaging.py) (v1.0.3), но в support tickets ещё не починена.
- **Доказательство:** строки 43-51.
- **Безопасный сценарий воспроизведения:** student создаёт ticket; admin отвечает; student вызывает `GET /api/support/tickets/<id>` → `messages[].sender.email = "admin@..."`.
- **Влияние:** Утечка email staff-членов; harvesting для phishing.
- **Рекомендация:** убрать `email` из `_user_payload` или вернуть его только когда `viewer.role ∈ _STAFF_ROLES`.
- **Какие тесты добавить:** `test_support_ticket_messages_hide_email_from_non_staff`.

### [M-2] `cosmetics /cosmetics/equip` — `slot` принимается из body, не из item-meta

- **Критичность:** Medium
- **Категория:** Business Logic
- **Статус:** подтверждено
- **Файл:** [backend/app/api/cosmetics.py](../backend/app/api/cosmetics.py)
- **Строки:** 83-122
- **Описание:** `slot = body.get("slot")`. Затем проверяется `item['type'] != slot`. Если slot=`avatar` и item — frame, возвращается 404. **OK.** Но если slot=`theme` и item — `light`, проходит без проверки `_user_can_use_theme` (потому что theme `light` в catalog price=0). Также для `avatar`/`frame` нет аналога ownership check для price-0 items. Может ли user экипировать avatar, который он не «купил», если он бесплатный? — Да. Это OK (avatars бесплатные).
- **Доказательство:** строки 105-119.
- **Безопасный сценарий воспроизведения:** student PATCH `/cosmetics/equip {item_key:'женщина1', slot:'avatar'}` без покупки. Сработает (price=0). **OK.**
- **Влияние:** Мелкая UI inconsistency.
- **Рекомендация:** игнорировать `slot` из body, использовать `item['type']` напрямую.
- **Минимальная правка:** убрать параметр `slot`, использовать `slot = item['type']`.

### [M-3] Cosmetics filename typo: `иужчина1.png` (вместо `мужчина1.png`)

- **Критичность:** Medium
- **Категория:** Data
- **Статус:** подтверждено
- **Файл:** [backend/app/models/cosmetics.py:34](../backend/app/models/cosmetics.py), [media/avatars/иужчина1.png](../media/avatars/иужчина1.png)
- **Описание:** В каталоге косметики ключ `мужчина1`, но `file = "иужчина1.png"`. Файл на диске тоже называется `иужчина1.png` (с типографской ошибкой). Функционально работает, но в UI/URL появляется опечатка.
- **Безопасный сценарий воспроизведения:** `GET /api/media/avatars/иужчина1.png` → 200. `GET /api/media/avatars/мужчина1.png` → 404.
- **Влияние:** UX (опечатка видна в URL).
- **Рекомендация:** переименовать файл `media/avatars/иужчина1.png → мужчина1.png` и обновить catalog `file="мужчина1.png"`.

### [M-4] Admin `xp=2000` startup для созданного admin — без причины

- **Критичность:** Medium
- **Категория:** Business Logic
- **Статус:** подтверждено
- **Файл:** [backend/app/api/admin.py:1182](../backend/app/api/admin.py)
- **Описание:** `User(... xp=2000)` при создании admin'а. Admin не должен иметь XP вообще — это student/parent балл. См. также H-3, H-6.
- **Безопасный сценарий воспроизведения:** см. H-6.
- **Рекомендация:** `xp=0`.

### [M-5] `create_module_lesson` не валидирует поля `theory_blocks`, `interactive_steps`, `passing_score`

- **Критичность:** Medium
- **Категория:** Business Logic
- **Статус:** подтверждено
- **Файл:** [backend/app/api/admin.py](../backend/app/api/admin.py)
- **Строки:** 1077-1099+
- **Описание:** `passing_score` принимается как-есть (хотя `_safe_int` есть выше, нужно использовать `minimum=0, maximum=100`). `duration_minutes` тоже стоит ограничить.
- **Рекомендация:** применить `_safe_int(value, default, minimum=..., maximum=...)`.

### [M-6] `grade_submission` не пишет AdminAuditLog (нет audit trail для teacher-действий)

- **Критичность:** Medium
- **Категория:** Tests / Security Logging
- **Статус:** подтверждено
- **Файл:** [backend/app/api/teacher.py:669-681](../backend/app/api/teacher.py)
- **Описание:** Teacher изменяет score и status submission — единственный лог это `SiteActivityLog` (per-request). Семантический audit (что именно поставлено, какому ученику, какой feedback) отсутствует. Архитектурный документ говорит «audit log должен покрывать критичные изменения» — для teacher не покрыт.
- **Рекомендация:** добавить `_log_admin_action` или специальный `TeacherActionLog`.

### [M-7] `staff_set_status` поддерживает любой переход (open → closed напрямую)

- **Критичность:** Medium
- **Категория:** Business Logic
- **Статус:** подтверждено
- **Файл:** [backend/app/services/support_tickets.py:303-318](../backend/app/services/support_tickets.py)
- **Описание:** State-machine ticket: `open → in_progress → resolved → closed`. Сейчас admin может ставить любой переход (`closed → open` и обратно). Не security, но business-logic слабый контракт.
- **Рекомендация:** ввести `_ALLOWED_TRANSITIONS = {('open','in_progress'), ('in_progress','resolved'), ('resolved','closed'), ('open','closed'), ('in_progress','closed')}` и валидировать.

### [M-8] `_class_leaderboard_rows` не использует Redis cache — может быть медленным

- **Критичность:** Medium
- **Категория:** Performance
- **Статус:** подтверждено
- **Файл:** [backend/app/api/student.py:299-314](../backend/app/api/student.py)
- **Описание:** Global leaderboard кешируется в Redis (`_global_leaderboard_rows`), но `_class_leaderboard_rows` каждый раз делает full scan classroom. Для класса 30 студентов — OK. Для класса 500 — медленно при частых запросах. Не критично сейчас.
- **Рекомендация:** добавить кеш также для class-scope.

### [M-9] Frontend: 5 крупных компонентов > 20 KB (shared-lesson-builder.tsx ~102 KB, lesson-player.tsx ~47 KB)

- **Критичность:** Medium
- **Категория:** Architecture / Maintainability
- **Статус:** подтверждено
- **Файлы:** [frontend/src/components/shared-lesson-builder.tsx](../frontend/src/components/shared-lesson-builder.tsx), [lesson-player.tsx](../frontend/src/components/lesson-player.tsx), [teacher-workspace.tsx](../frontend/src/components/teacher-workspace.tsx), [admin-tools.tsx](../frontend/src/components/admin-tools.tsx), [messages-page-view.tsx](../frontend/src/components/messages-page-view.tsx)
- **Описание:** Высокий регрессионный риск, низкая когезия. Документ уже фиксирует это как TD-10.

### [M-10] Backend: `student.py` ~52 KB / ~1500 строк — монолит

- **Критичность:** Medium
- **Категория:** Architecture
- **Статус:** подтверждено
- **Файл:** [backend/app/api/student.py](../backend/app/api/student.py)
- **Описание:** Dashboard + modules + lessons + tasks + quizzes + classes + parent_link_codes + cosmetics-helpers + leaderboard в одном файле.

### [M-11] `_user_payload` в [staff_messaging service](../backend/app/services/staff_messaging.py:41-49) возвращает email

- **Критичность:** Medium
- **Категория:** Security (PII)
- **Статус:** подтверждено
- **Описание:** В отличие от закрытой проблемы в [api/messaging.py](../backend/app/api/messaging.py), здесь staff-messaging service сохраняет email в payload. По текущей логике staff-thread всегда между двумя staff (admin/teacher), которые знают email друг друга через admin-каталог. **Низкий риск**, но защита-в-глубину: убрать email и тут.

### [M-12] `auth.py register` не валидирует длину `full_name`

- **Критичность:** Medium
- **Категория:** Business Logic
- **Статус:** подтверждено
- **Файл:** [backend/app/api/auth.py:195](../backend/app/api/auth.py)
- **Описание:** `full_name=data.get('full_name') or ''` без `[:120]`. На PG словит DataError.
- **Рекомендация:** `full_name=str(data.get('full_name') or '').strip()[:120]`.

### [M-13] `compose-smoke` CI job создаёт `JUDGE_RUNNER_AUTH_TOKEN=ci-only-judge-token-<16hex>` (=24 символа) — короче 32

- **Критичность:** Medium
- **Категория:** DevOps / Tests
- **Статус:** подтверждено
- **Файл:** [.github/workflows/ci.yml:147](../.github/workflows/ci.yml)
- **Описание:** `printf '\nJUDGE_RUNNER_AUTH_TOKEN=ci-only-judge-token-%s\n' "$(openssl rand -hex 16)"` — итоговая длина `"ci-only-judge-token-" (20) + 32 hex = 52`. **OK по факту, длина 52.** Я ошибся в подсчёте. Уберите этот пункт.

### [M-14] `useful.py /admin/<id>` PATCH не валидирует `slug` на длину/regex

- **Критичность:** Medium
- **Категория:** Business Logic
- **Файл:** [backend/app/api/useful.py:232-233](../backend/app/api/useful.py)
- **Описание:** `task.slug = _ensure_unique_slug(str(data['slug']))` — но `_slugify` уже грубо очищает: `re.sub(r'[^a-zA-Z0-9]+', '-', value.lower())`. Тем не менее, нет ограничения длины.

### [L-1] `submit_assignment` фейковый score `100 if len(answer.strip()) >= 10 else 60`

- **Критичность:** Low
- **Категория:** Business Logic
- **Файл:** [backend/app/api/student.py:1257](../backend/app/api/student.py)
- **Описание:** До проверки учителя score выставляется по длине. Это плейсхолдер, а не оценка. UX-вопрос; в payload отдаётся score=100, что вводит ученика в заблуждение.

### [L-2] `cosmetics` ассеты с кириллическими ключами/файлами — потенциальные UTF-8 issues на старых web-серверах

- **Критичность:** Low
- **Категория:** DevOps
- **Описание:** `мужчина1.png` идёт через Flask `send_from_directory`. На некоторых nginx/proxy конфигурациях кириллические URL требуют urlencode. Не подтверждено как баг, но потенциальный fragile path.

### [L-3] `student.py /achievements` доступно admin/superadmin/teacher — показывает их «прогресс»

- **Критичность:** Low
- **Категория:** Business Logic
- **Файл:** [backend/app/api/student.py:1118-1131](../backend/app/api/student.py)
- **Описание:** `@auth_required()` без role-list. Admin/teacher/parent могут получить список achievements, хотя для них achievements бессмысленны (XP не зарабатывают через уроки).

### [L-4] `decode_token` не различает access/refresh при первоначальном `kid`-lookup

- **Критичность:** Low
- **Категория:** Security
- **Файл:** [backend/app/core/security.py:512-523](../backend/app/core/security.py)
- **Описание:** `decode_token` валидирует подпись и `exp`, но не проверяет `type` — это делается в `auth_required` / `refresh`. Если кто-то использует `decode_token` напрямую вне auth_required (не нашёл такого пути), это могло бы привести к перепутыванию access/refresh.

### [L-5] `_normalize_module_order` после `delete_module` — race condition с concurrent create

- **Критичность:** Low
- **Категория:** Race condition
- **Файл:** [backend/app/api/admin.py:1072](../backend/app/api/admin.py)
- **Описание:** Реиндексация `order_index` после удаления — если два admin одновременно удаляют разные модули, последовательность может быть нарушена. В реальности admin-параллелизм минимален.

### [L-6] `_global_leaderboard_cache` (in-process dict) — per-worker, не shared между gunicorn workers

- **Критичность:** Low
- **Категория:** Performance
- **Файл:** [backend/app/api/student.py:96](../backend/app/api/student.py)
- **Описание:** Каждый worker держит свой кеш, потенциально показывает разный snapshot. Redis-кеш делает это «менее plохой», но `_global_leaderboard_cache` остался legacy. Cleanup в `invalidate_leaderboard_cache` есть, но между workers — нет.

### [L-7] `seed/bootstrap.py` ~85 KB — единый файл seed

- **Критичность:** Low
- **Категория:** Architecture

### [L-8] Default `email_verified=True` у новых User (server_default='1') — SECURITY-by-design

- **Критичность:** Low
- **Категория:** Security
- **Файл:** [backend/app/models/user.py:63](../backend/app/models/user.py)
- **Описание:** Default `True` для legacy-аккаунтов. `register` явно ставит `False` для self-signup, так что новые пользователи проходят verify. **OK по design**, но если кто-то скриптом создаст User без явного `email_verified=False` — пропустит верификацию.

### [L-9] `_register_parent` returns `initial_password` в JSON when `SEND_MAIL=False`

- **Критичность:** Low
- **Категория:** Security (dev-only)
- **Файл:** [backend/app/api/auth.py:334-335](../backend/app/api/auth.py)
- **Описание:** Только при `SEND_MAIL=False` (dev режим) возвращается plaintext password. В production `SEND_MAIL=True` обязательно. **OK для dev**, но stoit гарантированно проверить, что в production он не вернётся.

### [L-10] `audit_log_archive.py` clears DB tables после export — нет двойной защиты

- **Критичность:** Low
- **Категория:** Data
- **Файл:** [backend/app/services/audit_log_archive.py:209, 238](../backend/app/services/audit_log_archive.py)
- **Описание:** `delete(AdminAuditLog)` после export. Если запись JSON сломалась, но coммит уже произошёл — данные уйдут безвозвратно (но JSON-архив есть, retention forever — OK).

### [I-1] Frontend dompurify overrides в package.json — DOMPurify используется

- **Категория:** Info
- **Файл:** [frontend/package.json:31](../frontend/package.json)
- **Описание:** `"overrides": {"dompurify": "^3.3.2"}` — это override, значит DOMPurify подтянут как dep некоторого пакета. Где используется — нужна отдельная проверка. Если рендерится Markdown — sanitizer нужен.

### [I-2] `frontend/src/proxy.ts` — middleware-like, но Next.js 16 ожидает `middleware.ts`

- **Категория:** Info
- **Описание:** Файл назван `proxy.ts`, не `middleware.ts`. Возможно, Next.js не запускает его как middleware (нужна явная регистрация в `next.config.ts`). Требует проверки.

### [I-3] `student.py` использует in-process `_global_leaderboard_cache` ПЛЮС Redis

- **Категория:** Info
- **Описание:** Дублирование. Redis уже есть, in-process — legacy. Удалить.

### [I-4] `Achievement.code` хардкодит 5 значений (first_code, perfect_five, marathon, explorer, lightning) — нет миграции для расширения

- **Категория:** Info

### [I-5] Frontend `package.json` уже pinned, но `bun.lock` пока не обновлён — нужно `bun install` после pin

- **Категория:** Info

---

## 6. Уязвимости безопасности

### 6.1. Доступ и роли

- `staff_messaging /threads/<id>/*` — `@auth_required()` без role-list, компенсируется внутренним check'ом → **H-2**.
- `cosmetics` доступны admin/teacher → **H-6**.
- `student.py /achievements` доступно всем ролям → **L-3**.

### 6.2. Инъекции

- **SQL injection:** не найдено. Везде ORM, `text(...)` только в `migrations.py` / `runtime_schema.py` с bind-параметрами. **OK**.
- **HTML/JS injection через `external_url`:** **H-5**.

### 6.3. XSS / CSRF

- CSP nonce-based в production (frontend/src/proxy.ts:6-32). **OK.**
- CSRF double-submit cookie (security.py:646-651). **OK.**
- `dangerouslySetInnerHTML` только в `layout.tsx` (controlled). **OK.**

### 6.4. Файлы

- `/api/media/avatars/*` — `send_from_directory` + extension whitelist. **OK.**
- Image upload через `assignment_images.py` — re-encode to WebP, MAX_UPLOAD_BYTES check. **OK.**
- Не проверено реальное содержимое `reencode_uploaded_image`.

### 6.5. Секреты

- `.env` (исторически с GigaChat key) — **до сих пор требует `git filter-repo`**. См. `docs/operations/security-followups.md`.
- `.env.example` чистый.
- CI workflow содержит `SECRET_KEY` в plaintext (только CI-fixture, помечено комментарием).

### 6.6. Зависимости

- Frontend deps pinned в `package.json`, но `bun.lock` пока резолвит на старые версии (см. I-5).
- Backend requirements pinned exact, но `redis>=5.0.0` без верхней границы.
- Нет CVE-сканирования в CI (trivy / pip-audit / npm audit) — **открыто P1**.

### 6.7. Конфигурации

- Production fail-fast валидация в `backend/app/__init__.py:195-247` — **строгая**, ловит слабые SECRET_KEY, Redis password, runner-token, и т.д.
- judge-runner fail-fast при `ALLOW_UNAUTHENTICATED=true` в production. **OK.**

### 6.8. Ошибки

- Stack trace не утекает (`return {"message": ...}` везде).
- В judge-runner exception → 500 с generic msg, не stacktrace.

### 6.9. Логирование

- `SiteActivityLog` per-request — OK.
- `AdminAuditLog` для admin-действий — OK, но **не покрывает teacher-grading** (M-6).
- `audit_log_archive` keeps **forever** — OK по политике.

---

## 7. Ошибки бизнес-логики

| Категория | Найдено |
|-----------|---------|
| Неверные статусы | H-1 (resubmit overrides checked), M-7 (free state transitions in support_tickets) |
| Обход правил | H-5 (external_url scheme) |
| Повторные действия | H-1 (resubmit) |
| Чужие данные | Подтверждено: нет (IDOR-checks везде на месте после v1.0.3) |
| Конфликтующие состояния | M-7 |
| Отсутствие проверок | H-3 (email/name), H-4 (module fields), M-12 (full_name в register) |
| Проблемы удаления | C-1, C-2, C-3 (миграция 0019 ломается) |
| Проблемы аудита | M-6 (teacher-grading без audit) |

---

## 8. Расхождения между документацией и кодом

| Документ | Что заявлено | Что реально в коде | Риск | Что исправить |
|----------|--------------|--------------------|------|---------------|
| [Progyx_Architecture_v1.0.md](../Progyx_Architecture_v1.0.md) §27 v1.0.3 closing | «миграция 0019 переводит ~45 FK на CASCADE» | Миграция содержит 3 SQL-ошибки (C-1, C-2, C-3) — выполнение упадёт, CASCADE НЕ применится | CRITICAL | Исправить миграцию (см. C-1..C-3) |
| README.md L41 | «Telemetry-панель в админке» | [admin.py:547](../backend/app/api/admin.py) endpoint существует, но frontend [admin-telemetry-panel.tsx](../frontend/src/components/admin-telemetry-panel.tsx) визуально не проверен | LOW | Скриншот / e2e тест |
| README.md «E2E Playwright tests» (planned) | «нет e2e» | Действительно нет | INFO | План на P1 |
| Architecture §6.3 RBAC matrix | «Cosmetics shop: student ✓, teacher ✓ (свой)» | На самом деле teacher тоже может покупать через `@auth_required()` без role-list | MEDIUM | Документировать или ограничить (H-6) |
| Architecture §15.1 «16 тест-файлов» (в historic части) | Реально 22 файла | INFO | OK уже исправлено в текущем header документа |
| Architecture §22.3 «GigaChat риск» | «удалён» | Реально удалён из кода. Но `docs/operations/security-followups.md` и Архитектура_v1.0.md в исторической части всё ещё упоминают | INFO | OK historical |

---

## 9. Проблемы архитектуры

- **Монолитные blueprint'ы** (M-10): `student.py` 52 KB, `admin.py` 64 KB.
- **Монолитные frontend-компоненты** (M-9): `shared-lesson-builder.tsx` 102 KB.
- **Slug-prefix protocol** для custom-classroom-module: хрупко, должно быть FK на Classroom (`Module.custom_classroom_id: Integer FK`).
- **Assignment.description meta-JSON prefix** вместо отдельных колонок `assignment_type`, `submission_format`.
- **Custom migration runner** без downgrade — нужна Alembic.
- **Дублирующиеся email-leak функции** `_user_payload` в трёх местах (api/messaging, services/staff_messaging, services/support_tickets) — теперь нужно держать синхронно.
- **Two-layer proxy** в frontend (`proxy.ts` + `api/[...path]/route.ts`) — дублирование cookie-forwarding (см. ранее).

---

## 10. Проблемы БД и миграций

### Models / FK

- ✅ UniqueConstraints на нужных парах: `(classroom, student)`, `(user, lesson)`, `(user, achievement)`, `(user, item_key)` для cosmetics, `(user_low_id, user_high_id)` для staff threads, `(parent_user_id, child_user_id, child_user_id, classroom_id)` quadruple для parent_teacher_threads.
- ❌ **`Conversation` table named `message_conversations` not `conversations`** — миграция 0019 ошибочно ссылается (C-1).
- ❌ **`staff_direct_messages.thread_id` references `staff_direct_threads`** — миграция 0019 ошибочно указывает `users` (C-2).
- ❌ **`support_tickets.user_id` not `author_user_id`** — миграция 0019 (C-3).
- ⚠️ FK без `ondelete` на уровне модели в `messaging.py`, `learning.py`, `staff_messaging.py`, `parent_cabinet.py` — миграция 0019 должна это закрыть, но из-за багов (C-1..C-3) не закроет.

### Migrations

- Custom runner (`backend/app/core/migrations.py`) — `db.create_all()` baseline (0001), линейные ревизии, нет downgrade.
- 19 миграций, последняя — 0019.

---

## 11. Проблемы тестового покрытия

### Что покрыто (22 теста)

- security, P0 fixes, CSRF, runtime_config, migrations, code_judge_security, email_flows, admin_management, admin_queries, teacher_queries, critical_journeys, api_contracts, messaging, staff_messaging, parent_cabinet, cosmetics, useful_tasks, support_tickets, parent_copy_positivity, redis_rollout, core_domain, assignment_images.

### Не покрыто

| Тест | Приоритет |
|------|-----------|
| **test_migration_0019_actually_applies_fk_cascade** — assert каждый FK имеет CASCADE/SET NULL (защита от C-1..C-3) | **Critical** |
| **test_submit_assignment_blocked_after_checked** — student не может перезаписать checked submission (H-1) | High |
| **test_useful_external_url_rejects_javascript_scheme** (H-5) | High |
| **test_admin_cannot_buy_cosmetic** (H-6) | High |
| **test_create_admin_rejects_invalid_email** (H-3) | High |
| **test_create_admin_truncates_long_name** (H-3) | High |
| **test_create_module_requires_slug** (H-4) | High |
| **test_create_module_validates_age_group** (H-4) | High |
| **test_register_truncates_long_full_name** (M-12) | Medium |
| **test_support_ticket_messages_hide_email_from_non_staff** (M-1) | Medium |
| **test_staff_set_status_enforces_state_machine** (M-7) | Medium |
| **test_student_cannot_access_staff_thread_messages** (H-2) | Medium |
| **e2e: full student journey, teacher journey, parent journey** | Medium |
| **frontend unit tests на auth-form, lesson-player** | Medium |
| **load test 50 RPS на /api/tasks/<id>/submit + judge-runner** | Low |

---

## 12. DevOps и production readiness

### Docker

- ✅ Все сервисы с healthchecks
- ✅ Non-root users (Dockerfiles)
- ✅ judge-runner с full hardening
- ✅ Docker secrets для PG / Redis password
- ❌ Pinned digests не inline (требует `scripts/pin-images.sh` ручного запуска)

### env / config

- ✅ Production fail-fast validation
- ✅ `.env` в `.gitignore`
- ✅ `.env.example` без реальных значений
- ⚠️ Исторический leak GigaChat key всё ещё в git history — требует `git filter-repo`

### CI/CD

- ✅ 5 job'ов (secret-scan, backend-checks, backend-redis-integration, frontend-build, compose-smoke)
- ❌ Нет trivy / pip-audit / npm audit
- ❌ Нет coverage threshold
- ⚠️ `SECRET_KEY` в plaintext в YAML (CI-only, но best practice — GitHub Secret)

### Миграции

- ❌ **C-1, C-2, C-3 — миграция 0019 упадёт при выполнении**
- ❌ Нет downgrade
- ❌ Нет dependency graph

### Запуск

- README актуальный.
- `secrets/*.example` нужно копировать вручную.
- `JUDGE_RUNNER_AUTH_TOKEN` нужно генерировать вручную.

### Логирование

- `SiteActivityLog` per-request.
- `AdminAuditLog` для admin-actions (но не teacher-actions — M-6).
- Архив **forever** на host volume.

### Healthcheck

- ✅ Backend `/api/health` (включая Redis ping)
- ✅ Judge-runner `/health`
- ✅ Frontend проверяется через `fetch('http://127.0.0.1:3000')`

### Безопасность production-настроек

- ✅ HSTS, X-Content-Type-Options, X-Frame-Options, X-Permitted-Cross-Domain-Policies, Permissions-Policy, Referrer-Policy
- ✅ Strict SameSite в production
- ✅ HttpOnly cookies

---

## 13. Приоритетный план исправлений

### Срочно — до production

#### T-C1: Исправить миграцию 0019 — таблица conversations

- **Действие:** Заменить `"conversations"` → `"message_conversations"` в 5 строках `_FK_RULES`.
- **Файлы:** [backend/app/migrations/0019_fk_ondelete_cascade.py](../backend/app/migrations/0019_fk_ondelete_cascade.py) (строки 51-56).
- **Риск:** Без правки CASCADE не применится для 5 FK.
- **Ожидаемый результат:** `\d+ message_conversations` показывает `ON DELETE CASCADE/SET NULL`.
- **Тесты:** `test_migration_0019_actually_applies_fk_cascade`.
- **Критерий готовности:** `flask upgrade-db` на свежей PG завершается успешно; SQL-assert на `delete_rule != 'NO ACTION'`.

#### T-C2: Исправить миграцию 0019 — staff_direct_messages.thread_id

- **Действие:** `("staff_direct_messages", "thread_id", "users", "CASCADE")` → `("staff_direct_messages", "thread_id", "staff_direct_threads", "CASCADE")`.
- **Файл:** [migrations/0019_fk_ondelete_cascade.py:59](../backend/app/migrations/0019_fk_ondelete_cascade.py).
- **Риск:** Миграция упадёт.
- **Тесты:** см. T-C1.

#### T-C3: Исправить миграцию 0019 — support_tickets.user_id

- **Действие:** `"author_user_id"` → `"user_id"`.
- **Файл:** [migrations/0019_fk_ondelete_cascade.py:86](../backend/app/migrations/0019_fk_ondelete_cascade.py).

#### T-H1: Запретить resubmit assignment после checked

- **Действие:** В `submit_assignment` добавить проверку статуса, сбросить score.
- **Файл:** [student.py:1246-1271](../backend/app/api/student.py).
- **Тесты:** `test_submit_assignment_blocked_after_checked`.

#### T-H2: Ужесточить decorator в staff_messaging /threads/<id>/*

- **Действие:** `@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.TEACHER])` на 3 endpoints.
- **Файл:** [staff_messaging.py:96, 120, 145](../backend/app/api/staff_messaging.py).

#### T-H3: Валидировать email/full_name/xp в admin /admins POST

- **Действие:** is_valid_email + length-cap + xp=0.
- **Файл:** [admin.py:1162-1200](../backend/app/api/admin.py).

#### T-H4: Валидировать поля в admin /modules POST/PATCH

- **Действие:** обязательность slug, age_group ∈ enum, color regex, order_index safe.
- **Файл:** [admin.py:982-1039](../backend/app/api/admin.py).

#### T-H5: Валидация external_url в useful_tasks

- **Действие:** require `http://` или `https://`.
- **Файл:** [useful.py:207, 238-240](../backend/app/api/useful.py).

#### T-H6: Ограничить cosmetics только {STUDENT, PARENT}

- **Действие:** добавить role-list.
- **Файл:** [cosmetics.py:20, 33, 80](../backend/app/api/cosmetics.py).

### В ближайший релиз (Medium)

- M-1 убрать email из support payload
- M-4 admin xp=0
- M-5 _safe_int с границами в create_module_lesson
- M-6 audit log для teacher.grade_submission
- M-7 state-machine в support_tickets.staff_set_status
- M-11 убрать email из staff_messaging service _user_payload
- M-12 truncate full_name в auth.py register
- M-14 валидация slug в useful tasks

### Технический долг (Low/Info)

- L-1 «фейковый» score в submit_assignment — заменить на NULL до проверки
- L-2 рассмотреть переход cosmetic-файлов на ASCII-имена
- L-3 ограничить /achievements только student/parent
- L-6 удалить in-process leaderboard cache
- L-7 декомпозиция seed/bootstrap.py
- L-9 в production never returns initial_password — assert
- I-1 проверить DOMPurify usage и его покрытие
- I-2 проверить, что proxy.ts работает как middleware

---

## 14. Список рекомендуемых тестов

| ID | Название теста | Что проверяет | Данные | Ожидаемый результат |
|----|----------------|---------------|--------|---------------------|
| TT-01 | `test_migration_0019_applies_all_fk_cascade` | После `upgrade_database()` все 45 FK имеют `delete_rule ∈ {CASCADE, SET NULL}` | пустая PG | assert на каждый из tuple'ов из `_FK_RULES` |
| TT-02 | `test_submit_assignment_blocked_after_checked` | Resubmit checked submission возвращает 400 | student, assignment, submission(status=checked) | 400 + сообщение |
| TT-03 | `test_useful_external_url_rejects_javascript_scheme` | POST useful c external_url=`javascript:alert(1)` → 400 | admin token | 400 |
| TT-04 | `test_useful_external_url_rejects_data_scheme` | POST useful c external_url=`data:text/html,...` → 400 | admin token | 400 |
| TT-05 | `test_admin_cannot_buy_cosmetic` | POST `/cosmetics/purchase` от admin → 403 | admin token | 403 |
| TT-06 | `test_teacher_cannot_buy_cosmetic` | POST `/cosmetics/purchase` от teacher → 403 | teacher token | 403 |
| TT-07 | `test_create_admin_rejects_invalid_email` | POST `/admin/admins {email:"x@"}` → 400 | superadmin token | 400 |
| TT-08 | `test_create_admin_truncates_long_name` | POST `/admin/admins {full_name:"a"*5000}` → 201 c truncated до 120 | superadmin token | 201, full_name length=120 |
| TT-09 | `test_create_admin_xp_zero` | Созданный admin имеет xp=0 | superadmin token | admin.xp == 0 |
| TT-10 | `test_create_module_requires_slug` | POST `/admin/modules {}` → 400 | admin token | 400 |
| TT-11 | `test_create_module_validates_age_group` | POST `/admin/modules {slug:"x",age_group:"invalid"}` → 400 | admin token | 400 |
| TT-12 | `test_register_truncates_long_full_name` | POST register c full_name>120 → 201 c truncated | — | length 120 |
| TT-13 | `test_support_ticket_messages_hide_email_from_non_staff` | Student открывает ticket → нет admin.email в payload | student | message_payload без email |
| TT-14 | `test_staff_set_status_enforces_state_machine` | Admin меняет closed → open → 400 | admin token | 400 (no allowed transition) |
| TT-15 | `test_student_cannot_access_staff_thread_messages` | Student GET `/staff-messaging/threads/<id>/messages` → 403 | student token | 403 |
| TT-16 | `test_grade_submission_writes_audit_log` | Teacher grade → AdminAuditLog (или TeacherActionLog) row создаётся | teacher token | log row count +1 |
| TT-17 | `test_completion_percent_not_trusted_from_client` | PATCH `/lessons/<id>/complete {completion_percent:100}` без выполненных task/quiz → progress.status='not_started' и percent=0 | student token, lesson c task+quiz | percent=0 |
| TT-18 | `test_parent_safety_negative_bound_returns_400` | PATCH с `weekly=-1` → 400 | parent token | 400 |
| TT-19 | `test_parent_safety_over_week_max_returns_400` | PATCH с `weekly=20000` → 400 | parent token | 400 |
| TT-20 | `test_leaderboard_invalidated_after_xp_gain` | После submit_task с pass=true Redis cache очищен | student token + Redis | Redis key для age_group=middle отсутствует |

---

## 15. Итоговое заключение

**Можно ли выпускать проект в production?**

**Нет, не сейчас.** Три критичные ошибки в миграции 0019 (C-1, C-2, C-3) делают невозможным апгрейд БД на production-PostgreSQL. Без CASCADE FK любая admin-операция удаления может оставить orphan rows.

**При каких условиях можно выпускать.**

1. Применить T-C1, T-C2, T-C3 — исправить миграцию 0019.
2. Запустить миграцию на staging и валидировать FK constraints через SQL-query.
3. Применить T-H1 — заблокировать resubmit checked assignment.
4. Применить T-H5 — валидация external_url.
5. Применить T-H3, T-H4 — валидация admin-форм.
6. Применить T-H6 — ограничить cosmetics ролями.
7. Применить T-H2 — ужесточить staff_messaging decorator (защита в глубину).
8. Выполнить оргдействие `git filter-repo` для очистки исторического GigaChat key из истории + revoke у Сбера.
9. Inline Docker digest'ы (`scripts/pin-images.sh`).

**Что обязательно исправить до релиза.**

- C-1, C-2, C-3 (миграция БД).
- H-1 (resubmit overrides grade).
- H-3, H-4, H-5 (admin-input validation, XSS-vector).
- H-6 (cosmetics только для STUDENT/PARENT).
- H-2 (defense-in-depth для staff-thread).

**Что можно отложить.**

- M-* (большая часть — улучшения).
- L-*, I-* (тех. долг).
- Sentry / Prometheus / Alembic / e2e — план P1, не блокер пилота.

**Общий уровень риска.**

- **HIGH** до исправления C-1..C-3 и H-1..H-6.
- **MEDIUM** после применения T-C* и T-H*.
- **LOW** после применения M-* (рекомендуется до 5-10 школ).

---

*Конец отчёта.*
