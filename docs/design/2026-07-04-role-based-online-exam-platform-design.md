# Role-Based Online Exam Platform Design

## Purpose

Solaire will evolve from a single-user local exam workspace into a role-based teaching platform while preserving its current strengths: local project folders, YAML question banks, PDF/Word export, knowledge graph binding, score import, and AI-assisted workflows.

The target platform has four user surfaces:

- Administrator: the current welcome/project-entry surface extended with platform setup, global AI provider configuration, and school management.
- School: manages school-level AI enablement, teachers, teacher subjects, classes, and students.
- Teacher: a reduced and permission-scoped version of the current main workspace, filtered by assigned subjects and classes.
- Student: an online answering system inspired by PublicQ, with assignments, answer submission, history, results, and analysis.

The system will support both offline and online exams:

- Offline exams keep the current PDF/Word export and manual score upload workflow.
- Online exams can be published to one or more classes, answered by students in the browser, automatically scored where possible, and analyzed with progress and proctoring data.

## References From PublicQ

PublicQ provides useful patterns, but its .NET/EF architecture will not be copied directly. Solaire will reimplement the relevant ideas in FastAPI and React.

Adopted concepts:

- Assignment publishing: a teacher publishes assessment content to a selected audience.
- Student session/progress: each student has a durable attempt with start, answer, submit, and completion state.
- Reporting: reports summarize completion, average score, time spent, student rows, and per-assignment detail.
- Student dashboard: students see available assignments and historical results.
- Exam-taking experience: a dedicated answering page with minimal surrounding navigation.

Adjusted concepts:

- PublicQ's `Group` means a set of assessment modules. In Solaire, "class" means a real teaching class. Solaire will use `classes` for school classes and `exam_publications` for published paper assignments.
- PublicQ has basic anti-shortcut behavior and visibility refresh. Solaire will add explicit proctoring event logs and include them in analysis.
- PublicQ stores all content in a database. Solaire will keep exam/question content in the project file tree and store platform workflow state in a local SQLite database.

## Architecture

### Persistence

Use a hybrid model:

- Existing project files remain the source of truth for question banks, templates, exams, exports, and offline score batches.
- Add a project-local SQLite database at `.solaire/platform.db` for platform state.
- Add a project-local secret file at `.solaire/platform_secret` for session signing.

Rationale:

- The current repository already treats the project folder as the durable workspace.
- Role, class, publication, attempt, and proctoring data need relational queries and should not be spread across many JSON files.
- SQLite avoids Docker and new infrastructure while supporting real platform behavior.

### Backend Modules

Create focused backend modules under `src/solaire/web/`:

- `platform_db.py`: SQLite connection, schema migration, transaction helpers.
- `auth_service.py`: password hashing, user/session creation, role checks.
- `auth_api.py`: login, logout, current user, bootstrap admin, session refresh.
- `school_service.py`: schools, school AI toggle, teachers, subjects, classes, students, assignments of teachers to classes.
- `school_api.py`: school-side CRUD endpoints.
- `paper_service.py`: unified paper management over existing `exams/<label>/<subject>/exam.yaml` plus platform metadata.
- `paper_api.py`: paper listing, delivery mode update, offline score upload handoff, online publication.
- `online_exam_service.py`: publications, student attempts, answer records, submission, scoring, proctoring event ingestion.
- `online_exam_api.py`: student dashboard, attempt lifecycle, answer submission, proctoring event endpoint.
- `platform_analysis_service.py`: PublicQ-inspired report aggregation combining offline scores, online attempts, proctoring events, and existing knowledge graph analysis.
- `platform_analysis_api.py`: report endpoints for teacher, school, admin, and student views.

`src/solaire/web/app.py` remains the FastAPI app composition root. It should import routers from the new modules rather than absorbing the new logic directly.

### Frontend Structure

Add role-aware shells under `web/src/pages/platform/`:

- `AdminWorkspace.tsx`
- `SchoolWorkspace.tsx`
- `TeacherWorkspace.tsx`
- `StudentWorkspace.tsx`
- `PapersWorkspace.tsx`
- `StudentExamPlayer.tsx`
- `StudentResultsWorkspace.tsx`

