# ProgHUB Cursor Command Pack

This pack implements a **single Cursor slash command** for your repository:

```text
/proghub-orchestrate <your task>
```

## What this gives you
- One explicit command to start work inside Cursor Agent.
- A coordinator-first workflow.
- Automatic delegation to specialized subagents.
- English-only orchestration materials.

## Why this implementation matches Cursor's official docs
- Cursor automatically discovers skills from `.cursor/skills/`, and skills can be invoked manually by typing `/` and selecting the skill name.
- Setting `disable-model-invocation: true` makes the skill behave like an explicit slash command rather than an automatically applied skill.
- Cursor supports custom subagents in `.cursor/agents/`, and the main agent can delegate to them automatically or by explicit name.
- Cursor loads `AGENTS.md` and project rules alongside the agent session.

## Installation
Copy these files into the root of your repository.

Resulting structure:

```text
AGENTS.md
.cursor/
  agents/
  rules/
  skills/
```

## Recommended model choice
Use a strong parent model in Cursor Agent, then invoke the command. For your available models, a good default is:
- **GPT-5.4** for coordinator-heavy work
- **GPT-5.3 Codex High** for implementation-heavy work

The `repo-scout` and `qa-security` subagents are configured with `model: fast` for lightweight isolated work. The rest inherit the parent model.

## Usage
Open Cursor Agent in the repository and run:

```text
/proghub-orchestrate Implement teacher-student messaging MVP
```

More examples:

```text
/proghub-orchestrate Fix the lesson publish permission bug for teachers
/proghub-orchestrate Review the assignment flow for security and missing tests
/proghub-orchestrate Refactor the student dashboard without changing behavior
```

## Expected behavior
The coordinator should:
1. classify the task,
2. extract constraints,
3. scout the repository when needed,
4. create a short plan,
5. delegate to the right specialists,
6. verify before claiming completion.
