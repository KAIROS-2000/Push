# Кодиумс Fullsite v3

Полноценный fullstack‑сайт для обучения программированию по методичке Кодиумс и вашим уточнениям по ролям.

## Что реализовано

- регистрация и вход с JWT access + refresh
- роли: `student`, `teacher`, `admin`, `superadmin`
- суперадмин создаётся автоматически при старте по `.env`
- ученик: dashboard, roadmap, уроки, теория, практика, мини‑тесты, достижения, рейтинг, вступление в класс
- teacher workflow: создание классов, назначение заданий, просмотр учеников, проверка сдач
- teacher practice builder: ручная проверка, авто‑проверка по ключевым словам и настоящие автотесты для `Python`/`JavaScript`
- админ: просмотр пользователей, создание модулей, публикация и снятие с публикации
- суперадмин: создание, блокировка, разблокировка и удаление обычных админов
- родительский кабинет по семейной ссылке-приглашению
- смешанные тесты: single choice, multiple choice, ordering, matching
- красивый roadmap в стиле path‑based learning: крупные пунсоны-узлы соединены линией, состояния уроков видны визуально
- Docker Compose для фронтенда, бэкенда, PostgreSQL и изолированного `judge-runner`

## Актуальный стек

- Backend: Flask + Flask-SQLAlchemy + PostgreSQL + PyJWT
- Frontend: Next.js + React + Tailwind CSS + GSAP
- Учебные инструменты: Monaco Editor, текстовые и кодовые практики

## Быстрый старт

```bash

cp .env.example .env

docker compose up --build
```

После запуска:

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api
- `judge-runner` поднимается внутри Docker-сети и не публикует порт наружу

## Production режим

- по умолчанию проект запускается в production-конфигурации:
  - `APP_ENV=production`
  - `ENABLE_DEMO_DATA=false`
- фронтенд в Docker собирается через `next build` и запускается через `next start`
- backend стартует без `debug` режима (`FLASK_DEBUG=0`)
- если в `APP_ENV=production` оставлен слабый `SECRET_KEY` (`dev-secret-key` или `super-secret-key-change-me`), backend завершит запуск с ошибкой

## Автопроверка кода

- в конструкторе teacher-урока для практики можно выбрать:
- `Ручная проверка`
- `Авто по ориентирам` для текстовых ответов
- `Автотесты` для консольных задач на `Python` и `JavaScript`
- режим `Автотесты` ожидает программу, которая читает из `stdin` и пишет результат в `stdout`
- в `docker compose` backend отправляет код в отдельный сервис `judge-runner`
- runner запускает код в собственной временной директории, с таймаутом, лимитом памяти и сокращённым окружением
- backend может использовать локальный fallback только если это явно разрешено через `CODE_JUDGE_ALLOW_LOCAL_FALLBACK=true`

Поддерживаемые настройки `.env`:

```env
CODE_JUDGE_PYTHON_BIN=python
CODE_JUDGE_NODE_BIN=node
CODE_JUDGE_DEFAULT_TIME_LIMIT_MS=2000
CODE_JUDGE_DEFAULT_MEMORY_LIMIT_MB=128
CODE_JUDGE_MAX_OUTPUT_CHARS=4000
CODE_JUDGE_RUNNER_TIMEOUT_MS=15000
CODE_JUDGE_ALLOW_LOCAL_FALLBACK=true
```

## Тестовые данные (только для локальной проверки)

Если нужно поднять демо-аккаунты и тестовые сценарии, добавьте в `.env`:

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

Тогда будут доступны сценарии:

- вход под тестовыми пользователями выше
- вступление ученика в класс по коду `CLASS5B`
- родительский кабинет по адресу `/parent/PAR-DEMO2026`

## Структура

```text
backend/
  app/
    api/        # auth, student, teacher, admin
    core/       # config, db, security, gamification
    models/     # users, modules, lessons, assignments, invites, progress
    seed/       # автосоздание суперадмина и учебного контента
frontend/
  src/app/      # страницы App Router
  src/components/
  src/lib/
```

## Ключевые маршруты API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/dashboard`
- `GET /api/modules`
- `GET /api/lessons/<id>`
- `POST /api/tasks/<id>/submit`
- `POST /api/quizzes/<id>/submit`
- `POST /api/classes/join`
- `POST /api/parent/invite`
- `GET /api/parent/access/<code>`
- `GET /api/teacher/classes`
- `POST /api/teacher/classes/<id>/assignments`
- `PATCH /api/teacher/submissions/<id>/grade`
- `GET /api/admin/overview`
- `POST /api/admin/admins`
- `PATCH /api/admin/admins/<id>/block`
- `DELETE /api/admin/admins/<id>`

## Что можно доработать дальше

- более умная проверка текстовых ответов
- песочница исполнения Python/JS в Web Worker
- отдельный профиль‑редактор с аватарами и dark mode
- звуки, confetti, daily chest, weekly leaderboard reset
- миграции Alembic и e2e‑тесты
