# ProgHUB Orchestration Guide

## Purpose
This repository uses a coordinator pattern rather than a single generalist prompt.

## Parent agent responsibilities
- Interpret the user task.
- Decide whether the task is small enough for direct execution or should be delegated.
- Keep domain specialists focused.
- Prevent overlapping edits.
- Synthesize specialist output into one coherent delivery.

## Delegation heuristics
Use `repo-scout` when:
- the task touches unfamiliar code,
- multiple directories are involved,
- the user asks for a new feature,
- or the file map is unclear.

Use `backend-platform` when:
- API contracts change,
- database shape changes,
- permissions matter,
- background jobs or services are involved,
- backend tests need to be added or repaired.

Use `frontend-product` when:
- the request changes UI flows,
- routes, pages, components, or hooks are involved,
- loading, empty, error, or success states need work.

Use `learning-systems` when:
- the task affects teacher/student interaction,
- lesson creation, learning progression, or AI learning behavior is involved,
- product logic needs an explicit review.

Always use `qa-security` when:
- auth or role access is involved,
- the task claims to be complete,
- the change is large enough to justify an independent check.

## Preferred execution pattern
1. Scout
2. Coordinator plan
3. Backend and/or frontend implementation
4. Product-logic review if relevant
5. QA/security verification
6. Final synthesis
