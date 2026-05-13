# Progyx (ProgHUB)

Fullstack-платформа для обучения школьников 10–17 лет программированию на Python и JavaScript.
Учебный путь «модули → уроки → теория → практика → квиз», ролевая модель, родительский кабинет,
автопроверка кода в изолированном `judge-runner`, геймификация (XP, уровни, достижения,
косметика), системный журнал активности, ежедневный архив аудита.

## Что реализовано

### Учётные записи и доступ
- Самостоятельная регистрация ученика, учителя, родителя.
- Email-подтверждение по ссылке (`Unisender Go`), повторная отправка письма, восстановление
  пароля, инвалидация всех сессий после смены пароля.
- Логин по email; пароль удалён из БД при бан-листе (history-immutable hash).
- Backend выставляет `HttpOnly` cookies с access/refresh-токенами; CSRF — double-submit
  cookie (`csrf_token`) + заголовок `X-CSRF-Token`.
- JWT signing keyring (`JWT_SIGNING_KEY_ID` + `JWT_SIGNING_KEYS`) для ротации без принудительного
  выхода всех пользователей.
- Throttling логина / регистрации / refresh / parent-link / password reset через Redis
  (с DB-fallback в `THROTTLE_BACKEND=dual`).
- Мгновенная ревокация всех access-токенов через `User.session_version` (кешируется в Redis).
- 5 ролей: `student`, `teacher`, `parent`, `admin`, `superadmin`.

### Обучение
- Ученик: dashboard, roadmap, уроки, теория, практика, мини-тесты, достижения, рейтинг,
  вступление в класс по коду.
- Возрастные группы: `junior`, `middle`, `senior`. Для `junior` кодовая практика недоступна.
- Forced sequence: ученик проходит уроки по порядку; учитель может назначать кастомные
  уроки в обход последовательности.
- Контент-форматы: `single choice`, `multiple choice`, `ordering`, `matching`, текстовая
  практика, кодовая практика (`stdin/stdout`).
- Поддерживаемые языки автотестов: `Python`, `JavaScript`.

### Учительский workflow
- Конструктор уроков с темами теории, ключевыми идеями, интерактивными шагами,
  практикой (manual / `keywords` / `stdin_stdout`) и квизом.
- Создание классов, генерация кода вступления, одобрение/отклонение заявок учеников.
- Назначение заданий (`lesson_practice`, `mini_project`, `quiz`, `reflection`),
  ручная и автоматическая проверка сдач, обратная связь.
- Прямой чат с учеником в рамках класса, прямой чат с родителем ребёнка.

### Родительский кабинет
- Полноценный аккаунт `parent` со своим логином; email-only регистрация: backend
  генерирует временный пароль и шлёт его письмом вместе со ссылкой подтверждения.
- Привязка к ребёнку через одноразовый код (`ParentLinkCode`, в БД хранится только SHA-256).
- Просмотр прогресса ребёнка, достижений, истории сдач.
- Настройки безопасности (лимиты экранного времени, скрытие из публичного рейтинга,
  запрет публикации достижений).
- Согласия на обработку данных, push-уведомления, общение с учителем.
- In-app уведомления о достижениях, новых уроках, сдачах, обратной связи.
- Прямой чат с учителем ребёнка.

### Админка и суперадмин
- `admin`: overview, телеметрия, список пользователей с пагинацией, блокировка/разблокировка,
  очередь заявок учителей, создание/публикация/снятие модулей и уроков, прямой staff-чат с
  учителями, поддержка через тикет-систему, управление полезными заданиями.
- `superadmin`: всё то же + создание/блокировка/удаление обычных админов; единственная роль,
  которая может удалять учеников и учителей.
- Аудит-журналы: семантический `AdminAuditLog` (бизнес-действия admin) и
  per-request `SiteActivityLog` (метод, путь, статус, IP, user_id) — оба ежедневно
  выгружаются в JSON-файлы и сохраняются **бессрочно** (retention навсегда; ротация
  только pg_dump-бэкапов — 14 дней).