Add shared role/auth modules:

- `web/src/platform/auth.ts`
- `web/src/platform/roles.ts`
- `web/src/platform/policies.ts`
- `web/src/platform/api.ts`

The current `ComposeWorkspace`, `BankWorkspace`, `TemplateWorkspace`, `GraphWorkspace`, and `AnalysisWorkspace` will not be deleted. Teacher routing will mount a scoped version of them with policy gates and subject/class filters.

## Role Model

Roles:

- `admin`
- `school`
- `teacher`
- `student`

The first platform launch creates or prompts creation of the first `admin` account. Existing project opening behavior remains available through the administrator surface.

Permissions:

- Admin can configure global AI providers, create schools, disable schools, and inspect all platform records.
- School can enable or disable AI for the school, manage teacher accounts, manage teacher subject assignments, import/manage classes, import/manage students, and assign classes to teachers.
- Teacher can manage papers for assigned subjects, publish papers only to assigned classes, import offline scores for their papers, and view analysis for their papers/classes.
- Student can view assigned online papers, answer active papers, submit attempts, and view released results and analysis.

Access enforcement happens on both frontend and backend. Frontend guards are for UX only; backend dependencies must enforce role and ownership.

## Data Model

SQLite tables:

- `schools`
  - `id`, `name`, `status`, `ai_enabled`, `created_at`, `updated_at`
- `users`
  - `id`, `school_id`, `role`, `username`, `password_hash`, `display_name`, `email`, `status`, `created_at`, `updated_at`
- `teacher_subjects`
  - `id`, `teacher_id`, `subject`
- `classes`
  - `id`, `school_id`, `name`, `grade`, `subject_hint`, `created_at`, `updated_at`
- `students`
  - `id`, `school_id`, `student_no`, `display_name`, `email`, `status`, `created_at`, `updated_at`
- `class_students`
  - `class_id`, `student_id`
- `teacher_class_assignments`
  - `teacher_id`, `class_id`, `subject`
- `paper_records`
  - `id`, `exam_id`, `title`, `subject`, `delivery_mode`, `owner_teacher_id`, `school_id`, `status`, `created_at`, `updated_at`
- `exam_publications`
  - `id`, `paper_id`, `teacher_id`, `title`, `description`, `start_at`, `end_at`, `show_results_immediately`, `randomize_questions`, `randomize_answers`, `status`, `created_at`, `updated_at`
- `publication_classes`
  - `publication_id`, `class_id`
- `student_attempts`
  - `id`, `publication_id`, `student_id`, `status`, `started_at`, `submitted_at`, `score`, `max_score`, `time_spent_seconds`
- `student_answers`
  - `id`, `attempt_id`, `question_id`, `answer_payload`, `is_correct`, `score`, `responded_at`
- `proctor_events`
  - `id`, `attempt_id`, `student_id`, `publication_id`, `event_type`, `occurred_at`, `duration_ms`, `payload_json`
- `ai_audit_events`
  - `id`, `user_id`, `school_id`, `role`, `tool_name`, `created_at`, `payload_json`

Delivery mode values:

- `offline`
- `online`

Publication status values:

- `draft`
- `published`
- `closed`
- `archived`

Attempt status values:

- `not_started`
- `in_progress`
- `submitted`
- `expired`

## Paper Workflow

### Offline Paper

1. Teacher composes paper with current group-paper tools.
2. Teacher sets delivery mode to `offline`.
3. Teacher exports PDF/Word as today.
4. Teacher opens the new Papers page and uploads score CSV/Excel there.
5. The existing score import pipeline writes `exams/<label>/<subject>/scores/<batch_id>/`.
6. Analysis page reads the selected paper and score batch.

### Online Paper

1. Teacher composes paper with current group-paper tools.
2. Teacher sets delivery mode to `online`.
3. Teacher publishes to one or more assigned classes from the Papers page.
4. The platform creates an `exam_publications` row and class bindings.
5. Students see the publication in StudentWorkspace.
6. Student starts an attempt; the server snapshots the paper structure for consistent scoring.
7. Student answers questions; each answer is saved.
8. Browser sends proctoring events during the attempt.
9. Student submits; server computes score for automatically gradable questions.
10. Analysis page shows completion, score distribution, per-question results, and proctoring risk.

