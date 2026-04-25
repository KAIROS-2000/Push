# Judge-runner sandbox hardening (P0-4)

The judge-runner executes arbitrary user-submitted code. It is the
highest-risk component in the stack. This document describes the layered
defences that are currently in place and what operators MUST verify before
enabling the profile on a new host.

## Layers of defence (top → bottom)

1. **Container filesystem is read-only** (`read_only: true`).
   Only `/tmp` is writable and mounted as a `tmpfs` with `noexec,nosuid` and
   a small size cap (128 MiB).
2. **All Linux capabilities dropped** (`cap_drop: [ALL]`). The runner needs
   none of them.
3. **No new privileges** (`security_opt: no-new-privileges:true`). setuid
   binaries cannot elevate.
4. **Custom seccomp profile** (`judge_runner/seccomp.json`, see below).
5. **Process limit** (`pids_limit: 128`) caps fork-bombs at the cgroup level.
6. **Resource limits**:
   - `mem_limit: 512m`, `memswap_limit: 512m` → no swap escape from the
     memory cap.
   - `cpus: 1.0` → a single logical core per container.
   - `ulimits.nproc: 64`, `ulimits.nofile: 256/256` → per-process rlimits as
     a second line of defence behind `pids_limit`.
7. **Network isolation (partial — see known limitation)**. The `judge_net`
   bridge is declared with `internal: true`, which disables the default
   gateway — so the judge-runner has **no Internet egress**. The judge-runner
   is attached ONLY to `judge_net`; it has no route to `backend_net` and no
   route to the host.

   **Known limitation — lateral reach to backend on `judge_net`.** The backend
   service is also attached to `judge_net` (it must, to call the runner's
   HTTP `/execute` endpoint). Docker bridge networks are bidirectional, so
   compromised submitted code CAN initiate HTTP connections back to
   `backend:8000` over `judge_net`. Compensating controls that make this
   largely inert today:

   - The backend's sensitive endpoints require either a valid session cookie
     (which the runner does not possess) or a bearer token. Unauthenticated
     calls from the runner can only hit public health / login / register
     endpoints, and those are rate-limitable.
   - CSRF double-submit (P0-3) blocks unsafe operations from clients that
     cannot read the user's `csrf_token` cookie — which the runner cannot.
   - The runner's bearer token (`CODE_JUDGE_RUNNER_TOKEN`) is produced and
     consumed only by the backend; the runner never needs to use it outbound,
     so it is not stored in a way the sandboxed subprocess can read.

   **Planned upgrade.** A future hardening pass should either (a) replace the
   direct HTTP call with a pull-based job queue (Redis/RabbitMQ with ACLs so
   the runner can only consume from the queue), or (b) install host-level
   iptables rules to drop `judge-runner → backend:8000` traffic. Tracked as
   a follow-up under Phase 1.5 continuation.
8. **Non-root user** (`USER 1001` in the Dockerfile; UID/GID 1001 =
   `judgeuser`). Combined with `no-new-privileges` this makes privilege
   escalation within the container materially harder.
9. **No published ports**. The service exposes 8090 only on the internal
   `judge_net`.

## Seccomp profile

File: `judge_runner/seccomp.json`.

### Strategy chosen

**Allow-by-default with a curated denylist.** The profile sets
`defaultAction: SCMP_ACT_ALLOW` and explicitly blocks syscalls that are not
required to run standard Python / Node programs but which have historically
been used in container escapes or which manipulate kernel-wide state:

- Mount / filesystem: `mount`, `umount`, `umount2`, `pivot_root`, `chroot`,
  `open_by_handle_at`, `name_to_handle_at`, `sysfs`, `ustat`.
- Kernel modules / arbitrary code: `init_module`, `finit_module`,
  `delete_module`, `create_module`, `query_module`, `get_kernel_syms`,
  `kexec_load`, `kexec_file_load`, `bpf`.
- Namespace / clone: `unshare`, `setns`, restricted `clone` flags (see
  caveat below).
- Tracing / cross-VM peek: `ptrace`, `process_vm_readv`, `process_vm_writev`,
  `perf_event_open`, `kcmp`, `lookup_dcookie`.
