# АРХИТЕКТУРНЫЙ ДОКУМЕНТ

## Platform Progyx (ProgHUB)

### Образовательная платформа для обучения программированию школьников

### Production-oriented архитектура v1.0

On-Premise / Single-Tenant · Pre-Commercial Alpha → Commercial Pilot Track · Flask-PostgreSQL-Redis-Next.js · Sandboxed Code Judge · Role-scoped Access · Parent Cabinet · Cosmetics System

**Статус:** Pre-commercial alpha → Commercial pilot. Документ фиксирует текущее состояние репозитория `ProgHUB-pre_alfa` на апрель 2026 г. и определяет путь от работающего прототипа к первой безопасной коммерческой поставке для школы/учебного центра.

Оренбург, 2026

---

## 1. Общие сведения и уровень зрелости

Progyx — fullstack-платформа для обучения детей 10–17 лет программированию (Python/JavaScript). Продукт включает структурированный learning path (модули → уроки → теория → практика → квиз), ролевую модель (`student` / `teacher` / `parent` / `admin` / `superadmin`), полноценный родительский кабинет с учётной записью родителя (`parent`-роль, `ParentChildLink`, `ParentSafetySettings`, `ParentConsentSettings`, `ParentTeacherThread`), мессенджер teacher↔student и прямой staff-чат (admin↔teacher, admin↔admin), автопроверку кода в изолированном `judge-runner`-контейнере, геймификацию (XP, уровни, достижения, косметика — аватары, рамки, темы за XP), журнал активности сайта (`SiteActivityLog`), workflow согласования учителей (`teacher_approval_status`) и встроенный AI-ассистент по урокам на базе GigaChat.

Репозиторий представляет собой монорепозиторий: `backend/` (Flask 3.1.3 + SQLAlchemy 2.0.48 + PostgreSQL 17 + Redis 7 + PyJWT + python-redis), `frontend/` (Next.js 16.2.1 + React 19.2.0 + Tailwind + GSAP + Monaco), `judge_runner/` (самостоятельный stdlib-HTTP-сервер в отдельном контейнере), `shared/judge/` (общее ядро исполнения кода). Развёртывание — `docker compose up --build` на одном хосте. Redis теперь является обязательным сервисом стека (кэш leaderboard, session-version, throttle, подготовлены DB-слоты для Celery).

Версия v1.0 фиксирует критические архитектурные дефекты, обнаруженные при полном аудите кодовой базы, и определяет точный путь от текущего pre-commercial alpha к первому безопасному коммерческому пилоту в школе или учебном центре. Ядро реализовано (auth, обучение, классы, задания, автопроверка, мессенджер, панели admin/superadmin), но содержит системные проблемы, делающие текущее состояние непригодным для production-поставки без фиксов: утечка реального секрета интеграции, слабый SECRET_KEY в репозитории, ослабленный CSP, неполная изоляция sandbox'а, отсутствие CSRF-защиты при cookie-сессиях, тесты на SQLite вместо PostgreSQL.

### 1.1. Матрица зрелости по сценариям использования


| Сценарий                                       | Статус текущий (v1.0) | Что ещё нужно до готовности                                         |
| ---------------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| Локальная демонстрация / хакатон               | Готово ✓              | — (работает `docker compose up`)                                    |
| Учебный класс (10–30 учеников), один учитель   | Готово ✓ (после v1.0.1) | P0-fix применён: SECRET_KEY-hardening, nonce-CSP, CSRF double-submit, judge-sandbox (seccomp + ulimits), ProxyFix. Остался оргпроцесс: отозвать старый GigaChat-ключ у Сбера и переписать git-историю (`git filter-repo`). |
| Коммерческий пилот (1 школа, 100–500 учеников) | Почти готово (P1)     | P0-fix применён, backup-sidecar + DR-runbook добавлены. Остались P1: observability, EULA, политика ПДн                |
| Стабильный single-school продакшн              | Частично (P1)         | P0-fix + PostgreSQL-CI применены. Остались P1: e2e-тесты, миграции Alembic, DR-drill на реальных данных          |
| Мультишкольный on-premise                      | Не проектировалось    | Введение Tenant, изоляция schema/БД, централизованный admin         |
| Multi-tenant SaaS                              | Не проектировалось    | Биллинг, изоляция, резидентность ПДн, SLA, on-call                  |
| Enterprise без оговорок                        | Не готово             | HA PostgreSQL, SSO/SAML, ABAC, сертификация ИБ                      |


### 1.2. Критические дефекты версии v1.0 и статус устранения в v1.0.1

**Апдейт v1.0.1 (P0-фикс-спринт):** все десять P0-пунктов закрыты на уровне кода и конфигурации. Ниже исходная формулировка проблемы и конкретная ссылка на фикс.

**Апдейт v1.0.2 (security hardening):** закрыты все оставшиеся уязвимости из этого документа, которые можно устранить в коде/конфигурации без затрагивания GigaChat: JWT key rotation, Strict SameSite, HSTS, отсутствие unsafe-запросов без Origin в production, IP-throttle регистрации, удаление local judge fallback, PostgreSQL secret file и снятие публикации `5432` с host. GigaChat-риски намеренно исключены из scope по решению владельца.

Дополнительно в compose frontend больше не получает общий backend `.env`; runtime frontend ограничен `NEXT_PUBLIC_*`, `APP_ENV`, `NODE_ENV` и `INTERNAL_API_URL`, чтобы backend-only секреты не попадали в контейнер UI.

