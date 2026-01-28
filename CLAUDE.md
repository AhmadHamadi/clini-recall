\# Clini Recall — Claude Operating Rules



You must follow docs/PRD.md strictly.



Non-negotiables:

\- Multi-tenant isolation: every entity has clinic\_id; every query is scoped by clinic\_id from auth context.

\- Dentrix via Kolla is read-only. No writes to Dentrix. No auto-booking.

\- No auto-send SMS. Every outbound requires a human click.

\- STOP is absolute: inbound STOP immediately opts out and blocks all future sends and queued jobs.

\- Rules decide WHO and WHEN. AI only assists with wording and interpretation.

\- System must function without AI (templates + keyword fallback).

\- Build only the current phase. No feature creep.



Development standards:

\- Prefer simple, explicit code.

\- Avoid clever abstractions.

\- Add tests for tenancy, STOP handling, and idempotency.



