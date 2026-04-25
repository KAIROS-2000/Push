from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable

from ..core.db import db
from ..models.learning import Assignment, AssignmentSubmission, ClassMembership, Lesson, UserProgress, lesson_requires_teacher_review
from ..models.user import User

AUTO_SUBMISSION_PREFIX = 'Автоматическая сдача урока:'
SYNCABLE_PROGRESS_STATUSES = {'completed', 'pending_review'}


def _lesson_requires_teacher_review(lesson: Lesson) -> bool:
    return lesson_requires_teacher_review(lesson)


def _auto_submission_answer(lesson: Lesson, progress: UserProgress) -> str:
    completed_at = progress.completed_at or datetime.now(UTC)
    completed_label = completed_at.strftime('%d.%m.%Y %H:%M')
    return (
        f'{AUTO_SUBMISSION_PREFIX} ученик завершил урок "{lesson.title}" '
        f'с результатом {progress.score}%. Время завершения: {completed_label}.'
    )


def _is_auto_submission_answer(answer: str | None) -> bool:
    normalized = (answer or '').strip()
    return not normalized or normalized.startswith(AUTO_SUBMISSION_PREFIX)


def sync_assignment_submission_from_progress(
    assignment: Assignment,
    student: User,
    progress: UserProgress,
    answer: str | None = None,
    feedback: str | None = None,
) -> bool:
    if assignment.lesson_id != progress.lesson_id or progress.status not in SYNCABLE_PROGRESS_STATUSES:
        return False

    lesson = assignment.lesson or progress.lesson
    manual_review_required = _lesson_requires_teacher_review(lesson)
    if not manual_review_required and progress.status != 'completed':
        return False

    normalized_answer = (answer or '').strip()
    generated_answer = normalized_answer or _auto_submission_answer(lesson, progress)
    completed_at = progress.completed_at or datetime.now(UTC)
    target_status = 'pending_review' if manual_review_required and progress.status != 'completed' else 'checked'
    submission = AssignmentSubmission.query.filter_by(assignment_id=assignment.id, student_id=student.id).first()

    if submission is None:
        db.session.add(
            AssignmentSubmission(
                assignment_id=assignment.id,
                student_id=student.id,
                answer=generated_answer,
                score=progress.score,
                status=target_status,
                feedback=feedback,
                submitted_at=completed_at,
            )
        )
        return True

    changed = False
    best_score = max(submission.score, progress.score)
    if submission.score != best_score:
        submission.score = best_score
        changed = True

    should_replace_answer = bool(normalized_answer) or _is_auto_submission_answer(submission.answer)
    if should_replace_answer and submission.answer != generated_answer:
        submission.answer = generated_answer
        changed = True

    if should_replace_answer and submission.submitted_at != completed_at:
        submission.submitted_at = completed_at
        changed = True

    if submission.status != target_status:
        submission.status = target_status
        changed = True

    if feedback is not None and submission.feedback != feedback:
        submission.feedback = feedback
        changed = True

    return changed


def sync_student_assignment_submissions_for_lesson(
    student: User,
    lesson: Lesson,
    progress: UserProgress,
    answer: str | None = None,
    feedback: str | None = None,
) -> bool:
    assignments = (
        Assignment.query.join(ClassMembership, ClassMembership.classroom_id == Assignment.classroom_id)
        .filter(ClassMembership.student_id == student.id, Assignment.lesson_id == lesson.id)
        .all()
    )
    changed = False
    for assignment in assignments:
        changed = sync_assignment_submission_from_progress(assignment, student, progress, answer=answer, feedback=feedback) or changed
    return changed


def backfill_assignment_submissions_for_assignment(assignment: Assignment) -> bool:
    if assignment.lesson_id is None:
        return False

    progress_rows = (
        UserProgress.query.join(ClassMembership, ClassMembership.student_id == UserProgress.user_id)
        .filter(
            ClassMembership.classroom_id == assignment.classroom_id,
            UserProgress.lesson_id == assignment.lesson_id,
            UserProgress.status.in_(tuple(SYNCABLE_PROGRESS_STATUSES)),
        )
        .all()
    )
    changed = False
    for progress in progress_rows:
        changed = sync_assignment_submission_from_progress(assignment, progress.user, progress) or changed
    return changed


def backfill_assignment_submissions_for_assignments(assignments: Iterable[Assignment]) -> bool:
    changed = False
    for assignment in assignments:
        changed = backfill_assignment_submissions_for_assignment(assignment) or changed
    return changed