## Proctoring and Cheating Detection

Student exam pages record events instead of making irreversible cheating judgments.

Events:

- `visibility_hidden`: browser tab/page became hidden.
- `visibility_visible`: browser tab/page became visible.
- `window_blur`: browser window lost focus.
- `window_focus`: browser window regained focus.
- `fullscreen_exit`: fullscreen was exited during a locked exam.
- `blocked_shortcut`: browser detected a blocked shortcut such as print, save, paste, or developer tools key.
- `context_menu`: context menu opened during an exam.
- `copy_paste`: copy, cut, or paste action during an exam.
- `network_resume`: client returned after failed answer/proctoring sync.

Derived analysis fields:

- `switch_count`: number of `visibility_hidden` and `window_blur` events.
- `offscreen_seconds`: accumulated time between hidden/blur and visible/focus events.
- `blocked_action_count`: count of blocked shortcuts, context menu, and copy/paste events.
- `risk_level`: `low`, `medium`, or `high`.

Risk rule:

- `high`: `switch_count >= 5` or `offscreen_seconds >= 120` or `blocked_action_count >= 5`.
- `medium`: `switch_count >= 2` or `offscreen_seconds >= 30` or `blocked_action_count >= 1`.
- `low`: otherwise.

Reports must show these as evidence, not as automatic disciplinary conclusions.

## Analysis Design

The Analysis page becomes report-focused and no longer owns score upload.

Report views:

- Paper summary: total assigned, completed, in progress, not started, average score, average time, completion rate.
- Score distribution: histogram or compact bars.
- Question report: per-question correctness, average score ratio, difficult questions, linked knowledge nodes.
- Student report: score, rank, completion status, time spent, risk level, switch count, offscreen seconds.
- Class comparison: when a publication targets multiple classes.
- Proctoring report: high-risk attempts and event timeline per student.
- AI insight panel: school/teacher can ask AI to summarize report findings if AI is enabled.

Offline analysis:

- Uses existing `scores/<batch_id>/analysis.json`.
- Adds a report wrapper to match the online report shape where possible.

Online analysis:

- Uses attempts, answers, and proctoring events from SQLite.
- Can generate the same per-student and per-question shape used by offline analysis.

## AI Integration

AI availability:

- Admin configures global provider credentials and default model behavior.
- School toggles whether AI is enabled for the school.
- Teacher and school AI calls are allowed only when both global provider config and school toggle are active.
- Students do not get teacher/school AI tools in the first release.

Agent context must include:

- current role
- school id/name
- teacher id and subjects
- assigned class ids
- current page
- selected paper/publication/batch when applicable

New AI tools:

- `school.list_teachers`
- `school.create_teacher`
- `school.assign_teacher_subject`
- `school.list_classes`
- `school.import_students`
- `school.assign_teacher_class`
- `paper.list`
- `paper.set_delivery_mode`
- `paper.publish_online`
- `paper.import_offline_scores`
- `paper.report_summary`
- `publication.progress`
- `analysis.proctoring_summary`

Existing exam, bank, graph, and analysis tools remain available to teachers but must filter by role, subject, and class where relevant.

## Frontend Navigation

Unauthenticated:

- Show login/bootstrap screen.
- If no admin exists, show first-admin setup.

Admin:

- Welcome/project management.
- Global AI provider settings.
- School management.

School:

- Dashboard.
- AI toggle.
- Teacher accounts.
- Teacher subjects.
- Classes.
- Students.
- Teacher-class assignments.

Teacher:

- Papers.
- Compose.
- Bank.
- Graph.
- Template.
- Analysis.
- Assistant.
- Settings with reduced scope.

Student:

- My papers.
- Active exam player.
- History.
- Results and feedback.

The new Papers page sits between Compose and Analysis in the teacher sidebar.

## Migration and Backward Compatibility

Existing Solaire projects must continue to open without platform setup.

Migration behavior:

