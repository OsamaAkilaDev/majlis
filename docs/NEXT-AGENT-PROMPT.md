# Prompt for the next session

Paste everything below into a fresh Claude Code session at `C:\Users\Osama\Desktop\majlis-v2`.

---

Build Stage 5 of Majlis: events and registration.

Read `handoff.md` first, then `docs/specs/2026-09-10-majlis-design.md` §13 "How a stage is built", §7.3 and §7.4. Do not read `../majlis`, which is an abandoned build whose `CLAUDE.md` is actively wrong about this stack.

**Work this way, and do not add ceremony to it.**

1. Brainstorm with me only on what the spec genuinely leaves open. Ask your questions in one message, not one at a time.
2. Write a plan of three to five tasks. A task is "the API half", not "one endpoint". Name the files, the routes and the invariants. Do not write out every test in the plan.
3. Build it in two dispatches, API then web, committing per section.
4. Review once, at the end, for exploitable defects and spec violations only. Fix what it finds. If it finds nothing, we merge.

No per-task reviews. No separate stage design document unless you hit architecture the main spec does not settle, and if you do, keep it under a page. No fix round unless the review found something real.

**What Stage 5 owes, beyond the spec's own list:**

- **Field-level edit permissions.** Spec §6.1 gives Marketing "public fields" and CTO "technical fields" on clubs and events. Stage 4 deferred this because events need the same mechanism. Build it once here and apply it to clubs in the same change.
- **Event poster upload** reuses Stage 4's pipeline. Add `event-poster` to `IMAGE_KINDS` in `packages/contracts/src/clubs/index.ts` and `PATHS` in `apps/api/src/storage/image-kinds.ts`. The path convention `events/<eventId>/poster.webp` is already agreed.

**What gets tested, and nothing beyond it:**

- The capacity guarantee, under real concurrency, proven by removing the row lock and watching it break.
- Waitlist ordering and transactional promotion.
- The event lifecycle transitions that must be refused.
- One allowed role and one refused role per new permission.
- The registration window boundaries.

Not every guard branch, not every 404, not every field of every response. Stage 4 wrote 269 integration tests and six of them found everything that mattered.

**Two rules that are not negotiable, because each has already cost this project real bugs:**

- When you write a test, delete the code it guards and confirm it goes red. If you cannot make it fail, it is not a test.
- Assert the response detail message, not only the status code, wherever a specific error mapping is the thing under test. A dead error-mapping branch survived three stages because every test asserted the status and none asserted the text.

**Keep:** database invariants as partial unique indexes and CHECK constraints with hand-written SQL, `TransactionHost` for every write, audit rows in the same transaction, `DomainError` subclasses, cursor pagination everywhere, and a security review before the stage merges.

**Pace:** Stage 4 was correct and took far too long, entirely on process. Lead your replies to me with the answer. Keep code comments to a line or two. No em dashes anywhere, and no explanatory UI copy: layout guides the user, not prose.

Stage 4 is on branch `stage-4-clubs-team-membership` and may still be unmerged. Check `git log` and `git status` before you start, and merge it to `master` first if it is green.
