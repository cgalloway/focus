# Planned Focus changes

## September 28, 2026

- [x] Use the task's duration from Todoist when available; otherwise default to 10 minutes instead of 25.
  - Clarified September 29, 2026: read Todoist duration first; use the 10-minute fallback only when no duration is set there.
  - Keep explicitly selected per-task durations intact.
  - Status September 30, 2026: implemented and tested in 3.0.4; installed with Focus 3.0.5 on September 30, 2026.
  - User requested implementation of the collected changes on September 30, 2026.

## Compact timer redesign — September 30, 2026

- [x] Tighter pill with fixed control sizes and more room for task names.
- [x] Visible play/pause and Complete; native menu for secondary actions.
- [x] Timer-only and task layouts, paused indicator, progress line, dedicated drag grip, and optional edge snapping.
- [x] Temporary +5 minutes and Do later with countdown preservation.
- [x] Add a task empty state.
- Status: installed and verified in /Applications/Focus.app as 3.0.5 on September 30, 2026, including Settings version, 10-minute default, compact layout, and native menu. Previous 3.0.3 app backed up.

## Compact sizing and menu fixes — September 30, 2026

- [x] Automatically size the task pill to its text; wrap names that exceed the screen width.
- [x] Replace the clipped dropdown with a readable, separate menu panel.
- Installed Focus 3.0.6 in /Applications after approved force-close; previous 3.0.5 app backed up.
- Verified Settings version, full task title visibility, and readable menu on the installed app.

## Todoist completion confirmation — October 1, 2026

- [x] Retain a task until Todoist acknowledges completion, including the compact checkmark.
- [x] Show saving/failure/confirmed feedback and clarify recurring completions with “Done · repeats”.
- [x] Add bounded requests, durable command IDs for safe retries, legacy ID mapping, and protection against stale sync responses.
- Read-only investigation: Todoist activity recorded Review PLT Notes completed October 1 at 5:03 p.m. Pacific; the every-Thursday recurrence is next due October 8. No live task was changed during testing.
- Installed and verified Focus 3.0.7 in /Applications. The existing two-task queue and paused 9:33 countdown were preserved; Settings shows 3.0.7. Previous 3.0.6 app backed up in desktop/backups.
- Validation: 26 unit tests, isolated desktop smoke checks (all external API traffic blocked), source/package comparison, DMG checksum verification, and installed app/version verification passed.

## Automatic overtime — October 2, 2026

- [x] Count up automatically after every task timer reaches zero, including Todoist estimates and the default duration after switching tasks.
- [x] Show overtime in both the main timer and compact bar; keep break timers bounded and defer a Pomodoro break until task completion.
- Installed Focus 3.0.8; Settings version verified. Two-task session and paused 14:57 timer preserved, and compact mode restored.
- Validation: 26 unit tests, isolated desktop timer/completion/layout smoke checks, bundled-source comparison, and DMG verification passed. Previous 3.0.7 app backed up.

## Add existing Todoist tasks — October 29, 2026

- [x] Add a labeled task picker beside Your session, with today/overdue, all tasks, search, and Added feedback.
- [x] Preserve the current task and timer when appending tasks, and initialize the first task's duration in an empty session.
- [x] Improve full-window text contrast, control targets, and notice placement.
- Validation: 26 unit tests passed. A separately packaged Focus QA app ran the full isolated desktop smoke suite successfully, including the new picker, sync-error/focus regressions, completion, overtime, compact controls, and mobile layout. All test API traffic was blocked or mocked. Release bundle matched the tested UI source.
- Focus 3.0.10 built at desktop/dist/mac-arm64/Focus.app and packaged as desktop/dist/Focus-3.0.10-arm64.zip. DMG generation is unavailable in this environment.
- Installation remains pending because this session cannot write to /Applications. The installed app is still 3.0.9. Its backup is desktop/backups/Focus-3.0.9-before-3.0.10.app. Finder was opened to the finished app for manual installation.
- After the user requested installation again, the approval system rejected escalation because sandbox approval is disabled. The old app was quit and the tested 3.0.10 build was launched directly from desktop/dist/mac-arm64/Focus.app instead. The four-task session, selected task, and paused 10-minute timer restored. The new picker was verified against live Todoist data and left open with 12 tasks and the four session tasks marked Added. /Applications/Focus.app remains 3.0.9.

## Inline session management and consistency — October 30, 2026

- [x] Expand the main session list alongside focus and momentum; remove distraction inbox/capture UI and D shortcut while retaining stored notes.
- [x] Reorder by drag, visible up/down buttons, or handle arrow keys; preserve the focused task and countdown, paused state, break, overtime, and temporary extensions.
- [x] Remove from the main list or Todoist picker; add In your session filtering, cached-session coverage, duplicate-click protection, focus restoration, and completion-in-progress guards. Removal never deletes or completes a Todoist task.
- [x] Consolidate task management entry points; keep bulk additions/Clear under Session options; align compact labels, duration presets, dialog appearance, dark colors, settings behavior, keyboard access, and Escape/focus handling.
- Validation: all 40 Node tests passed, including 14 regressions executing actual session functions in a VM with mocked rendering/network. JavaScript syntax and git diff checks passed. Packaged UI/shell matched final source, version 3.0.11.
- Native smoke suite updated for picker removal, drag/reordering, settings, dialogs, compact controls, and layout. It could not run this turn: Electron exits with SIGABRT before app startup, and native UI tools are unavailable. No new rendered screenshot or full desktop smoke result is claimed.
- Built desktop/dist-3.0.11/mac-arm64/Focus.app and desktop/dist-3.0.11/Focus-3.0.11-arm64.zip. The new build has not been launched or installed; existing running/installed copies were left intact.