### Геймификация и косметика
- XP за прохождение уроков и практик; уровень + ранг (`rank_title`).
- 5 встроенных достижений: `first_code`, `perfect_five`, `marathon`, `explorer`, `lightning`.
- Магазин косметики за XP: 10 аватаров (бесплатно), 12 рамок (35–200 XP), 8 тем (0–200 XP).
- Глобальный leaderboard с кешированием в Redis (TTL 5 мин); инвалидация при изменении XP,
  блокировке/разблокировке, удалении пользователя.

### Прочее
- Полезные задания (`useful_tasks`) — отдельный каталог практик вне основного learning path.
- Изображения-обложки для заданий (`MediaAsset`, ограниченные форматы png/jpg/webp/gif/svg).
- Турнирный рейтинг с подгрузкой XLSX-файла с Yandex Disk (кеш-интервал настраивается в
  `TOURNAMENT_DATA_REFRESH_INTERVAL_SECONDS`).
- Тикет-система поддержки (`support_tickets`) — пользователи задают вопросы, админ отвечает
  в нити с отметками прочтения.
- Маскот в виде набора PNG-эмоций, отдаваемых через `/api/mascot/<filename>`.
- Telemetry-панель в админке: активные сессии, регистрации/прохождения за 14 дней,
  распределение ролей, низкоконвертируемые уроки.

## Стек

- **Backend:** Flask 3.1.3, Flask-SQLAlchemy 3.1.1, SQLAlchemy 2.0.48,
  psycopg 3.2.12 (binary), PyJWT 2.10.1, Werkzeug 3.1.3, gunicorn 23.0.0,
  redis-py ≥ 5, Pillow 11.0.0.
- **Frontend:** Next.js 16.2.1, React 19.2.0, TypeScript 5.7+, Tailwind 4.2+,
  GSAP 3.14.2 (core + ScrollTrigger, **бесплатно для коммерции** после Webflow-acquisition),
  Monaco Editor, lucide-react, react-hot-toast.
- **Хранилища:** PostgreSQL 17, Redis 7-alpine.
- **Code execution:** изолированный stdlib-HTTP-сервер `judge-runner` (Python + Node),
  собственная Docker-сеть без egress, seccomp-профиль, `cap_drop: ALL`, `read_only`,
  `tmpfs:/tmp:noexec`, `pids_limit`, RLIMIT_CPU/AS/NPROC/FSIZE, `umask 0077`.
- **Email:** Unisender Go (Transactional API).
- **Инфраструктура:** `docker compose` на одном хосте; sidecar `db-backup` (nightly pg_dump,
  retention 14 дней, SHA-256 sidecar). Secrets для PostgreSQL и Redis через Docker secrets.

## Быстрый старт

```bash
cp .env.example .env

# Скопируйте файлы паролей PostgreSQL и Redis в реальные:
cp secrets/postgres_password.example secrets/postgres_password
cp secrets/redis_password.example   secrets/redis_password

# Сгенерируйте сильный токен для judge-runner (compose откажется стартовать без него):
echo "JUDGE_RUNNER_AUTH_TOKEN=$(openssl rand -hex 32)" >> .env
echo "CODE_JUDGE_RUNNER_TOKEN=$(grep ^JUDGE_RUNNER_AUTH_TOKEN .env | cut -d= -f2)" >> .env

docker compose up --build
```

После запуска:

- Frontend: <http://localhost:3000>
- Backend API: <http://localhost:8000/api>
- judge-runner экспонируется только внутрь Docker-сети `judge_net` (`internal: true`),
  на host порты не публикуются.
- БД PostgreSQL и Redis также не публикуют свои порты на host.

**Суперадмин:** логин = `superadmin@codequest.local`, пароль = значение
`SUPERADMIN_PASSWORD` в `.env` (в `.env.example` для локалки: `ReplaceMe-Local-SuperAdmin-1!`).
Учётка появляется только при `SUPERADMIN_BOOTSTRAP=true` и успешном `bootstrap-app`.

## Production-режим

При `APP_ENV=production` backend проводит fail-fast валидацию конфигурации и **откажется
стартовать**, если выполнено любое из условий:

- `SECRET_KEY` короче 32 символов, содержит placeholder-фрагменты (`change-me`,
  `replace-me`, `dev-secret`, `super-secret-key`, и т.п.) или имеет низкую энтропию.
