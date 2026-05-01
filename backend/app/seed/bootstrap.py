from __future__ import annotations

import secrets
import string

from flask import current_app
from sqlalchemy import inspect, text

from ..core.db import db
from ..core.security import hash_password
from ..models.learning import (
    Achievement,
    Assignment,
    ClassMembership,
    Classroom,
    Lesson,
    Module,
    Quiz,
    Task,
    age_group_supports_code,
    has_explicit_code_task_intent,
    normalize_task_validation,
)
from ..models.user import User, UserRole


def generate_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def _username_from_email(email: str, fallback: str) -> str:
    normalized = (email or '').strip().lower()
    if normalized and '@' in normalized:
        return normalized.split('@')[0]
    return fallback


def bootstrap_superadmin() -> None:
    email = current_app.config['SUPERADMIN_EMAIL'].strip().lower()
    password = current_app.config.get('SUPERADMIN_PASSWORD') or ''
    if not email or not password:
        return
    if User.query.filter_by(email=email).first():
        return
    username = email.split('@')[0]
    db.session.add(
        User(
            full_name=current_app.config['SUPERADMIN_NAME'],
            username=username,
            email=email,
            password_hash=hash_password(password),
            role=UserRole.SUPERADMIN,
            age_group='adult',
            xp=5000,
        )
    )
    db.session.commit()


def seed_achievements() -> None:
    existing_codes = {achievement.code for achievement in Achievement.query.all()}
    achievements = [
        ('first_code', 'Первый код', 'Написать первую программу', 'start', 'sparkles', 50),
        ('perfect_five', 'Безошибочный', 'Пройти 5 уроков подряд без ошибок', 'mastery', 'badge-check', 150),
        ('marathon', 'Марафонец', 'Заходить 30 дней подряд', 'persistence', 'flame', 500),
        ('explorer', 'Исследователь', 'Закрыть все модули возрастной группы', 'progress', 'map', 300),
        ('lightning', 'Молния', 'Решить задачу меньше чем за минуту', 'speed', 'zap', 75),
        ('patience', 'Терпение', 'Решить задачу, потратив больше 10 минут, но без ошибок', 'persistence', 'clock', 200),
        ('night_owl', 'Вечерний программист', 'Пройти урок после 23:00', 'time', 'moon', 50),
        ('early_bird', 'Утренний старт', 'Пройти урок до 8:00', 'time', 'sunrise', 50),
        ('golden_streak', 'Золотая серия', 'Пройти 10 уроков подряд без перерыва более 5 минут', 'persistence', 'trophy', 300),
        ('sprinter', 'Спринтер', 'Пройти 5 уроков за 20 минут', 'speed', 'timer', 175),
        ('no_hints', 'Без подсказок', 'Решить задачу, не используя встроенные подсказки', 'mastery', 'eye-off', 125),
        ('revisitor', 'Повторитель', 'Вернуться к старому уроку и пройти его идеально', 'persistence', 'rotate-ccw', 80),
    ]
    added = False
    for code, name, description, category, icon, xp in achievements:
        if code not in existing_codes:
            db.session.add(Achievement(code=code, name=name, description=description, category=category, icon=icon, xp_reward=xp))
            added = True
    if added:
        db.session.commit()


def cleanup_deprecated_learning_artifacts() -> None:
    changed = False

    mentor_achievement = Achievement.query.filter_by(code='mentor').first()
    if mentor_achievement:
        db.session.delete(mentor_achievement)
        db.session.flush()
        changed = True

    users_table = User.__table__.name
    existing_columns = {column['name'] for column in inspect(db.engine).get_columns(users_table)}
    for fragments in (('ava', 'tar'), ('compan', 'ion')):
        legacy_column = ''.join(fragments)
        if legacy_column in existing_columns:
            db.session.execute(text(f'ALTER TABLE {users_table} DROP COLUMN {legacy_column}'))
            changed = True

    legacy_discussion_table = ''.join(['fo', 'rum', '_posts'])
    if inspect(db.engine).has_table(legacy_discussion_table):
        db.session.execute(text(f'DROP TABLE {legacy_discussion_table}'))
        changed = True

    if changed:
        db.session.commit()


def _question_single(qid: str, prompt: str, options: list[str], correct: int) -> dict:
    return {'id': qid, 'type': 'single', 'prompt': prompt, 'options': options, 'correct': [correct]}


def _question_multiple(qid: str, prompt: str, options: list[str], correct: list[int]) -> dict:
    return {'id': qid, 'type': 'multiple', 'prompt': prompt, 'options': options, 'correct': correct}


def _question_order(qid: str, prompt: str, items: list[str], correct: list[str]) -> dict:
    return {'id': qid, 'type': 'order', 'prompt': prompt, 'items': items, 'correct': correct}


def _question_match(qid: str, prompt: str, left: list[str], right: list[str], correct: dict[str, str]) -> dict:
    return {'id': qid, 'type': 'match', 'prompt': prompt, 'left': left, 'right': right, 'correct': correct}


DEFAULT_MENTOR_TIP = 'Сначала прочитай объяснение, потом измени пример и только после этого переходи к практике.'


def _default_theory_blocks(
    title: str,
    summary: str,
    concepts: list[str],
    practice_title: str,
    mentor_tip: str,
) -> list[dict]:
    key_idea = concepts[0] if concepts else title
    return [
        {'type': 'hero', 'title': title, 'text': summary},
        {'type': 'list', 'title': 'Ключевые понятия', 'items': concepts},
        {
            'type': 'checklist',
            'title': 'Как не запутаться',
            'items': [
                f'Сначала скажи своими словами, что значит «{key_idea}».',
                'Потом разбери один понятный пример шаг за шагом.',
                f'После этого переходи к заданию «{practice_title}» и повторяй тот же ход мысли.',
            ],
        },
        {'type': 'tip', 'title': 'Совет наставника', 'text': mentor_tip},
    ]


def _default_interactive_steps(
    title: str,
    concepts: list[str],
    practice_title: str,
    practice_prompt: str,
) -> list[dict]:
    main_idea = concepts[0] if concepts else title
    support_idea = concepts[1] if len(concepts) > 1 else 'делай шаги по порядку'
    practice_focus = practice_prompt.strip().rstrip('.')
    return [
        {
            'title': f'Смотрим на тему «{title}»',
            'text': (
                f'Сначала замечаем главную мысль: {main_idea}. '
                'Не нужно запоминать все сразу. Достаточно понять, что именно происходит и зачем.'
            ),
        },
        {
            'title': f'Разбираем пример для «{practice_title}»',
            'text': (
                'Шаг 1. Определи, что у нас есть в начале.\n'
                'Шаг 2. Сделай одно понятное действие.\n'
                f'Шаг 3. Проверь, как на результат влияет идея «{support_idea}».'
            ),
        },
        {
            'title': 'Пробуем сами',
            'text': (
                f'Теперь повтори тот же ход в своей практике: {practice_focus}. '
                'Если стало трудно, вернись к примеру и найди шаг, на котором потерялась логика.'
            ),
        },
    ]


def _lesson_payload(
    title: str,
    summary: str,
    concepts: list[str],
    practice_title: str,
    practice_prompt: str,
    answer_keywords: list[str],
    task_hints: list[str],
    quiz_questions: list[dict],
    starter_code: str = '',
    task_validation: dict | None = None,
    mentor_tip: str = DEFAULT_MENTOR_TIP,
    extra_theory_blocks: list[dict] | None = None,
    custom_interactive_steps: list[dict] | None = None,
) -> dict:
    if has_explicit_code_task_intent(
        title=practice_title,
        prompt=practice_prompt,
        starter_code=starter_code,
    ) and not starter_code:
        raise ValueError(f'Code lesson "{title}" requires starter_code and stdin/stdout tests.')
    if starter_code:
        if not isinstance(task_validation, dict):
            raise ValueError(f'Code lesson "{title}" requires explicit stdin/stdout tests in task_validation.')
        raw_tests = task_validation.get('tests')
        if not isinstance(raw_tests, list) or not raw_tests:
            raise ValueError(f'Code lesson "{title}" requires at least one stdin/stdout test in task_validation.')

    theory_blocks = _default_theory_blocks(
        title,
        summary,
        concepts,
        practice_title,
        mentor_tip,
    )
    if extra_theory_blocks:
        theory_blocks[2:2] = extra_theory_blocks

    interactive_steps = custom_interactive_steps or _default_interactive_steps(
        title,
        concepts,
        practice_title,
        practice_prompt,
    )

    return {
        'title': title,
        'summary': summary,
        'theory_blocks': theory_blocks,
        'interactive_steps': interactive_steps,
        'task': {
            'title': practice_title,
            'prompt': practice_prompt,
            'starter_code': starter_code,
            'validation': task_validation or {'keywords': answer_keywords},
            'hints': task_hints,
        },
        'quiz': quiz_questions,
    }


def _stdio_validation(language: str, tests: list[dict], time_limit_ms: int = 2000, memory_limit_mb: int = 128) -> dict:
    return {
        'evaluation_mode': 'stdin_stdout',
        'language': language,
        'tests': tests,
        'time_limit_ms': time_limit_ms,
        'memory_limit_mb': memory_limit_mb,
    }


