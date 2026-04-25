# ProgHUB Agent Operating Guide

This repository uses a coordinator-first orchestration workflow.

## Global goals
- Preserve existing architecture, naming, and UX patterns.
- Prefer incremental changes over broad rewrites.
- Keep backend business logic out of UI components.
- Treat authentication, authorization, messaging, payments, file access, and evaluation/judge flows as high-risk domains.
- Add or update tests for meaningful behavior changes.
- Keep all generated planning and implementation artifacts in English.

## Orchestration policy
- The parent agent is the coordinator.
- The coordinator should proactively delegate specialized work to subagents when the task spans multiple domains or would benefit from isolated context.
- Do not let two writing agents edit the same files at the same time.
- Parallelize only when file ownership is clearly separated.
- Use a readonly scout first for large or unclear tasks.
- Use a readonly QA/security reviewer before declaring a task complete.

## Domain ownership
- `repo-scout`: repository mapping, file discovery, reuse opportunities, risk discovery.
- `backend-platform`: APIs, database, migrations, permissions, services, tests.
- `frontend-product`: Next.js/React/Tailwind UI, state, fetch integration, UX states.
- `learning-systems`: learning flow logic, AI-assisted flows, cross-domain product reasoning.
- `qa-security`: verification, regression checks, auth/access review, contract mismatches.

## Delivery standard
Every substantial task should end with:
1. A short execution summary.
2. Files changed.
3. Risks or follow-up items.
4. Verification performed.