- `JWT_SIGNING_KEY_ID` не зарегистрирован в `JWT_SIGNING_KEYS` (если последний задан).
- `SESSION_COOKIE_SECURE != true`.
- `SESSION_COOKIE_SAMESITE != Strict`.
- `CLIENT_URL` пустой.
- `CODE_JUDGE_RUNNER_TOKEN` пустой, короче 32 символов или содержит placeholder.
- `SUPERADMIN_BOOTSTRAP=true` без сильного `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`.
- Слабый/пустой пароль PostgreSQL, отсутствует `REDIS_URL` / `REDIS_PASSWORD_FILE`,
  пароль Redis короче 24 символов.

Дополнительные требования production-конфигурации:

- `ENABLE_DEMO_DATA=false`, `SUPERADMIN_BOOTSTRAP=false` (после первоначального
  bootstrap'а на staging его желательно выключить).
- `CLIENT_URL`, `NEXT_PUBLIC_API_URL`, `INTERNAL_API_URL`, `FRONTEND_PUBLIC_URL` —
  обязательно из env.
- Backend запускается через Gunicorn; `flask.run()` запрещён.
- Frontend собирается через `next build` и запускается через `next start`.
- При работе за reverse-proxy выставьте `TRUST_PROXY=true`, чтобы `request.is_secure` и
  `request.remote_addr` корректно учитывали `X-Forwarded-*` заголовки.

## Автопроверка кода

В конструкторе урока учитель выбирает режим практики:

- `Ручная проверка` — учитель проверяет ответы вручную.
- `Авто по ориентирам` (`keywords`) — backend ищет ключевые слова в ответе.
- `Автотесты` (`stdin_stdout`) — программа читает из `stdin`, пишет в `stdout`;
  ответ запускается в `judge-runner` против набора тест-кейсов.

Поток исполнения:

1. Backend получает submit с кодом.
2. Делает HTTP POST на `judge-runner` с Bearer-токеном.
3. Runner создаёт временную директорию (`tmpfs`), записывает код, запускает интерпретатор
   как non-root-пользователь в read-only rootfs с custom seccomp-профилем и `cap_drop: ALL`.
4. RLIMIT: CPU, AS (для Python), NPROC (32/64), FSIZE; `umask 0077`.
5. Подключённая сеть `judge_net` объявлена `internal: true` — egress отсутствует.
6. Сам runner ограничивает: `MAX_CODE_BYTES=256 KB`, `MAX_STDIN_BYTES_TOTAL=1 MB`,
   `MAX_OUTPUT_CHARS=4000`, `MAX_CONCURRENCY=4`, taймаут `15s`.
7. Результат возвращается в backend; backend пишет `AssignmentSubmission` или
   `UserProgress`.

В production `JUDGE_RUNNER_ALLOW_UNAUTHENTICATED` — fail-fast, runner не примет ни одного
запроса без сильного Bearer-токена.

## Поддерживаемые переменные окружения

Минимум для локального запуска (см. полный список в [.env.example](.env.example)):

```env
APP_ENV=development
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_API_URL=http://localhost:3000/api
INTERNAL_API_URL=http://localhost:8000/api
CLIENT_URL=http://localhost:3000

SECRET_KEY=<openssl rand -hex 32>
JWT_SIGNING_KEY_ID=default
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAMESITE=Strict

POSTGRES_HOST=db
POSTGRES_DB=codequest
POSTGRES_USER=codequest
POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password

REDIS_PASSWORD_FILE=/run/secrets/redis_password
THROTTLE_BACKEND=dual

CODE_JUDGE_RUNNER_URL=http://judge-runner:8090/execute
CODE_JUDGE_RUNNER_TOKEN=<openssl rand -hex 32>
JUDGE_RUNNER_AUTH_TOKEN=<тот же токен>

EMAIL_PROVIDER=unisender_go
UNISENDER_GO_API_KEY=<your-key>
EMAIL_FROM=no-reply@progyx.local
FRONTEND_PUBLIC_URL=http://localhost:3000
SEND_MAIL=false        # true в production
EMAIL_DRY_RUN=false

TOURNAMENT_DATA_REFRESH_INTERVAL_SECONDS=1200

SUPERADMIN_BOOTSTRAP=true
SUPERADMIN_EMAIL=superadmin@codequest.local
SUPERADMIN_PASSWORD=ReplaceMe-Local-SuperAdmin-1!
```

## Тестовые данные (только для локальной проверки)

Демо-аккаунты появляются при наличии полного набора `DEMO_*` и `ENABLE_DEMO_DATA=true`:

```env
ENABLE_DEMO_DATA=true
DEMO_STUDENT_EMAIL=student@codequest.local
DEMO_STUDENT_PASSWORD=Student123!
DEMO_TEACHER_EMAIL=teacher@codequest.local
DEMO_TEACHER_PASSWORD=Teacher123!
DEMO_ADMIN_EMAIL=admin@codequest.local
DEMO_ADMIN_PASSWORD=Admin123!
DEMO_CLASS_CODE=CLASS5B
DEMO_PARENT_CODE=PAR-DEMO2026
```

После этого:

- доступен вход под перечисленными учётками;
- ученик может присоединиться к классу по коду `CLASS5B`;
- ссылка-инвайт родителя — `/parent/PAR-DEMO2026`.

## Структура репозитория

```text
backend/
  app/
    api/          # auth, student, teacher, admin, parent_cabinet, messaging,
                  # staff_messaging, cosmetics, support, useful, lesson_builder
    core/         # config, db, security, gamification, code_judge,
                  # redis_client, throttle_redis, achievements, phone, migrations
    models/       # user, learning, messaging, parent_cabinet, cosmetics,
                  # staff_messaging, support, useful, media
    migrations/   # 0001..0019 — самописный runner (см. core/migrations.py)
    seed/         # учебный контент и опциональный bootstrap суперадмина
    services/     # email_service, email_tokens, audit_log_archive,
                  # parent_messaging, parent_insights, staff_messaging,
                  # support_tickets, teacher_query_service, ...
  tests/          # 22 файла unit/integration на Python unittest
  sprite/         # PNG-эмоции маскота
  Dockerfile
  requirements.txt

frontend/
  src/
    app/          # страницы App Router (admin, superadmin, auth, parent,
                  # teacher, lessons, dashboard, leaderboard, support, tournament)
    components/   # lesson-player, shared-lesson-builder, teacher-workspace, ...
    hooks/
    lib/          # api, auth-session, public-env, internal-api-base, theme
    proxy.ts      # middleware: CSP nonce, role-based redirects, refresh
  Dockerfile
  package.json    # все зависимости pinned (semver-range)

judge_runner/     # standalone stdlib-HTTP сервер, изолирующий запуск кода
  app.py
  seccomp.json
  Dockerfile

shared/judge/     # общее ядро исполнения (engine, RLIMIT, output truncation)

scripts/          # backup.sh, restore.sh, pin-images.sh
secrets/          # *.example файлы (реальные пароли — вне репозитория)
docs/             # operations: backup, dr, image-pinning, redis, sandbox,
                  # security-followups, email_unisender_go; planning/
.github/workflows/ci.yml  # 5 job: secret-scan (gitleaks), backend-checks,
                          # backend-redis-integration, frontend-build, compose-smoke
```

## Ключевые маршруты API

### Авторизация / профиль
- `POST /api/auth/register` — student/teacher/parent
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/options`

### Ученик
- `GET /api/dashboard`
- `GET /api/modules`, `GET /api/modules/<id>/lessons`
- `GET /api/lessons/<id>`, `GET /api/student/lesson-access/<id>`
- `POST /api/lessons/<id>/start`, `POST /api/lessons/<id>/hints`,
  `PATCH /api/lessons/<id>/complete`
- `POST /api/tasks/<id>/submit`, `POST /api/quizzes/<id>/submit`
- `POST /api/classes/join`, `GET /api/leaderboard`
- `POST /api/assignments/<id>/submit`
- `GET /api/users/me`, `PATCH /api/users/me`

### Учитель
- `GET /api/teacher/classes`, `GET /api/teacher/classes/<id>`
- `POST /api/teacher/classes`, `POST /api/teacher/classes/<id>/lessons`
- `POST /api/teacher/classes/<id>/assignments`, `GET /api/teacher/classes/<id>/assignments`
- `GET /api/teacher/assignments/<id>/submissions`
- `PATCH /api/teacher/submissions/<id>/grade`
- `GET /api/teacher/lesson-catalog`, `GET /api/teacher/parent-threads`

### Родитель
- `GET /api/parent/dashboard`
- `POST /api/parent/link/redeem`, `POST /api/parent/link/generate`
- `GET /api/parent/children/<id>/practice-history`
- `GET|PATCH /api/parent/children/<id>/safety`
- `GET|PATCH /api/parent/children/<id>/consent`
- `GET /api/parent/children/<id>/achievements`
- `GET /api/parent/notifications`, `PATCH /api/parent/notifications/<id>/read`
- `GET /api/parent/billing`

### Мессенджеры
- `GET /api/messaging/conversations` (teacher↔student)
- `GET /api/messaging/conversations/<id>/messages`
- `POST /api/messaging/conversations/<id>/messages`
- `POST /api/messaging/conversations/<id>/read`
- `GET|POST /api/staff-messaging/threads`, `/api/staff-messaging/search-users`
- `GET|POST /api/staff-messaging/threads/<id>/messages`
- `POST /api/staff-messaging/threads/<id>/read`

### Админ / суперадмин
- `GET /api/admin/overview`, `GET /api/admin/telemetry`
- `GET /api/admin/users`, `PATCH /api/admin/users/<id>/block|unblock`
- `DELETE /api/admin/users/<id>` (только superadmin)
- `GET /api/admin/teacher-requests`,
  `PATCH /api/admin/teacher-requests/<id>/approve|reject`
- `GET /api/admin/modules`, `POST /api/admin/modules`
- `GET /api/admin/admins`, `POST /api/admin/admins` (только superadmin)
- `GET /api/admin/site-activity`, `GET /api/admin/audit-log`

### Поддержка / косметика / полезные задания
- `GET|POST /api/support/tickets`, `/api/support/tickets/<id>/messages`
- `GET /api/cosmetics/catalog`, `POST /api/cosmetics/<key>/buy`,
  `POST /api/cosmetics/<key>/equip`
- `GET /api/useful`, `POST /api/useful` (admin)
- `GET /api/mascot/<filename>`, `GET /api/media/{avatars,frames,assignment-images}/<f>`

### Системные
- `GET /api/health`

## Тесты

```bash
cd backend && python -m unittest discover -s tests -v
```

Все 22 файла тестов покрывают:

- security (HttpOnly cookies, session revocation, throttle, password policy),
- CSRF (double-submit, OPTIONS-preflight, HMAC compare),
- runtime config (валидация SECRET_KEY, JWT keyring, Redis password),
- migrations (применение, идемпотентность),
- judge-runner security (Bearer auth, timeout, лимиты),
- email-потоки (verify, resend, forgot, reset),
- admin/teacher queries и management,
- messaging (teacher↔student, staff-direct),
- parent cabinet (link/redeem, safety, consent),
- cosmetics, useful tasks, support tickets,
- critical journeys (register → lesson → submit → complete → grade).

CI: 5 job на GitHub Actions — `secret-scan` (gitleaks), `backend-checks` (PostgreSQL),
`backend-redis-integration` (PostgreSQL + Redis), `frontend-build` (typecheck + build),
`compose-smoke` (полный стек поднимается, health-чеки зелёные).

## Что можно доработать дальше

- Перенос самописного migration runner'а на Alembic (downgrade, dep-graph,
  `CREATE INDEX CONCURRENTLY`).
- Celery + Redis-broker для асинхронной автопроверки и отправки писем.
- OpenAPI-спецификация и автогенерация TypeScript-типов.
- Sentry / Glitchtip + Prometheus + Grafana для observability.
- Декомпозиция крупных компонентов фронта (`shared-lesson-builder.tsx` ~100 KB,
  `lesson-player.tsx` ~47 KB) и блюпринтов бэка (`student.py` ~52 KB).
- nsjail / bwrap внутри judge-runner для defense-in-depth.
- E2E-тесты на Playwright и frontend-юнит-тесты на Vitest.