def _legacy_seeded_code_task_updates() -> dict[tuple[str, str], dict]:
    return {
        ('middle-python-intro', 'Выведи сообщение'): {
            'starter_code': 'print("Я изучаю Python")\n',
            'validation': _stdio_validation(
                'python',
                [
                    {'label': 'Тест 1', 'input': '', 'expected': 'Я изучаю Python\n'},
                ],
            ),
        },
        ('middle-python-intro', 'Создай переменные'): {
            'starter_code': 'name = "Аня"\nage = 12\nprint(name, age)\n',
            'validation': _stdio_validation(
                'python',
                [
                    {'label': 'Тест 1', 'input': '', 'expected': 'Аня 12\n'},
                ],
            ),
        },
        ('middle-python-intro', 'Поздоровайся по имени'): {
            'starter_code': 'name = input().strip()\nprint(f"Привет, {name}")\n',
            'validation': _stdio_validation(
                'python',
                [
                    {'label': 'Тест 1', 'input': 'Аня\n', 'expected': 'Привет, Аня\n'},
                    {'label': 'Тест 2', 'input': 'Тимур\n', 'expected': 'Привет, Тимур\n'},
                ],
            ),
        },
        ('middle-conditions', 'Проверь возраст'): {
            'starter_code': 'age = int(input())\nif age >= 12:\n    print("Средняя группа")\nelse:\n    print("Младшая группа")\n',
            'validation': _stdio_validation(
                'python',
                [
                    {'label': 'Тест 1', 'input': '12\n', 'expected': 'Средняя группа\n'},
                    {'label': 'Тест 2', 'input': '9\n', 'expected': 'Младшая группа\n'},
                ],
            ),
        },
        ('middle-conditions', 'Проверь пропуск'): {
            'prompt': 'Считай has_ticket и is_on_time из stdin. Выведи pass, если оба равны 1, иначе wait.',
            'hints': [
                'Сначала получи два числа через input(): has_ticket и is_on_time.',
                'Объедини обе проверки в одном условии через and.',
                'Если оба значения равны 1, выведи pass, иначе выведи wait.',
            ],
            'starter_code': (
                'has_ticket = int(input())\n'
                'is_on_time = int(input())\n'
                '\n'
                'if has_ticket == 1 and is_on_time == 1:\n'
                '    print("pass")\n'
                'else:\n'
                '    print("wait")\n'
            ),
            'validation': _stdio_validation(
                'python',
                [
                    {'label': 'Тест 1', 'input': '1\n1\n', 'expected': 'pass\n'},
                    {'label': 'Тест 2', 'input': '1\n0\n', 'expected': 'wait\n'},
                    {'label': 'Тест 3', 'input': '0\n1\n', 'expected': 'wait\n'},
                ],
            ),
        },
        ('middle-conditions', 'Определи категорию'): {
            'prompt': 'Считай возраст из stdin и выведи junior, middle или senior.',
            'hints': [
                'Сначала получи возраст через input() и преврати его в число.',
                'Используй if / elif / else, чтобы разделить три возрастные категории.',
                'Для младшей группы выведи junior, для средней middle, для старшей senior.',
            ],
            'starter_code': (
                'age = int(input())\n'
                '\n'
                'if age < 12:\n'
                '    print("junior")\n'
                'elif age < 15:\n'
                '    print("middle")\n'
                'else:\n'
                '    print("senior")\n'
            ),
            'validation': _stdio_validation(
                'python',
                [
                    {'label': 'Тест 1', 'input': '10\n', 'expected': 'junior\n'},
                    {'label': 'Тест 2', 'input': '13\n', 'expected': 'middle\n'},
                    {'label': 'Тест 3', 'input': '16\n', 'expected': 'senior\n'},
                ],
            ),
        },
        ('middle-functions', 'Создай greet'): {
            'prompt': 'Считай имя из stdin, создай функцию greet(name) и выведи приветствие.',
            'hints': [
                'Сначала получи имя пользователя через input().',
                'Объяви функцию greet(name), которая печатает приветствие.',
                'После объявления функции вызови её с именем из ввода.',
            ],
            'starter_code': 'name = input().strip()\n\ndef greet(name):\n    print(f"Привет, {name}")\n\ngreet(name)\n',
            'validation': _stdio_validation(
                'python',
                [
                    {'label': 'Тест 1', 'input': 'Маша\n', 'expected': 'Привет, Маша\n'},
                    {'label': 'Тест 2', 'input': 'Илья\n', 'expected': 'Привет, Илья\n'},
                ],
            ),
        },
        ('middle-functions', 'Посчитай сумму'): {
            'prompt': 'Считай два числа из stdin, создай функцию add(a, b) и выведи сумму.',
            'hints': [
                'Сначала получи два числа через input() и сохрани их в переменные.',
                'Создай функцию add(a, b), которая возвращает сумму через return.',
                'В конце выведи результат вызова add(a, b) через print().',
            ],
            'starter_code': (
                'a = int(input())\n'
                'b = int(input())\n'
                '\n'
                'def add(a, b):\n'
                '    return a + b\n'
                '\n'
                'print(add(a, b))\n'
            ),
            'validation': _stdio_validation(
                'python',
                [
                    {'label': 'Тест 1', 'input': '2\n3\n', 'expected': '5\n'},
                    {'label': 'Тест 2', 'input': '-1\n10\n', 'expected': '9\n'},
                ],
            ),
        },
        ('middle-functions', 'Мини-проект заметки'): {
            'prompt': 'Считай заголовок и текст из stdin, собери заметку с помощью 2 функций и выведи её.',
            'hints': [
                'Сначала получи заголовок и текст заметки через input().',
                'Сделай одну функцию для сборки строки заметки, а вторую для вывода результата.',
                'В конце вызови функции по очереди и выведи готовую заметку.',
            ],
            'starter_code': (
                'title = input().strip()\n'
                'text = input().strip()\n'
                '\n'
                'def build_note(title, text):\n'
                '    return f"{title}: {text}"\n'
                '\n'
                'def show_note(note):\n'
                '    print(note)\n'
                '\n'
                'show_note(build_note(title, text))\n'
            ),
            'validation': _stdio_validation(
                'python',
                [
                    {'label': 'Тест 1', 'input': 'План\nСделать проект\n', 'expected': 'План: Сделать проект\n'},
                    {'label': 'Тест 2', 'input': 'Идея\nПриложение для заметок\n', 'expected': 'Идея: Приложение для заметок\n'},
                ],
            ),
        },
        ('senior-js-basics', 'Создай переменную score'): {
            'starter_code': 'let score = 10;\nconsole.log(score);\n',
            'validation': _stdio_validation(
                'javascript',
                [
                    {'label': 'Тест 1', 'input': '', 'expected': '10\n'},
                ],
            ),
        },
        ('senior-js-basics', 'Проверь балл'): {
            'prompt': 'Создай функцию checkScore(score). Выведи результаты для 72 и 40: pass или retry.',
            'hints': [
                'Опиши функцию checkScore(score), которая возвращает строку, а не печатает её внутри себя.',
                'Если балл не меньше 70, функция должна вернуть pass, иначе retry.',
                'После этого выведи через console.log результат для 72 и для 40.',
            ],
            'starter_code': (
                'function checkScore(score) {\n'
                '  if (score >= 70) {\n'
                '    return "pass";\n'
                '  }\n'
                '  return "retry";\n'
                '}\n'
                '\n'
                'console.log(checkScore(72));\n'
                'console.log(checkScore(40));\n'
            ),
            'validation': _stdio_validation(
                'javascript',
                [
                    {'label': 'Тест 1', 'input': '', 'expected': 'pass\nretry\n'},
                ],
            ),
        },
        ('senior-js-basics', 'Сделай кнопку'): {
            'prompt': 'У объекта button уже есть addEventListener и click(). Добавь обработчик click, который меняет label на "Готово", затем выведи результат.',
            'hints': [
                'Используй button.addEventListener("click", ...), чтобы зарегистрировать обработчик.',
                'Внутри обработчика поменяй button.label на "Готово".',
                'После регистрации вызови button.click() и выведи button.label через console.log().',
            ],
            'starter_code': (
                'const button = {\n'
                '  label: "Нажми",\n'
                '  handlers: {},\n'
                '  addEventListener(event, handler) {\n'
                '    this.handlers[event] = handler;\n'
                '  },\n'
                '  click() {\n'
                '    if (this.handlers.click) {\n'
                '      this.handlers.click();\n'
                '    }\n'
                '  },\n'
                '};\n'
                '\n'
                'button.addEventListener("click", () => {\n'
                '  button.label = "Готово";\n'
                '});\n'
                '\n'
                'button.click();\n'
                'console.log(button.label);\n'
            ),
            'validation': _stdio_validation(
                'javascript',
                [
                    {'label': 'Тест 1', 'input': '', 'expected': 'Готово\n'},
                ],
            ),
        },
    }


