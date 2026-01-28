1. PRODUCT GOAL (LOCKED)

Clini Recall is a daily-action system for dental front desks.

It tells staff:

Who to contact

Why

What to say

What to do next

Primary outcomes:

Recover overdue recall

Rebook cancellations

Fill short-notice gaps

Keep SMS safe, compliant, and human-controlled

This is not an automation-first system.
This is a rules-first, human-in-the-loop system.

2. TARGET USERS
A) Receptionist / Front Desk (Primary)

Works on desktop all day

Wants clarity, not complexity

Must trust the system

B) Clinic Owner / Manager

Wants consistency and compliance

Wants visibility, not micromanagement

C) Platform Admin (You)

Controls onboarding

Controls SMS usage

Controls integrations

Controls safety

3. NON-NEGOTIABLE PRINCIPLES (DO NOT VIOLATE)

Multi-tenant isolation

Every row scoped by clinic_id

Enforced in middleware, jobs, queries

PMS is read-only

No writes to Dentrix

No auto-booking

Rules decide WHO and WHEN

AI only helps with wording and interpretation

No auto-send

Every outbound message requires a human click

STOP is absolute

Immediate opt-out

Blocks API sends + queued jobs

System works without AI

Templates + keyword fallback always available

4. SUPPORTED PMS (v1)
✅ Dentrix (via Kolla Unify) — FIRST
🔜 OpenDental (via Kolla)
🔜 AbleDent (direct read-only DB adapter)

Dentrix defines the canonical data contract.
All other PMSs must adapt to it.

5. CORE FEATURES (v1 SCOPE)
5.1 Authentication & Roles
Roles:

Platform Admin

Clinic Admin

Clinic Staff

Rules:

Users belong to clinics via memberships

JWT always includes user_id, clinic_id, role

Clinic users cannot change PMS type

5.2 Clinic Onboarding (Admin-only)

When creating a clinic:

Select PMS:

Dentrix (Kolla)

OpenDental (later)

AbleDent (later)

Set timezone

Set default recall interval

Set SMS caps (within platform limits)

This PMS selection is authoritative.

5.3 Kolla Dentrix Integration (v1)
Required endpoints:

Contacts (patients)

Appointments

Appointment types

Appointment statuses

Sync strategy:

Daily patient sync

Every 15–30 min appointment sync

Use filtering (updated_since)

Upsert by external IDs

Track:

last_sync_at

last_sync_error

Cancellation detection:

Status change OR disappearance

Creates “Cancellation Rebook” task

5.4 Today Board (PRIMARY UI)

Single screen with 4 sections:

Recall Due

Cancellations to Rebook

Short-Notice Opportunities

Unanswered Messages

Each item shows:

Patient name + phone

Reason (clear text)

Recommended action

Message preview (editable)

Actions:

Send

Snooze

Skip (reason required)

Mark outcome

Board generation is idempotent.

5.5 Recall Engine (Rules-first)

Eligibility:

Has phone

Not opted out

Not contacted within cooldown (14 days)

Overdue by recall logic

Scoring:

Days overdue (primary)

Limits:

Daily cap (default 20)

Max attempts (3)

Cooldown always enforced

5.6 Cancellation Rebooking

Trigger:

Dentrix appointment cancelled

Flow:

Create rebook task

Suggest rebook message

Staff sends message

Staff books manually in PMS

Outcome logged

5.7 Short-Notice / Gap Filling

Source:

Cancellation creates gap

Candidate pool:

Patients marked “short-notice”

Respect cooldown and opt-outs

AI:

Draft message only

Staff selects and sends

5.8 Two-Way SMS (Twilio)
Outbound:

Uses Messaging Service

Blocked if:

opted out

cooldown

daily/monthly cap reached

Inbound:

Routed by To-number → clinic

Threaded by patient

STOP triggers immediate opt-out

5.9 Inbox

Thread list

Thread view

Manual replies

AI suggested reply (optional)

Unanswered threads create board items

5.10 AI Copilot (Optional per clinic)

AI can:

Rewrite messages

Classify reply intent

Suggest replies

AI cannot:

Choose patients

Send messages

Override rules

Failure-safe: templates + keyword detection.

6. DATA MODEL (HIGH LEVEL)

Minimum entities:

Clinics

Users

ClinicMemberships

Patients

Appointments

BoardItems

Threads

Messages

OptOuts

ContactAttempts

AuditLogs

Every entity includes clinic_id.

7. PLATFORM ADMIN CONTROLS

Platform Admin can:

View all clinics

Set SMS caps

Pause SMS per clinic

View usage + audit logs

Disable AI per clinic

Clinics cannot override platform limits.

8. ACCEPTANCE CRITERIA (MUST PASS)

Clinic A cannot see Clinic B data

STOP blocks all future sends instantly

Board regeneration creates no duplicates

Cancellation creates rebook task

AI downtime does not block workflows

All sends logged with user + timestamp

🛠️ BUILD PLAN (STEP-BY-STEP)
Phase 0 — Skeleton

Repo structure

Env setup

Health check

Phase 1 — Security & Tenancy

Auth

Clinic scoping

Audit logs

Phase 2 — Twilio Messaging

Outbound + inbound

STOP compliance

Threading

Phase 3 — Today Board (Mock Data)

Rules engine

Idempotent generation

Outcomes

Phase 4 — Kolla Dentrix Adapter

Real patient sync

Appointment sync

Cancellation detection

Phase 5 — Polish + Guardrails

SMS caps

Quiet hours

Admin controls