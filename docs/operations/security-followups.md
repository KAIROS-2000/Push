# Security follow-ups (out-of-codebase)

These audit findings can NOT be closed by changing source files alone.
They require operator action and are tracked here so they don't drift.

## S-19 — Rotate the leaked GigaChat key

**Status:** OPEN.
**Risk:** the historical `.env` (committed before this repo was sanitized) contained a
real `GIGACHAT_AUTH_KEY`. Anyone with read access to the git history can replay it
against Sber's API and burn quota / impersonate the integration.

**Required steps:**

1. Open the Sber GigaChat console, revoke the existing `Authorization key`,
   and issue a new one.
2. Run `git filter-repo --path .env --invert-paths` (or BFG equivalent) to
   excise the file from history. Coordinate with all collaborators — every
   local clone must be re-cloned afterwards.
3. Force-push to all hosting remotes (`git push --force-with-lease origin --all`
   and `--tags`).
4. Issue the new key only via Docker secret + `.env` not committed to VCS.
5. Until (1)-(4) are done, keep the GigaChat endpoint disabled — see audit C-08
   marker in `backend/app/api/student.py:lesson_gigachat`.

## C-08 — Decide the fate of the GigaChat integration

**Status:** OPEN, waiting for product decision.
The integration code in `backend/app/core/gigachat.py` is intact (~16 KB, full
OAuth + token cache + retries). The HTTP endpoint that exposes it
(`POST /api/lessons/<id>/gigachat`) is a hard-coded `404`.

Pick one:

- **Delete:** remove `backend/app/core/gigachat.py`, all `GIGACHAT_*` keys from
  `Config`, `.env.example`, the validator, and remove the endpoint stub. Update
  README to drop the AI-assistant promise.
- **Re-enable:** restore the previous logic in `lesson_gigachat`, ensure S-19
  is fully completed first, and add an integration test that exercises the
  503-fallback when the upstream is unreachable.

## C-10 — CI secrets via GitHub Actions Secrets

**Status:** OPEN.
The current `ci.yml` hard-codes `SECRET_KEY: UnitTestSecretKey...` and
`DATABASE_URL: postgresql://codequest:codequest@...` as workflow-level env. These are
test-only values, but they are still readable in the public workflow file and
any developer copying the snippet into their own production setup will keep
them.

**Required steps (in GitHub UI, not in this repo):**

1. Repository → Settings → Secrets and variables → Actions.
2. Add `CI_SECRET_KEY` (output of `openssl rand -hex 32`).
3. Replace the inline `SECRET_KEY:` env line with `${{ secrets.CI_SECRET_KEY }}`.
4. The Postgres credential pair `codequest:codequest` is acceptable for the
   ephemeral CI service container (network is not exposed) but should match
   the operator's production setup style — document the deviation.

## Test verification

Run `python -m unittest discover -s backend/tests -v` after each step to make sure
the runtime validators still accept the new values (they reject placeholders /
weak passwords automatically in production mode).