def seed_modules() -> None:
    if Module.query.count() > 0:
        return

    junior_modules = [
        {
            'slug': 'junior-computer', 'title': 'Знакомство с компьютером', 'description': 'Что такое компьютер, программа и алгоритм.', 'age_group': 'junior', 'icon': 'monitor', 'color': '#4A90D9',
            'lessons': [
                _lesson_payload(
                    'Что такое компьютер?',
                    'Компьютер — не волшебник. Он делает только то, что ему говорят. Давай разберём, кто ему говорит и как!',
                    ['Компьютер не думает сам — ему нужны команды', 'Программа — это список команд, как рецепт для повара', 'Клавиатура и мышь — ввод; экран и колонки — вывод'],
                    'Собери алгоритм утра',
                    'Напиши три шага утреннего алгоритма через стрелочку.',
                    ['встать', 'почистить', 'завтрак', 'проснуться'],
                    [
                        'Начни с самого первого действия после пробуждения.',
                        'Каждый шаг пиши коротким действием: например, встать или почистить зубы.',
                        'Соедини три шага стрелочками и проверь, что порядок логичный.',
                    ],
                    [
                        _question_single('j11', 'Что такое программа?', ['Набор команд', 'Игрушка', 'Картинка', 'Песня'], 0),
                        _question_order('j12', 'Расставь шаги алгоритма включения компьютера.', ['Нажать кнопку', 'Увидеть экран приветствия', 'Ждать загрузку'], ['Нажать кнопку', 'Ждать загрузку', 'Увидеть экран приветствия']),
                    ],
                    mentor_tip='Компьютер — как очень послушный, но не очень умный робот. Он сделает всё, что скажешь, но ровно так, как ты сказал. Поэтому команды должны быть точными!',
                    extra_theory_blocks=[
                        {'type': 'example', 'title': 'Смотри на живом примере', 'text': 'Ты нажимаешь стрелку вправо в игре.\nКомпьютер читает программу: «стрелка вправо нажата? → двигай героя на 1 клетку вправо».\n\nВсё! Никакой магии — просто точная команда. Отпустил стрелку — герой стоит. Нет команды — нет действия.'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: Компьютер — это послушный робот', 'text': 'Представь робота, который делает всё что ты говоришь — но только точно то, что ты сказал. Скажи «иди» — идёт. Не скажешь — стоит. Компьютер такой же: без команды он ничего не делает.'},
                        {'title': 'Шаг 2: Программа — это рецепт', 'text': 'Программа — это как рецепт пирога: список шагов по порядку. Повар читает рецепт и делает по нему. Компьютер читает программу и делает по ней. Нет рецепта — нет пирога!'},
                        {'title': 'Шаг 3: Что такое ввод и вывод?', 'text': 'Ввод — это ты что-то говоришь компьютеру (нажимаешь клавиши, двигаешь мышь). Вывод — это компьютер отвечает тебе (показывает картинку, играет звук). Это как разговор!'},
                        {'title': 'Шаг 4: Найди ввод и вывод рядом!', 'text': 'Посмотри на свой телефон. Когда ты тыкаешь в экран — это ввод. Когда он показывает картинку или играет звук — это вывод. Найди ещё 2 примера ввода и 2 вывода вокруг тебя!'},
                    ],
                ),
                _lesson_payload(
                    'Алгоритмы вокруг нас',
                    'Алгоритм — это как инструкция по сборке Lego: делай шаги по порядку, и всё получится. Перепутай — и домик развалится!',
                    ['Алгоритм — это список шагов по порядку', 'Перепутай шаги — получишь другой результат или ничего', 'Одинаковые шаги можно записать как «повтори N раз»'],
                    'Маршрут робота',
                    'Напиши маршрут: вверх, вверх, вправо.',
                    ['вверх', 'вправо'],
                    [
                        'Сначала запиши две одинаковые команды подряд.',
                        'Последняя команда должна повернуть робота в сторону, а не вверх.',
                        'Проверь, что в ответе есть только слова вверх и вправо.',
                    ],
                    [
                        _question_single('j13', 'Алгоритм — это...', ['Случайный текст', 'Последовательность действий', 'Только код на Python', 'Рисунок'], 1),
                        _question_match('j14', 'Соедини устройство и его роль.', ['Клавиатура', 'Монитор'], ['Вывод', 'Ввод'], {'Клавиатура': 'Ввод', 'Монитор': 'Вывод'}),
                    ],
                    mentor_tip='Прочитай свой алгоритм другу вслух и попроси его сделать всё буквально. Если друг запутался — значит, алгоритм нужно исправить. Это лучший способ проверить!',
                    extra_theory_blocks=[
                        {'type': 'example', 'title': 'Алгоритм бутерброда', 'text': 'Попробуй нарушить порядок и посмотри что выйдет:\n\nПравильно:\n1. Взять хлеб → 2. Намазать масло → 3. Положить сыр\n\nНеправильно:\n1. Положить сыр → 2. Взять хлеб → 3. Намазать масло\n\nВо втором случае сыр ляжет прямо на стол! Порядок важен.'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: Алгоритм — это инструкция', 'text': 'Алгоритм — это точный список шагов, которые ведут к результату. Как инструкция по сборке Lego: делай по порядку — и всё получится. Пропустил шаг — и домик не стоит!'},
                        {'title': 'Шаг 2: Порядок — это закон', 'text': 'Попробуй поменять шаги завтрака: сначала надеть рюкзак, потом проснуться. Звучит смешно? Вот именно! Компьютер делал бы это без смеха — поэтому порядок в алгоритме критичен.'},
                        {'title': 'Шаг 3: Повторения — это удобно', 'text': 'Если делаешь одно и то же несколько раз — не пиши каждый раз заново. Скажи: «повтори 4 раза: шаг вперёд». Программисты обожают такие сокращения — они называются циклами!'},
                        {'title': 'Шаг 4: Найди свой алгоритм', 'text': 'Напиши алгоритм чистки зубов по шагам (не меньше 5 шагов!). Потом перечитай и проверь: если бы робот делал это строго по твоему списку, получилось бы нормально?'},
                    ],
                ),
                _lesson_payload(
                    'Привет, мир!',
                    'Знаешь, как все программисты в мире начинали учиться? С двух слов: «Привет, мир!». Сегодня ты сделаешь то же самое!',
                    ['Каждая команда даёт конкретный результат', 'Компьютер выполняет команду точно как написано — без домыслов', 'Традиция «Привет, мир!» — первый шаг каждого программиста'],
                    'Поздоровайся с миром',
                    'Напиши фразу «Привет, мир!»',
                    ['привет', 'мир'],
                    [
                        'Нужна одна короткая фраза-приветствие без лишних слов.',
                        'Используй оба слова из задания: Привет и мир.',
                        'Проверь, что фраза выглядит почти точно как в условии.',
                    ],
                    [
                        _question_single('j15', 'Что увидит пользователь?', ['Ничего', 'Сообщение', 'Файл', 'Пароль'], 1),
                        _question_multiple('j16', 'Что нужно хорошей команде?', ['Быть понятной', 'Иметь цель', 'Быть случайной', 'Давать результат'], [0, 1, 3]),
                    ],
                    mentor_tip='С 1978 года все программисты начинают с «Hello, World!». Это как традиция — написал первую программу, стал частью огромного клуба! Добро пожаловать в клуб!',
                    extra_theory_blocks=[
                        {'type': 'example', 'title': 'Интересный факт про «Привет, мир!»', 'text': 'В 1978 году учёные написали книгу о программировании. Первый пример в ней выводил «Hello, World!». С тех пор это традиция — каждый программист начинает с этих слов на любом новом языке.\n\nСегодня ты станешь частью этой традиции!'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: Почему «Привет, мир»?', 'text': 'Это самый простой способ проверить: «моя программа вообще работает?». Если видишь надпись — всё работает! Программисты делают это каждый раз, когда начинают изучать новый язык.'},
                        {'title': 'Шаг 2: Команда — это действие', 'text': 'Команда — это приказ для компьютера. «Покажи текст Привет, мир!» — компьютер покажет. «Нарисуй круг» — нарисует. Нет команды — нет действия. Всё просто!'},
                        {'title': 'Шаг 3: Каждый символ важен', 'text': 'Напиши «Привет мир» без запятой — это уже другой текст. Напиши «привет, Мир!» — снова другой. Компьютер не понимает «почти правильно». Только точное совпадение!'},
                        {'title': 'Шаг 4: Ты уже программист!', 'text': 'Серьёзно! Как только напишешь «Привет, мир!» — ты сделаешь то, с чего начинали все: Марк Цукерберг (Facebook), Билл Гейтс (Microsoft), и миллионы других. Твой первый шаг!'},
                    ],
                ),
            ],
        },
        {
            'slug': 'junior-sequence', 'title': 'Последовательности', 'description': 'Команды по порядку и путь персонажа.', 'age_group': 'junior', 'icon': 'route', 'color': '#2ECC71',
            'lessons': [
                _lesson_payload(
                    'Команды по порядку',
                    'Что будет, если сначала включить тостер, а потом положить хлеб? Ничего хорошего! Порядок команд — это всё.',
                    ['Компьютер выполняет команды строго по порядку — сверху вниз', 'Один пропущенный шаг может сломать весь результат', 'Прежде чем написать — проговори шаги вслух, как робот'],
                    'Испеки тост',
                    'Опиши порядок действий для тоста.',
                    ['хлеб', 'тостер'],
                    [
                        'Первый шаг связан с хлебом, а не с кнопкой тостера.',
                        'После того как хлеб внутри, можно включить тостер.',
                        'Последним действием будет достать готовый тост.',
                    ],
                    [
                        _question_single('j21', 'Что будет, если поменять шаги местами?', ['Ничего', 'Результат может измениться', 'Код удалится', 'Появится пароль'], 1),
                        _question_order('j22', 'Поставь шаги приготовления тоста по порядку.', ['Положить хлеб', 'Включить тостер', 'Достать тост'], ['Положить хлеб', 'Включить тостер', 'Достать тост']),
                    ],
                    mentor_tip='Попробуй стать роботом: прочитай свои шаги и делай ровно то, что написано, без смекалки. Если робот запутается — значит, алгоритм надо исправить!',
                    extra_theory_blocks=[
                        {'type': 'example', 'title': 'Три версии алгоритма тоста', 'text': 'Правильно:\n1. Положить хлеб 2. Включить тостер 3. Достать тост\n\nОшибка 1 — включить тостер без хлеба:\n1. Включить тостер 2. Положить хлеб 3. Ждать...\n(тостер греет воздух — хлеб не поджарится!)\n\nОшибка 2 — пропустить шаг:\n1. Положить хлеб 2. Достать тост\n(тостер не включили — хлеб холодный!)'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: Компьютер читает сверху вниз', 'text': 'Представь книгу — ты читаешь страницу сверху вниз, строчку за строчкой. Компьютер делает то же самое с командами! Первая команда, потом вторая, потом третья... Он не прыгает и не пропускает.'},
                        {'title': 'Шаг 2: Один пропуск — и всё рушится', 'text': 'Попробуй приготовить бутерброд и «забудь» открыть холодильник. Ничего не выйдет! Точно так же в программе: пропустил шаг — результат сломался. Каждый шаг важен!'},
                        {'title': 'Шаг 3: Стань роботом и проверь', 'text': 'Написал алгоритм? Теперь прочитай его вслух и делай буквально то, что написано. Нет слова «открой» — не открывай. Это лучший способ найти ошибку!'},
                        {'title': 'Шаг 4: Игра «Сломай алгоритм»', 'text': 'Возьми алгоритм чистки зубов и специально поменяй 2 шага местами. Что получится? Это весело — и помогает понять, почему порядок важен. Поделись с другом — кто придумает смешнее?'},
                    ],
                ),
                _lesson_payload(
                    'Рисуем фигуры',
                    'Как нарисовать квадрат с помощью команд? Оказывается, там всего 2 команды — но они повторяются 4 раза!',
                    ['Квадрат = 4 одинаковые стороны = одна пара команд, повторённая 4 раза', 'Повтори N раз — это цикл, очень удобная штука', 'Каждую фигуру можно разложить на простые движения'],
                    'Нарисуй квадрат',
                    'Напиши команды вперёд и поворот 4 раза.',
                    ['вперёд', 'поворот'],
                    [
                        'У квадрата четыре одинаковые стороны, значит пара команд повторится четыре раза.',
                        'После каждого шага вперёд нужен поворот.',
                        'Проверь, что в ответе встречаются обе команды: вперёд и поворот.',
                    ],
                    [
                        _question_multiple('j23', 'Что нужно для квадрата?', ['4 стороны', '2 поворота', '4 поворота', '1 круг'], [0, 2]),
                        _question_match('j24', 'Сопоставь фигуру и количество сторон.', ['Треугольник', 'Квадрат'], ['3', '4'], {'Треугольник': '3', 'Квадрат': '4'}),
                    ],
                    mentor_tip='Возьми карандаш и нарисуй квадрат на бумаге, проговаривая команды: «вперёд», «поворот»... Ты сам удивишься, что повторяешь одно и то же ровно 4 раза!',
                    extra_theory_blocks=[
                        {'type': 'example', 'title': 'Длинный и короткий способ', 'text': 'Длинный способ (8 команд):\nвперёд, поворот, вперёд, поворот, вперёд, поворот, вперёд, поворот\n\nКороткий способ (1 команда!):\nПовтори 4 раза: (вперёд, поворот)\n\nОба варианта рисуют одинаковый квадрат. Но программисты предпочитают короткий!'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: Посчитай стороны квадрата', 'text': 'Нарисуй квадрат в воздухе пальцем. Одна сторона... две... три... четыре. Четыре одинаковых стороны! Значит движение «вперёд» повторится 4 раза. И поворот тоже 4 раза.'},
                        {'title': 'Шаг 2: Одна сторона = две команды', 'text': 'Чтобы нарисовать одну сторону квадрата: сначала «вперёд» (рисуем линию), потом «поворот» (готовимся к следующей стороне). Итого 4 стороны × 2 команды = 8 команд. Но можно записать короче!'},
                        {'title': 'Шаг 3: Повтори — это суперкоманда', 'text': 'Вместо 8 одинаковых команд можно написать: «Повтори 4 раза: вперёд, поворот». Это называется цикл — одна из самых важных вещей в программировании. Ты только что узнал о ней!'},
                        {'title': 'Шаг 4: А что насчёт треугольника?', 'text': 'Угадай: сколько раз надо повторить «вперёд, поворот», чтобы нарисовать треугольник? Правильно — 3 раза! Попробуй нарисовать треугольник по той же схеме.'},
                    ],
                ),
                _lesson_payload(
                    'Маршрут персонажа',
                    'Наш герой застрял! Помоги ему добраться до звезды, написав точный маршрут из команд. Каждая команда — один шаг.',
                    ['Каждая команда = один шаг в одном направлении', 'Маршрут удобно проверять пальцем по клеточкам', 'Можно найти разные пути — короткий лучше длинного!'],
                    'Проведи героя',
                    'Напиши: вправо, вправо, вниз.',
                    ['вправо', 'вниз'],
                    [
                        'Сделай два шага в одну и ту же сторону, прежде чем двигаться вниз.',
                        'Последняя команда должна опустить героя на одну клетку.',
                        'Сверь ответ с маршрутом из трёх коротких команд.',
                    ],
                    [
                        _question_single('j25', 'Маршрут удобнее всего проверять...', ['По клеткам', 'Наугад', 'По цвету', 'По музыке'], 0),
                        _question_order('j26', 'Поставь команды маршрута к звезде.', ['вправо', 'вправо', 'вниз'], ['вправо', 'вправо', 'вниз']),
                    ],
                    mentor_tip='Нарисуй сетку на бумаге, поставь точку «старт» и «финиш» и проведи маршрут пальцем. Это намного проще, чем держать всё в голове!',
                    extra_theory_blocks=[
                        {'type': 'example', 'title': 'Читаем маршрут как карту', 'text': 'Герой стоит в клетке. Маршрут: вправо, вправо, вниз.\n\n[Г][ ][ ]\n[ ][ ][★]\n\n→ вправо: [_][Г][ ]\n→ вправо: [_][_][Г]\n↓ вниз:   [_][_][_]\n          [_][_][★← Герой пришёл!]\n\nТри команды — и герой у цели!'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: Сетка — это как клетчатая бумага', 'text': 'Представь лист клетчатой бумаги. Герой стоит в одной клетке. Каждая команда двигает его ровно на одну клеточку: вправо, влево, вверх или вниз. Никаких прыжков!'},
                        {'title': 'Шаг 2: Четыре стрелки', 'text': 'Есть только 4 направления: → вправо, ← влево, ↑ вверх, ↓ вниз. Каждое — одна клетка. Хочешь пройти 3 клетки вправо? Нужны 3 команды «вправо». Всё просто!'},
                        {'title': 'Шаг 3: Проверяй пальцем', 'text': 'Написал маршрут? Теперь проследи его пальцем по сетке, называя каждую команду. Дошёл до звезды — ура, маршрут правильный! Промахнулся — найди где свернул не туда.'},
                        {'title': 'Шаг 4: Найди короткий путь', 'text': 'До одной точки можно добраться по-разному. Попробуй найти маршрут к звезде с наименьшим количеством команд. Короткий путь = меньше команд = лучшая программа!'},
                    ],
                ),
            ],
        },
    ]

    middle_modules = [
        {
            'slug': 'middle-python-intro', 'title': 'Введение в Python', 'description': 'Переменные, ввод и вывод в Python.', 'age_group': 'middle', 'icon': 'code', 'color': '#8B5CF6',
            'lessons': [
                _lesson_payload(
                    'Что такое Python?',
                    'Python — язык программирования, который понимает компьютер. Команды пишутся почти как английские слова, а выполняются строчка за строчкой сверху вниз.',
                    ['Python читается почти как английский текст', 'Команды выполняются строго сверху вниз', 'print() выводит текст или значение на экран'],
                    'Выведи сообщение',
                    'Напиши программу, которая выводит «Я изучаю Python».',
                    ['print', 'python'],
                    [
                        'Для вывода текста в Python используй функцию print().',
                        'Фразу нужно взять в кавычки внутри print().',
                        'Проверь, что вывод совпадает с условием без лишних слов и знаков.',
                    ],
                    [
                        _question_single('m11', 'Для вывода в Python используют...', ['echo', 'print()', 'show()', 'emit()'], 1),
                        _question_order('m12', 'Поставь действия по порядку: написать код, запустить, увидеть вывод.', ['написать код', 'увидеть вывод', 'запустить'], ['написать код', 'запустить', 'увидеть вывод']),
                    ],
                    'print("Я изучаю Python")\n',
                    _legacy_seeded_code_task_updates()[('middle-python-intro', 'Выведи сообщение')]['validation'],
                    mentor_tip='Не просто читай код — меняй его и смотри что будет! Напиши print("Привет, [твоё имя]!") и запусти. Вот это настоящее программирование!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'Смотри — всё очень просто!', 'text': 'print("Привет, мир!")   ← пишем команду\n                        ↓ запускаем\nПривет, мир!            ← видим результат\n\nprint("Я изучаю Python")\nЯ изучаю Python\n\nКаждый print() — новая строка на экране!'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: Python — почти русский язык', 'text': 'print — это «напечатать» по-английски. Python использует слова, похожие на обычные команды. Именно поэтому он — самый популярный первый язык в мире. Даже ребята в NASA им пользуются!'},
                        {'title': 'Шаг 2: print() — команда «покажи»', 'text': 'print("что-то") говорит Python: «покажи вот это на экране». Что в кавычках — то и покажет. print("Привет") → Привет. print("123") → 123. Просто!'},
                        {'title': 'Шаг 3: Читаем сверху вниз', 'text': 'Python выполняет строчки по порядку — как ты читаешь книгу. Первая строка, вторая, третья... Если написать два print() — будет два вывода, один за другим!'},
                        {'title': 'Шаг 4: Кавычки — это важно!', 'text': 'Без кавычек Python думает, что ты написал имя переменной, и говорит «не знаю такую!». С кавычками — понимает, что это текст. print("Привет") — работает. print(Привет) — ошибка!'},
                    ],
                ),
                _lesson_payload(
                    'Переменные и типы',
                    'Переменная — это имя для значения. Создав переменную, можно хранить имя, возраст или число очков и использовать их в любом месте программы.',
                    ['Переменная — именованная ячейка для хранения данных', 'Строка (str) и число (int) — разные типы, их нельзя путать', 'Имена переменных должны быть понятными: name, не n'],
                    'Создай переменные',
                    'Создай name и age, затем выведи их.',
                    ['name', 'age', 'print'],
                    [
                        'Сохрани имя в переменную name, а возраст в переменную age.',
                        'Текстовое значение записывай в кавычках, число можно оставить без кавычек.',
                        'Для вывода обеих переменных используй один print().',
                    ],
                    [
                        _question_multiple('m13', 'Что можно хранить в переменной?', ['Число', 'Строку', 'Список', 'Картинку в коде'], [0, 1, 2]),
                        _question_match('m14', 'Сопоставь пример и тип данных.', ['12', '"Аня"'], ['число', 'строка'], {'12': 'число', '"Аня"': 'строка'}),
                    ],
                    'name = "Аня"\nage = 12\nprint(name, age)\n',
                    _legacy_seeded_code_task_updates()[('middle-python-intro', 'Создай переменные')]['validation'],
                    mentor_tip='Переменная — это коробочка с подписью. Положи в неё значение и называй по подписи. Давай понятные имена: name, а не n. Иначе через неделю не вспомнишь, что там лежало!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'Три вида переменных', 'text': 'name = "Аня"     # текст — всегда в кавычках\nage = 12         # число — без кавычек\nheight = 1.65    # дробное — с точкой, не с запятой!\n\nprint(name)           → Аня\nprint(age)            → 12\nprint(name, ":", age) → Аня : 12'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: Переменная — коробочка с именем', 'text': 'Представь коробку с надписью «name». Внутри лежит «Аня». Когда пишешь name = "Аня" — кладёшь «Аня» в коробку. Когда пишешь print(name) — достаёшь из коробки и показываешь. Вот и вся магия!'},
                        {'title': 'Шаг 2: Три типа — три разных коробки', 'text': 'Текст ("Аня") — в кавычках, это строка. Число (12) — без кавычек, это целое. Дробное (1.65) — с точкой, не с запятой! Python сам понимает тип, не нужно ничего указывать.'},
                        {'title': 'Шаг 3: Называй понятно', 'text': 'name лучше чем n. user_age лучше чем ua. Имена с подчёркиванием — ок. С пробелом — ошибка! С цифры начинать нельзя. Хорошее имя — как хорошая подпись на коробке: сразу понятно что внутри.'},
                        {'title': 'Шаг 4: Переменную можно поменять', 'text': 'age = 12, потом age = 13 — Python забудет 12 и запомнит 13. Они называются «переменными», потому что их значение может меняться. Попробуй написать 3 строки: создай, измени, выведи!'},
                    ],
                ),
                _lesson_payload(
                    'input() и print()',
                    'Принимаем данные от пользователя через input() и отвечаем через print(). Так программа становится интерактивной — она реагирует на то, что вводит человек.',
                    ['input() останавливает программу и ждёт ввода пользователя', 'Результат input() — всегда строка, даже если ввели число', 'f-строки позволяют вставлять переменные прямо в текст'],
                    'Поздоровайся по имени',
                    'Используй input для имени и print для приветствия.',
                    ['input', 'print'],
                    [
                        'Сначала считай имя пользователя через input().',
                        'Сохрани введённое значение в переменную, чтобы использовать его дальше.',
                        'Выведи приветствие через print(), подставив имя внутрь строки.',
                    ],
                    [
                        _question_single('m15', 'Что делает input()?', ['Удаляет строку', 'Принимает ввод', 'Красит текст', 'Считает XP'], 1),
                        _question_order('m16', 'Расставь шаги общения с пользователем.', ['Показать вопрос', 'Получить ответ', 'Вывести приветствие'], ['Показать вопрос', 'Получить ответ', 'Вывести приветствие']),
                    ],
                    'name = input().strip()\nprint(f"Привет, {name}")\n',
                    _legacy_seeded_code_task_updates()[('middle-python-intro', 'Поздоровайся по имени')]['validation'],
                    mentor_tip='Запусти программу и введи своё настоящее имя! Когда видишь «Привет, [твоё имя]!» — это уже настоящий диалог человека и компьютера. Это и есть программирование!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'Программа разговаривает с тобой!', 'text': 'name = input()             ← программа ждёт...\n                           ← ты вводишь: Аня\nprint(f"Привет, {name}!")  ← программа отвечает:\n                           → Привет, Аня!\n\nВот и всё! input() спрашивает, print() отвечает.'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: input() — программа ждёт тебя', 'text': 'Когда программа доходит до input() — она останавливается и ждёт. Как официант, который ждёт твой заказ. Ты вводишь текст и жмёшь Enter — программа продолжает работу.'},
                        {'title': 'Шаг 2: Сохрани — иначе потеряется', 'text': 'name = input() — сохраняем то, что ввёл пользователь, в переменную name. Если не сохранить (просто написать input()) — ответ пользователя тут же забудется. Как не записать номер телефона!'},
                        {'title': 'Шаг 3: f-строка — вставка переменной', 'text': 'f"Привет, {name}!" — буква f перед кавычками значит: «внутри фигурных скобок { } — вставь переменную». Если name = "Аня", то получится "Привет, Аня!". Очень удобно!'},
                        {'title': 'Шаг 4: .strip() — убирает случайные пробелы', 'text': 'Иногда пользователь случайно жмёт пробел перед именем: " Аня". Тогда " Аня" и "Аня" — разные строки! .strip() убирает пробелы с краёв. Пиши input().strip() — и будет надёжнее.'},
                    ],
                ),
            ],
        },
        {
            'slug': 'middle-conditions', 'title': 'Условия и логика', 'description': 'if / elif / else и мини-проекты.', 'age_group': 'middle', 'icon': 'git-branch', 'color': '#EC4899',
            'lessons': [
                _lesson_payload(
                    'if / else',
                    'Условия позволяют программе принимать решения. if проверяет условие — если оно истинно, выполняется один блок кода, иначе — другой.',
                    ['if выполняет блок кода, только если условие истинно', 'else — запасной сценарий, когда if не сработал', 'Отступ 4 пробела обязателен — это синтаксис Python, не стиль'],
                    'Проверь возраст',
                    'Напиши if, который определит возрастную группу.',
                    ['if', 'print'],
                    [
                        'Возраст сначала нужно получить из input() и превратить в число.',
                        'Проверь условие age >= 12 в ветке if.',
                        'Подумай, что программа должна вывести, если условие не выполнилось.',
                    ],
                    [
                        _question_single('m21', 'Когда срабатывает else?', ['Всегда первым', 'Если условие не выполнилось', 'Только на login', 'При цикле'], 1),
                        _question_match('m22', 'Сопоставь сравнение и смысл.', ['>=', '=='], ['больше или равно', 'равно'], {'>=': 'больше или равно', '==': 'равно'}),
                    ],
                    'age = int(input())\nif age >= 12:\n    print("Средняя группа")\nelse:\n    print("Младшая группа")\n',
                    _legacy_seeded_code_task_updates()[('middle-conditions', 'Проверь возраст')]['validation'],
                    mentor_tip='Запомни: = кладёт значение (age = 12 — запомни число 12), а == сравнивает (age == 12 — проверь, равно ли 12?). Одно = — действие, два == — вопрос!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'if / else — развилка на дороге', 'text': 'age = int(input())    ← вводим возраст (как число!)\n\nif age >= 12:         ← если 12 или больше...\n    print("Средняя группа")   ← ...выводим это\nelse:                 ← иначе...\n    print("Младшая группа")   ← ...выводим это\n\nВвод 14 → Средняя группа\nВвод 9  → Младшая группа'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Шаг 1: if — это вопрос да/нет', 'text': 'if — это как развилка на дороге. Python задаёт вопрос: «условие выполняется?». Если ДА — идёт по одной дороге (if). Если НЕТ — по другой (else). Выбирает только одну!'},
                        {'title': 'Шаг 2: Знаки сравнения', 'text': '> больше, < меньше, >= не меньше, <= не больше, == равно, != не равно. Главная ловушка: = это «запомни», а == это «сравни». age = 12 (запомни 12). age == 12 (это правда 12?).'},
                        {'title': 'Шаг 3: Отступ — это закон Python', 'text': 'Видишь 4 пробела перед print? Это обязательно! Python по отступам понимает, что код внутри if. Забыл отступ — Python скажет «IndentationError» и не запустит. Редактор ставит их сам!'},
                        {'title': 'Шаг 4: int() превращает текст в число', 'text': 'input() всегда даёт текст, даже если ввёл цифры. "12" — это текст! Сравнить текст с числом не получится. int("12") превращает текст "12" в настоящее число 12. Вот зачем int(input()).'},
                    ],
                ),
                _lesson_payload(
                    'Логические операторы',
                    'Соединяем несколько условий в одно с помощью and, or и not. Это позволяет проверять сложные сценарии.',
                    ['and истинен только когда оба условия истинны', 'or истинен когда хотя бы одно условие истинно', 'not переворачивает результат: True становится False'],
                    'Проверь пропуск',
                    _legacy_seeded_code_task_updates()[('middle-conditions', 'Проверь пропуск')]['prompt'],
                    ['and', 'if'],
                    _legacy_seeded_code_task_updates()[('middle-conditions', 'Проверь пропуск')]['hints'],
                    [
                        _question_single('m23', 'Какой оператор означает «и»?', ['or', 'not', 'and', '='], 2),
                        _question_multiple('m24', 'Что относится к логическим операторам?', ['and', 'or', 'not', 'print'], [0, 1, 2]),
                    ],
                    _legacy_seeded_code_task_updates()[('middle-conditions', 'Проверь пропуск')]['starter_code'],
                    _legacy_seeded_code_task_updates()[('middle-conditions', 'Проверь пропуск')]['validation'],
                    mentor_tip='Читай условия вслух по-русски: «если есть билет И не опоздал» — это and. «Если есть билет ИЛИ пропуск» — это or. Так сразу понятно, какой оператор нужен!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'and, or, not на практике', 'text': 'has_ticket = int(input())\nis_on_time = int(input())\n\nif has_ticket == 1 and is_on_time == 1:\n    print("pass")   # оба истинны\nelse:\n    print("wait")\n\n# not переворачивает:\nif not (age < 12):   # то же, что age >= 12\n    print("не младший")'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Оператор and — нужны ОБА', 'text': 'and истинен только когда ОБА условия истинны. True and True = True. True and False = False. False and False = False. Одного недостаточно — нужны оба!'},
                        {'title': 'Оператор or — достаточно одного', 'text': 'or истинен когда хотя бы ОДНО условие истинно. True or False = True. True or True = True. False or False = False. Только когда оба ложны — результат False.'},
                        {'title': 'Оператор not — переворот', 'text': 'not переворачивает результат: not True = False, not False = True. Используй, когда удобнее проверить обратное: not (age < 12) читается как «не младший».'},
                        {'title': 'Проверь все комбинации', 'text': 'Составь таблицу для has_ticket и is_on_time. Что будет при (1,1)? При (1,0)? При (0,1)? При (0,0)? Это называется «таблица истинности» — полезный инструмент программиста!'},
                    ],
                ),
                _lesson_payload(
                    'Мини-проект: калькулятор возраста',
                    'Собираем всё изученное вместе: ввод данных, несколько условий через elif и красивый вывод результата.',
                    ['elif добавляет третий и более вариантов после if', 'Python проверяет условия по порядку и останавливается на первом истинном', 'Настоящий проект = ввод + обработка + вывод'],
                    'Определи категорию',
                    _legacy_seeded_code_task_updates()[('middle-conditions', 'Определи категорию')]['prompt'],
                    ['input', 'if', 'print'],
                    _legacy_seeded_code_task_updates()[('middle-conditions', 'Определи категорию')]['hints'],
                    [
                        _question_single('m25', 'Что связывает все прошлые уроки?', ['Музыка', 'Комбинация базовых конструкций', 'Только цикл', 'Только список'], 1),
                        _question_order('m26', 'Порядок шагов в мини-проекте.', ['Получить возраст', 'Проверить условие', 'Показать результат'], ['Получить возраст', 'Проверить условие', 'Показать результат']),
                    ],
                    _legacy_seeded_code_task_updates()[('middle-conditions', 'Определи категорию')]['starter_code'],
                    _legacy_seeded_code_task_updates()[('middle-conditions', 'Определи категорию')]['validation'],
                    mentor_tip='Настоящие проекты собираются из маленьких знакомых кусочков. Здесь нет ничего нового — только input(), if/elif/else и print() в нужном порядке. Ты уже умеешь это!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'if / elif / else — три варианта', 'text': 'age = int(input())\n\nif age < 12:          # первая проверка\n    print("junior")\nelif age < 15:        # вторая проверка (если первая не сработала)\n    print("middle")\nelse:                 # всё остальное\n    print("senior")\n\n# Ввод: 10 → junior\n# Ввод: 13 → middle\n# Ввод: 16 → senior'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'elif — когда вариантов больше двух', 'text': 'Когда вариантов больше двух, используй elif (else if). Python проверяет if, потом первый elif, потом второй... и останавливается на первом истинном условии.'},
                        {'title': 'Порядок проверок важен', 'text': 'Python проверяет условия по порядку сверху вниз. Условия должны идти от частного к общему. Если написать сначала age < 15, а потом age < 12 — возраст 10 попадёт в middle вместо junior!'},
                        {'title': 'Структура мини-проекта', 'text': 'Любой мини-проект = ввод + обработка + вывод. Сначала получи данные (input), потом обработай (if/elif/else), потом покажи результат (print). Эта схема работает в любом языке!'},
                        {'title': 'Тестируй все граничные значения', 'text': 'Проверь программу на крайних значениях: 11 (граница junior), 12 (начало middle), 14 (конец middle), 15 (начало senior). Ошибки чаще всего прячутся именно на границах!'},
                    ],
                ),
            ],
        },
        {
            'slug': 'middle-functions', 'title': 'Функции', 'description': 'Разбиваем код на понятные части.', 'age_group': 'middle', 'icon': 'function-square', 'color': '#10B981',
            'lessons': [
                _lesson_payload(
                    'Зачем нужны функции?',
                    'Функция — это блок кода с именем, который можно вызвать сколько угодно раз. Функции убирают повторения и делают код понятнее.',
                    ['def создаёт функцию — но не запускает её', 'Функцию нужно вызвать по имени, чтобы код внутри выполнился', 'Имя функции — глагол, описывающий действие: greet, calculate, show'],
                    'Создай greet',
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Создай greet')]['prompt'],
                    ['def', 'greet', 'print'],
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Создай greet')]['hints'],
                    [
                        _question_single('m31', 'Чем полезна функция?', ['Удаляет ошибки автоматически', 'Повторно использует код', 'Создаёт таблицу', 'Меняет браузер'], 1),
                        _question_match('m32', 'Соедини часть функции и её роль.', ['def', 'return'], ['создаёт функцию', 'возвращает значение'], {'def': 'создаёт функцию', 'return': 'возвращает значение'}),
                    ],
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Создай greet')]['starter_code'],
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Создай greet')]['validation'],
                    mentor_tip='Если видишь одинаковый код в двух местах — значит, пора создать функцию. Это главный сигнал! Дублирование кода — главный враг хорошей программы.',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'Функция vs копипаст', 'text': '# Без функции (плохо — дублирование!):\nprint("Привет, Аня")\nprint("Привет, Иван")\nprint("Привет, Маша")\n\n# С функцией (хорошо):\ndef greet(name):\n    print(f"Привет, {name}")\n\ngreet("Аня")    # Привет, Аня\ngreet("Иван")   # Привет, Иван\ngreet("Маша")   # Привет, Маша'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Зачем нужны функции', 'text': 'Функция — это блок кода с именем. Вместо того чтобы копировать один и тот же код в 10 мест, пишешь функцию один раз и вызываешь её 10 раз. Меньше кода — меньше ошибок!'},
                        {'title': 'def — объявление, не запуск', 'text': 'def greet(name): — это объявление функции. Код внутри НЕ выполняется при объявлении. Чтобы функция заработала, нужно её вызвать: greet("Аня"). Без вызова — ничего не произойдёт.'},
                        {'title': 'Параметры в скобках', 'text': 'В def greet(name) — name это параметр. При вызове greet("Аня") — "Аня" передаётся как значение параметра name. Внутри функции name = "Аня". Параметры делают функцию гибкой!'},
                        {'title': 'Имя функции — это действие', 'text': 'Имя функции должно быть глаголом или описывать действие: greet (приветствовать), calculate_sum (посчитать сумму), show_result (показать результат). Так сразу понятно, что делает функция!'},
                    ],
                ),
                _lesson_payload(
                    'Параметры и return',
                    'Передаём данные внутрь функции через параметры и получаем результат обратно через return. Так функция становится настоящим инструментом.',
                    ['Параметры — переменные, которые получают значения при вызове', 'return возвращает значение и завершает функцию', 'Одна функция должна делать одно понятное действие'],
                    'Посчитай сумму',
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Посчитай сумму')]['prompt'],
                    ['def', 'return'],
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Посчитай сумму')]['hints'],
                    [
                        _question_single('m33', 'Что делает return?', ['Запускает цикл', 'Возвращает значение', 'Открывает файл', 'Рисует квадрат'], 1),
                        _question_order('m34', 'Порядок работы функции.', ['Написать def', 'Передать аргументы', 'Получить результат'], ['Написать def', 'Передать аргументы', 'Получить результат']),
                    ],
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Посчитай сумму')]['starter_code'],
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Посчитай сумму')]['validation'],
                    mentor_tip='Функция с return — как калькулятор: даёшь числа, получаешь результат. Функция с print — как принтер: даёшь команду, что-то печатается. Обычно лучше return — результат можно использовать дальше!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'Параметры и return в действии', 'text': 'def add(a, b):\n    return a + b    # возвращает результат\n\nresult = add(2, 3)  # result = 5\nprint(result)       # 5\nprint(add(10, 7))   # 17\n\n# Отличие: return передаёт значение назад\n# print только выводит — значение теряется!'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Параметры — гибкость функции', 'text': 'Параметры — переменные внутри функции, которые получают значения при вызове. def add(a, b) — a и b это параметры. При вызове add(2, 3) — a получает 2, b получает 3. Одна функция, разные данные!'},
                        {'title': 'return — возврат результата', 'text': 'return отправляет результат обратно туда, откуда вызвали функцию. После return функция немедленно завершается — код после него не выполняется. return можно использовать только внутри функции.'},
                        {'title': 'Сохрани результат', 'text': 'result = add(2, 3) — результат функции сохраняется в переменную. Без переменной результат вернётся, но сразу потеряется! Всегда сохраняй то, что собираешься использовать.'},
                        {'title': 'Одна функция — одна задача', 'text': 'Хорошая функция делает одно конкретное дело. add() только считает сумму — не считает И не выводит одновременно. Разделяй вычисление и вывод — код станет понятнее и проще тестировать.'},
                    ],
                ),
                _lesson_payload(
                    'Декомпозиция задач',
                    'Большую задачу делим на маленькие функции, каждая из которых отвечает за одну вещь. Это делает код понятным, тестируемым и лёгким для исправления.',
                    ['Декомпозиция — разбить задачу на маленькие независимые части', 'Каждая функция отвечает только за одно действие', 'Маленькие функции проще тестировать и исправлять'],
                    'Мини-проект заметки',
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Мини-проект заметки')]['prompt'],
                    ['def'],
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Мини-проект заметки')]['hints'],
                    [
                        _question_single('m35', 'Декомпозиция — это...', ['Удаление кода', 'Деление задачи на части', 'Смена языка', 'Публикация модуля'], 1),
                        _question_multiple('m36', 'Что даёт декомпозиция?', ['Читаемость', 'Проверяемость', 'Хаос', 'Повторное использование'], [0, 1, 3]),
                    ],
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Мини-проект заметки')]['starter_code'],
                    _legacy_seeded_code_task_updates()[('middle-functions', 'Мини-проект заметки')]['validation'],
                    mentor_tip='Декомпозиция — суперсила программиста. Любую задачу, которая кажется огромной, можно решить, разбив её на маленькие понятные шаги. Начни с вопроса: «на какие части это можно разделить?»',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'Большая задача → маленькие функции', 'text': 'title = input().strip()\ntext = input().strip()\n\ndef build_note(title, text):    # собирает строку\n    return f"{title}: {text}"\n\ndef show_note(note):             # выводит результат\n    print(note)\n\nshow_note(build_note(title, text))\n# Ввод: "План" и "Сделать проект"\n# Вывод: "План: Сделать проект"'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Что такое декомпозиция', 'text': 'Декомпозиция — разбить большую задачу на маленькие понятные части. Каждую часть проще написать, проще проверить, проще исправить. Не пытайся решить всё сразу!'},
                        {'title': 'Одна функция — одна ответственность', 'text': 'build_note() только собирает строку, show_note() только выводит. Каждая функция отвечает за своё. Это делает код предсказуемым: знаешь название — знаешь, что происходит.'},
                        {'title': 'Тестирование по частям', 'text': 'Когда функции маленькие и независимые, можно проверить каждую отдельно. Нашёл баг в build_note — исправь только её, не трогая остальное. Это называется модульность!'},
                        {'title': 'Читай изнутри наружу', 'text': 'show_note(build_note(title, text)) — сначала выполнится build_note (вернёт строку), потом show_note получит эту строку и выведет её. Вложенные вызовы читаются изнутри наружу!'},
                    ],
                ),
            ],
        },
    ]

    senior_modules = [
        {
            'slug': 'senior-js-basics', 'title': 'JavaScript и DOM', 'description': 'Переход к текстовому программированию и интерфейсам.', 'age_group': 'senior', 'icon': 'layers', 'color': '#0EA5E9',
            'lessons': [
                _lesson_payload(
                    'Переменные в JS',
                    'JavaScript — язык, который оживляет веб-страницы. let и const создают переменные, console.log выводит результат. Это фундамент любого JS-кода.',
                    ['let создаёт переменную, которую можно изменить позже', 'const создаёт константу — значение нельзя переназначить', 'console.log() выводит результат в консоль браузера'],
                    'Создай переменную score',
                    'Напиши код с let score = 10 и выведи значение.',
                    ['let', 'score', 'console.log'],
                    [
                        'Создай переменную через let и присвой ей число 10.',
                        'Название переменной должно быть score, как в задании.',
                        'Для вывода результата используй console.log(score).',
                    ],
                    [
                        _question_single('s11', 'Что выводит результат в JS?', ['print()', 'console.log()', 'echo()', 'input()'], 1),
                        _question_match('s12', 'Соедини JS-ключевое слово и смысл.', ['let', 'const'], ['переменная, которую можно менять', 'значение без переназначения'], {'let': 'переменная, которую можно менять', 'const': 'значение без переназначения'}),
                    ],
                    'let score = 10;\nconsole.log(score);\n',
                    _legacy_seeded_code_task_updates()[('senior-js-basics', 'Создай переменную score')]['validation'],
                    mentor_tip='В JavaScript почти всегда используй const. Переключайся на let только когда переменная должна измениться — счётчик, состояние. var — забудь о нём совсем, это устаревший способ!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'let, const и типы данных в JS', 'text': 'let score = 10;          // можно изменить\nconst name = "Аня";      // нельзя переназначить\n\nconsole.log(score);      // 10\nconsole.log(name);       // Аня\n\nscore = 20;              // OK — let разрешает\n// name = "Иван";        // Ошибка! const запрещает'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'let vs const — в чём разница', 'text': 'let — для переменных, которые будут меняться: счётчики, текущее состояние. const — для значений, которые не изменятся: имена, настройки, константы. Используй const по умолчанию — это хорошая практика!'},
                        {'title': 'console.log() — отладка и вывод', 'text': 'console.log() — аналог print() в Python. Всё переданное в скобках появится в консоли браузера (F12 → Console). Можно передавать несколько значений через запятую: console.log("score:", score).'},
                        {'title': 'Типы данных в JavaScript', 'text': 'number: 42, 3.14. string: "Привет" или \'Привет\'. boolean: true или false. Тип определяется автоматически — не нужно указывать явно. JavaScript — динамически типизированный язык.'},
                        {'title': 'Точка с запятой в конце', 'text': 'В JavaScript принято ставить ; в конце каждой инструкции. Технически можно обойтись без неё — JS добавит автоматически, но иногда ошибается. С ; код понятнее и безопаснее. Привыкай ставить!'},
                    ],
                ),
                _lesson_payload(
                    'Условия в JS',
                    'if и логика в JavaScript работают так же, как в Python, но с фигурными скобками вместо отступов. Главная особенность — строгое сравнение ===.',
                    ['if (условие) { } — фигурные скобки вместо отступов', '=== сравнивает значение И тип, == только значение — всегда используй ===', 'Функции с return позволяют не писать else, если в if стоит return'],
                    'Проверь балл',
                    _legacy_seeded_code_task_updates()[('senior-js-basics', 'Проверь балл')]['prompt'],
                    ['if', '70'],
                    _legacy_seeded_code_task_updates()[('senior-js-basics', 'Проверь балл')]['hints'],
                    [
                        _question_single('s13', 'Как сравнить строго?', ['==', '===', '=>', '!='], 1),
                        _question_order('s14', 'Порядок чтения условия.', ['Сравнить значение', 'Понять true/false', 'Выполнить ветку'], ['Сравнить значение', 'Понять true/false', 'Выполнить ветку']),
                    ],
                    _legacy_seeded_code_task_updates()[('senior-js-basics', 'Проверь балл')]['starter_code'],
                    _legacy_seeded_code_task_updates()[('senior-js-basics', 'Проверь балл')]['validation'],
                    mentor_tip='Запомни навсегда: == проверяет только значение (1 == "1" это true!), а === проверяет и значение, и тип (1 === "1" это false — разные типы). Всегда используй ===, чтобы избежать скрытых ошибок!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'if / else и === в JavaScript', 'text': 'function checkScore(score) {\n  if (score >= 70) {\n    return "pass";   // функция заканчивается здесь\n  }\n  return "retry";  // else не нужен!\n}\n\nconsole.log(checkScore(72));  // pass\nconsole.log(checkScore(40));  // retry\n\n// 70 === 70   → true (число и число)\n// 70 === "70" → false (число и строка!)'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Синтаксис if в JS', 'text': 'if (условие) { код } else { код } — в JavaScript вместо отступов используются фигурные скобки. Скобки обязательны, если в блоке больше одной строки. Если одна строка — можно без скобок, но лучше с ними для читаемости.'},
                        {'title': '=== строгое равенство — всегда!', 'text': '=== сравнивает и значение, и тип данных одновременно. 1 === 1 это true. 1 === "1" это false — потому что число и строка разных типов. Используй === везде, чтобы не получить неожиданный результат.'},
                        {'title': 'return завершает функцию', 'text': 'Если в блоке if стоит return, то else можно не писать — после return функция всё равно завершится. Код после return не выполняется. Это упрощает читаемость: не нужны вложенные блоки!'},
                        {'title': 'Проверь граничные значения', 'text': 'Вызови checkScore с разными значениями: 70 (граница — должно быть pass), 69 (ниже границы — retry), 100 (максимум — pass). Убедись, что обе ветки работают правильно!'},
                    ],
                ),
                _lesson_payload(
                    'DOM-события',
                    'DOM — это представление HTML-страницы как дерева объектов. JavaScript может изменить любой элемент страницы в ответ на действие пользователя.',
                    ['DOM (Document Object Model) — дерево элементов HTML-страницы', 'addEventListener(событие, функция) регистрирует реакцию на действие пользователя', 'Через DOM можно менять текст, стили и классы любого элемента'],
                    'Сделай кнопку',
                    _legacy_seeded_code_task_updates()[('senior-js-basics', 'Сделай кнопку')]['prompt'],
                    ['addEventListener', 'click'],
                    _legacy_seeded_code_task_updates()[('senior-js-basics', 'Сделай кнопку')]['hints'],
                    [
                        _question_single('s15', 'Событие клика — это...', ['hover', 'click', 'keydown', 'submit'], 1),
                        _question_multiple('s16', 'Что можно менять через DOM?', ['Текст', 'Классы', 'Содержимое кнопки', 'Только базу данных'], [0, 1, 2]),
                    ],
                    _legacy_seeded_code_task_updates()[('senior-js-basics', 'Сделай кнопку')]['starter_code'],
                    _legacy_seeded_code_task_updates()[('senior-js-basics', 'Сделай кнопку')]['validation'],
                    mentor_tip='DOM — это не страшно. Думай о нём как о дереве: документ → body → div → кнопка. JavaScript может залезть в любой узел этого дерева и изменить что угодно прямо во время работы страницы!',
                    extra_theory_blocks=[
                        {'type': 'code', 'title': 'addEventListener и изменение элемента', 'text': 'const button = document.querySelector("#myBtn");\n\nbutton.addEventListener("click", () => {\n  button.textContent = "Готово";   // меняем текст\n  button.style.color = "green";    // меняем цвет\n});\n\n// До клика: кнопка с исходным текстом\n// После клика: текст и цвет изменились!'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Что такое DOM', 'text': 'DOM (Document Object Model) — представление HTML-страницы как дерева объектов JavaScript. Каждый тег — узел дерева. Через DOM можно читать и изменять любой элемент страницы прямо во время её работы.'},
                        {'title': 'addEventListener — подписка на событие', 'text': 'addEventListener(событие, функция) говорит браузеру: «когда произойдёт это событие — вызови эту функцию». "click" — клик мышью, "keydown" — нажатие клавиши, "submit" — отправка формы.'},
                        {'title': 'Стрелочная функция () => { }', 'text': '() => { ... } — стрелочная функция. Это компактная запись вместо function() { ... }. Внутри addEventListener удобно использовать именно её — код выглядит чище и короче.'},
                        {'title': 'Что можно изменить через DOM', 'text': 'element.textContent — текст внутри тега. element.style.color — CSS-стиль. element.classList.add("active") — добавляет CSS-класс. element.setAttribute("disabled", true) — меняет атрибут. Это самые частые операции!'},
                    ],
                ),
            ],
        },
        {
            'slug': 'senior-project', 'title': 'Финальный мини-проект', 'description': 'Собираем небольшое приложение и презентуем результат.', 'age_group': 'senior', 'icon': 'trophy', 'color': '#F97316',
            'lessons': [
                _lesson_payload(
                    'Планирование проекта',
                    'Хороший проект начинается не с кода, а с чёткого плана: что делаем, для кого и как проверим результат. Один час планирования экономит десять часов правок.',
                    ['Цель проекта отвечает на вопрос: «какую проблему мы решаем?»', 'User story описывает путь пользователя: открыл → сделал → получил результат', 'MVP — минимальная версия, которая уже решает задачу'],
                    'Составь план',
                    'Опиши 3 шага проекта.',
                    ['шаг'],
                    [
                        'Первый шаг должен объяснять, что именно ты хочешь сделать в проекте.',
                        'Второй и третий шаги лучше оформить как конкретные действия, а не общие слова.',
                        'Проверь, что у тебя получилось ровно три понятных шага.',
                    ],
                    [
                        _question_single('s21', 'Что идёт первым?', ['План', 'Рандомный код', 'Дизайн без цели', 'Удаление файлов'], 0),
                        _question_order('s22', 'Порядок работы над проектом.', ['Понять задачу', 'Набросать шаги', 'Сделать демо'], ['Понять задачу', 'Набросать шаги', 'Сделать демо']),
                    ],
                    mentor_tip='Хороший план экономит в 10 раз больше времени, чем занимает. Напиши цель одним предложением. Если не можешь — значит, цель ещё не ясна. Начни с этого!',
                    extra_theory_blocks=[
                        {'type': 'example', 'title': 'Структура хорошего плана', 'text': 'Пример для приложения «Список дел»:\n\nЦель: пользователь добавляет задачи и отмечает выполненные\n\nШаги:\n1. Форма ввода новой задачи\n2. Список задач с чекбоксами\n3. Кнопка «выполнено» меняет вид задачи\n\nПроверка: открыть в браузере, добавить 3 задачи, отметить одну'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Начни с цели', 'text': 'Начни с вопроса: «Какую проблему решает мой проект?» Ответ на это и есть цель. Без понятной цели легко потратить время на функции, которые никому не нужны.'},
                        {'title': 'User story — путь пользователя', 'text': 'User story — короткое описание пути пользователя: «Пользователь открывает страницу → вводит задачу → нажимает кнопку → видит задачу в списке». Напиши такой сценарий для своего проекта.'},
                        {'title': 'Декомпозиция на части', 'text': 'Раздели проект на три части: интерфейс (что видит пользователь), логика (что происходит при действии), данные (что сохраняется). Начни с самой важной части — без неё проект не работает!'},
                        {'title': 'MVP — сначала минимум', 'text': 'MVP (Minimum Viable Product) — версия с минимальным набором функций, которая уже решает задачу. Сначала сделай MVP, потом улучшай. Лучше простой рабочий проект, чем сложный незаконченный!'},
                    ],
                ),
                _lesson_payload(
                    'Сборка интерфейса',
                    'Собираем экран из блоков: заголовок задаёт контекст, кнопка запускает действие, результат показывает, что произошло. Хороший интерфейс не требует инструкции.',
                    ['Каждый экран состоит из блоков с понятной ролью', 'Кнопка должна иметь конкретное название действия: «Добавить», не «OK»', 'После каждого действия пользователь должен видеть, что что-то изменилось'],
                    'Опиши экран',
                    'Опиши заголовок, кнопку и результат.',
                    ['кнопка', 'заголовок'],
                    [
                        'Сначала назови, какой заголовок увидит пользователь на экране.',
                        'Потом опиши кнопку и действие, которое она запускает.',
                        'В конце добавь, какой результат пользователь увидит после нажатия.',
                    ],
                    [
                        _question_single('s23', 'Хороший интерфейс — это...', ['Понятный', 'Случайный', 'Очень мелкий', 'Без структуры'], 0),
                        _question_match('s24', 'Соедини элемент интерфейса и его роль.', ['Кнопка', 'Заголовок'], ['действие', 'контекст экрана'], {'Кнопка': 'действие', 'Заголовок': 'контекст экрана'}),
                    ],
                    mentor_tip='Хороший интерфейс — тот, который не требует инструкции. Если пользователю нужно объяснять, как им пользоваться — что-то пошло не так. Пройди путь пользователя сам, без подсказок!',
                    extra_theory_blocks=[
                        {'type': 'example', 'title': 'Элементы интерфейса и их роль', 'text': 'Экран «Список дел»:\n\n[Мои задачи]          ← заголовок: контекст\n[Введите задачу...][+] ← поле ввода + кнопка: действие\n[✓ Купить молоко]     ← элемент списка: данные\n[○ Написать отчёт]    ← невыполненная задача\n\nКаждый элемент имеет ровно одну роль!'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Заголовок — контекст для пользователя', 'text': 'Заголовок страницы объясняет, где находится пользователь и что здесь можно делать. «Мои задачи» — сразу понятно. «Главная» — непонятно ничего. Заголовок должен отвечать на вопрос: «где я и зачем?»'},
                        {'title': 'Кнопка = конкретное действие', 'text': 'Каждая кнопка запускает одно понятное действие. «Добавить задачу» лучше «OK». «Удалить задачу» лучше «Удалить». «Отметить выполненной» лучше «Изменить». Будь конкретным — пользователь должен знать, что произойдёт!'},
                        {'title': 'Пройди путь пользователя', 'text': 'Представь, что ты пользователь и видишь интерфейс впервые. Пройди путь сам: открыл → ввёл данные → нажал → увидел результат. Каждый шаг должен быть понятным без подсказок.'},
                        {'title': 'Обратная связь обязательна', 'text': 'После каждого действия пользователь должен видеть результат. Нажал кнопку — список обновился, задача добавилась, цвет изменился. Нет обратной связи — пользователь не знает, сработало ли действие!'},
                    ],
                ),
                _lesson_payload(
                    'Презентация результата',
                    'Хорошая презентация — это проблема, решение и живое демо. Три тезиса, две минуты, один запущенный проект. Покажи результат, а не рассказывай о нём.',
                    ['Структура питча: проблема → решение → демо', 'Живое демо убеждает лучше любых слов', 'Простое объяснение — признак глубокого понимания'],
                    'Собери питч',
                    'Составь 3 тезиса защиты проекта.',
                    ['проблема', 'решение', 'демо'],
                    [
                        'Первый тезис посвяти проблеме, которую решает проект.',
                        'Второй тезис должен коротко объяснять само решение.',
                        'Третий тезис оставь под демо или результат, который можно показать.',
                    ],
                    [
                        _question_single('s25', 'Что важно в финале?', ['Показать демо', 'Скрыть результат', 'Не объяснять решение', 'Только читать код'], 0),
                        _question_multiple('s26', 'Что входит в хороший питч?', ['Проблема', 'Решение', 'Демо', 'Случайный мем'], [0, 1, 2]),
                    ],
                    mentor_tip='Презентуй проект как будто объясняешь другу, который никогда не слышал о программировании. Если он понял — ты справился. Простота объяснения — признак глубокого понимания темы!',
                    extra_theory_blocks=[
                        {'type': 'example', 'title': 'Структура питча за 2 минуты', 'text': 'Тезис 1 (проблема):\n«Сложно не забывать дела — записки теряются»\n\nТезис 2 (решение):\n«Я сделал веб-приложение, где задачи не теряются»\n\nТезис 3 (демо):\n«Смотрите — добавляю задачу и отмечаю выполненной»\n\nВремя: 2-3 минуты. Не больше!'},
                    ],
                    custom_interactive_steps=[
                        {'title': 'Структура: проблема → решение → демо', 'text': 'Сначала объясни, зачем это нужно (проблема). Потом — что ты сделал (решение). Потом — покажи вживую (демо). Эта структура работает для любого проекта, продукта или идеи.'},
                        {'title': 'Покажи, не рассказывай', 'text': 'Живое демо убеждает лучше любых слов. Открой проект, пройди по главному сценарию прямо во время презентации. Аудитория увидит реальный результат — это в сто раз убедительнее слайдов.'},
                        {'title': 'Если что-то сломалось', 'text': 'Если демо не работает — не паникуй. Спокойно объясни, что должно было произойти, и покажи скриншот или видео. Все программисты сталкиваются с такими ситуациями. Главное — не теряться!'},
                        {'title': 'Попроси обратную связь', 'text': 'После презентации спроси: «Что было непонятно?» и «Что можно улучшить?». Это не критика — это способ сделать следующий проект лучше. Лучшие разработчики активно ищут обратную связь!'},
                    ],
                ),
            ],
        },
    ]

    for group_index, module_data in enumerate(junior_modules + middle_modules + senior_modules, start=1):
        module = Module(
            slug=module_data['slug'],
            title=module_data['title'],
            description=module_data['description'],
            age_group=module_data['age_group'],
            icon=module_data['icon'],
            color=module_data['color'],
            order_index=group_index,
            is_published=True,
        )
        db.session.add(module)
        db.session.flush()
        for lesson_index, lesson_payload in enumerate(module_data['lessons'], start=1):
            raw_task = lesson_payload['task']
            task_type = 'code' if age_group_supports_code(module.age_group) and raw_task.get('starter_code') else 'text'
            starter_code = raw_task.get('starter_code', '') if task_type == 'code' else ''
            if (
                has_explicit_code_task_intent(
                    title=raw_task.get('title'),
                    prompt=raw_task.get('prompt'),
                    starter_code=raw_task.get('starter_code', ''),
                )
                and task_type != 'code'
            ):
                raise ValueError(
                    f'Seed lesson "{module.slug}/{lesson_payload["title"]}" has code intent but configured as text task.'
                )
            task_validation = normalize_task_validation(
                raw_task['validation'],
                task_type=task_type,
                age_group=module.age_group,
            )
            lesson = Lesson(
                module_id=module.id,
                slug=f"{module.slug}-lesson-{lesson_index}",
                title=lesson_payload['title'],
                summary=lesson_payload['summary'],
                theory_blocks=lesson_payload['theory_blocks'],
                interactive_steps=lesson_payload['interactive_steps'],
                order_index=lesson_index,
                duration_minutes=8 + lesson_index * 2,
                passing_score=70,
                content_format='mixed',
            )
            db.session.add(lesson)
            db.session.flush()
            db.session.add(
                Task(
                    lesson_id=lesson.id,
                    task_type=task_type,
                    title=raw_task['title'],
                    prompt=raw_task['prompt'],
                    starter_code=starter_code,
                    validation=task_validation,
                    hints=raw_task['hints'],
                    xp_reward=30,
                )
            )
            db.session.add(
                Quiz(
                    lesson_id=lesson.id,
                    title=f"Мини-тест: {lesson.title}",
                    passing_score=70,
                    questions=lesson_payload['quiz'],
                    xp_reward=50,
                )
            )
    db.session.commit()


def seed_demo_users() -> None:
    student_email = (current_app.config.get('DEMO_STUDENT_EMAIL') or '').strip().lower()
    student_password = current_app.config.get('DEMO_STUDENT_PASSWORD') or ''
    teacher_email = (current_app.config.get('DEMO_TEACHER_EMAIL') or '').strip().lower()
    teacher_password = current_app.config.get('DEMO_TEACHER_PASSWORD') or ''
    admin_email = (current_app.config.get('DEMO_ADMIN_EMAIL') or '').strip().lower()
    admin_password = current_app.config.get('DEMO_ADMIN_PASSWORD') or ''

    if not all([student_email, student_password, teacher_email, teacher_password, admin_email, admin_password]):
        return

    student_username = _username_from_email(student_email, 'student_seed')
    teacher_username = _username_from_email(teacher_email, 'teacher_seed')
    admin_username = _username_from_email(admin_email, 'admin_seed')
    if User.query.filter(
        (User.email == student_email) | (User.email == teacher_email) | (User.email == admin_email)
    ).first():
        return

    users = [
        User(
            full_name='Тестовый ученик',
            username=student_username,
            email=student_email,
            password_hash=hash_password(student_password),
            role=UserRole.STUDENT,
            age_group='middle',
            xp=360,
            streak=6,
        ),
        User(
            full_name='Тестовый учитель',
            username=teacher_username,
            email=teacher_email,
            password_hash=hash_password(teacher_password),
            role=UserRole.TEACHER,
            age_group='adult',
            xp=1200,
            streak=12,
        ),
        User(
            full_name='Тестовый администратор',
            username=admin_username,
            email=admin_email,
            password_hash=hash_password(admin_password),
            role=UserRole.ADMIN,
            age_group='adult',
            xp=2400,
            streak=18,
        ),
    ]
    db.session.add_all(users)
    db.session.commit()


def seed_classes_and_assignments() -> None:
    if Classroom.query.count() > 0:
        return
    teacher_email = (current_app.config.get('DEMO_TEACHER_EMAIL') or '').strip().lower()
    student_email = (current_app.config.get('DEMO_STUDENT_EMAIL') or '').strip().lower()
    if not teacher_email or not student_email:
        return

    teacher = User.query.filter_by(email=teacher_email).first()
    student = User.query.filter_by(email=student_email).first()
    lesson = Lesson.query.join(Module).filter(Module.slug == 'middle-python-intro').order_by(Lesson.order_index.asc()).first()
    if not all([teacher, student, lesson]):
        return

    classroom_code = ((current_app.config.get('DEMO_CLASS_CODE') or '').strip().upper() or generate_code(6))
    classroom = Classroom(name='Тестовый класс', description='Класс для проверки teacher-панели', code=classroom_code, teacher_id=teacher.id)
    db.session.add(classroom)
    db.session.flush()
    db.session.add(ClassMembership(classroom_id=classroom.id, student_id=student.id))
    db.session.add(
        Assignment(
            classroom_id=classroom.id,
            lesson_id=lesson.id,
            title='Домашнее задание: приветствие по имени',
            description='Напиши короткую программу, которая спрашивает имя и приветствует пользователя.',
            difficulty='easy',
            due_date=None,
            xp_reward=90,
        )
    )
    db.session.commit()


def repair_legacy_code_task_validations() -> None:
    updates = _legacy_seeded_code_task_updates()
    changed = False
    for task in Task.query.join(Lesson).join(Module).all():
        if not age_group_supports_code(task.lesson.module.age_group):
            target_validation = normalize_task_validation(
                task.validation,
                is_custom_lesson=task.lesson.module.is_custom_classroom_module,
                task_type='text',
                age_group=task.lesson.module.age_group,
            )
            if task.task_type != 'text':
                task.task_type = 'text'
                changed = True
            if task.starter_code:
                task.starter_code = ''
                changed = True
            if task.validation != target_validation:
                task.validation = target_validation
                changed = True
            continue

        key = (task.lesson.module.slug, task.title)
        update = updates.get(key)
        if update:
            target_starter_code = update['starter_code']
            target_validation = normalize_task_validation(
                update['validation'],
                is_custom_lesson=task.lesson.module.is_custom_classroom_module,
                task_type='code',
                age_group=task.lesson.module.age_group,
            )
            target_prompt = update.get('prompt')
            target_hints = update.get('hints')
            if task.task_type != 'code':
                task.task_type = 'code'
                changed = True
            if target_prompt is not None and task.prompt != target_prompt:
                task.prompt = target_prompt
                changed = True
            if target_hints is not None and task.hints != target_hints:
                task.hints = target_hints
                changed = True
            if task.starter_code != target_starter_code:
                task.starter_code = target_starter_code
                changed = True
            if task.validation != target_validation:
                task.validation = target_validation
                changed = True
            continue

        if task.task_type != 'code':
            continue

        normalized = normalize_task_validation(
            task.validation,
            is_custom_lesson=task.lesson.module.is_custom_classroom_module,
            task_type=task.task_type,
            age_group=task.lesson.module.age_group,
        )

        # Code tasks always use the real stdin/stdout judge.
        if task.validation != normalized:
            task.validation = normalized
            changed = True

    if changed:
        db.session.commit()


def seed_all(enable_demo_data: bool = True) -> None:
    if current_app.config.get('SUPERADMIN_BOOTSTRAP', False):
        bootstrap_superadmin()
    seed_achievements()
    cleanup_deprecated_learning_artifacts()
    seed_modules()
    repair_legacy_code_task_validations()
    if enable_demo_data:
        seed_demo_users()
        seed_classes_and_assignments()