- On project open, if `.solaire/platform.db` does not exist, initialize schema.
- Existing `exams/<label>/<subject>/exam.yaml` entries appear as `paper_records` lazily when Papers or Analysis lists them.
- Existing exams default to `delivery_mode = offline`.
- Existing score batches stay readable.
- Existing AI settings remain where they are and are wrapped by platform permission checks.

No existing YAML schema should be broken in the first platform release.

## Error Handling

User-facing errors:

- Unauthorized role access returns 403 with a clear message.
- Teacher publishing to an unassigned class returns 403.
- Teacher publishing a subject outside their assigned subjects returns 403.
- Student opening an unavailable publication returns 403 or 404 depending on ownership.
- Attempt submission after deadline marks the attempt expired unless the attempt started before the allowed end and policy permits completion.
- Proctoring sync failures queue client-side events and retry.

Backend logging:

- Auth failures log username and role target, not passwords.
- AI tool calls write `ai_audit_events`.
- Online exam submit errors include publication and attempt ids.

## Testing Strategy

Backend tests:

- Schema initialization and idempotent migration.
- Password hashing and login session verification.
- Role and ownership guards.
- School CRUD and teacher/class/student assignment.
- Paper mode changes and lazy import of existing exams.
- Publishing to allowed and forbidden classes.
- Student attempt lifecycle.
- Answer scoring for single choice, multiple choice, judge, fill, and subjective questions marked as pending manual grading.
- Proctoring event ingestion and risk aggregation.
- Offline and online report aggregation.

Frontend tests:

- Role-based navigation renders correct pages.
- Teacher cannot see admin/school-only pages.
- Papers page moves offline score upload from Analysis.
- Student dashboard lists assigned publications.
- Student exam player records visibility and focus events.
- Analysis renders proctoring risk fields.

Manual verification:

- Admin creates school.
- School creates teacher, class, students, assigns class to teacher.
- Teacher creates online paper and publishes to class.
- Student answers and submits.
- Analysis shows score plus proctoring evidence.
- Teacher creates offline paper and uploads CSV from Papers page.

## Phased Delivery

### Phase 1: Platform and Permission Foundation

Deliver:

- SQLite platform database.
- Admin bootstrap/login/session.
- Role guards.
- Admin, school, teacher, student shells.
- School CRUD for teachers, teacher subjects, classes, students, and teacher-class assignment.
- Teacher sidebar with an active Papers entry that can list papers and show phase-specific unavailable states for later actions.
- Existing project workflows still usable by admin and teacher.

### Phase 2: Papers Page and Offline/Online Mode

Deliver:

- Paper list backed by existing exam workspaces plus `paper_records`.
- Delivery mode toggle.
- Move offline score upload from Analysis to Papers.
- Analysis reads selected paper only and no longer owns upload UI.
- Teacher subject/class filters applied.

### Phase 3: Online Publication and Student Answering

Deliver:

- Publish online paper to one or more assigned classes.
- Student dashboard.
- Student exam player.
- Attempt and answer APIs.
- Auto-scoring for objective question types.
- Result history for students.

### Phase 4: Proctoring and PublicQ-Style Reports

Deliver:

- Browser proctoring event capture.
- Proctoring event ingestion.
- Risk aggregation.
- PublicQ-style assignment report metrics.
- Analysis page report tabs for summary, questions, students, classes, proctoring.

### Phase 5: AI Tool Synchronization

Deliver:

- Role-aware AI availability.
- School AI toggle enforcement.
- New school, paper, publication, and proctoring AI tools.
- Agent page context updates for role, school, teacher subjects, class scope, selected paper, and selected publication.

## Acceptance Criteria

The platform is considered complete when:

- A fresh project can initialize the platform database and create the first admin.
- Admin can create a school.
- School can create teachers, assign subjects, import classes/students, and assign classes to teachers.
- Teacher can only publish papers for assigned subjects and assigned classes.
- A paper can be marked offline or online.
- Offline score upload happens from Papers, not Analysis.
- Student can complete an online paper.
- Proctoring events are captured during student answering.
- Analysis can show both offline score data and online attempt data.
- Analysis includes proctoring risk, switch count, offscreen time, and event evidence.
- AI tools and page context respect role and school AI settings.
- Existing PDF/Word export, question bank, graph, and offline analysis still work.