| # | Исходный блокер (v1.0) | Статус | Что сделано в v1.0.1 |
|---|------------------------|--------|----------------------|
| P0-1 | Утечка `GIGACHAT_AUTH_KEY` в `.env`, слабый `SECRET_KEY=wemogw!325g` (13 симв.), `GIGACHAT_VERIFY_SSL=false`. | **Закрыто в коде** (требуется оргдействие) | `_validate_runtime_config` в production теперь требует `SECRET_KEY` ≥ 32 симв. + запрещает placeholder-подстроки (`change-me`, `replace-me`, `your-secret`, `dev-secret`, `super-secret-key`, `example`, `todo`) + низкоэнтропийные ключи (один символ, короткие all-lowercase/all-digits). `GIGACHAT_VERIFY_SSL=false` в production → `RuntimeError`. Покрыто `backend/tests/test_runtime_config.py` (8 кейсов). **Оргдействие (вне кода):** (a) отозвать действующий ключ у Сбера и выпустить новый; (b) `git filter-repo` для удаления `.env` из истории; (c) force-push + уведомление контрибьюторов. |
| P0-2 | CSP: `script-src 'self' 'unsafe-inline' 'unsafe-eval'` и `style-src 'self' 'unsafe-inline'`. | **Закрыто** | Введён `frontend/src/middleware.ts` с per-request nonce (32 hex-символа). Production-CSP: `script-src 'self' 'nonce-<X>' 'strict-dynamic'`. `'unsafe-eval'` подключается только при `NODE_ENV!=='production'` (HMR Next.js). Единственный inline-скрипт (`getThemeInitScript` в `layout.tsx`) теперь несёт `nonce`. Backend API-респонсы уже использовали строгий `default-src 'none'`. Для `style-src` оставлен `'unsafe-inline'` — ограничение Next.js App Router (документировано в `sandbox.md` → TODO). |
| P0-3 | Нет CSRF при cookie-сессиях, только Origin-check. | **Закрыто** | Реализован double-submit cookie: на `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh` выдаётся non-HttpOnly cookie `csrf_token = secrets.token_urlsafe(32)`. Middleware `@before_request` отклоняет unsafe-методы на `/api/*` при cookie-auth, если заголовок `X-CSRF-Token` не совпадает (сравнение `hmac.compare_digest`). Bearer-авторизованные запросы освобождены. `logout` очищает cookie. Покрыто 8 тестами в `backend/tests/test_csrf.py` (включая OPTIONS-preflight). |
| P0-4 | Judge-sandbox: только RLIMIT_CPU/RLIMIT_AS (Python+Linux), нет seccomp/userns/egress. | **Закрыто (с задокументированным остатком)** | В `docker-compose.yml` для `judge-runner` добавлены: `security_opt: [seccomp=./judge_runner/seccomp.json, no-new-privileges:true]`, `cap_drop: [ALL]`, `read_only: true`, `tmpfs:/tmp:noexec,nosuid`, `pids_limit:128`, `mem_limit:512m`, `memswap_limit:512m`, `cpus:1.0`, `ulimits: {nproc:64, nofile:256/256}`, `USER 1001` (non-root) в Dockerfile. Собственный seccomp-профиль (`judge_runner/seccomp.json`) блокирует `mount/umount/pivot_root/chroot/ptrace/unshare/setns/bpf/kexec/module_*/keyctl/perf_event_open/clock_settime/sethostname/userfaultfd/acct` и прочие escape-syscall. Сеть: `judge_net` `internal:true` (нет egress). **Задокументированный остаток:** backend также подключён к `judge_net` для HTTP-вызовов runner'а; Docker bridge двунаправленный — код ученика формально может инициировать запрос к `backend:8000`, но без cookie и без bearer-токена он не проходит auth+CSRF. Дорожная карта (queue-based pull или host iptables DROP) — в `docs/operations/sandbox.md`, известное ограничение. |
| P0-5 | CI на SQLite (`DATABASE_URL=sqlite:////tmp/...`). | **Закрыто** | `.github/workflows/ci.yml` теперь поднимает `services.postgres: postgres:17` с healthcheck (`pg_isready`), job-level `DATABASE_URL=postgresql://codequest:codequest@localhost:5432/codequest_ci`. Миграционный smoke и regression-тесты запускаются на PostgreSQL. Драйвер `psycopg[binary]` уже в `backend/requirements.txt`. Job-level `SECRET_KEY` подобран так, чтобы проходить ужесточённый валидатор. |
| P0-6 | Docker-образы без digest (`postgres:17`, `python:3.12-slim`, `node:22-alpine`, apt nodejs). | **Закрыто (playbook + инструмент)** | Digest'ы **не инлайнятся** (фабриковать их нельзя — сломает сборку). Введены: (a) `# pin:` комментарии на каждом `image:`/`FROM`; (b) `scripts/pin-images.sh` — автоматический ресолвер digest'ов через `docker pull` + `docker inspect`; (c) `docs/operations/image-pinning.md` — operator playbook с inventory-таблицей и ротационной каденцией (месячно + при CVE). Оператор выполняет скрипт перед prod-деплоем. Для `apt nodejs` в `judge_runner/Dockerfile` добавлен `ARG NODEJS_APT_VERSION` для пиннинга версии. |
| P0-7 | `CODE_JUDGE_RUNNER_TOKEN` — fail-fast не покрыт тестами. | **Закрыто** | `_validate_runtime_config` в production требует `len(token) ≥ 32` + запрещает `local-dev-judge-token-change-me`, `replace-with-random-judge-runner-token`, пустое значение. Покрыто в `backend/tests/test_code_judge_security.py` (пустой, оба placeholder'а, короткий, strong-приём). |
| P0-8 | Нет `pg_dump`-cron, нет DR-runbook. | **Закрыто** | В `docker-compose.yml` добавлен sidecar `db-backup` (тот же `postgres:17`, sleep-loop scheduler, `depends_on: db healthy`, именованный том `postgres_backups`). `scripts/backup.sh` (POSIX, `set -eu` + pipefail-fallback, двухстадийная запись через temp-файл с верификацией кода возврата `pg_dump`, атомарный rename, SHA-256 sidecar, retention). `scripts/restore.sh` требует явного `YES`. Документация: `docs/operations/backup.md` (архитектура), `docs/operations/dr.md` (RPO 24 ч, RTO 2 ч, 8-шаговый runbook, обязательный понедельничный test-restore, алерты по freshness/disk). |
| P0-9 | Нет ProxyFix/SECURE_PROXY_SSL_HEADER для работы за nginx. | **Закрыто** | Введён новый конфиг-флаг `TRUST_PROXY` (по умолчанию `False`). При `True` — `create_app()` оборачивает `app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=0)`. Покрыто тестом `test_trust_proxy_applies_forwarded_for_and_proto`. В production оператор выставляет `TRUST_PROXY=true` после того, как удостоверится в trust-границе reverse-proxy. |
| P0-10 | `is_active=False` revoke — не покрыт access-cookie edge-case. | **Закрыто** | Добавлен тест `test_blocked_user_me_endpoint_is_rejected_after_admin_block` в `backend/tests/test_admin_management.py`: старая access-cookie, выданная до блокировки, получает `401` на `/api/auth/me` после `is_active=False` + `bump_session_version`. Ранее покрытие было только на refresh-ендпойнте. |



| P1 — важные для production (устранить до стабильной эксплуатации)                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[P1-1] Отсутствие наблюдаемости.** Нет Sentry/Prometheus/Grafana. Логи — plain-text через stdout gunicorn. Нет request-ID / correlation-ID. Нет алертов. В случае инцидента нельзя восстановить цепочку событий.                                                                                                                                                                                                    |
| **[P1-2] Отсутствие стратегии бэкапов.** В compose: `postgres_data` — named volume без дампов. Нет `pg_dump`/WAL-archiving, нет rsync, нет DR-runbook. Потеря volume = потеря всех данных школы.                                                                                                                                                                                                                      |
| **[P1-3] Custom migration runner, не Alembic.** `backend/app/core/migrations.py` — самодельный, добавляет/игнорирует ревизии, но не поддерживает downgrade, не умеет генерировать миграции автоматически, не имеет graph-зависимостей. При эволюции схемы появятся data-migration'ы, которые custom runner не потянет.                                                                                                |
| **[P1-4] Leaderboard-cache in-process.** **Частично закрыто (Redis live, полная миграция — pending).** Redis-сервис добавлен в compose (обязателен). `THROTTLE_BACKEND=dual` — Redis primary, DB fallback. `SESSION_VERSION_CACHE=redis` в production. `REDIS_DB_LEADERBOARD=0` зарезервирован. Переезд `_global_leaderboard_cache` в Redis shared cache через всех workers — pending P1.                                                 |
| **[P1-5] Отсутствие password recovery и email-канала.** Нет ни SMTP, ни Celery/RQ, ни background-worker. Учитель не может восстановить пароль, админ не может прислать приглашение. Для школы/коммерции — блокер.                                                                                                                                                                                                     |
| **[P1-6] JWT без key rotation.** **Закрыто в v1.0.2.** Введены `JWT_SIGNING_KEY_ID` + `JWT_SIGNING_KEYS` (`kid=secret,...`), новые токены подписываются с `kid`, decode принимает текущий и предыдущие ключи. Production validator проверяет наличие текущего `kid` и стойкость всех signing keys.                                                                                                                                     |
| **[P1-7] Admin-audit-log неполон.** `AdminAuditLog` покрывает только явно инструментированные действия. **Дополнение:** добавлен `SiteActivityLog` (migration 0011) — per-request API-журнал (метод, путь, статус, IP, user_id). `ENABLE_SITE_ACTIVITY_LOG=true` по умолчанию. Ежедневный архивный экспорт через `audit_log_archive.py`. Семантический audit (правки Task, reset XP, create lesson) по-прежнему неполон. |
| **[P1-8] Rate-limit на ключевые эндпоинты.** **Закрыто в v1.0.2.** Login, parent link, register и refresh имеют throttle. Для register добавлен отдельный IP-level attempt throttle (`REGISTER_IP_RATE_LIMIT_*`). `THROTTLE_BACKEND=dual` — Redis primary, DB fallback при Redis-outage.                                                                                                                 |
| **[P1-9] CSRF и SameSite=Strict при HttpOnly-куках.** **Закрыто в v1.0.2.** `SESSION_COOKIE_SAMESITE` по умолчанию `Strict`, production валидатор запрещает `Lax`; CSRF-cookie использует тот же SameSite. Unsafe `/api/*` без `Origin` в production отклоняются, Next API-proxy и session-refresh явно передают origin на backend.                                                                                                      |



| P2 — технический долг (плановые улучшения)                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[P2-1] Огромные frontend-компоненты.** `shared-lesson-builder.tsx` — 102 KB (~2100 строк); `teacher-workspace.tsx` — 79 KB; `lesson-player.tsx` — 47 KB; `admin-tools.tsx` — 48 KB; `messages-page-view.tsx` — 24 KB. Низкая когезия, высокий регрессионный риск, трудно тестировать.                            |
| **[P2-2] Огромные backend-blueprint'ы.** `student.py` — 43 KB (~1200 строк), `teacher.py` — 27 KB, `admin.py` — 26 KB, `messaging.py` — 18 KB. Логика, сериализация, авторизация, интеграции смешаны.                                                                                                              |
| **[P2-3] Отсутствие e2e и frontend-тестов.** Нет Playwright/Cypress, нет Vitest. Любой рефакторинг UI — слепой. Backend-тесты хорошие (critical journeys, security, messaging), но покрытие UI = 0.                                                                                                                |
| **[P2-4] API-контракты дублируются вручную.** Flask-ответы и TypeScript `types/index.ts` поддерживаются параллельно. `test_api_contracts.py` — выборочная защита, не полная. Нет OpenAPI / JSON-schema.                                                                                                            |
| **[P2-5] Мьютабельные PK=Integer.** Модели используют `Integer primary key`. Для multi-tenant миграции и merge-операций (импорт/экспорт между школами) UUID PK был бы безопаснее.                                                                                                                                  |
| **[P2-6] Мелкий tech debt.** `tsconfig.tsbuildinfo` закоммичен; `TypeScript: latest` в devDependencies (не-детерминистичный build); `mascot` sprite'ы (6 × ~2 MB PNG) внутри `backend/sprite/` раздаются Flask-ом, а не CDN/nginx; `ACCESS_TOKEN_MINUTES=360` в `.env` — 6 часов, слишком долго для access-токена. |


### 1.3. Текущее состояние зрелости


| Область                            | Состояние                 | Комментарий                                                                                          |
| ---------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Функциональная полнота Core        | ~95%                      | Реализованы все базовые сценарии + родительский кабинет (parent-роль, ParentChildLink, ParentTeacherThread), косметика (аватары/рамки/темы за XP), staff-прямые-чаты, SiteActivityLog, teacher approval workflow |
| Безопасность (secrets)             | 70% (после v1.0.1)        | Ужесточённый валидатор SECRET_KEY (len≥32, placeholder-denylist, entropy); fail-fast runner-token. Ротация/Docker-secrets и `git filter-repo` — оргдействие. |
| Безопасность (code isolation)      | 80% (после v1.0.1)        | Seccomp-профиль, cap_drop [ALL], read_only rootfs, ulimits, non-root UID, `judge_net internal:true`. Known limitation — lateral backend reach по `judge_net` задокументирована. |
| Data layer (схема, миграции)       | 65%                       | 12 миграций (0001–0012); custom-runner; нет Alembic; нет downgrade. Схема значительно расширена (parent cabinet, cosmetics, staff messaging, activity log). |
| Observability                      | 15%                       | SiteActivityLog добавлен (per-request trail). Sentry/Prometheus/Grafana отсутствуют; нет request-ID. |
| CI/CD                              | 80% (после v1.0.1)        | CI: 4 job'а: backend-checks (PostgreSQL), backend-redis-integration (PostgreSQL+Redis), frontend-build, compose-smoke. Остаются security scan (trivy/gitleaks) и pinned digests. |
| Disaster Recovery                  | 60% (после v1.0.1)        | `db-backup` sidecar (nightly pg_dump custom+gzip, retention, SHA-256), `docs/operations/dr.md` (RPO 24ч/RTO 2ч), `scripts/restore.sh`. DR-drill на реальных данных — остаётся. |
| Тестирование                       | 75% backend / 0% frontend | +новые тесты: test_core_domain, test_cosmetics, test_parent_cabinet, test_redis_rollout, test_staff_messaging. UI-тестов и e2e по-прежнему нет. |
| Документация                       | 65%                       | +4 operations runbook'а + docs/planning/redis-rollout-scope.md. OpenAPI — всё ещё нет. |
| Готовность к коммерческой поставке | 78% (после v1.0.1)        | P0 закрыт. Продукт функционально богаче. До первой продажи остаётся оргпроцесс + P1 (observability, EULA, async judge/email). |


---

## 2. Топология системы

### 2.1. Архитектурное решение

**Принцип:** один docker-compose-хост = один учебный центр / одна школа. Данные хранятся физически изолировано: PostgreSQL-volume на сервере клиента. Исполнение кода ученика — в отдельном контейнере `judge-runner` с собственной сетью `judge_net` (`internal: true`). Фронтенд Next.js служит и как UI-слой, и как server-side API-proxy (маршрут `/api/[...path]/route.ts`) — backend не выставлен напрямую в интернет в production-конфигурации.

```
                     ┌─────────────────────────────────────────┐
                     │          Public network / LAN            │
                     └─────────┬───────────────────────────────┘
                               │ HTTPS (via reverse-proxy / CDN)
                               ▼
                     ┌──────────────────────┐
                     │  Next.js (frontend)  │  port 3000
                     │  React 19 + Monaco   │
                     │  GSAP animations     │
                     └───┬────────────┬─────┘
                         │ fetch      │ /api proxy (cookie-forwarded)
                         ▼            ▼
                     ┌──────────────────────────────────────┐
                     │      Flask backend (gunicorn)        │  port 8000
                     │      Blueprints: auth/student/       │
                     │      teacher/admin/messaging/        │
                     │      parent_cabinet/cosmetics/       │
                     │      staff_messaging/lesson_builder  │
                     └──────┬───────┬──────┬────────┬──────┘
              backend_net   │       │      │        │  judge_net (internal)
                            ▼       ▼      ▼        ▼
                      ┌──────────┐ ┌────┐ ┌──────────┐  ┌─────────────────┐
                      │PostgreSQL│ │Redis│ │ GigaChat │  │  judge-runner    │
                      │  17      │ │ 7  │ │ (https)  │  │ (python+node,    │
                      │ volume   │ │DB0-4│ │ external │  │  read_only,      │
                      └──────────┘ └────┘ └──────────┘  │  cap_drop:ALL,   │
                                                         │  pids_limit,     │
                                                         │  tmpfs /tmp)     │
                                                         └─────────────────┘
```

### 2.2. Сервисы Docker Compose


| Сервис         | Образ (текущий)                               | Порт                         | Сеть                         | Назначение                                        |
| -------------- | --------------------------------------------- | ---------------------------- | ---------------------------- | ------------------------------------------------- |
| `db`           | `postgres:17` (без digest ⚠)                  | —  (5432 не публикуется)     | `backend_net`                | Единственная БД. `postgres_data` — named volume. Password через Docker secret. |
| `redis`        | `redis:7-alpine` (без digest ⚠)               | — (6379 не публикуется)      | `backend_net`                | Кэш leaderboard (DB 0), session-version (DB 1), throttle (DB 2), Celery broker (DB 3), Celery result (DB 4). Password через Docker secret + `--requirepass`. |
| `db-backup`    | `postgres:17` (sidecar)                       | —                            | `backend_net`                | Nightly `pg_dump` в named volume `postgres_backups`; retention 14 дней. |
| `backend-init` | локальная сборка из `backend/Dockerfile`      | —                            | `backend_net`, `judge_net`   | One-shot: `flask bootstrap-app` — миграции + seed |
| `backend`      | то же                                         | 8000                         | `backend_net`, `judge_net`   | Gunicorn, выполняет API и server-side SPA         |
| `frontend`     | локальная сборка из `frontend/Dockerfile`     | 3000                         | `backend_net`                | Next.js `next start`, проксирует /api             |
| `judge-runner` | локальная сборка из `judge_runner/Dockerfile` | `expose 8090` (не published) | `judge_net` (internal: true) | Изолированный исполнитель кода учеников           |


### 2.3. Ключевые сетевые решения

- `judge_net` объявлен `internal: true` — контейнер не имеет egress-интерфейса на внешний интернет. Это критично и верно.
- `backend` присутствует в обеих сетях, чтобы инициировать вызов runner'а и при этом иметь доступ к `db`. Побочное следствие: runner по-прежнему может дотянуться до backend'а по `judge_net`. Future hardening: пер-submission намного-временный network namespace с полным блоком egress.
- `db` больше не публикует `5432` на host; администрирование БД — через `docker exec`, bastion или временный admin-профиль.
- `redis` не публикует `6379` на host; доступен только внутри `backend_net`.
- `frontend` → `backend`: через `INTERNAL_API_URL=http://backend:8000/api`, cookie пробрасываются в `frontend/src/app/api/[...path]/route.ts`.

### 2.4. Внешние интеграции


| Направление                   | Назначение                             | Транспорт                         | Статус                                             |
| ----------------------------- | -------------------------------------- | --------------------------------- | -------------------------------------------------- |
| GigaChat (Sberbank API)       | AI-ассистент по урокам в lesson-drawer | HTTPS (OAuth2 → chat completions) | Реализовано, токен кэшируется, нужна ротация ключа |
| SMTP / email                  | Восстановление пароля, уведомления     | —                                 | **Не реализовано** (блокер для пилота)             |
| Платёжная интеграция          | Биллинг подписок                       | —                                 | **Не реализовано** (Фаза 4)                        |
| SSO / SAML / Active Directory | Корпоративный вход                     | —                                 | **Не реализовано** (Фаза 5)                        |


---

## 3. Критические архитектурные решения

### 3.1. Единая роль пользователя (single-role RBAC)

Модель `User` имеет одно поле `role = db.Column(db.Enum(UserRole))` с вариантами `student`, `teacher`, `admin`, `superadmin`. Мульти-роли (преподаватель, который одновременно администратор) не поддерживаются. Это осознанное упрощение v1.0 для ускорения разработки.

**Trade-off:** в школе, где директор одновременно преподаёт, модель неудобна — нужен второй аккаунт. В Фазе 3 следует ввести many-to-many `user_roles` без изменения существующего API (миграция с сохранением `role` как primary-role).

### 3.2. Session versioning для мгновенной ревокации JWT

Обычная проблема stateless-JWT — невозможно отозвать до окончания срока действия. В проекте применён паттерн `session_version`:

```python
# models/user.py
class User(db.Model):
    session_version = db.Column(db.Integer, nullable=False, default=0)

    def bump_session_version(self) -> int:
        self.session_version = int(self.session_version or 0) + 1
        return self.session_version
```

```python
# core/security.py
def create_token_pair(user):
    access_payload = {"sub": str(user.id), "role": user.role.value,
                      "session_version": user.session_version, "type": "access", ...}

def auth_required(roles=None):
    def wrapper(...):
        ...
        if not token_matches_user_session(payload, user):
            return {"message": "Сессия была отозвана.", "code": "session_revoked"}, 401
```

При блокировке пользователя (`admin/users/<id>/block`) вызывается `user.bump_session_version()` + `revoke_refresh_tokens_for_user()`. Все существующие access-токены становятся невалидными на следующем запросе, даже если `exp` не истёк.

**Trade-off:** +1 SQL-чтение `User` на каждый аутентифицированный запрос (нет Redis-кеша). На нагрузке >100 RPS нужен materialized session-version или Redis с TTL.

### 3.3. Двухслойная изоляция sandbox'а (что есть, что должно быть)

**Текущий слой 1 — Docker hardening:**

```yaml
judge-runner:
  read_only: true
  tmpfs:
    - /tmp:rw,noexec,nosuid,size=128m
  security_opt: [no-new-privileges:true]
  cap_drop: [ALL]
  pids_limit: 128
  mem_limit: 512m
  networks: [judge_net]  # internal: true
```

**Текущий слой 2 — posix RLIMIT:**

```python
def _preexec_resource_limits(memory_limit_mb, time_limit_ms, language):
    if os.name != 'posix':
        return None
    def apply_limits():
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        if language == 'python' and hasattr(resource, 'RLIMIT_AS'):
            resource.setrlimit(resource.RLIMIT_AS, (memory_limit_bytes, memory_limit_bytes))
```

**Что отсутствует (P0-план):**

- Seccomp-фильтр syscall'ов: запрет `socket`, `connect`, `bind`, `ptrace`, `clone` (кроме базовых).
- Per-submission ephemeral namespace: `unshare -U -n -p --mount-proc --fork python script.py` или замена процесса `nsjail`/`firejail`/`bubblewrap`.
- Явный egress-блок: `iptables -A OUTPUT -j DROP` в init-скрипте контейнера для всех, кроме loopback.
- Ограничение wall-time на уровне supervisor (сейчас timeout через `subprocess.timeout`, но wall-clock timeout не кумулятивный при многих тестах).
- RLIMIT_AS для Node.js: сейчас не применяется из-за комментария «V8 can stall during bootstrap». Замена — cgroups memory.max внутри контейнера.

**Решение v1.0 → v1.5:** внедрить `nsjail` либо `bubblewrap` в `judge_runner/Dockerfile`:

```dockerfile
RUN apt-get install -y --no-install-recommends nsjail libseccomp2
```

и вызывать не напрямую `python script.py`, а:

```bash
nsjail --quiet --chroot / --rlimit_as 128 --time_limit 3 \
       --disable_clone_newnet --seccomp_policy=/etc/nsjail.seccomp -- \
       python -I /work/main.py < stdin
```

### 3.4. Миграционный фреймворк — самописный, с известными ограничениями

`backend/app/core/migrations.py` реализует минимальную таблицу `schema_migrations (revision PRIMARY KEY, description, applied_at)` и последовательное применение модулей из `backend/app/migrations/000N_*.py`. Каждый модуль экспортирует `revision`, `description`, `upgrade(db)`.

**Проблемы:**

- Нет `downgrade()` — невозможно откатиться. Авария = восстановление из дампа.
- Нет зависимостей между миграциями (только сортировка по имени).
- Нет data-migration pattern'а — миграции смешивают DDL и данные.
- Нет `CREATE INDEX CONCURRENTLY` (на lock-free deploy).
- Миграция 0001 делает `db.create_all()` — baseline через ORM, а не через явный SQL. Если модель изменилась — baseline перестаёт быть reproducible.

**Решение v1.0 → v1.5:** миграция на Alembic, сохранение текущей `schema_migrations` как baseline (одна «stamp» ревизия `0001_baseline`). Последующие миграции — через `alembic revision --autogenerate` с ручной ревизией.

### 3.5. Throttling на уровне БД (SecurityThrottle)

```python
class SecurityThrottle(db.Model):
    __table_args__ = (UniqueConstraint('scope', 'subject', 'ip_address'),)
    scope = db.Column(db.String(64))   # 'login' | 'parent_access'
    subject = db.Column(db.String(255))
    ip_address = db.Column(db.String(64))
    failed_count = db.Column(db.Integer, default=0)
    window_started_at = db.Column(db.DateTime(timezone=True))
    blocked_until = db.Column(db.DateTime(timezone=True))
```

Окно 15 минут, лимит 8 попыток на login, блок 15 минут. Аналогично для `/api/parent/access/<code>`.

**Плюсы:** работает без Redis, детерминирован, не теряется при рестарте. Используется как fallback в `THROTTLE_BACKEND=dual`.
**Минусы:** каждый login = 1 UPDATE, при массовом brute-force нагружает PostgreSQL. В production с Redis рекомендуется `THROTTLE_BACKEND=redis` (INCR+EXPIRE). Dual-mode (default) использует Redis primary, DB fallback при Redis-outage.

### 3.6. Frontend-proxy для cookie-forwarding

Между браузером и Flask стоит Next.js (`/api/[...path]/route.ts`):

```typescript
function proxiedCookieHeader(request: NextRequest) {
  const parts = AUTH_COOKIE_NAMES.map((name) => {
    const value = request.cookies.get(name)?.value
    return value ? `${name}=${encodeURIComponent(value)}` : ''
  }).filter(Boolean)
  return parts.join('; ')
}
```

Это даёт:

- Единый origin (`NEXT_PUBLIC_API_URL=http://localhost:3000/api`) — упрощает CORS.
- Возможность SSR-запросов к backend до гидратации.
- Естественный slot для edge middleware (rate-limit, geo-lock) в будущем.

**Недостаток:** удвоение I/O на запрос (browser → Next → Flask → Next → browser). На slow path это заметно для Monaco-editor submit (код ≥10 KB).

### 3.7. Immutability событий — ПРАКТИЧЕСКИ НЕ РЕАЛИЗОВАНА

В отличие от event-sourced систем учётной логики, здесь `UserProgress`, `AssignmentSubmission`, `Message` — мьютабельные записи с обновлением по месту.

- `UserProgress.score` обновляется at-will (`progress.score = max(progress.score, score)`).
- `AssignmentSubmission.status` переходит submitted → checked → needs_revision → submitted циклически.
- `Message` — immutable по духу (нет PUT/PATCH endpoint'а), но на уровне БД нет constraint'а на `UPDATE`.

Это приемлемо для образовательной платформы, но означает отсутствие полного audit-trail для сдач. В Фазе 3 при внедрении платных сертификатов потребуется `ProgressHistory` / `SubmissionHistory`.

### 3.8. Idempotency интеграций — отсутствует

GigaChat-запросы отправляются без idempotency-key. При сетевых ретраях возможен double-charge квоты / двойной ответ. Для MVP приемлемо, в Фазе 3 при публичном запуске AI — критично.

---

## 4. Feature-gating и permissions

Progyx не имеет лицензионной feature-модели (типа v4.x из reference-документа). Вместо этого применяется многослойная access-model:

### 4.1. Уровни доступа


| Уровень              | Реализация                                                            | Где проверяется                                                                |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Authentication       | JWT в HttpOnly-cookie + `session_version`                             | `@auth_required()` декоратор                                                   |
| Role-based           | `UserRole` enum (single-role)                                         | `@auth_required([UserRole.ADMIN])`                                             |
| Content publishing   | `Module.is_published`, `Lesson.is_published`                          | Queryset-фильтр в `student.py`: `Module.query.filter_by(is_published=True)`    |
| Age-group gating     | `Module.age_group in {junior, middle, senior}` vs `User.age_group`    | Queryset-фильтр + `age_group_supports_code()` для Junior=запрет кодовых задач  |
| Classroom membership | `ClassMembership(classroom_id, student_id)`                           | `_user_can_access_lesson()` проверяет membership перед custom-module уроком    |
| Lesson state machine | `UserProgress.status` + `STATE_MAP` (`locked/open/current/completed`) | `_effective_lesson_state_for_student()` — gate на последовательное прохождение |
| Parent access        | `ParentInvite.code` + throttle                                        | Публичный эндпоинт `/api/parent/access/<code>`                                 |
| Support/admin-audit  | `AdminAuditLog`                                                       | Только для admin-action'ов                                                     |


### 4.2. Слабые места feature-gating

- **[DEFECT] Module.age_group не валидируется при пересечении с User.age_group на write.** Ученик `junior` может попытаться `POST /api/lessons/<id>/complete` с lesson из модуля `senior`, если знает id. Сервер проверяет только `_user_can_access_lesson()` (публикация + classroom membership для custom), но не match возрастной группы. Нужен явный validator.
- **[DEFECT] Custom classroom module lifecycle не защищён.** `Module.is_custom_classroom_module` определяется через `slug.startswith("teacher-class-")` (string-match). Это хрупкий protocol — любая ошибка в генерации slug'а ломает authorization path.
- **[OK] Admin и superadmin различимы.** `@auth_required([UserRole.SUPERADMIN])` для управления admin'ами; `@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])` для обычных admin-действий.

### 4.3. Решение v1.5 — явный PermissionService

```python
# NEW: core/permissions.py
class PermissionService:
    @staticmethod
    def can_access_lesson(user: User, lesson: Lesson) -> bool:
        if not lesson.module.is_published and user.role == UserRole.STUDENT:
            return False
        if user.role == UserRole.STUDENT and user.age_group != lesson.module.age_group \
                and not lesson.module.is_custom_classroom_module:
            return False
        if lesson.module.is_custom_classroom_module:
            classroom_id = lesson.module.custom_classroom_id
            return ClassMembership.query.filter_by(
                classroom_id=classroom_id, student_id=user.id
            ).first() is not None
        return True
```

Единая точка истины для RBAC на чтение. Сейчас логика разбросана по `student.py`, `teacher.py`, `admin.py`.

---

## 5. Security model

### 5.1. Секреты — текущее состояние и план


| Секрет                    | Текущее место                            | Риск                           | План                                                                                                                                                                            |
| ------------------------- | ---------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SECRET_KEY`              | `.env` / env secret                      | P0: компрометация legacy JWT   | **Закрыто v1.0.2:** production требует стойкий `SECRET_KEY`; JWT ротация вынесена в `JWT_SIGNING_KEY_ID` + `JWT_SIGNING_KEYS`, новые токены получают `kid`, старые ключи можно держать до истечения refresh TTL.                              |
| `GIGACHAT_AUTH_KEY`       | `.env` в repo (реальный!)                | P0: квота Sberbank расходуется | **Исключено из scope v1.0.2 по решению владельца.** Требуется оргдействие: отозвать ключ у Sber, новый — в Docker secret; `.env` уже в `.gitignore`, но файл был в истории коммитов — нужен `git filter-repo`.                              |
| `CODE_JUDGE_RUNNER_TOKEN` | `.env` / env secret                      | Средний: компрометация runner  | Production fail-fast требует минимум 32 символа и запрещает known placeholders. Local fallback удалён из execution path.                                                                                                                       |
| `SUPERADMIN_PASSWORD`     | `.env`                                   | Средний: захват superadmin     | Bootstrap только через CLI (`--password-stdin`), не в .env                                                                                                                      |
| `POSTGRES_PASSWORD`       | Docker secret file                       | P0 если публичный порт         | **Закрыто v1.0.2:** `db` читает `POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password`, `5432` больше не published на host, backend умеет строить `DATABASE_URL` из `POSTGRES_*` + password file. Production validator отклоняет дефолтный/короткий PostgreSQL password. |


### 5.2. TLS и reverse-proxy

Текущий compose не содержит nginx/traefik/caddy. Предполагается, что оператор ставит TLS-терминацию отдельно. Необходимо:

```python
# settings fix v1.5 — ready when behind reverse proxy
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")  # Flask: app.config + ProxyFix middleware
# For Flask:
from werkzeug.middleware.proxy_fix import ProxyFix
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
```

Без `ProxyFix` `request.is_secure` всегда False за nginx → `SESSION_COOKIE_SECURE=True` в production не сработает корректно для отладки, и `request.remote_addr` отдаст IP nginx вместо клиента (throttle работает неверно). **Статус v1.0.2:** закрыто через `TRUST_PROXY=true` + `ProxyFix`; включать только за доверенным reverse-proxy.

### 5.3. Заголовки безопасности

В `backend/app/__init__.py` set'ится:

```python
response.headers.setdefault('Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
```

В `frontend/src/proxy.ts` set'ится per-request CSP nonce:

```typescript
script-src 'self' 'nonce-<random>' 'strict-dynamic'
```

**Статус v1.0.2:** script-CSP закрыт: `unsafe-eval` остаётся только вне production для HMR, inline theme script получает nonce из proxy header. `next.config.ts` добавляет static security headers, а production также выставляет `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Остаток: `style-src 'unsafe-inline'` сохраняется из-за React inline styles / Next App Router; это documented follow-up, не script execution surface.

### 5.4. CSRF

Сейчас: `enforce_origin_for_unsafe_api_requests` проверяет `Origin` vs `CLIENT_URL` для всех не-GET запросов на `/api/*`.

**Статус v1.0.2:**

- В production unsafe `/api/*` без `Origin` отклоняются.
- Next API-proxy (`frontend/src/app/api/[...path]/route.ts`) и session-refresh (`frontend/src/proxy.ts`) передают `Origin` на backend для внутренних server-side fetch.
- `SESSION_COOKIE_SAMESITE=Strict` по умолчанию; production validator запрещает `Lax`.
- `logout` больше не находится в public unsafe bypass list и требует CSRF при cookie-auth.
- Double-submit cookie уже используется:

```python
# При login set XSRF-TOKEN (не HttpOnly), frontend читает и шлёт в X-XSRF-TOKEN header
# Flask middleware сверяет X-XSRF-TOKEN header с cookie на всех unsafe-методах
```

### 5.5. Passwords

- `werkzeug.security.generate_password_hash` (pbkdf2-sha256, 600k итераций в новых версиях Werkzeug). Приемлемо.
- Policy: минимум 10 символов (12 для admin), верхний+нижний+цифра+спецсимвол, список 11 common-weak.
- Нет leak-check (HIBP k-anonymity). Для v1.5 добавить.
- Нет password-rotation. Для Фазы 3.

### 5.6. Судейство кода — security surface

Submit-flow:

1. `POST /api/tasks/<id>/submit {answer: "..."}`
2. `judge_task_submission(task, raw_answer)` вызывает только `_judge_stdio_submission_remote` через изолированный runner.

**Статус v1.0.2:** local fallback удалён из execution path. Если `CODE_JUDGE_RUNNER_URL` не задан или runner недоступен, backend возвращает `CodeJudgeUnavailableError` вместо запуска ученического кода внутри backend-процесса. Dev и production используют один security path: compose должен поднимать `judge-runner`.

### 5.7. SQL injection

- Везде ORM (SQLAlchemy), параметризированные запросы. Ручной `text(...)` — только в `migrations.py` и `runtime_schema.py`, параметры всегда biparam.
- `_columns(db, 'user_progress')` — вызывает `inspect(db.engine)` без user input, безопасно.

### 5.8. XSS

- Frontend: React по умолчанию escapes. `dangerouslySetInnerHTML` использован в одном месте — `ThemeHydrator` (контролируемый script, без user input). Безопасно.
- Lesson `theory_blocks` — JSON массив объектов `{type, title, text}`, рендерится как React children. Проверить, что `text` не рендерится через `dangerouslySetInnerHTML` в компонентах (в `lesson-player.tsx` size 47 KB — требует отдельного аудита; из README следует, что markdown/code через MD-рендерер — нужно выяснить, не обходит ли sanitizer (override `dompurify: ^3.3.2` в package.json — сигнал, что DOMPurify используется)).

### 5.9. Personally Identifiable Information (PII)

Собираемые ПДн:

- `User.full_name`, `User.email` — 152-ФЗ-регулируется.
- `User.age_group` (junior/middle/senior ≈ возрастная группа).
- `ParentInvite` — родитель и его связь с ребёнком.
- `Message.body` — переписка учитель-ученик.

Необходимо для Фазы 2 (первая продажа школе):

- Согласие на обработку ПДн при регистрации (checkbox + хранение версии согласия).
- Политика конфиденциальности, EULA.
- Операторство: школа — оператор, вендор — processor. Договор обработки ПДн.
- Локальное on-prem развёртывание покрывает резидентность данных. SaaS-вариант (Фаза 4) — обязательное уведомление РКН.

---

## 6. RBAC — роли, права, матрица

### 6.1. Роли


| Роль         | Назначение                                                                     | Тип доступа      | Кто создаёт            |
| ------------ | ------------------------------------------------------------------------------ | ---------------- | ---------------------- |
| `student`    | Ученик: проходит уроки, сдаёт задания                                          | постоянный       | Self-registration      |
| `teacher`    | Учитель: создаёт классы, назначает уроки, проверяет сдачи. Требует approval.   | постоянный       | Self-registration + approve admin |
| `parent`     | Родитель: полноценная учётная запись, просмотр прогресса ребёнка, чат с учителем | постоянный     | Регистрация + `ParentLinkCode` для привязки к ребёнку |
| `admin`      | Контент-админ: модули, уроки, управление учениками и учителями                 | постоянный       | Создаётся `superadmin` |
| `superadmin` | Платформенный админ: управляет `admin`'ами                                     | постоянный, один | Bootstrap через `.env` |


### 6.2. Матрица прав (по эндпоинтам)


| Действие                           | student           | teacher  | parent   | admin | superadmin |
| ---------------------------------- | ----------------- | -------- | -------- | ----- | ---------- |
| Register (self)                    | ✓                 | ✓        | ✓        | ✗     | ✗          |
| Login                              | ✓                 | ✓        | ✓        | ✓     | ✓          |
| Refresh / Logout / /me             | ✓                 | ✓        | ✓        | ✓     | ✓          |
| Dashboard (`/api/dashboard`)       | ✓ (свой)          | ✓ (свой) | ✗        | ✗     | ✗          |
| View modules/lessons (published)   | ✓                 | ✓        | ✗        | ✓     | ✓          |
| Complete lesson, submit task/quiz  | ✓                 | ✗        | ✗        | ✗     | ✗          |
| Join classroom by code             | ✓                 | ✗        | ✗        | ✗     | ✗          |
| Parent link code (generate)        | ✓ (свой)          | ✗        | ✗        | ✗     | ✗          |
| Parent link redeem                 | ✗                 | ✗        | ✓        | ✗     | ✗          |
| Parent dashboard (child progress)  | ✗                 | ✗        | ✓ (свой) | ✗     | ✗          |
| Parent safety/consent settings     | ✗                 | ✗        | ✓ (свой) | ✗     | ✗          |
| Parent↔Teacher messaging           | ✗                 | ✓ (свой) | ✓ (свой) | ✗     | ✗          |
| Create classroom / invite students | ✗                 | ✓        | ✗        | ✗     | ✗          |
| Create custom-lesson in classroom  | ✗                 | ✓        | ✗        | ✗     | ✗          |
| Grade assignment submissions       | ✗                 | ✓        | ✗        | ✗     | ✗          |
| Teacher↔Student messaging          | ✓ (свой)          | ✓ (свой) | ✗        | ✗     | ✗          |
| Staff direct messaging             | ✗                 | ✓ (свой) | ✗        | ✓     | ✓          |
| Cosmetics shop (buy/equip)         | ✓                 | ✓        | ✗        | ✗     | ✗          |
| Admin overview                     | ✗                 | ✗        | ✗        | ✓     | ✓          |
| Block/unblock student/teacher      | ✗                 | ✗        | ✗        | ✓     | ✓          |
| Create/delete roadmap module       | ✗                 | ✗        | ✗        | ✓     | ✓          |
| Create/delete roadmap lesson       | ✗                 | ✗        | ✗        | ✓     | ✓          |
| Teacher approval (approve/reject)  | ✗                 | ✗        | ✗        | ✓     | ✓          |
| Site activity log view             | ✗                 | ✗        | ✗        | ✓     | ✓          |
| List admins                        | ✗                 | ✗        | ✗        | ✗     | ✓          |
| Create/block/delete admin          | ✗                 | ✗        | ✗        | ✗     | ✓          |


### 6.3. Enforcement — где есть, где нет

**ENFORCED в коде:**

- API routes: все `@auth_required([...])` указывают список ролей.
- Messaging: `_ensure_messaging_role()` блокирует admin/superadmin от чата (только teacher↔student).
- Admin: `_ensure_managed_user_target` не даёт admin'у блокировать другого admin/superadmin.
- Teacher-classroom: все эндпоинты фильтруют `Classroom.teacher_id == current_user.id`.
- Student-classroom: все эндпоинты фильтруют `ClassMembership.student_id == current_user.id`.

**NOT ENFORCED (баги):**

- **[DEFECT] `submit_task` доступен всем через `@auth_required()`** — без списка ролей. Admin/superadmin может отправить ответ от своего имени, что создаст `UserProgress` для admin'а и триггернёт достижения. Не критично, но семантически неверно.
- **[DEFECT] `submit_quiz`** — аналогично.
- **[DEFECT] `module_lessons`, `get_lesson`, `list_modules`** — `@auth_required()` без ролей. Admin видит modules с filter по его age_group, но `User.age_group` для admin'а — `'adult'` или None → пустой список. Работает «случайно правильно», но семантика хрупкая.

### 6.4. Решение v1.5 — единый permission-декоратор

```python
def role_required(*roles):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            user = kwargs.get("current_user") or args[0]
            if user.role not in roles:
                return {"message": "Forbidden", "code": "role_forbidden"}, 403
            return func(*args, **kwargs)
        return wrapper
    return decorator

# Usage:
@student_bp.post("/tasks/<int:task_id>/submit")
@auth_required([UserRole.STUDENT])  # NEW: restrict role
def submit_task(current_user, task_id): ...
```

---

## 7. Domain model

Все PK — `Integer` (autoincrement). JSON-поля — `JSONB` с вариантом `JSON` для SQLite-CI.

### 7.1. Учётные сущности


| Модель             | Ключевые поля                                                                                                           | Назначение                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `User`             | id, full_name, username (5–10 симв.), email, phone, password_hash, role (student/teacher/parent/admin/superadmin), age_group, xp, xp_progress, avatar_id, frame_id, streak, theme, is_active, teacher_approval_status, teacher_rejection_expires_at, session_version, last_login_at | Единая пользовательская сущность, single-role. `xp_progress` — накопленный всего (нельзя снизить), `xp` — текущий (можно тратить на косметику). |
| `RefreshToken`     | id, user_id, token_id (jti), expires_at                                                                                 | Whitelist refresh-токенов                     |
| `SecurityThrottle` | scope, subject, ip_address, failed_count, blocked_until                                                                 | DB-level rate-limit (fallback при Redis-outage) |
| `AdminAuditLog`    | actor_user_id, actor_role, action, entity_type, entity_id, entity_label, details_json, created_at                      | Частичный семантический аудит admin-действий  |
| `SiteActivityLog`  | user_id, user_role, method, path, status_code, client_ip, created_at                                                   | Per-request API trail (migration 0011). `ENABLE_SITE_ACTIVITY_LOG=true`. Ежедневный JSONL-архив через `audit_log_archive.py`. |


### 7.2. Образовательный контент


| Модель   | Ключевые поля                                                                                                                                                                       | Специфика                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Module` | id, slug (unique), title, age_group, icon, color, order_index, is_published                                                                                                         | Корневой контейнер контента. Префикс `teacher-class-` обозначает учительский модуль |
| `Lesson` | id, module_id, slug (unique), title, summary, content_format, theory_blocks (JSONB), interactive_steps (JSONB), order_index, duration_minutes, passing_score                        | Единица обучения                                                                    |
| `Task`   | id, lesson_id, task_type (text/code), title, prompt, starter_code, validation (JSONB: evaluation_mode, tests, keywords, language, time_limit_ms, memory_limit_mb), hints, xp_reward | Практика                                                                            |
| `Quiz`   | id, lesson_id, title, passing_score, questions (JSONB), xp_reward                                                                                                                   | Тест внутри урока: single/multi/ordering/matching                                   |


### 7.3. Классы и задания


| Модель                 | Ключевые поля                                                                                                                 | Специфика                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Classroom`            | id, name, code (unique), teacher_id, created_at                                                                               | Класс                                                                                                  |
| `ClassMembership`      | classroom_id, student_id (unique pair)                                                                                        | Участие ученика в классе                                                                               |
| `ClassJoinRequest`     | classroom_id, student_id, status (pending/approved/rejected), created_at, decided_by_id                                       | Заявка на вступление                                                                                   |
| `Assignment`           | id, classroom_id, lesson_id (nullable), title, description, difficulty, due_date, xp_reward                                   | Задание для класса. Meta-prefix `[cq-assignment-meta]{...}` хранит тип/формат сдачи внутри description |
| `AssignmentSubmission` | id, assignment_id, student_id (unique pair), answer, score, status (submitted/checked/needs_revision), feedback, submitted_at | Сдача                                                                                                  |


### 7.4. Прогресс и геймификация


| Модель              | Ключевые поля                                                                                                                                                     | Специфика                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `UserProgress`    | user_id, lesson_id (unique pair), status (not_started/in_progress/pending_review/needs_revision/completed), score, attempts, hints_used, started_at, completed_at | Мьютабельное состояние прохождения                                    |
| `Achievement`     | code (unique), name, category, icon, xp_reward                                                                                                                    | 5 встроенных: first_code, perfect_five, marathon, explorer, lightning |
| `UserAchievement` | user_id, achievement_id (unique pair), earned_at                                                                                                                  | Факт получения                                                        |
| `ParentInvite`    | id, student_id, code (unique), label, active, weekly_limit_minutes, modules_whitelist (JSONB), expires_at                                                         | Устаревший механизм инвайта (анонимный). Заменяется `ParentChildLink` |
| `UserOwnedCosmetic` | user_id, item_key, item_type (avatar/frame/theme), purchased_at (unique user+item) | Покупки за XP (migration 0012). Каталог хардкодирован: 10 аватаров (бесплатно), 12 рамок (35–200 XP), 8 тем (0–200 XP). |


### 7.5. Мессенджер (Teacher↔Student)


| Модель                  | Ключевые поля                                                                    | Специфика                                 |
| ----------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| `Conversation`          | id, classroom_id, teacher_id, student_id (unique triple), created_at, updated_at | Диалог teacher↔student в контексте класса |
| `Message`               | id, conversation_id, sender_id, body (≤400), created_at                          | Сообщение                                 |
| `ConversationReadState` | conversation_id, user_id (unique pair), last_read_message_id                     | Read-receipts                             |


### 7.6. Staff Direct Messaging (Admin/Teacher прямой чат)

Добавлено в migration 0010. Прямые 1:1 диалоги между сотрудниками (admin↔teacher, admin↔admin, teacher↔teacher).

| Модель                  | Ключевые поля                                                                    | Специфика                                 |
| ----------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| `StaffDirectThread`     | id, user_low_id, user_high_id (unique pair, low < high), created_at, updated_at  | Уникальный поток для пары пользователей   |
| `StaffDirectMessage`    | id, thread_id, sender_id, body (Text), created_at                                | Сообщение. Нет ограничения ≤400 (в отличие от teacher↔student) |
| `StaffDirectReadState`  | thread_id, user_id (unique pair), last_read_message_id, updated_at               | Read-receipts                             |


### 7.7. Родительский кабинет (Parent Cabinet)

Добавлено в migration 0009. Полноценная учётная запись родителя (`parent` role) с привязкой к ребёнку через one-time code (hash stored at rest), настройками безопасности и согласий, уведомлениями и прямым чатом с учителем.

| Модель                    | Ключевые поля                                                                    | Специфика                                 |
| ------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| `ParentChildLink`         | parent_user_id, child_user_id (unique pair), relationship_label, active, revoked_at | Постоянная связь родитель-ребёнок после успешного redeem |
| `ParentLinkCode`          | child_user_id, code_hash (sha256), expires_at (7 дней), used_at, revoked_at      | One-time код. Только hash хранится в БД. Throttle на redeem. |
| `ParentSafetySettings`    | parent_user_id, child_user_id (unique), weekly/daily_screen_time_limit_minutes, hide_child_public_profile, allow_achievement_sharing | Родительский контроль |
| `ParentConsentSettings`   | parent_user_id, child_user_id (unique), allow_notifications, allow_browser_notifications, allow_achievement_sharing, allow_learning_analytics_display, allow_parent_teacher_communication | Согласие и настройки уведомлений |
| `ParentNotification`      | parent_user_id, child_user_id, title, body, type (achievement/lesson/assignment/feedback/digest/info), href, read_at | In-app уведомления родителю |
| `ParentTeacherThread`     | parent_user_id, teacher_id, child_user_id, classroom_id (unique 4-tuple), updated_at | Диалог родитель↔учитель в контексте класса ребёнка |
| `ParentTeacherMessage`    | thread_id, sender_id, body, created_at                                           | Сообщение в родитель↔учитель диалоге      |
| `ParentTeacherReadState`  | thread_id, user_id (unique pair), last_read_message_id, updated_at               | Read-receipts                             |


### 7.8. Entity Relationship (упрощённо)

```
User(1)──(N)ClassMembership(N)──(1)Classroom(1)──(N)Assignment(1)──(N)AssignmentSubmission(N)──(1)User
  │                                     │
  │                                     └─(1 teacher)
  │
  ├──(N)UserProgress(N)──(1)Lesson(N)──(1)Module
  │
  ├──(N)UserAchievement(N)──(1)Achievement
  │
  ├──(N)UserOwnedCosmetic (avatar/frame/theme)
  │
  ├──(N)ParentInvite [legacy]
  │
  ├──(N)ParentChildLink (parent_user_id) ←── User[parent]
  │         └── ParentSafetySettings, ParentConsentSettings
  │         └── ParentNotification
  │         └── ParentTeacherThread → ParentTeacherMessage → ParentTeacherReadState
  │
  ├──(N)StaffDirectThread (as user_low/user_high) → StaffDirectMessage → StaffDirectReadState
  │
  ├──(N)Conversation (as teacher|student) → (N)Message → ConversationReadState
  │
  ├──(N)RefreshToken, (N)AdminAuditLog
  │
  └──(N)SiteActivityLog
```

### 7.9. Дефекты модели

- **[DEFECT] Отсутствует CASCADE на DB-уровне для большинства FK.** ORM `cascade='all, delete-orphan'` работает только через ORM session. Прямой SQL `DELETE FROM users` может оставить orphan'ов.
- **[DEFECT] `Module.custom_classroom_id` — parse из slug.** Protocol-parsing вместо FK. При ошибке в генерации slug'а ломается всё authorization-дерево.
- **[DEFECT] `Assignment.description` хранит meta через префикс `[cq-assignment-meta]{...}\n<body>`.** Вместо отдельной колонки — JSON внутри Text. Indexing и query по `assignment_type` невозможны.
- **[OK] UniqueConstraint'ы везде, где надо:** `(classroom, student)`, `(user, lesson)`, `(user, achievement)`, `(scope, subject, ip)` — правильно.

### 7.10. План миграции модели (v1.5 → v2.0)

- `Module.custom_classroom_id: Integer FK → Classroom.id` (nullable) — вместо string-parsing.
- `Assignment.assignment_type: String, Assignment.submission_format: String` — вынести из description.
- CASCADE на DB-уровне: `ON DELETE SET NULL` для `User.decided_by_id` и `assignment.lesson_id`; `ON DELETE CASCADE` для `ClassMembership`, `UserProgress`, `ParentInvite`.
- UUID PK для основных сущностей (User, Classroom, Assignment, Lesson, Module) — подготовка к multi-tenant (merge-safe).

---

## 8. Event-driven / state management

### 8.1. Текущая модель — синхронная

Все действия — синхронные HTTP request/response. Нет очереди, нет worker'а, нет event bus.

**Критические пути, которые должны были быть асинхронными, но не являются:**


| Путь                                                 | Проблема                                   | Impact                                                                                  |
| ---------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `submit_task` с `stdin_stdout` → HTTP call to runner | Блокирует gunicorn worker на 0.5–2s        | Один worker = одна submission; `workers=4` => 4 одновременных submission для всей школы |
| `lesson_gigachat` → HTTP call to GigaChat            | Блокирует на 5–30s (таймаут 30s)           | Тот же эффект: 4 параллельных AI-запроса на школу                                       |
| `sync_achievements_for_user`                         | 5 SQL-запросов с JOIN'ами на каждый submit | Замедляет ответ; приемлемо пока                                                         |


### 8.2. Решение v1.5 — Celery + Redis

**Redis уже в стеке** (обязательный сервис в compose). Celery workers/beat — следующий шаг Фазы 2.

```yaml
# docker-compose.yml — Redis уже добавлен (см. Section 2.2)
# Осталось добавить:
celery-worker:
  build: {context: ., dockerfile: backend/Dockerfile}
  command: ["celery", "-A", "run.celery", "worker", "--loglevel=info"]
  depends_on: [redis, db]
  networks: [backend_net, judge_net]
```

Асинхронизовать:

- `judge_task_submission` → Celery task `judge.run_submission`. API возвращает `{submission_id, status: "queued"}`, фронтенд поллит `GET /api/submissions/<id>`.
- `request_lesson_chat_completion` → Celery task `gigachat.chat`. Тот же паттерн.
- `sync_achievements_for_user` — nightly cron + on-demand через Celery beat.
- Email delivery (Фаза 2) — Celery task.

### 8.3. State-transition для submission

Текущий state machine `AssignmentSubmission.status`:

```
       ┌───────────┐  teacher grade   ┌─────────┐
       │ submitted ├─────────────────►│ checked │
       └─────┬─────┘                  └─────────┘
             │
             │ teacher: needs_revision
             ▼
   ┌─────────────────┐
   │ needs_revision  │
   └────────┬────────┘
            │ student re-submits
            ▼
       submitted (loop)
```

Enforced в `teacher.py` через явную проверку `status in VALID_SUBMISSION_REVIEW_STATUSES`. Приемлемо для MVP.

### 8.4. Effective state for UserProgress

Текущий flow `complete_lesson` (упрощено):

```python
effective_percent = max(completion_percent, progress.score)  # монотонный рост
progress.score = effective_percent
if manual_review_required and effective_percent >= lesson.passing_score:
    progress.status = "pending_review"
else:
    progress.status = _status_from_completion_percent(lesson, effective_percent)
```

**ОК:** монотонность (нельзя «откатить» прогресс назад).
**ДЕФЕКТ:** `completion_percent` приходит от клиента. Злоумышленник может отправить `POST /api/lessons/<id>/complete {"completion_percent": 100}` и засчитать урок без прохождения. Serverside-вычисление процента отсутствует.

**Решение v1.5:** `completion_percent` вычисляется только сервером по (tasks_completed + quizzes_passed) / total. Клиент присылает только `lesson_id` и опционально `answer` для практики.

---

## 9. API architecture

### 9.1. Стиль

REST, JSON-based, cookie-auth. Нет OpenAPI-спецификации, нет версионирования (`/api/v1/...` отсутствует). Базовый префикс `/api/`.

### 9.2. Blueprint-раскладка


| Blueprint          | Префикс                  | Размер (KB) | Основные эндпоинты                                                                                                     |
| ------------------ | ------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `auth`             | `/api/auth`              | 7           | register, login, refresh, logout, me, options                                                                          |
| `student`          | `/api/`                  | 43          | dashboard, modules, lessons/, tasks//submit, quizzes//submit, classes/join, parent/invite, leaderboard                |
| `teacher`          | `/api/teacher`           | 27          | classes, classes/, classes//students, assignments, submissions, submissions//grade, lessons (custom)                   |
| `messaging`        | `/api/messaging`         | 18          | conversations, conversations//messages, conversations//read                                                            |
| `admin`            | `/api/admin`             | 26          | overview, users, users//block, teacher-requests, telemetry, site-activity                                              |
| `lesson_builder`   | `/api/lesson-builder`    | ~           | Создание/редактирование уроков (admin/teacher lesson builder API)                                                      |
| `cosmetics`        | `/api/cosmetics`         | ~           | catalog, buy, equip (аватары, рамки, темы за XP)                                                                       |
| `staff_messaging`  | `/api/staff-messaging`   | ~           | threads, threads//messages, threads//read (прямые staff-чаты)                                                          |
| `parent_cabinet`   | `/api/parent`            | ~           | link/generate, link/redeem, dashboard, notifications, safety-settings, consent-settings, teacher-threads, teacher-messages |


### 9.3. Дефекты API

- **[DEFECT] Большая монолитная `student.py`** — dashboard, modules, lessons, tasks, quizzes, classes, parent, leaderboard в одном blueprint. 1200 строк. Трудно тестировать в изоляции.
- **[DEFECT] Отсутствует OpenAPI** — frontend и backend контракт синхронизируются только через `test_api_contracts.py` и ручное поддержание `frontend/src/types/index.ts` (11.7 KB).
- **[DEFECT] Несогласованный формат ошибок.** Иногда `{"message": "..."}`, иногда `{"message": "...", "code": "invalid_token"}`. Клиенту трудно reliably маппить errors → UI-сообщения.
- **[DEFECT] Нет pagination на `/api/dashboard`, `/api/modules`, `/api/teacher/classes`.** Для школы с 1000 учеников teacher-dashboard станет медленным.
- **[OK] Cursor-pagination для messaging:** `/api/messaging/conversations/<id>/messages?before=<id>&limit=50`. Правильный подход для чата.

### 9.4. Стандарты ответов (принятые неявно)

```json
// Success
{"user": {...}} | {"modules": [...], "pagination": {...}} | {"message": "..."}

// Error
{"message": "Человекочитаемая причина"}
{"message": "...", "code": "invalid_token|session_revoked|role_forbidden"}

// HTTP codes:
400 - validation, 401 - auth, 403 - forbidden, 404 - not found, 409 - conflict, 429 - throttled, 503 - upstream unavailable
```

### 9.5. Решение v1.5

- Ввести `/api/v1/` префикс, сохранить текущие эндпоинты как alias → `/api/v1/...` навсегда.
- Документирование через `flask-smorest` / `apispec` / вручную написанный `openapi.yaml` в repo.
- Генерация `types/index.ts` из OpenAPI через `openapi-typescript` в pre-commit hook.
- Единый ErrorResponse: `{error: {code, message, details?}}`.

---

## 10. Integration architecture

### 10.1. GigaChat integration (внешний AI)

```python
# core/gigachat.py — 12.5 KB
_token_cache = {'access_token': None, 'expires_at': 0.0}
_token_lock = Lock()

def request_lesson_chat_completion(*, lesson, current_user, raw_messages, current_answer):
    # 1. Build system prompt with lesson context
    # 2. Normalize messages (last 14, trim 5000 chars each)
    # 3. Get/refresh OAuth access token (cached with lock)
    # 4. POST to GIGACHAT_API_URL/chat/completions
    # 5. Return {reply, usage} or raise GigaChatUnavailableError
```

**Плюсы:**

- Токен кэшируется in-memory с Lock (thread-safe в рамках одного процесса).
- Explicit `GigaChatConfigurationError` vs `GigaChatUnavailableError` — правильное разделение 400 vs 503.
- Проверка `GIGACHAT_VERIFY_SSL` в production (force True).

**Минусы:**

- In-process cache: при `gunicorn workers=4` каждый процесс держит свой токен → 4× нагрузка на GigaChat OAuth.
- Нет idempotency-key / request-id.
- Нет retry-политики на 5xx (fail-fast).
- Таймаут 30s — при cascade latency повесит весь request.

### 10.2. Code judge integration (внутренний service)

```python
# core/code_judge.py
def judge_task_submission(task, code):
    validation = task.normalized_validation(include_private=True)
    if validation['evaluation_mode'] == 'stdin_stdout':
        runner_url = _runner_url()
        if not runner_url:
            raise CodeJudgeUnavailableError('Изолированный runner обязателен.')
        return _judge_stdio_submission_remote(task, code, validation)
```

**Transport:** HTTP POST на `http://judge-runner:8090/execute` с bearer-token. Не MQ, не gRPC.

**Плюсы:**

- Bearer-auth между backend и runner (хороший).
- Thread-safe `RUNNER_SEMAPHORE = BoundedSemaphore(MAX_CONCURRENCY=4)` на runner — отклоняет 429 при перегрузке.
- Нет local fallback: ученический код не исполняется внутри backend-контейнера.

**Минусы:**

- Синхронный HTTP. Timeout 15s блокирует gunicorn worker.
- Если runner недоступен, автопроверка возвращает 503/availability error; это намеренный fail-closed.

### 10.3. План интеграций (Фаза 2+)


| Интеграция                        | Назначение                                          | Фаза | Транспорт                       |
| --------------------------------- | --------------------------------------------------- | ---- | ------------------------------- |
| Email (SMTP / SendGrid / Mailgun) | Password recovery, уведомления, родительский invite | 2    | Celery task + HTTP API          |
| Payment gateway (YooKassa)        | Подписка school-lifetime / pro-tier                 | 4    | REST + webhook (ASGI handler)   |
| SSO (SAML / Keycloak)             | Корпоративный вход через АД школы                   | 5    | SAML / OIDC                     |
| FSFES (ФГИС «Моя школа»)          | Интеграция с гос. цифровым образованием             | 6    | REST (когда откроется API)      |
| LMS exchange (SCORM / xAPI)       | Экспорт прогресса в Moodle/1С                       | 5    | SCORM package export, xAPI HTTP |


---

## 11. Background jobs / queues / async processing

**Текущее состояние:** Redis-брокер добавлен в compose и активен. Celery workers/beat — пока не реализованы (все задачи по-прежнему синхронны). Инфраструктура для Redis (multi-DB config, `REDIS_DB_CELERY_BROKER=3`, `REDIS_DB_CELERY_RESULT=4`) подготовлена в `config.py`. Переход на Celery — Фаза 2.

### 11.1. Jobs, которые необходимы для пилота


| Job                                            | Триггер                 | Периодичность       | Критичность     |
| ---------------------------------------------- | ----------------------- | ------------------- | --------------- |
| `judge.run_submission(task_id, user_id, code)` | event (student submit)  | on-demand           | P0              |
| `gigachat.chat_completion(...)`                | event                   | on-demand           | P1              |
| `email.send(template, to, ctx)`                | event                   | on-demand           | P0 (для пилота) |
| `sync_achievements(user_id)`                   | event (любой submit)    | on-demand + nightly | P1              |
| `leaderboard.refresh()`                        | cron                    | 5 min               | P1              |
| `cleanup_expired_tokens()`                     | cron                    | daily               | P2              |
| `cleanup_throttles()`                          | cron                    | hourly              | P2              |
| `export_class_progress(class_id)`              | event (teacher request) | on-demand           | P2              |
| `backup.pg_dump()`                             | cron                    | daily               | P0 (для пилота) |


### 11.2. Архитектура v1.5

```
┌───────────┐   enqueue    ┌─────────┐           ┌──────────────┐
│  Flask    │─────────────►│  Redis  │◄─────────►│Celery workers│
│  (web)    │              │  broker │  pop      │  (2-4 pcs)   │
└───────────┘              │  result │  result   └──────────────┘
                           └─────────┘
                                ▲
                                │ beat
                         ┌──────┴──────┐
                         │ Celery Beat │  (cron jobs)
                         └─────────────┘
```

Разделение очередей: `default`, `judge`, `gigachat`, `email`, `maintenance`. Отдельный worker-pool для `judge` — может быть на отдельном хосте.

### 11.3. Idempotency

Все async-jobs должны быть идемпотентны. Для submission: `submission.celery_task_id` хранится, повторный enqueue не создаёт дубля. Для email: `message_id` + unique constraint на (email_template, user_id, sent_at_date).

---

## 12. File storage / object storage strategy

### 12.1. Текущее состояние

- **User uploads:** отсутствуют. Ученик не может загрузить файл ответа (только textarea + code).
- **Mascot sprites:** 6 PNG по ~2 MB в `backend/sprite/`, отдаются через `@app.get("/api/mascot/<path:filename>")` через `send_from_directory`. Это критический P2-дефект — 12 MB статики в Docker-образе backend'а.
- **Lesson images / theory assets:** в `frontend/public/` (SVG, мелкие логотипы). Server-rendered Next.js отдаёт их напрямую.
- **Attachments to assignment submissions:** отсутствуют.

### 12.2. План v1.5


| Ресурс                         | Текущее хранение  | План                                                        |
| ------------------------------ | ----------------- | ----------------------------------------------------------- |
| Mascot sprites                 | `backend/sprite/` | Переместить в `frontend/public/mascot/`, Next.js static     |
| Task attachments (будущее)     | —                 | SeaweedFS (S3-compatible, Apache 2.0) или MinIO-replacement |
| User avatars                   | —                 | Тот же bucket, separate prefix                              |
| Backup PostgreSQL              | —                 | Local volume + rsync на external storage                    |
| Lesson attachments (pdf/video) | —                 | Тот же bucket с signed-URL                                  |


### 12.3. Choice of object storage


| Кандидат                           | Лицензия   | Статус 2026                 | Рекомендация         |
| ---------------------------------- | ---------- | --------------------------- | -------------------- |
| MinIO Open Source                  | AGPL-3.0   | Maintenance mode с 12/2025  | ❌                    |
| SeaweedFS                          | Apache 2.0 | Актуальный                  | ✓ Приоритет          |
| Garage (Deuxfleurs)                | AGPL-3.0   | Актуальный, geo-distributed | Альтернатива         |
| Локальный `MEDIA_ROOT` через nginx | —          | Простота, zero-infra        | ✓ Для пилота 1 школы |


Для MVP пилота (1 школа, до 1000 учеников, до 5 GB ассетов) достаточно локального volume + nginx. S3-compatible — в Фазе 3 при росте.

---

## 13. Release Strategy

### 13.1. Версионирование

Текущее: `frontend/package.json: "version": "2.0.0"`, backend без `VERSION`. Миграции нумеруются `0001..0012`. Нет git-тегов в `.git/refs/tags/`.

Текущие миграции (0001–0012):
- `0001` — baseline schema
- `0002` — admin_audit_logs
- `0003` — session_and_progress_columns
- `0004` — teacher_student_messaging
- `0005` — class_join_requests
- `0006` — user_phone
- `0007` — teacher_approval_status
- `0008` — teacher_rejection_expiration
- `0009` — parent_cabinet (ParentChildLink, ParentLinkCode, ParentSafetySettings, ParentConsentSettings, ParentNotification, ParentTeacherThread, ParentTeacherMessage, ParentTeacherReadState)
- `0010` — staff_direct_messaging (StaffDirectThread, StaffDirectMessage, StaffDirectReadState)
- `0011` — site_activity_logs (SiteActivityLog)
- `0012` — cosmetics (UserOwnedCosmetic)

**План v1.5:** Semantic Versioning `MAJOR.MINOR.PATCH` на всё (monorepo release).

- `v1.0.0` — текущее состояние (baseline pre-alpha).
- `v1.0.1` — **P0-фикс-спринт применён** (10/10 блокеров закрыты в коде); оргдействия (revoke/filter-repo/inline-digests) — за Gate 1.
- `v1.1.0` — целевая версия после Gate 1 (оргдействия P0 выполнены) + старт Phase 2 (P1).
- `v1.2.0` — Celery + email.
- `v2.0.0` — Multi-tenant / SaaS.

Docker image tags: `progyx/backend:1.1.0-sha-<shortsha>`, `progyx/frontend:1.1.0-sha-<shortsha>`. Никаких `:latest` в production.

### 13.2. Стратегия миграций БД

Текущая: линейная последовательность `0001 → 0002 → ... → 0012`, выполнение on-startup через `backend-init` service.

**Ограничения:**

- Нет `CREATE INDEX CONCURRENTLY` (текущие индексы создаются через `inspect().create_all()` — с блокировкой таблицы).
- Нет expand-contract для переименований столбцов.
- Нет rollback.

**План v1.5:** переезд на Alembic, `alembic stamp head` на текущей БД, затем generated migrations. Для production: migration review через PR, `alembic upgrade +1` в отдельном deploy step до rolling-update backend'а.

### 13.3. Deploy flow

Текущий: `docker compose up -d --build`. Нет blue/green, нет canary, нет rolling.

**План v1.5 (on-premise с zero-downtime):**

```bash
# Шаг 1: pull new image by digest
docker compose pull backend frontend

# Шаг 2: run migrations first
docker compose run --rm backend flask upgrade-db

# Шаг 3: rolling restart
docker compose up -d --no-deps --scale backend=2 backend  # old+new параллельно
# After health-check new, gracefully stop old

# Шаг 4: frontend restart
docker compose up -d --no-deps frontend
```

Для blue/green: два compose-profile'а, nginx upstream переключается между `backend_blue` и `backend_green`.

---

## 14. CI/CD strategy

### 14.1. Текущий CI (`.github/workflows/ci.yml`)

Четыре job:

1. **backend-checks**: Python 3.12, `pip install -r requirements.txt + requirements-dev.txt`, `python -m compileall backend`, smoke миграций на **PostgreSQL 17** (сервис в CI), `unittest discover backend/tests`. `SECRET_KEY=UnitTestSecretKey123!...` (проходит validator).
2. **backend-redis-integration**: Python 3.12, PostgreSQL 17 + Redis 7 в CI services. `THROTTLE_BACKEND=dual`, `SESSION_VERSION_CACHE=redis`, `REDIS_URL=redis://localhost:6379/0`. Запускает все backend-тесты с Redis.
3. **frontend-build**: Node 22, `npm ci`, `npm run typecheck`, `npm run build` (production).
4. **compose-smoke**: зависит от job 1+2+3, запускает `docker compose up -d --build db redis judge-runner backend-init backend frontend`, ждёт health всех сервисов.

### 14.2. Дефекты текущего CI


| Дефект                                         | P   | Влияние                                                        |
| ---------------------------------------------- | --- | -------------------------------------------------------------- |
| SQLite в тестах                                | **P0 — закрыто** | CI теперь на PostgreSQL 17 + Redis (backend-checks + backend-redis-integration) |
| Нет security scan (trivy)                      | P1  | CVE в образах попадают в production                            |
| Нет dependency-audit (pip-audit, npm audit)    | P1  | Уязвимые библиотеки                                            |
| Нет coverage threshold                         | P1  | Покрытие неизвестно, регрессии незаметны                       |
| Нет секрет-скана (gitleaks, detect-secrets)    | P0  | Утечка `.env` уже произошла                                    |
| Нет lint'а (ruff, mypy, eslint)                | P2  | Style-drift, type-bugs                                         |
| Нет Playwright/Cypress                         | P2  | UI-регрессии                                                   |
| Нет pinned image digests в compose-smoke       | P1  | Non-reproducible builds                                        |
| `pip install -r requirements.txt` без lockfile | P1  | Non-reproducible Python deps; нужен `pip-tools` / `uv lock`    |


### 14.3. План v1.5 — полноценный pipeline

```yaml
jobs:
  lint:
    - ruff check backend/
    - ruff format --check backend/
    - mypy backend/ --strict-optional
    - npm run lint (frontend eslint + next/core-web-vitals)

  secret-scan:
    - gitleaks detect --source . --verbose
    - detect-secrets scan

  unit-tests:
    services:
      postgres: {image: postgres:17-alpine@sha256:...}
      redis:    {image: redis:7-alpine@sha256:...}
    env:
      DATABASE_URL: postgresql+psycopg://test:test@localhost:5432/test
    steps:
      - pytest backend/tests/ --cov=backend/app --cov-fail-under=60 --junit-xml

  integration-tests:
    # Playwright against docker-compose

  security-scan:
    - trivy image --severity HIGH,CRITICAL --exit-code 1 progyx/backend:ci
    - pip-audit
    - npm audit --audit-level=high

  docker-build:
    - buildx build --push --tag progyx/backend:${{github.sha}}@sha256:...
    - cosign sign progyx/backend:${{github.sha}} (supply-chain)

  deploy-staging:  # manual approval
    - ssh staging 'docker compose pull && docker compose up -d'
```

### 14.4. Release gates


| Gate                    | Условие                                            | Enforcement                    |
| ----------------------- | -------------------------------------------------- | ------------------------------ |
| Gate 1 (merge to main)  | lint + unit + secret-scan + security-scan = green  | branch-protection rule         |
| Gate 2 (staging deploy) | Gate 1 + integration-tests green + coverage ≥ 60%  | manual approval                |
| Gate 3 (production)     | Gate 2 + DR-drill зелёный + smoke on staging ≥ 24h | manual approval, 2-person rule |


---

## 15. Testing Strategy

### 15.1. Что есть сейчас


| Уровень             | Файл                                   | Что тестирует                                                                         |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Security            | `test_security.py` (12.5 KB)           | HttpOnly-cookies, session_version revocation, throttle, origin-check, password policy |
| Admin ops           | `test_admin_management.py` (9.4 KB)    | create admin, block, delete, audit log                                                |
| Admin queries       | `test_admin_queries.py` (10.6 KB)      | user listing, pagination, filters                                                     |
| Teacher queries     | `test_teacher_queries.py` (23 KB)      | classrooms, students, submissions aggregation                                         |
| Critical journeys   | `test_critical_journeys.py` (9.7 KB)   | register → lesson → submit → complete                                                 |
| API contracts       | `test_api_contracts.py` (11.5 KB)      | payload shape smoke (select endpoints)                                                |
| Code judge security | `test_code_judge_security.py` (5.1 KB) | runner bearer, timeout, rejection                                                     |
| Migrations          | `test_migrations.py` (2.7 KB)          | schema_migrations recording                                                           |
| Messaging           | `test_messaging.py` (28.7 KB)          | conversations, read receipts, authorization                                           |
| CSRF                | `test_csrf.py`                         | double-submit cookie, OPTIONS-preflight, hmac compare                                 |
| Runtime config      | `test_runtime_config.py`               | SECRET_KEY validation, placeholder denylist, entropy guard (8 кейсов)                |
| Core domain         | `test_core_domain.py`                  | gamification, achievements, XP logic                                                  |
| Cosmetics           | `test_cosmetics.py`                    | buy/equip items, XP spend, catalog validation                                         |
| Parent cabinet      | `test_parent_cabinet.py`               | link code generate/redeem, ParentChildLink, safety settings                           |
| Redis rollout       | `test_redis_rollout.py`                | throttle dual-mode (DB + Redis), session_version cache in Redis                       |
| Staff messaging     | `test_staff_messaging.py`              | StaffDirectThread, messages, read states, authorization                               |


**ИТОГО:** ~150+ KB backend-тестов, преимущественно unit + integration (API-level).

### 15.2. Что отсутствует


| Уровень                                      | Требование                            | Статус |
| -------------------------------------------- | ------------------------------------- | ------ |
| Frontend unit (Vitest)                       | Проверка компонентов                  | 0%     |
| Frontend integration (React Testing Library) | Форма auth, lesson player             | 0%     |
| E2E (Playwright)                             | Full student journey, teacher journey | 0%     |
| Contract schema (Zod / Pydantic)             | API response validation в runtime     | 0%     |
| Property-based (Hypothesis)                  | Валидаторы password, email            | 0%     |
| Load testing (k6 / Locust)                   | Судья на 100 одновременных submission | 0%     |
| Chaos testing                                | GigaChat вниз → graceful              | 0%     |


### 15.3. Тестовый конфиг v1.5

```python
# settings_test.py
DATABASES = {
    "default": "postgresql+psycopg://test:test@postgres:5432/test_progyx"
}
CACHES = {"default": {"BACKEND": "redis", "LOCATION": "redis://redis:6379/2"}}
CELERY_TASK_ALWAYS_EAGER = False
CELERY_BROKER_URL = "redis://redis:6379/3"
JUDGE_RUNNER_URL = "http://judge-runner:8090/execute"  # real runner in CI compose
CODE_JUDGE_ALLOW_LOCAL_FALLBACK = False
```

### 15.4. Целевой покрытие pyramid

```
         ┌──────────────┐  E2E (5%):
         │   Playwright  │  critical journeys × 3 ролей
         └──────────────┘
       ┌──────────────────┐  Integration (25%):
       │ Flask test_client │  API + PostgreSQL + Redis + runner
       └──────────────────┘
     ┌──────────────────────┐  Frontend integration (15%):
     │ RTL + MSW            │  lesson-player, auth-form, teacher-workspace
     └──────────────────────┘
   ┌──────────────────────────┐  Unit (55%):
   │ pytest + vitest          │  validators, gamification, permissions
   └──────────────────────────┘
```

Minimum acceptable coverage for Gate 2: **60%** backend, **40%** frontend.

---

## 16. Disaster Recovery

### 16.1. Текущее состояние

- **RPO:** неопределён (нет бэкапов → потенциально ∞).
- **RTO:** неопределён (нет runbook).
- **Backups:** отсутствуют (docker volume без внешней копии).
- **Restore drill:** никогда не проводился.

**Это P0 блокер для первой коммерческой поставки.** Потеря данных школы = немедленное судебное разбирательство по 152-ФЗ + репутационный урон.

### 16.2. Целевая DR-стратегия v1.5 (для пилота)


| Параметр       | Цель             | Реализация                                                           |
| -------------- | ---------------- | -------------------------------------------------------------------- |
| RPO            | ≤ 24 часа        | `pg_dump` ежедневно в 03:00, retention 14 дней                       |
| RTO            | ≤ 4 часа         | Документированный runbook: стоп сервис → pg_restore → start          |
| Backup storage | 3 копии, 2 среды | Local volume + rsync to external SSD + weekly upload в S3-compatible |
| Verification   | weekly           | Автоматический restore test в staging + сверка checksum              |


### 16.3. Backup-стратегия

```yaml
# docker-compose.yml add
backup:
  image: postgres:17-alpine@sha256:...  # re-use pg_dump
  volumes:
    - postgres_data:/var/lib/postgresql/data:ro
    - /backup/progyx:/backup
  command: >
    sh -c '
    while true; do
      pg_dump -h db -U codequest codequest | gzip > /backup/codequest-$(date +%Y%m%d-%H%M%S).sql.gz;
      find /backup -name "*.sql.gz" -mtime +14 -delete;
      sleep 86400;
    done
    '
  networks: [backend_net]
```

Для WAL-based PITR (Point-In-Time Recovery) — Фаза 3, через `barman` или `pgbackrest`.

### 16.4. Maintenance Mode

Отсутствует. `Tenant.maintenance_mode` как в reference-платформе не реализовано. 

**Решение v1.5:**

```python
# core/maintenance.py
@app.before_request
def check_maintenance():
    if app.config.get("MAINTENANCE_MODE") and request.method not in SAFE_HTTP_METHODS:
        return {"message": "Платформа в режиме обслуживания. Запись временно недоступна."}, 503
```

Флаг через `redis SET maintenance 1` без рестарта.

### 16.5. DR Drill checklist (обязательно до Gate 2)

- Документировать runbook: шаги restore, roles, contact list.
- Полностью снести staging → restore из свежего дампа → smoke test.
- Замерить реальный RTO. Если > 4h — оптимизировать (pg_basebackup, параллельный pg_restore).
- Симулировать потерю judge-runner → проверить graceful degradation.
- Симулировать потерю frontend → проверить что backend-only API работает.

---

## 17. Docker / deployment architecture

### 17.1. Текущий compose — сильные стороны

- `**judge_net: internal: true**` — изоляция runner'а от интернета ✓
- `**backend-init` как separate one-shot** — миграции перед app start ✓
- `**healthcheck` на всех сервисах** — правильные depends_on с `condition: service_healthy` ✓
- **Non-root users** в Dockerfile'ах (appuser, judge, app) ✓
- `**read_only: true` + `tmpfs` + `cap_drop: ALL` + `pids_limit` + `mem_limit`** на judge-runner ✓
- **Redis с паролем через Docker secret** — requirepass через shell + Docker secret, `redis_data` named volume ✓
- **PostgreSQL password через Docker secret** — `POSTGRES_PASSWORD_FILE`, `5432` не публикуется на host ✓
- **db-backup sidecar** — nightly pg_dump, `postgres_backups` volume, retention, SHA-256 ✓

### 17.2. Текущий compose — слабые стороны


| Дефект                                                                      | P   |
| --------------------------------------------------------------------------- | --- |
| Образы без digest (`postgres:17`, `node:22-alpine`, `python:3.12-slim`)     | P0 закрыт playbook/tooling: digest resolve перед prod |
| `POSTGRES_PASSWORD: codequest` plain-text в compose                         | **Закрыто v1.0.2:** `POSTGRES_PASSWORD_FILE` + Docker secret |
| `5432:5432` published — БД открыта с хоста                                  | **Закрыто v1.0.2:** port publication удалена |
| `JUDGE_RUNNER_AUTH_TOKEN: ${...:-local-dev-judge-token-change-me}` fallback | Runtime fail-fast в production; local fallback выполнения удалён |
| Нет `restart: on-failure` на backend-init (стоит `restart: no` — ок)        | P2  |
| Нет Docker secrets / no external secret manager                             | **Частично закрыто v1.0.2:** PostgreSQL + Redis через Docker secrets; остальные внешние секреты — env/ops |
| `judge_runner/Dockerfile` ставит `nodejs` через apt — latest debian stable  | P1  |
| Нет multi-stage для backend — full pip install в runtime image              | P2  |


### 17.3. v1.5 Docker hardening checklist

- Все образы: `image: postgres:17-alpine@sha256:<64hex>`.
- Секреты PostgreSQL/Redis через Docker secrets (`secrets/postgres_password`, `secrets/redis_password`); остальные env-файлы только вне репозитория (в `/etc/progyx/.env` с chmod 600).
- Публикация `5432:5432` удалена; доступ к БД только через `docker exec`, bastion или временный admin-профиль.
- `JUDGE_RUNNER_AUTH_TOKEN` — обязательный fail-fast при пустом/дефолтном в production (уже проверяется в `_validate_runtime_config`).
- Multi-stage для backend: builder-stage → slim runtime-stage с только runtime deps.
- Pin Node.js version в judge-runner: `RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash && apt install -y nodejs=20.`*.
- WeasyPrint (если будет PDF-экспорт) — `apt install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 libcairo2 libffi-dev`.
- Сканирование CVE в CI: `trivy image --severity HIGH,CRITICAL`.
- Cosign signing для supply-chain.

### 17.4. Целевая топология v1.5

```yaml
# compose.yml
services:
  db:
    image: postgres:17-alpine@sha256:<digest>
    secrets: [postgres_password]
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    networks: [backend_net]
    volumes:
      - postgres_data:/var/lib/postgresql/data
    # no ports exposed
    
  redis:
    image: redis:7-alpine@sha256:<digest>
    command: ["redis-server", "--requirepass-file", "/run/secrets/redis_password"]
    secrets: [redis_password]
    networks: [backend_net]

  backend: {...}  # with proxy-fix, celery removed to celery-worker
  celery-worker: {...}
  celery-beat: {...}
  judge-runner: {...}  # + nsjail layer
  
  nginx:
    image: nginx:1.25-alpine@sha256:<digest>
    volumes:
      - ./deploy/nginx.conf:/etc/nginx/nginx.conf:ro
      - letsencrypt:/etc/letsencrypt:ro
    ports: ["80:80", "443:443"]
    depends_on: [frontend, backend]

secrets:
  postgres_password: {file: ./secrets/postgres_password}
  redis_password: {file: ./secrets/redis_password}
  gigachat_key: {file: ./secrets/gigachat_key}
  judge_token: {file: ./secrets/judge_token}
```

---

## 18. Infrastructure hardening

### 18.1. Host-level


| Мера                                              | Статус             | P   |
| ------------------------------------------------- | ------------------ | --- |
| Dedicated user (non-root) для docker              | Не документировано | P1  |
| Firewall (ufw / iptables): allow 80, 443, ssh     | Не документировано | P1  |
| SSH key-only, no password                         | Не документировано | P1  |
| fail2ban на sshd + nginx                          | Не документировано | P2  |
| Автообновление безопасности (unattended-upgrades) | Не документировано | P1  |
| `systemd` unit для `docker compose up`            | Нет                | P2  |


### 18.2. Application-level


| Мера                                    | Статус                      | Комментарий                          |
| --------------------------------------- | --------------------------- | ------------------------------------ |
| SECURE_PROXY_SSL_HEADER + ProxyFix      | Применено (флаг `TRUST_PROXY`, default `False`) | **Закрыто в v1.0.1** — оператор включает `TRUST_PROXY=true` за доверенным reverse-proxy |
| SESSION_COOKIE_SECURE в prod            | Принудительно               | OK                                   |
| SESSION_COOKIE_SAMESITE=Strict          | Strict                      | **Закрыто v1.0.2** — default Strict + production fail-fast |
| CSRF double-submit                      | Введён (`csrf_token` cookie + `X-CSRF-Token`) | **Закрыто в v1.0.1**                |
| Content Security Policy без unsafe-*    | Script: `nonce + strict-dynamic` (prod); Style: `unsafe-inline` остаётся (Next.js App Router) | **Script закрыто в v1.0.1**, Style — follow-up |
| CORS allowlist строгий                  | CORS через CLIENT_URL       | OK                                   |
| HSTS header                             | Set in production           | **Закрыто v1.0.2**                  |
| X-Permitted-Cross-Domain-Policies: none | Set                         | **Закрыто v1.0.2**                  |


### 18.3. Observability hardening


| Компонент    | Рекомендация                                                                     |
| ------------ | -------------------------------------------------------------------------------- |
| Logs         | `structlog` JSON → stdout → `docker logs` + Loki                                 |
| Metrics      | `prometheus_flask_exporter` + `/metrics` endpoint → Prometheus → Grafana         |
| Traces       | OpenTelemetry-python → Jaeger (для post-Фаза 3)                                  |
| Errors       | Sentry (self-hosted Glitchtip) — перехват всех unhandled exception               |
| Uptime       | Uptime-Kuma на отдельном хосте                                                   |
| Health-check | Расширить `/api/health` до `/api/health/readiness` (проверяет db, redis, runner) |


---

## 19. Performance bottlenecks

### 19.1. Наблюдаемые узкие места


| Место                                                  | Проблема                                                  | Метрика                           | Решение                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `judge_task_submission` (remote)                       | Блокирует gunicorn worker на 0.5–15s                      | wait-time worker                  | Async via Celery                                                                    |
| `lesson_gigachat`                                      | Блокирует на 1–30s                                        | worker wait                       | Async + streaming                                                                   |
| `/api/dashboard`                                       | N+1: UserProgress per lesson; classrooms joined           | > 50 SQL на запрос                | `selectinload` / `joinedload` + eager loading; уже частично в teacher_query_service |
| `_global_leaderboard_rows`                             | In-process cache; рекомпиляция при cache-miss — full scan | N × SELECT FROM users ORDER BY xp | **Redis зарезервирован** (`REDIS_DB_LEADERBOARD=0`); переезд кэша — pending P1 |
| `seed/bootstrap.py` — 65 KB                            | Huge one-shot load — 990 lines                            | app startup time                  | Разбить на отдельные seed-скрипты, запускать только при ENABLE_DEMO_DATA            |
| `frontend/components/shared-lesson-builder.tsx` 102 KB | Big bundle, main-thread jank                              | TTI                               | Code-splitting через `dynamic(() => import(...))`                                   |
| Monaco editor                                          | 2 MB gzipped на первую загрузку                           | LCP на `/lessons/<id>`            | Lazy-load через next/dynamic                                                        |
| `backend/sprite/*.png` (6 × 2 MB)                      | Тяжёлая статика через Flask                               | static-cache-miss latency         | Перенести в `frontend/public/mascot/`                                               |


### 19.2. Профилирование план

- Включить `METRICS_DEBUG=true` временно: `X-Request-Duration-Ms`, `X-DB-Query-Count` на всех ответах.
- Лог-агрегирование: sort by `query_count` → top-N эндпоинтов с N+1.
- Lighthouse CI на фронтенде в PR — LCP, CLS, TBT.
- k6 load-test: 50 users × 5 min на `/api/dashboard`, `/api/tasks/<id>/submit`.

### 19.3. Capacity planning для пилота

Оценка на класс 30 учеников + 1 учитель, пиковая нагрузка 25 одновременных submission:

- Backend gunicorn: 4 workers × 8 threads = 32 параллельных. 25 submission × 2s = OK.
- Judge-runner `MAX_CONCURRENCY=4`. 25 submission → queue 6 × 4 = 24s wait. **Увеличить до 8–16** + горизонтальный scale runner'а.
- PostgreSQL: 30 активных соединений, нагрузка копеечная.
- Redis: 1 instance, пиковая нагрузка 100 req/s.
- Типовой server: 4 vCPU / 8 GB RAM / 100 GB SSD.

Для 1000 учеников (20 классов) — те же ресурсы × 3, или отдельный judge-runner pool (нагрузка 3-6 одновременных classroom practice session).

---

## 20. Scalability roadmap


| Масштаб                             | Требования                           | Архитектурные изменения                                                                                              |
| ----------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1 школа, 100–500 учеников           | Однохостовый compose                 | **v1.5 current target** — P0 fixes + Celery + backups                                                                |
| 1 школа, 500–2000 учеников          | Выделенный backend pool              | Горизонтальное масштабирование backend (3 реплики за nginx load-balancer), shared Redis, shared PostgreSQL           |
| Multi-school (5–20 школ) on-premise | Каждая школа — отдельный docker-host | Нет multi-tenant в коде, просто N инсталляций. Centralized update through private registry, phone-home license check |
| Multi-school SaaS (20–100 школ)     | Один кластер                         | Вводить `Tenant` FK на все модели; PostgreSQL schemas или row-level security; per-tenant Celery queues               |
| National-scale (1000+ школ)         | Multi-region                         | Shard by tenant_id; separate PG per region; CDN для статики; edge workers для auth                                   |


### 20.1. Data-layer масштабирование

- PostgreSQL 17: до 10k RPS read / 2k RPS write на одном приличном хосте — избыточно для любого school-level пилота.
- Connection pooling: добавить **PgBouncer** в transaction-mode перед PG при > 100 соединений (>12 backend workers).
- Read replicas: PG streaming replication с Фазы 4 (SaaS multi-school).

### 20.2. Compute-layer масштабирование

- Backend: stateless (сессия в cookie, state в PG/Redis) → безопасно горизонтально.
- Judge-runner: stateless → можно N реплик, backend выбирает round-robin.
- Frontend Next.js: `next start` масштабируется горизонтально; SSR-cache — через Redis (`@neshca/cache-handler`).

### 20.3. Asset-layer

- Статика frontend'а — за CDN (Cloudflare, Yandex Cloud CDN).
- Uploads — SeaweedFS в Фазе 3.

---

## 21. Technical debt

Сводная таблица техдолга, упорядоченная по impact/effort.


| Код   | Долг                                                                                   | Impact      | Effort | P   |
| ----- | -------------------------------------------------------------------------------------- | ----------- | ------ | --- |
| TD-01 | `.env` с секретом закоммичена — нужен `git filter-repo`, revoke ключа, rewrite history | Критический | S      | **P0 — код закрыт в v1.0.1, оргдействие остаётся**  |
| TD-02 | SQLite CI → PostgreSQL CI                                                              | Высокий     | S      | **P0 — закрыто в v1.0.1** (postgres:17 service)     |
| TD-03 | CSP `unsafe-inline`, `unsafe-eval`                                                     | Высокий     | M      | **P0 — закрыто в v1.0.1** (nonce + strict-dynamic)  |
| TD-04 | Нет CSRF-token                                                                         | Высокий     | M      | **P0 — закрыто в v1.0.1** (double-submit cookie)    |
| TD-05 | Pinned image digests                                                                   | Средний     | S      | **P0 — playbook+скрипт готовы, inline оператором**  |
| TD-06 | Нет бэкапов PG                                                                         | Критический | S      | **P0 — закрыто в v1.0.1** (db-backup sidecar + DR)  |
| TD-07 | Нет Celery/email                                                                       | Высокий     | L      | P1 (Redis live, Celery — следующий шаг) |
| TD-08 | Самописный migration runner → Alembic                                                  | Средний     | M      | P1  |
| TD-09 | Leaderboard in-process cache → Redis                                                   | Средний     | S      | P1 (Redis live, кэш pending) |
| TD-10 | Oversized frontend components (5 файлов > 20 KB)                                       | Средний     | L      | P1  |
| TD-11 | Oversized backend blueprints (student.py 43 KB)                                        | Средний     | L      | P1  |
| TD-12 | OpenAPI / type-safe контракт                                                           | Средний     | M      | P1  |
| TD-13 | Нет frontend-тестов                                                                    | Средний     | L      | P2  |
| TD-14 | Nsjail / seccomp для judge                                                             | Высокий     | M      | P1  |
| TD-15 | Admin audit log неполон (семантически)                                                 | Средний     | M      | P1 (SiteActivityLog добавлен как сырой trail) |
| TD-16 | UUID PK для multi-tenant                                                               | Низкий      | L      | P2  |
| TD-17 | `Module.is_custom_classroom_module` через slug-prefix → FK                             | Низкий      | M      | P2  |
| TD-18 | `Assignment.description` meta через префикс → отдельные колонки                        | Низкий      | M      | P2  |
| TD-19 | Username min 5 симв — коллизии в школе 500+                                            | Средний     | S      | P1  |
| TD-20 | Mascot PNG 12 MB в backend-образе                                                      | Низкий      | S      | P2  |
| TD-21 | `ParentInvite` legacy-механизм → вытеснить `ParentChildLink`                           | Средний     | M      | P2  |
| TD-22 | Throttle dual-mode только для login/register; parent_cabinet использует DB-fallback    | Средний     | S      | P1  |


Total: **22 крупных пунктов tech debt**. P0 × 6 закрыты, P1 × 10, P2 × 6.

---

## 22. Licensing risks

### 22.1. Ревизия зависимостей


| Компонент               | Лицензия                                       | Коммерческое on-premise             | Коммерческое SaaS | Риск                                     |
| ----------------------- | ---------------------------------------------- | ----------------------------------- | ----------------- | ---------------------------------------- |
| Flask 3.1.3             | BSD-3                                          | ✓                                   | ✓                 | Нет                                      |
| Flask-SQLAlchemy 3.1.1  | BSD-3                                          | ✓                                   | ✓                 | Нет                                      |
| SQLAlchemy 2.0.48       | MIT                                            | ✓                                   | ✓                 | Нет                                      |
| psycopg 3.2.12 (binary) | LGPL-3.0 + OpenSSL                             | ✓                                   | ✓                 | Низкий (LGPL — динамическая линковка ОК) |
| PyJWT 2.10.1            | MIT                                            | ✓                                   | ✓                 | Нет                                      |
| Werkzeug 3.1.3          | BSD-3                                          | ✓                                   | ✓                 | Нет                                      |
| gunicorn 23.0.0         | MIT                                            | ✓                                   | ✓                 | Нет                                      |
| Flask-Cors 6.0.1        | MIT                                            | ✓                                   | ✓                 | Нет                                      |
| python-dotenv 1.1.1     | BSD-3                                          | ✓                                   | ✓                 | Нет                                      |
| Next.js 16.2.1          | MIT                                            | ✓                                   | ✓                 | Нет                                      |
| React 19.2.0            | MIT                                            | ✓                                   | ✓                 | Нет                                      |
| Tailwind CSS            | MIT                                            | ✓                                   | ✓                 | Нет                                      |
| GSAP 3.14.2             | **GreenSock Standard License**                 | ✓ (non-commercial) / Plus $199/year | **⚠ РИСК**        | **Средний**                              |
| `@gsap/react`           | MIT (но bundle GSAP core под Standard License) | См. выше                            | См. выше          | **Средний**                              |
| `@monaco-editor/react`  | MIT (Monaco core — MIT)                        | ✓                                   | ✓                 | Нет                                      |
| lucide-react            | ISC                                            | ✓                                   | ✓                 | Нет                                      |
| react-hot-toast         | MIT                                            | ✓                                   | ✓                 | Нет                                      |
| clsx                    | MIT                                            | ✓                                   | ✓                 | Нет                                      |
| dompurify 3.3.2         | Apache-2.0 / MPL-2.0                           | ✓                                   | ✓                 | Нет                                      |
| PostgreSQL 17           | PostgreSQL License (permissive)                | ✓                                   | ✓                 | Нет                                      |
| Node.js 22              | MIT + OpenSSL                                  | ✓                                   | ✓                 | Нет                                      |


### 22.2. Критический риск: GSAP

GSAP использует кастомную лицензию **GreenSock Standard License**:

- Бесплатно для non-commercial и до $100M revenue для большинства плагинов.
- Core (Tween, Timeline) — бесплатен.
- **Бонусные плагины** (ScrollTrigger, SplitText, DrawSVG, MorphSVG) требуют «GSAP Plus» подписки ($99–$199/год) для коммерческого использования.

**Рекомендация:** провести аудит `frontend/src/components/*.tsx` на использование **плагинов GSAP**. Если используются только core + базовые easings — бесплатно. Если ScrollTrigger / SplitText / Draggable — **обязательна платная подписка** для коммерции.

**Альтернатива (v1.5):** замена GSAP на Framer Motion (MIT) + CSS Animations — меньше bundle size, нет license cost, достаточно для learning-path анимации.

### 22.3. Риск: GigaChat API

- SLA: неизвестен (Sberbank не публикует).
- Ценообразование: per-token, ~1₽ за 1k токенов (данные на 2026).
- Альтернативы для fail-over: YandexGPT, локальная модель (Llama 3.1-8B через Ollama) — Apache 2.0.

### 22.4. Риск: educational контент

- Reference-контент в `seed/bootstrap.py` — создан автором проекта. Нужен explicit лицензирующий header (CC-BY-SA 4.0 предпочтительно).
- Mascot sprites — если нарисованы на заказ, нужны договоры о передаче исключительных прав.

---

## 23. Economic model

### 23.1. Целевая аудитория


| Сегмент                                        | Описание                                 | Базовая численность РФ | Цена за школу/год                  |
| ---------------------------------------------- | ---------------------------------------- | ---------------------- | ---------------------------------- |
| Частная школа / гимназия                       | 200–800 учеников, IT-направление         | ~2 500 школ            | 60 000 – 180 000 ₽                 |
| Муниципальная школа (по гранту)                | 500–1500 учеников                        | ~41 000 школ           | 30 000 – 80 000 ₽                  |
| Центр доп. образования                         | 50–500 учеников, кружки программирования | ~4 000 центров         | 40 000 – 120 000 ₽                 |
| Онлайн-школа (Skypro, Skillbox, Яндекс Lyceum) | 1000+ учеников, white-label              | ~30 крупных            | 500 000 ₽+ лицензионно + доработки |


### 23.2. Тарифная модель


| Тариф                 | Состав                                                                             | Целевой клиент           | Цена/школа/год |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------ | -------------- |
| **Start** (v1.5 MVP)  | Core + roadmap + teacher-workspace + classes + messaging + auto-grading            | Муниципальные школы, ЦДО | 30 000 ₽       |
| **Pro** (v2.0)        | Start + GigaChat AI-ассистент + parent-portal + Advanced analytics + 20 GB storage | Частные школы            | 90 000 ₽       |
| **Pro+** (v2.5)       | Pro + SSO + API интеграций с 1С ХроноГраф / АвторасПросвет + экспорт SCORM         | Онлайн-школы, EdTech     | 250 000 ₽      |
| **OEM / white-label** | Полный исходник + поддержка + кастомизация                                         | Enterprise EdTech        | 1 500 000 ₽+   |


### 23.3. Unit economics — соло-разработчик, realistic


| Параметр                                   | Год 1           | Год 2                        | Год 3                                    |
| ------------------------------------------ | --------------- | ---------------------------- | ---------------------------------------- |
| Зарплата разработчика                      | 1 800 000 ₽     | 2 200 000 ₽                  | 2 800 000 ₽                              |
| Сервер / инфра / домены                    | 100 000 ₽       | 200 000 ₽                    | 350 000 ₽                                |
| Юридические / EULA / ПДн                   | 150 000 ₽       | 50 000 ₽                     | 100 000 ₽                                |
| Маркетинг / продажи                        | 100 000 ₽       | 300 000 ₽                    | 600 000 ₽                                |
| GigaChat квота (~250 обращений/ученик/мес) | 0 ₽             | 120 000 ₽                    | 400 000 ₽                                |
| **Итого OPEX**                             | **2 150 000 ₽** | **2 870 000 ₽**              | **4 250 000 ₽**                          |
| Клиентов Start                             | —               | 10                           | 40                                       |
| Клиентов Pro                               | —               | 3                            | 15                                       |
| Клиентов Pro+                              | —               | 0                            | 2                                        |
| **ARR**                                    | 0               | 10×30k + 3×90k = **570 000** | 40×30k + 15×90k + 2×250k = **3 050 000** |
| Breakeven?                                 | ❌               | ❌                            | ❌ (ARR < OPEX)                           |


### 23.4. Breakeven-анализ

Для соло-разработчика при OPEX ~3 млн ₽/год:

- Чисто Start-tier: нужно 100 клиентов → нереалистично за 2 года.
- Mix Start+Pro 70/30: ARPA ~48k ₽ → 65 клиентов.
- Mix Start+Pro+Pro+ 50/30/20: ARPA ~90k ₽ → 35 клиентов — **достижимо к концу Year 3** при активных продажах.

**Вывод:** прибыльность достижима на горизонте 2.5–3 года **только при фокусе на Pro/Pro+ сегмент** (частные и онлайн-школы), а не на муниципальный. Муниципальный сегмент требует тендеров, реестра Минцифры, сертификатов ФСТЭК — отдельный долгий путь.

### 23.5. Альтернативная модель: B2C (репетиторы + родители)

- SaaS для индивидуальных учителей программирования (репетиторов): 500 ₽/месяц × 500 учителей = 250k ₽/месяц = 3 млн ₽/год — **breakeven за 1 год** при агрессивном onboarding.
- Требует: Stripe/ЮКасса billing, самообслуживание (onboarding без участия продажников), публичный сайт.

---

## 24. Development roadmap по фазам

Предполагается **соло-разработчик** либо команда 2–3 чел. (backend + frontend + DevOps/QA совместитель).

### Фаза 0 — Baseline (DONE)

- ✓ Flask + SQLAlchemy + PostgreSQL + JWT-auth + RBAC
- ✓ Next.js + Tailwind + GSAP + Monaco + lesson-player
- ✓ 5 ролей (student/teacher/parent/admin/superadmin), session_version revocation
- ✓ Classroom + Assignment + Submission flow
- ✓ Judge-runner в изолированном контейнере с bearer-auth
- ✓ Messaging teacher↔student
- ✓ Staff direct messaging (admin↔teacher, admin↔admin)
- ✓ GigaChat integration
- ✓ Gamification + achievements
- ✓ Cosmetics system (аватары, рамки, темы за XP)
- ✓ Parent cabinet (parent-роль, ParentChildLink, ParentLinkCode, ParentSafetySettings, ParentConsentSettings, ParentTeacherThread)
- ✓ SiteActivityLog + audit_log_archive
- ✓ Teacher approval workflow (teacher_approval_status, rejection expiration)
- ✓ Redis в compose (throttle dual-mode, session-version cache, leaderboard DB reserved)
- ✓ Custom migrations runner (12 миграций)
- ✓ GitHub Actions CI (4 job'а: backend-checks, backend-redis-integration, frontend-build, compose-smoke)

### Фаза 1.5 — P0 hardening (ЗАКРЫТА в v1.0.1 за один спринт)

**Статус на v1.0.2:** все P0 code/config пункты закрыты, а оставшиеся security follow-ups из этого документа закрыты в коде за исключением GigaChat-scope. Чек-лист ниже сохранён для истории; каждая строка помечена `[x]` с ссылкой на артефакт.

- [x] **[P0-1]** SECRET_KEY-hardening в `_validate_runtime_config` (len≥32, placeholder-denylist, entropy-guard) + тесты в `backend/tests/test_runtime_config.py`. **Оргдействие (остаётся вне кода):** revoke GigaChat-ключа у Сбера, `git filter-repo .env`, миграция на Docker secrets.
- [x] **[P0-2]** Nonce-based CSP: `frontend/src/proxy.ts` + `layout.tsx` с `nonce`. `unsafe-inline` удалён из prod `script-src`. Для `style-src` — задокументировано ограничение Next.js App Router.
- [x] **[P0-3]** CSRF double-submit cookie (`csrf_token` + `X-CSRF-Token`, `hmac.compare_digest`); `backend/tests/test_csrf.py` (8 кейсов, включая OPTIONS-preflight).
- [x] **[P0-4]** Judge-sandbox: seccomp-профиль (`judge_runner/seccomp.json`), `cap_drop ALL`, `read_only`, `no-new-privileges`, `mem_limit/memswap_limit/cpus`, `ulimits nproc/nofile`, non-root UID 1001, `judge_net internal:true`. Документация — `docs/operations/sandbox.md`.
- [x] **[P0-5]** CI на PostgreSQL 17: `.github/workflows/ci.yml` `services.postgres` + `DATABASE_URL=postgresql://...`.
- [x] **[P0-6]** Pinned digests: `# pin:` комментарии везде + `scripts/pin-images.sh` (digest-resolver) + `docs/operations/image-pinning.md` (operator playbook). Inline — оператором перед prod-деплоем.
- [x] **[P0-7]** Runner-token fail-fast: денилист (`local-dev-*`, `replace-with-*`, пустое), требование len≥32 в production, покрыто в `backend/tests/test_code_judge_security.py`.
- [x] **[P0-8]** Backup-sidecar `db-backup` (nightly `pg_dump --format=custom`, retention, SHA-256 sidecar), `scripts/backup.sh`/`restore.sh`, `docs/operations/backup.md` + `docs/operations/dr.md` (RPO 24ч/RTO 2ч).
- [x] **[P0-9]** `ProxyFix` middleware, управляется флагом `TRUST_PROXY` (default `False`); тест `test_trust_proxy_applies_forwarded_for_and_proto`.
- [x] **[P0-10]** Access-cookie revoke edge-case: тест `test_blocked_user_me_endpoint_is_rejected_after_admin_block` в `test_admin_management.py`.

#### Follow-ups за пределами P0 (перешли в P1)

- Host-level `iptables` DROP или переход на pull-queue (Redis/RabbitMQ) для runner→backend. Сейчас лишь compensating controls (auth/CSRF блокируют lateral reach).
- Inline digest'ов в `docker-compose.yml` и Dockerfile'ах оператором (playbook готов).
- `git filter-repo` на исторические коммиты с `.env` + revoke ключа у Сбера.
- Переход на strict-whitelist seccomp (сейчас allow-default + denylist опасных syscall'ов).
- Убрать `'unsafe-inline'` из `style-src` после валидации нового Next.js-подхода.
- v1.0.2 закрыл: JWT keyring, Strict SameSite, HSTS, strict Origin in production, register IP-throttle, удаление local judge fallback, PostgreSQL Docker secret и закрытие host `5432`.

#### Исторические пункты Phase 1.5 (сохранены для трассировки)

**Блокер: без этих фиксов продукт нельзя безопасно запустить даже в одной школе.**

- [P0-1] Rotate `.env` secrets: revoke GigaChat key у Sber, новый SECRET_KEY 64 hex, перенести в Docker secrets.
- [P0-1] `git filter-repo` для удаления `.env` из истории; force-push; уведомить контрибьюторов.
- [P0-2] CSP без `unsafe-inline` / `unsafe-eval`: nonce-based в Next.js 16, вынести inline-scripts в static.
- [P0-3] CSRF double-submit cookie; SameSite=Strict на refresh-cookie.
- [P0-4] Judge-sandbox hardening: nsjail / bwrap в judge-runner Dockerfile, seccomp-profile, explicit egress block (`iptables -A OUTPUT -j DROP` кроме loopback), убрать `CODE_JUDGE_ALLOW_LOCAL_FALLBACK` совсем.
- [P0-5] CI: DATABASE_URL → PostgreSQL service в GitHub Actions. Все тесты должны проходить на PG.
- [P0-6] Pinned SHA-digest для всех образов в `docker-compose.yml` и Dockerfile'ах.
- [P0-7] Bearer `CODE_JUDGE_RUNNER_TOKEN` — fail-fast с пустым/дефолтным значением (уже есть в `_validate_runtime_config`, покрыть тестом).
- [P0-8] `pg_dump` cron + retention в compose. DR-runbook в `docs/operations/dr.md`.
- [P0-9] `ProxyFix` middleware для работы за nginx.
- [P0-10] Revoke session on `User.is_active = False` — уже есть, добавить тесты на edge-case.

### Фаза 2 — Commercial pilot readiness (6–8 недель)

**Gate 2: первая платящая школа.**

- Celery + Redis интеграция. Асинхронные: judge, gigachat, email.
- SMTP-интеграция (Mailgun / Yandex.Cloud Mail): password recovery, registration confirmation, parent invite.
- OpenAPI-спецификация: генерация из flask-smorest + type generation в TypeScript.
- Sentry (Glitchtip self-hosted) для error tracking.
- Structured logging (structlog JSON) + request-ID / correlation-ID.
- Prometheus metrics + Grafana dashboard: request rate, error rate, DB query count, judge queue size.
- EULA, политика обработки ПДн, согласие на обработку при регистрации.
- Alembic migrations, stamp baseline, автогенерация новых.
- Admin audit log: полное покрытие всех мутаций роли admin/superadmin.
- Rate-limit на `register`, `refresh` через Redis (не DB).
- Password recovery (email-link с HMAC-signed one-time токеном).

### Фаза 3 — Multi-classroom + reliability (5–7 недель)

**Gate 3: 5–10 школ, подтверждение product-market-fit.**

- Redis-backed leaderboard cache, read-through pattern.
- PgBouncer перед PostgreSQL (transaction-mode).
- Read-replica PostgreSQL + streaming replication.
- SeaweedFS (или `MEDIA_ROOT` + nginx) для attachments в submissions.
- Assignment/lesson attachments: upload в submission (file ≤ 10 MB).
- Refactor oversized components: `shared-lesson-builder.tsx` → 5 меньших, `teacher-workspace.tsx` → 4 меньших.
- Refactor oversized blueprints: `student.py` → `student_dashboard.py` + `student_lessons.py` + `student_classes.py` + `student_parent.py`.
- Frontend tests: Vitest + RTL для auth-form, lesson-player, teacher-workspace.
- E2E Playwright: register → join class → complete lesson → teacher grades → student sees feedback.
- ABAC шаг 1: teacher может видеть классы только своей школы (в подготовке к multi-tenant).

### Фаза 4 — SaaS readiness (8–10 недель)

**Gate 4: self-service подписка, оплата без продажника.**

- Multi-tenant: добавить `Tenant` модель + FK на все entity; row-level security PostgreSQL **или** separate-schema-per-tenant.
- Billing: ЮКасса + webhook handler; план + grace period + суспензия.
- Self-service onboarding: публичный лендинг, регистрация школы, trial 14 дней.
- CDN для статики (Cloudflare / Yandex.Cloud).
- Background job: `tenant.provisioning` (создание schema, seed, welcome email).
- UUID PK миграция (тяжёлая, отдельный спринт).
- Disaster recovery: PITR через pgBackRest, RPO ≤ 15 min, RTO ≤ 1 h.

### Фаза 5 — Enterprise / Gov readiness (10–12 недель)

**Gate 5: продажи в корпоративный EdTech и муниципальный сегмент.**

- SSO (SAML + OIDC через Keycloak).
- Реестр Минцифры: подтверждение совместимости с Astra Linux SE 1.7+, ALT Linux p10+.
- Сертификация ФСТЭК (длительный процесс, 6–12 месяцев параллельно).
- SCORM / xAPI экспорт прогресса.
- Интеграция с 1С ХроноГраф, АвторасПросвет, ФГИС Моя школа (когда API откроется).
- ABAC шаг 2: per-school admin + school-wide teacher-mentor.
- High-availability PostgreSQL (patroni или etcd-based).
- Blue/green deploy через docker-compose (profiles) + nginx switch.

### Фаза 6 — Scale / ML-ассистент (постоянно)

- Персонализация learning-path (ML-модель на `UserProgress` данных).
- Анти-чит: детектор скопированного кода (MinHash + token-diff).
- Генерация уроков на локальной LLM (Llama 3.1 / Qwen 2.5) для школ без GigaChat-квоты.
- Классификация Task.prompt → автоматическая генерация тестов.

---

## 25. Gate-модель выхода в production


| Gate                             | Чек-лист                                                                                             | Кто апрувит              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| **Gate 1: Internal demo**        | Локальный docker compose запускается, все роли работают, unit-тесты зелёные                          | Разработчик              |
| **Gate 2: Commercial pilot**     | Фаза 1.5 + Фаза 2 DONE. DR-drill проведён, RTO ≤ 4h. Pen-test passed. EULA подписан первым клиентом. | CTO + юрист              |
| **Gate 3: Multi-classroom prod** | Фаза 3 DONE. Observability live. 5+ школ на staging 2 недели без P0-инцидентов.                      | CTO                      |
| **Gate 4: Self-service SaaS**    | Фаза 4 DONE. Billing tested end-to-end (trial → paid → suspension → reactivation). ПДн-аудит.        | CTO + юрист + SRE        |
| **Gate 5: Gov/Enterprise**       | Фаза 5 DONE. Реестр Минцифры. Сертификация ФСТЭК (или SLA-гарантия до сертификации).                 | CTO + compliance officer |


### 25.1. Обязательные exit-criteria для Gate 2

1. **Security:** pen-test от внешнего подрядчика, zero HIGH/CRITICAL CVE в trivy scan, script-CSP на nonce/strict-dynamic, CSRF/Origin/SameSite tests зелёные.
2. **Reliability:** 30 дней на staging без data loss, DR drill пройден (restore в < 4h), health-checks реалистичные.
3. **Compliance:** EULA, ПДн-политика, согласие, локальность данных (для on-prem — гарантирована, для SaaS — РФ-хостинг).
4. **Observability:** Sentry собирает errors, Grafana-dashboard public, on-call контакт определён.
5. **Documentation:** operations runbook (установка, обновление, DR), user manual (teacher, admin), API-docs (OpenAPI).
6. **Testing:** coverage ≥ 60% backend, ≥ 40% frontend, e2e happy-path зелёный в каждом CI-запуске.

---

## 26. Итоговые принципы архитектуры v1.0


| Принцип                                                    | Решение в v1.0 / v1.5                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Enforcement, не декларация**                             | Каждый P0-дефект закрывается тестом: runner-bearer, CSP-header, CSRF-double-submit, immutable-runner-sandbox.                             |
| **Single-host single-school для пилота**                   | Один docker-compose = один клиент. Multi-tenant — осознанно отложен до Фазы 4.                                                            |
| **Изоляция кода ученика через defense-in-depth**           | Docker read_only + cap_drop + pids_limit + tmpfs + nsjail (v1.5) + seccomp + egress-block + RLIMIT. Ни один из слоёв не доверяет другому. |
| **Stateless backend, state в PG/Redis**                    | Сессия в HttpOnly-cookie + session_version counter. Никаких in-process session-store, кроме leaderboard-cache (исправляется в v1.5).      |
| **Session-version revocation для JWT**                     | Блокировка пользователя = bump `session_version` = мгновенная инвалидация всех active access-token'ов.                                    |
| **Throttle в PostgreSQL (v1.0) → Redis (v1.5)**            | DB-level rate-limit детерминистичен, но дорог. Redis INCR+EXPIRE — целевое решение при > 100 RPS login.                                   |
| **API-proxy через Next.js**                                | Единый origin, простые CORS, slot для edge-middleware. Trade-off — удвоенный I/O, приемлемо.                                              |
| **Custom migrations → Alembic**                            | v1.0 — минимальный runner, v1.5 — Alembic. Baseline сохраняется через `stamp`.                                                            |
| **Синхронный API → Celery async**                          | Всё, что зависит от внешнего сервиса (GigaChat, judge-runner, SMTP), переходит в Celery в Фазе 2.                                         |
| **CSP без unsafe-* для script-src**                        | Закрыто v1.0.2: nonce + strict-dynamic в production; `style-src unsafe-inline` остаётся documented Next/React follow-up.                  |
| **CSRF double-submit cookie + strict Origin**               | Закрыто v1.0.2: double-submit, SameSite=Strict, unsafe no-Origin reject в production, Next proxy origin-forwarding.                       |
| **Pinned SHA-digest на все образы**                        | Reproducibility + supply-chain. Обязательно для Gate 2.                                                                                   |
| **Backups = часть архитектуры, не deployment'а**           | `pg_dump` сервис в compose.yml, retention 14 дней, weekly restore drill.                                                                  |
| **Observability обязательна до первой продажи**            | Sentry + structured logs + Prometheus. В pilot-школе мы должны диагностировать инцидент за минуты, не часы.                               |
| **Тесты на PostgreSQL**                                    | Не SQLite. JSONB, UniqueConstraint с IS NULL, concurrent updates — ловятся только на реальной БД.                                         |
| **OpenAPI как single source of truth**                     | Frontend types генерируются из backend'а, не поддерживаются вручную. Дрейф контрактов исключается на уровне CI.                           |
| **Minimal viable multi-tenant как опция, не default**      | v1.0–v1.5 остаётся single-school. Multi-tenant — тяжёлая миграция, делать только когда есть > 10 клиентов.                                |
| **GSAP → Framer Motion если используются платные плагины** | Аудит обязателен до Gate 2. Альтернатива бесплатна.                                                                                       |
| **Breakeven реалистичен на горизонте 2.5–3 года**          | При фокусе на Pro/Pro+ сегмент (частные и онлайн-школы), 35–65 клиентов. Муниципальный — отдельный, долгий путь.                          |


---

## 27. Итоговая production-ready стратегия

Платформа Progyx (ProgHUB) в текущей версии **v1.0 / v1.0.2 (pre-alpha)** представляет собой функционально богатый прототип: реализованы все основные сценарии ученика, учителя, администратора, **полноценный родительский кабинет** (parent-роль, ParentChildLink, безопасность, согласия, parent↔teacher-чат), **system косметики** (аватары/рамки/темы за XP с механикой покупки), **staff-прямые-чаты** (admin↔teacher), **SiteActivityLog** (per-request API trail), **teacher approval workflow**, **Redis в стеке** (throttle dual-mode, session_version cache), расширенный CI с Redis-интеграцией. Работает автопроверка кода в изолированном контейнере, мессенджер, AI-ассистент, описаны 12 миграций, работает CI из 4 job'ов.

**Апдейт v1.0.1 (P0-фикс-спринт):** все **десять P0-блокеров** закрыты на уровне кода, конфигурации, тестов и документации — SECRET_KEY-hardening, nonce-based CSP, CSRF double-submit, seccomp + ulimits + non-root для judge-runner, PostgreSQL-CI, image-pinning playbook, runner-token denylist, pg_dump backup-sidecar + DR-runbook, ProxyFix middleware, access-cookie session revoke.

**Апдейт v1.0.2 (security hardening, GigaChat excluded):** закрыты оставшиеся code/config уязвимости: JWT key rotation (`kid` + keyring), Strict SameSite + production fail-fast, HSTS/X-Permitted-Cross-Domain-Policies, production reject unsafe requests without `Origin`, Next proxy origin-forwarding, IP-level register throttle, удаление local judge fallback, PostgreSQL Docker secret + закрытый host port `5432`.

**Функциональное расширение (post v1.0.2):** добавлены parent cabinet (migration 0009), staff direct messaging (0010), site activity log (0011), cosmetics system (0012), teacher approval workflow (0007-0008), phone field (0006). Стек расширен Redis 7 (обязательный сервис). CI расширен job'ом `backend-redis-integration`. Тест-покрытие: 16 файлов, ~150+ KB.

Остаются **оргдействия** (GigaChat-ключ намеренно исключён из scope, `git filter-repo`, inline digest'ов, host-level iptables для runner-egress) и **P1/P2 reliability/product debt** (observability, Alembic, leaderboard Redis-cache, Celery/email, audit-log completeness, e2e/frontend tests). Оценочный объём оставшихся работ — **одна фаза 2 (6–8 недель)** для P1 до уровня **Gate 2 — первая коммерческая поставка**.

После Gate 2 продукт готов к пилотным поставкам в частные школы и центры доп. образования с тарифами 30–90 тыс. ₽/школа/год. Прибыльность для соло-разработчика реалистична на горизонте 2.5–3 года при фокусе на сегмент Pro/Pro+ (частные школы, EdTech-онлайн-школы).

Ключевые архитектурные риски, за которые платформа должна отвечать до первой продажи:

1. **Безопасность кода ученика.** Defense-in-depth (nsjail + seccomp + egress-block + RLIMIT + read_only + cap_drop + namespace) обязателен, каждый слой тестируется отдельно.
2. **Сохранность данных.** `pg_dump` + rsync + weekly drill — минимум, без которого лицензионное соглашение не должно подписываться.
3. **Стабильность инфраструктуры.** Observability + health-checks + on-call контакт + blue/green deploy — уровень, соответствующий ожиданиям школы.
4. **Юридическая чистота.** EULA, политика ПДн, договор processor'а с оператором, явная резидентность данных.
5. **Лицензионная чистота third-party.** Аудит GSAP-плагинов обязателен. GigaChat-риски намеренно исключены из v1.0.2 scope; план B — замена на локальную модель.

**Финальная рекомендация:** переход в статус commercial pilot возможен за 9–13 недель целенаправленной работы (Фазы 1.5 + 2) при условии соло-разработчика, или за 5–7 недель при команде из 2–3 человек. Продукт существенно богаче относительно исходного v1.0 за счёт новых систем (parent cabinet, cosmetics, staff messaging, activity log). Все изменения описаны конкретно, с предложенными code-патчами, и не требуют переписывания архитектуры — только её достройки до production-grade уровня.

*Конец документа*

---

*Архитектурный документ подготовлен как результат полного аудита репозитория `ProgHUB-pre_alfa`. Последнее обновление: апрель 2026 (отражает фактическое состояние кодовой базы: 12 миграций, Redis в стеке, 5 ролей, parent cabinet, cosmetics, staff direct messaging, SiteActivityLog, teacher approval, 16 тест-файлов, 4 CI job'а). Документ предназначен для CTO-review, инвестора, технической защиты проекта, а также для подготовки к первой коммерческой поставке.*
