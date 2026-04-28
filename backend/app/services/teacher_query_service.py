from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import case, func
from werkzeug.exceptions import NotFound

from ..core.db import db
from ..core.gamification import level_from_xp
from ..models.learning import Assignment, AssignmentSubmission, ClassMembership, Classroom, UserProgress
from ..models.user import User

REVIEWED_SUBMISSION_STATUSES = {'checked', 'needs_revision'}


@dataclass(frozen=True)
class AssignmentStats:
    submissions_count: int = 0
    checked_count: int = 0


class TeacherQueryService:
    def __init__(self, session=None):
        self.session = session or db.session

    def _teacher_classes(self, teacher_id: int) -> list[Classroom]:
        return (
            Classroom.query
            .filter_by(teacher_id=teacher_id)
            .order_by(Classroom.created_at.desc())
            .all()
        )

    def _class_member_counts(self, class_ids: list[int]) -> dict[int, int]:
        if not class_ids:
            return {}
        rows = (
            self.session.query(
                ClassMembership.classroom_id,
                func.count(ClassMembership.id),
            )
            .filter(ClassMembership.classroom_id.in_(class_ids))
            .group_by(ClassMembership.classroom_id)
            .all()
        )
        return {classroom_id: count for classroom_id, count in rows}

    def _assignment_stats_map(self, assignment_ids: list[int]) -> dict[int, AssignmentStats]:
        if not assignment_ids:
            return {}
        rows = (
            self.session.query(
                AssignmentSubmission.assignment_id,
                func.count(AssignmentSubmission.id).label('submissions_count'),
                func.sum(
                    case(
                        (AssignmentSubmission.status.in_(REVIEWED_SUBMISSION_STATUSES), 1),
                        else_=0,
                    )
                ).label('checked_count'),
            )
            .filter(AssignmentSubmission.assignment_id.in_(assignment_ids))
            .group_by(AssignmentSubmission.assignment_id)
            .all()
        )
        return {
            assignment_id: AssignmentStats(
                submissions_count=int(submissions_count or 0),
                checked_count=int(checked_count or 0),
            )
            for assignment_id, submissions_count, checked_count in rows
        }

    def _assignment_payload(self, assignment: Assignment, stats: AssignmentStats | None = None) -> dict:
        summary = stats or AssignmentStats()
        return {
            **assignment.to_dict(),
            'submissions_count': summary.submissions_count,
            'checked_count': summary.checked_count,
        }

    def _classroom_payload(
        self,
        classroom: Classroom,
        *,
        students_count: int = 0,
        assignments_count: int = 0,
    ) -> dict:
        return {
            'id': classroom.id,
            'name': classroom.name,
            'description': classroom.description,
            'code': classroom.code,
            'teacher_id': classroom.teacher_id,
            'students_count': students_count,
            'assignments_count': assignments_count,
        }

    def overview_payload(self, teacher: User) -> dict:
        classes = self._teacher_classes(teacher.id)
        class_ids = [item.id for item in classes]
        member_counts = self._class_member_counts(class_ids)

        assignments = (
            Assignment.query
            .filter(Assignment.classroom_id.in_(class_ids))
            .order_by(Assignment.created_at.desc())
            .all()
            if class_ids
            else []
        )
        assignment_ids = [assignment.id for assignment in assignments]
        assignment_stats = self._assignment_stats_map(assignment_ids)
        assignments_per_class: dict[int, int] = {}
        total_submissions = 0

        for assignment in assignments:
            assignments_per_class[assignment.classroom_id] = assignments_per_class.get(assignment.classroom_id, 0) + 1
            stats = assignment_stats.get(assignment.id, AssignmentStats())
            total_submissions += stats.submissions_count

        return {
            'summary': {
                'classes': len(classes),
                'students': sum(member_counts.get(class_id, 0) for class_id in class_ids),
                'assignments': len(assignments),
                'submissions': total_submissions,
            },
            'classes': [
                self._classroom_payload(
                    classroom,
                    students_count=member_counts.get(classroom.id, 0),
                    assignments_count=assignments_per_class.get(classroom.id, 0),
                )
                for classroom in classes
            ],
        }

    def class_detail_payload(self, teacher: User, classroom_id: int) -> dict:
        classroom = Classroom.query.filter_by(id=classroom_id, teacher_id=teacher.id).first_or_404()
        assignments = (
            Assignment.query
            .filter_by(classroom_id=classroom.id)
            .order_by(Assignment.created_at.desc())
            .all()
        )
        assignment_stats = self._assignment_stats_map([assignment.id for assignment in assignments])
        student_rows = (
            self.session.query(
                ClassMembership.student_id,
                User.username,
                User.full_name,
                User.xp,
                func.count(
                    case((UserProgress.status == 'completed', UserProgress.id), else_=None)
                ).label('completed_lessons'),
                func.avg(
                    case((UserProgress.status == 'completed', UserProgress.score), else_=None)
                ).label('average_score'),
            )
            .join(User, User.id == ClassMembership.student_id)
            .outerjoin(UserProgress, UserProgress.user_id == ClassMembership.student_id)
            .filter(ClassMembership.classroom_id == classroom.id)
            .group_by(ClassMembership.student_id, User.username, User.full_name, User.xp)
            .order_by(User.full_name.asc(), User.username.asc())
            .all()
        )

        students = [
            {
                'id': student_id,
                'username': username,
                'full_name': full_name,
                'xp': xp,
                'level': level_from_xp(xp),
                'completed_lessons': int(completed_lessons or 0),
                'average_score': round(float(average_score or 0), 1),
            }
            for student_id, username, full_name, xp, completed_lessons, average_score in student_rows
        ]

        member_counts = self._class_member_counts([classroom.id])
        return {
            'classroom': self._classroom_payload(
                classroom,
                students_count=member_counts.get(classroom.id, 0),
                assignments_count=len(assignments),
            ),
            'students': students,
            'assignments': [
                self._assignment_payload(assignment, assignment_stats.get(assignment.id))
                for assignment in assignments
            ],
        }

    def class_assignments_payload(self, teacher: User, classroom_id: int) -> dict:
        classroom = Classroom.query.filter_by(id=classroom_id, teacher_id=teacher.id).first_or_404()
        assignments = (
            Assignment.query
            .filter_by(classroom_id=classroom.id)
            .order_by(Assignment.created_at.desc())
            .all()
        )
        stats_map = self._assignment_stats_map([assignment.id for assignment in assignments])
        return {
            'assignments': [
                self._assignment_payload(assignment, stats_map.get(assignment.id))
                for assignment in assignments
            ]
        }

    def assignment_submissions_payload(self, teacher: User, assignment_id: int) -> dict:
        assignment = db.session.get(Assignment, assignment_id)
        if assignment is None:
            raise NotFound()
        if assignment.classroom.teacher_id != teacher.id:
            raise PermissionError('Forbidden')

        submissions = (
            AssignmentSubmission.query
            .filter_by(assignment_id=assignment.id)
            .order_by(AssignmentSubmission.submitted_at.desc())
            .all()
        )
        stats = AssignmentStats(
            submissions_count=len(submissions),
            checked_count=len([row for row in submissions if row.status in REVIEWED_SUBMISSION_STATUSES]),
        )
        return {
            'assignment': self._assignment_payload(assignment, stats),
            'submissions': [submission.to_dict() for submission in submissions],
        }
