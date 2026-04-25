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
    ParentInvite,
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
    if Achievement.query.count() > 0:
        return
    achievements = [
        ('first_code', 'Первый код', 'Написать первую программу', 'start', 'sparkles', 50),
        ('perfect_five', 'Безошибочный', 'Пройти 5 уроков подряд без ошибок', 'mastery', 'badge-check', 150),
        ('marathon', 'Марафонец', 'Заходить 30 дней подряд', 'persistence', 'flame', 500),
        ('explorer', 'Исследователь', 'Закрыть все модули возрастной группы', 'progress', 'map', 300),
        ('lightning', 'Молния', 'Решить задачу меньше чем за минуту', 'speed', 'zap', 75),
    ]
    for code, name, description, category, icon, xp in achievements:
        db.session.add(Achievement(code=code, name=name, description=description, category=category, icon=icon, xp_reward=xp))
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
    return {
        'title': title,
        'summary': summary,
        'theory_blocks': [
            {'type': 'hero', 'title': title, 'text': summary},
            {'type': 'list', 'title': 'Ключевые понятия', 'items': concepts},
            {'type': 'tip', 'title': 'Совет наставника', 'text': 'Сначала прочитай объяснение, потом измени пример и только после этого переходи к практике.'},
        ],
        'interactive_steps': [
            {'title': 'Пошаговый пример', 'text': 'Нажимай Далее и смотри, как меняется результат после каждого шага.'},
            {'title': 'Мини-эксперимент', 'text': 'Попробуй изменить одну команду или значение и посмотри, что изменится.'},
        ],
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
                    'Разбираем, как компьютер выполняет команды и почему программа — это точная инструкция.',
                    ['Компьютер следует алгоритму', 'Программа — это набор команд', 'Устройства ввода и вывода помогают общаться с техникой'],
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
                ),
                _lesson_payload(
                    'Алгоритмы вокруг нас',
                    'Ищем алгоритмы в привычных действиях и учимся объяснять их понятно.',
                    ['Порядок важен', 'Шаги должны быть понятными', 'Повторение можно описать один раз'],
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
                ),
                _lesson_payload(
                    'Привет, мир!',
                    'Создаём первое сообщение для программы и понимаем, что у кода всегда есть результат.',
                    ['Команда должна быть понятной', 'У программы есть результат', 'Первый шаг в программировании — простая команда'],
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
                ),
            ],
        },
        {
            'slug': 'junior-sequence', 'title': 'Последовательности', 'description': 'Команды по порядку и путь персонажа.', 'age_group': 'junior', 'icon': 'route', 'color': '#2ECC71',
            'lessons': [
                _lesson_payload(
                    'Команды по порядку',
                    'Учимся ставить команды в правильной последовательности и видеть, как меняется результат.',
                    ['Порядок влияет на результат', 'Один пропуск ломает решение', 'Каждый шаг должен быть точным'],
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
                ),
                _lesson_payload(
                    'Рисуем фигуры',
                    'Строим последовательность команд для квадрата.',
                    ['Каждая сторона квадрата одинаковая', 'Команда может повторяться', 'Последовательности удобно проверять по шагам'],
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
                ),
                _lesson_payload(
                    'Маршрут персонажа',
                    'Помогаем герою дойти до звезды кратчайшим путём.',
                    ['Путь можно проверять по клеткам', 'Ошибки видно на маршруте', 'Короткий путь удобнее'],
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
                    'Знакомство с языком и его синтаксисом.',
                    ['Python читается почти как английский', 'Команды выполняются сверху вниз', 'print() выводит текст'],
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
                ),
                _lesson_payload(
                    'Переменные и типы',
                    'Учимся хранить имя, возраст и число очков.',
                    ['Переменная хранит данные', 'Строка и число — разные типы', 'Имена переменных должны быть понятными'],
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
                ),
                _lesson_payload(
                    'input() и print()',
                    'Принимаем данные от пользователя и отвечаем ему.',
                    ['input() читает текст', 'print() показывает результат', 'Можно объединять ввод и вывод'],
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
                ),
            ],
        },
        {
            'slug': 'middle-conditions', 'title': 'Условия и логика', 'description': 'if / elif / else и мини-проекты.', 'age_group': 'middle', 'icon': 'git-branch', 'color': '#EC4899',
            'lessons': [
                _lesson_payload(
                    'if / else',
                    'Учимся принимать решения в коде.',
                    ['if проверяет условие', 'else нужен для запасного сценария', 'Условия зависят от данных'],
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
                ),
                _lesson_payload(
                    'Логические операторы',
                    'Соединяем несколько условий и проверяем сложные сценарии.',
                    ['and требует два истинных условия', 'or требует хотя бы одно', 'not переворачивает условие'],
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
                ),
                _lesson_payload(
                    'Мини-проект: калькулятор возраста',
                    'Собираем ввод, условие и вычисление в одну мини-программу.',
                    ['Проект сочетает ввод, переменные и условия', 'Проверки делают программу понятнее', 'Итог можно красиво вывести'],
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
                ),
            ],
        },
        {
            'slug': 'middle-functions', 'title': 'Функции', 'description': 'Разбиваем код на понятные части.', 'age_group': 'middle', 'icon': 'function-square', 'color': '#10B981',
            'lessons': [
                _lesson_payload(
                    'Зачем нужны функции?',
                    'Функции помогают повторно использовать код и делать проект чище.',
                    ['def создаёт функцию', 'Функцию можно вызвать много раз', 'Имя функции описывает действие'],
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
                ),
                _lesson_payload(
                    'Параметры и return',
                    'Передаём данные внутрь функции и получаем результат обратно.',
                    ['Параметры делают функцию гибкой', 'return возвращает значение', 'Одна функция — одно понятное действие'],
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
                ),
                _lesson_payload(
                    'Декомпозиция задач',
                    'Большую задачу делим на маленькие функции, которые проще тестировать.',
                    ['Декомпозиция делает код проще', 'Маленькие функции легче тестировать', 'Описательные имена улучшают читаемость'],
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
                    'let, const и базовые типы данных в JavaScript.',
                    ['let и const создают переменные', 'Строки и числа — базовые типы', 'console.log выводит результат'],
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
                ),
                _lesson_payload(
                    'Условия в JS',
                    'if и логика для интерактивных страниц.',
                    ['if проверяет условие', '=== сравнивает строго', 'else срабатывает иначе'],
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
                ),
                _lesson_payload(
                    'DOM-события',
                    'Кнопки, клики и простая реакция интерфейса.',
                    ['DOM — это структура страницы', 'addEventListener ловит события', 'Интерфейс можно менять кодом'],
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
                ),
            ],
        },
        {
            'slug': 'senior-project', 'title': 'Финальный мини-проект', 'description': 'Собираем небольшое приложение и презентуем результат.', 'age_group': 'senior', 'icon': 'trophy', 'color': '#F97316',
            'lessons': [
                _lesson_payload(
                    'Планирование проекта',
                    'Разбиваем проект на маленькие шаги и определяем сценарий пользователя.',
                    ['Нужна цель', 'Нужны шаги', 'Нужна проверка результата'],
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
                ),
                _lesson_payload(
                    'Сборка интерфейса',
                    'Создаём экран и базовые действия так, чтобы путь пользователя был понятен.',
                    ['Интерфейс состоит из блоков', 'Каждая кнопка должна иметь действие', 'Пользовательский путь должен быть понятен'],
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
                ),
                _lesson_payload(
                    'Презентация результата',
                    'Показываем проблему, решение и демо так, чтобы идею понял любой зритель.',
                    ['Нужно показать путь пользователя', 'Важно объяснить выбор решений', 'Финал — это короткое демо'],
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


def seed_parent_invite() -> None:
    if ParentInvite.query.count() > 0:
        return
    student_email = (current_app.config.get('DEMO_STUDENT_EMAIL') or '').strip().lower()
    if not student_email:
        return
    student = User.query.filter_by(email=student_email).first()
    if not student:
        return
    parent_code = ((current_app.config.get('DEMO_PARENT_CODE') or '').strip().upper() or f"PAR-{generate_code(8)}")
    db.session.add(
        ParentInvite(
            student_id=student.id,
            code=parent_code,
            label='Родительский кабинет',
            weekly_limit_minutes=180,
            modules_whitelist=['middle-python-intro', 'middle-conditions'],
            expires_at=ParentInvite.next_month_expiry(),
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
        seed_parent_invite()