- Time / host manipulation: `clock_settime`, `clock_adjtime`,
  `settimeofday`, `stime`, `sethostname`, `setdomainname`.
- Swap / quotas / accounting: `swapon`, `swapoff`, `quotactl`, `acct`.
- Legacy / obscure: `uselib`, `vm86`, `vm86old`, `userfaultfd`, `ioperm`,
  `iopl`, `personality`, `reboot`, `nfsservctl`.
- Keyring: `add_key`, `request_key`, `keyctl`.
- NUMA / memory policy: `mbind`, `set_mempolicy`, `get_mempolicy`,
  `migrate_pages`, `move_pages`.
- Fanotify: `fanotify_init`.

Denied syscalls return `EPERM` (errno 1) to the caller.

### Why not a strict whitelist?

A strict whitelist (default-deny, enumerate allowed syscalls) is stronger
but is fragile under Python/Node runtime upgrades — a new glibc or a new V8
version can introduce new syscalls that then fail in ways that look like
application bugs. The allow-default-deny-dangerous profile chosen here is a
pragmatic intermediate; it is materially stronger than the Docker default
(which has a larger allowlist oriented at general container workloads).

A follow-up task is to move to a strict whitelist once the runtime matrix
is stable; `judge_runner/seccomp.json` is a good base for that work.

### Caveat: `clone` / `clone3` filtering

The profile blocks `clone` only when the `CLONE_NEWUSER` flag is present.
Ordinary process creation must remain available because the runner uses
subprocesses to execute Python and Node solutions. The profile also denies
`clone3` with `ENOSYS`: seccomp cannot inspect the flags inside `clone3`'s
pointer argument, and returning `ENOSYS` lets runtimes fall back to `clone`
when they support that path.

Operators SHOULD still validate this on the target host: run the
judge-runner under seccomp, run the full judge test matrix, and confirm that
user-namespace creation remains blocked.

## Verification checklist (required before enabling on a new host)

Run these from the host after `docker compose up -d judge-runner`:

1. **Seccomp is loaded:**
   ```
   docker inspect --format='{{.HostConfig.SecurityOpt}}' proghub-judge-runner
   ```
   Must include `seccomp=...seccomp.json`.
2. **Capabilities are empty:**
   ```
   docker inspect --format='{{.HostConfig.CapDrop}} / {{.HostConfig.CapAdd}}' proghub-judge-runner
   ```
   Expected: `[ALL] / []`.
3. **Running as UID 1001:**
   ```
   docker exec proghub-judge-runner id
   ```
   Expected: `uid=1001(judgeuser) gid=1001(judgeuser) groups=1001(judgeuser)`.
4. **Read-only rootfs:**
   ```
   docker exec proghub-judge-runner sh -c 'touch /abc 2>&1 || echo OK'
   ```
   Expected: `OK`.
5. **No internet egress:**
   ```
   docker exec proghub-judge-runner sh -c 'python -c "import urllib.request; urllib.request.urlopen(\"http://example.com\", timeout=2)"'
   ```
   Expected: network failure.
6. **Full Python and Node smoke tests pass** — run the backend's judge
   integration tests against this container. If any syscall in the denylist
   is in fact needed by the runtime, tests will fail with a clear EPERM
   error; remove the offending syscall from the denylist and document why.
7. **AppArmor (Linux hosts only):** on Debian/Ubuntu hosts, verify that the
   container is confined by the `docker-default` AppArmor profile:
   ```
   docker inspect --format='{{.AppArmorProfile}}' proghub-judge-runner
   ```
   Expected: `docker-default` (this is automatic on Linux hosts with
   AppArmor; it is a no-op on non-Linux Docker Desktop). The compose file
   does not explicitly set it to avoid breaking macOS/Windows dev
   environments.

## If you suspect the seccomp profile is breaking submissions

Temporarily revert to Docker's default by editing the `security_opt:` block
in `docker-compose.yml` (comment out the `seccomp=...` line) and restart
the container. File an issue with the failing submission + the kernel
syscall trace (capture with `strace -f -c` attached to the runner).