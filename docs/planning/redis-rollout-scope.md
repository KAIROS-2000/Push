# Redis — карта охвата внедрения (ProgHUB / Progyx)

**Дата:** 2026-04-25

Карта callsite'ов для shared-cache, throttling, OAuth GigaChat, флагов обслуживания и инфраструктуры. Пути относительно корня репозитория.

---

## Лидерборд

| Файл | Строки (прибл.) | Роль / адаптация |
|------|-----------------|------------------|
| `backend/app/api/student.py` | 71–77 | Константы кеша, `_global_leaderboard_cache` — Redis read-through + in-process fallback. |
| `backend/app/api/student.py` | 79–88 | `_leaderboard_row` — сериализация строки, без изменений контракта. |
| `backend/app/api/student.py` | 107–131 | `_global_leaderboard_rows` — hit/miss Redis, TTL = `GLOBAL_LEADERBOARD_REFRESH_INTERVAL`. |
| `backend/app/api/student.py` | 134–146 | `_class_leaderboard_rows` — по классу, при необходимости только БД (без глобального in-process). |
| `backend/app/api/student.py` | 947–991 | `GET /leaderboard` — ответ и `refresh_seconds` без изменения контракта. |
| `backend/tests/test_api_contracts.py` | ~202–269 | Контракт глобального лидерборда. |

**Примечание:** символа `_ensure_global_leaderboard` в репозитории нет; агрегация — `_global_leaderboard_rows`.

---

## Версия сессии (`session_version`)

| Файл | Строки (прибл.) | Роль / адаптация |
|------|-----------------|------------------|
| `backend/app/models/user.py` | 39, 52–54 | Колонка `session_version`, `bump_session_version()`. |
| `backend/app/core/security.py` | 213–245 | `create_token_pair` — встраивание версии в JWT. |
| `backend/app/core/security.py` | 280–292 | `_payload_session_version`, `token_matches_user_session`. |
| `backend/app/core/security.py` | 432–455 | `auth_required` — загрузка `User`, проверка `token_matches_user_session`; ранний выход по Redis при рассинхроне. |
| `backend/app/api/auth.py` | 99, 125–160 | Регистрация/логин/refresh — выдача и проверка токенов. |
| `backend/app/api/admin.py` | 308–310, 609–611 | Блокировка — `bump_session_version`; инвалидация кеша Redis. |

Отдельного session-middleware нет: CORS/CSRF в `backend/app/__init__.py`.

---

## SecurityThrottle (PostgreSQL сегодня)

| Файл | Строки (прибл.) | Роль / адаптация |
|------|-----------------|------------------|
| `backend/app/models/user.py` | 150–168 | Модель `SecurityThrottle`, уникальность `(scope, subject, ip_address)`. |
| `backend/app/core/security.py` | 25–27, 95–210 | Скоупы, `_throttle_record`, `throttle_allowed`, `register_throttle_failure`, обёртки login/parent. |
| `backend/app/api/auth.py` | 109–135 | Логин — throttle; **регистрация** — добавить throttle (P1-8). |
| `backend/app/api/auth.py` | 139–166 | **Refresh** — добавить throttle (P1-8). |
| `backend/app/api/student.py` | 1170–1187 | `parent_access` — throttle. |
| `backend/app/core/config.py` | 79–84 | Окна/лимиты login и parent_access; расширить для register/refresh. |
| `.env.example` | 17–22 | Документация лимитов. |
| `backend/tests/test_security.py` | ~138–192 | Лимиты входа и parent access. |

**Миграция 0007:** в репозитории не обязательна для dual-write; индексы под `(scope, subject, ip)` уже покрыты уникальным ограничением. При нагрузочных `EXPLAIN` — отдельное решение.

---

## GigaChat (in-process токен)

| Файл | Строки (прибл.) | Роль / адаптация |
|------|-----------------|------------------|
| `backend/app/core/gigachat.py` | 32–33, 119–163 | `_token_lock`, `_token_cache`, `_get_access_token` — общий токен в Redis при доступности. |
| `backend/app/api/student.py` | 677–703 | Маршрут GigaChat. |

---

## Валидация конфигурации

| Файл | Строки (прибл.) | Роль / адаптация |
|------|-----------------|------------------|
| `backend/app/__init__.py` | 102–139 | `_validate_runtime_config` — в production обязательны Redis URL и сильный пароль. |
| `backend/app/core/config.py` | весь файл | `REDIS_*`, feature-flags, лимиты refresh/register. |
| `backend/tests/test_runtime_config.py` | весь файл | Тесты новых правил Redis. |

---

## Инфраструктура и CI

| Файл | Роль / адаптация |
|------|------------------|
| `docker-compose.yml` | Сервис `redis` только в `backend_net`, secrets, без публикации порта. |
| `.github/workflows/ci.yml` | Сервис Redis + job с интеграционными флагами; job без Redis для graceful degrade. |
| `.env.example` | Переменные Redis (без реальных секретов). |
| `secrets/redis_password.example` | Шаблон для dev/prod secret-файла. |

---

## Режим обслуживания и health

| Файл | Строки (прибл.) | Роль / адаптация |
|------|-----------------|------------------|
| `backend/app/__init__.py` | 215–217 | `GET /api/health` — расширение проверкой Redis (таймаут ~100ms). |
| `backend/app/__init__.py` | `before_request` | Чтение флага maintenance из Redis (локальный TTL-кеш 5 с). |

---

## Следующие шаги (вне этого тикета)

- Celery broker/result на Redis (§8.2).
- SSR cache Next.js `@neshca/cache-handler` (§20.2).
- Redis HA / Sentinel (фаза 3).
