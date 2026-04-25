# Redis в ProgHUB (shared cache / throttle / подготовка к Celery)

## Роль сервиса

- Общий кеш между воркерами gunicorn: глобальный лидерборд, версия сессии (опционально), OAuth access token GigaChat.
- Первичный слой rate limiting (`SecurityThrottle`) при `THROTTLE_BACKEND=redis|dual` с записью в PostgreSQL для истории и fallback.
- Флаг технического обслуживания (`flags:maintenance`) без рестарта приложения.
- Резерв под брокер и result backend Celery (БД 3 и 4) — в текущем тикете Celery не подключается.

## Сеть

Redis подключается только к `backend_net`. Сервис `judge-runner` остаётся в изолированной `judge_net` и не имеет доступа к Redis.

## Нумерация логических БД (Redis `SELECT`)

| DB | Назначение |
|----|------------|
| 0 | Кеш: лидерборд, GigaChat OAuth payload |
| 1 | Кеш `session_version` по `user_id` |
| 2 | Throttle (INCR/EXPIRE) |
| 3 | Зарезервировано: брокер Celery |
| 4 | Зарезервировано: result backend Celery |

База задаётся суффиксом в `REDIS_URL` (например `.../0`) или отдельными URL для разных подсистем — в коде используется один хост и разные номера БД через клиентский параметр `db`.

## Префиксы ключей

Формат: `progyx:<env>:<domain>:...`, где `<env>` — нормализованный `APP_ENV` (например `production`, `development`).

Примеры:

- `progyx:production:leaderboard:global:all`
- `progyx:production:leaderboard:global:middle`
- `progyx:production:session_ver:<user_id>`
- `progyx:production:throttle:<scope>:<hash>:<hash>`
- `progyx:production:gigachat:oauth`
- `progyx:production:flags:maintenance`

В ключах не хранятся сырые JWT, email, IP-адреса и прочие PII: для throttle используются хеш-фрагменты (в т.ч. канонический IP через `ipaddress` → SHA-256).

## TTL

| Данные | TTL / политика |
|--------|----------------|
| Лидерборд глобальный | `GLOBAL_LEADERBOARD_REFRESH_INTERVAL` (например 5 минут) |
| `session_version` | 30 секунд |
| Throttle | Окно и блокировка из конфигурации (`*_RATE_LIMIT_*`) |
| GigaChat token | По `expires_at` от провайдера, с запасом до refresh |
| Флаг maintenance | Без TTL на стороне Redis — актуальность; приложение кеширует чтение 5 с |

## Feature flags

| Переменная | Значения | Поведение |
|------------|----------|-----------|
| `THROTTLE_BACKEND` | `redis`, `db`, `dual` (по умолчанию `dual`) | Источник лимитов и dual-write в БД. |
| `SESSION_VERSION_CACHE` | `redis`, `off` | Кеш версии сессии; в production рекомендуется `redis`. |

## Production

- `REDIS_URL` обязателен, пароль в URL или через `REDIS_PASSWORD` / `REDIS_PASSWORD_FILE`.
- Пароль не короче 24 символов, без placeholder-подстрок (как для `SECRET_KEY`).
- В `docker-compose` пароль читается из Docker secret `redis_password` (файл в контейнере: `/run/secrets/redis_password`) и передаётся в `redis-server --requirepass` через оболочку. Директива `requirepass-file` **не** поддерживается в Redis 7.4.x (см. комментарий в `docker-compose.yml`).

## Dev / fallback

- Если Redis недоступен или `REDIS_URL` не задан: приложение стартует; лидерборд — in-process; throttle — PostgreSQL; GigaChat — per-process lock; maintenance и session-version cache отключены на чтении Redis.

## Observability

- При сбоях подключения логи **не спамятся**: предупреждения rate-limited (интервал порядка 30 с), пароль не логируется.
- Метрики (план): `INFO`, `SLOWLOG GET`, задержка ping в ответе `/api/health` при включённом Redis.

## Backup

- Данные в Redis для ProgHUB в основном восстановимы (кеш, throttle, token). Снэпшот RDB опционален; для строгого RPO — политика на уровне оркестратора.

## Runbook: «Redis недоступен»

1. Проверить `docker compose ps` / health контейнера `redis`.
2. Проверить секрет пароля и монтирование `/run/secrets/redis_password`.
3. Убедиться, что backend в `backend_net` резолвит хост `redis`.
4. При деградации API должен отвечать 200 на основные GET при отказе кеша; throttling уходит в PostgreSQL.
5. После восстановления Redis — без рестарта backend: соединения восстанавливаются lazy/ping.

## Failure modes

| Сценарий | Эффект |
|----------|--------|
| Timeout ping | `redis_available()` кеширует отрицательный результат на 5 с |
| Ошибка записи throttle в Redis | В режиме `dual` учитывается БД; запись в Redis best-effort |
| Потеря ключей | Кеш прогревается заново; throttle в БД сохраняет историю |
