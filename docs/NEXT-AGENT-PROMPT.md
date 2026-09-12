# Prompt for the next session

Paste everything below into a fresh Claude Code session at `C:\Users\Osama\Desktop\majlis-v2`.

---

Build Stage 6 of Majlis: attendance and certificates.

Read `handoff.md` first, then `docs/specs/2026-09-10-majlis-design.md` §13 "How a stage is built", §7.5 and §7.6. Do not read `../majlis`, an abandoned build whose `CLAUDE.md` is actively wrong about this stack.

**Work this way, and do not add ceremony to it.**

1. Brainstorm with me only on what the spec genuinely leaves open. Ask your questions in one message, not one at a time.
2. Write a plan of three to five tasks. A task is "the API half", not "one endpoint". Name the files, the routes and the invariants. Do not write out every test in the plan.
3. Build it in two dispatches, API then web, committing per section.
4. Review once, at the end, for exploitable defects and spec violations only. Fix what it finds.

No per-task reviews. No separate stage design document unless you hit architecture the main spec does not settle, and if you do, keep it under a page.

**This stage is the one where a mistake is most expensive.** It signs tokens, it decides who may scan whom, and it issues documents people will show to employers. Two things follow from that:

- **Run the security review before the stage merges, not as a formality.** Stage 5's review found a secret being written to the logs on every request, a permission bypass on an upload route, and a lifecycle that replayed its own state transitions under concurrency. This stage has more surface than that one.
- **The signing key never appears in code, in a log, or in an audit row, and no raw token is ever stored.** Add the new secret's header or field to `LOG_REDACT_PATHS` in `apps/api/src/config/log-redaction.ts` in the same commit that introduces it, with a test. Stage 5 shipped the sweep secret without that and it landed in every request log.

**What Stage 6 owes, beyond the spec's own list:**

- **The scanner is the one screen that must work one-handed, in a noisy hall, on a bad connection.** §7.5 names seven distinct scan results and says they must render "distinctly and unambiguously". Treat that list as the spec it is: checked in (with name and email to eyeball), already checked in (with the original time), not registered, registration cancelled, event not open, invalid or superseded pass, and not authorised. A failure must never reveal anything about an unrelated student.
- **`GET /verify/{code}` is public and unauthenticated.** It returns holder name, event title, club name, issue date and status, and nothing else, ever. It is also the only anonymous route in the product, so it needs its own thought about rate limiting even though Stage 8 owns the rest.
- **There is no `error.tsx` anywhere in `apps/web`**, and every client `load()` effect rejects unhandled on a non-404/403 error, so a revoked session mid-use leaves the screen on its skeleton forever. Fix that here: the scanner is the worst possible place to discover it.

**What gets tested, and nothing beyond it:**

- Double check-in is impossible under two operators scanning simultaneously, proven by removing the unique index and watching it break.
- `issueForEvent` is idempotent, proven by running it twice and asserting one certificate.
- A `NO_SHOW` never receives a certificate.
- Token rotation kills every previously issued image immediately.
- One allowed role and one refused role per new permission, including the event-assignment path that grants scan rights without a standing officer role.
- The correction window boundary, and that an Admin may cross it with a reason.

Not every guard branch, not every 404, not every field of every response.

**Two rules that are not negotiable, because each has already cost this project real bugs:**

- When you write a test, delete the code it guards and confirm it goes red. If you cannot make it fail, it is not a test. Stage 5 applied 21 mutations and every one went red; six others survived the suite and one of those was a real gap.
- Assert the response detail message, not only the status code, wherever a specific error mapping is the thing under test.

**Keep:** database invariants as partial unique indexes and CHECK constraints with hand-written SQL, `TransactionHost` for every write, audit rows in the same transaction, `DomainError` subclasses, cursor pagination everywhere.

**Never edit an applied migration file, including its comments.** Prisma stores the file's hash and `migrate dev` will refuse to run and offer to drop your database. This happened, both databases are repaired, and the trap is still there.

**Pace:** Stage 5 was correct but slow, and the slowness was process, not code. Lead your replies to me with the answer. Keep code comments to a line or two. No em dashes anywhere, and no explanatory UI copy: layout guides the user, not prose.

Stage 5 is on branch `stage-5-events-registration`. Check `git log` and `git status` before you start, and merge it to `master` first if it is green.
