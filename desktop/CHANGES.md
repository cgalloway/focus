## 3.0.12 — Housekeeping

- Keep one shared list of bundled interface files, with a test that the service worker and index.html stay in step with it.
- Remove an unused loading spinner and two settings that were saved but never read.
- Drop the obsolete cross-origin font cache from the service worker.
- No change to timer, session, sync or Todoist behavior.

## 3.0.11 — Manage the session in place

- Reorder directly in the expanded session list by dragging, move-up/down buttons, or arrow keys on the handle. Preserve the current task and its countdown, overtime, or break.
- Remove tasks from either the main list or the Todoist picker without completing or deleting them in Todoist. The picker includes an In your session filter and protects against accidental double clicks.
- Remove the distraction inbox, capture controls, and D shortcut; retain stored notes. Extend the session beside both the focus and momentum cards, with Today/Weekly Planner/Clear under Session options.
- Route compact Add controls to the same picker. Align duration presets, button labels, dialog appearance, dark colors, keyboard focus and Escape behavior.
- Preserve timers when saving settings, adding tasks, and removing other tasks. Keep work controls safe while a completion is pending.

## 3.0.10 — Add existing Todoist tasks

- Add a labeled Add Todoist tasks button beside the session heading and an A keyboard shortcut.
- Pick today's and overdue tasks, browse all tasks, or search names, descriptions, projects and labels in a dedicated dialog.
- Append tasks once while preserving the current task and running timer; show Added feedback and retain saved tasks when refresh fails.
- Keep session arranging separate, improve text contrast and button sizes, and prevent overlapping status notices.

## 3.0.9 — Direct miniature task controls

- Keep Previous, Next, and Remove from session visible in both miniature layouts, with accessible labels and hover hints.
- Fit the bar around all controls, including older saved window sizes and long task titles.
- Reuse the existing task navigation and session removal behavior: switching preserves countdowns, and removal leaves the task open in Todoist.
- Disable navigation for a single task and removal for an empty session or while a Todoist completion is pending.

## 3.0.8 — Every task continues into overtime

- Continue counting up past zero for Todoist estimates and the ten-minute default, as well as manually chosen durations.
- Keep overtime tied to the focused task; Pomodoro breaks wait until the task is completed, while break timers still finish normally.
- Make expiry notifications accurately describe counting overtime.
- Verify countdown expiry, increasing overtime in both displays, task switching, and break behavior in the isolated desktop tests.

## 3.0.7 — Confirm Todoist completion

- Keep tasks in the session until Todoist acknowledges completion, including the compact checkmark.
- Show saving, failure, and confirmed-completion feedback; explain that recurring tasks schedule their next occurrence.
- Bound requests to 15 seconds and retain command IDs so retries after interruptions do not repeat a recurring completion.
- Resolve older cached task IDs, handle command-level errors, and prevent older sync responses from restoring a just-completed task.
- Exercise completion, offline/auth/timeout failures, repeated clicks, navigation, sync races, and local tracking errors in isolated tests.

## 3.0.6 — Automatic compact sizing and readable menu

- Fit the task pill to its task name, reserving room for controls even on hover.
- Keep the bar on the current screen; wrap exceptionally long names and grow vertically as needed.
- Replace the clipped macOS popup with a separate opaque menu panel, supporting keyboard navigation and Escape.
- Verify growing/shrinking titles, wrapping, screen bounds, and menu selection from the timer-only layout.

## 3.0.5 — Compact timer redesign

- A tighter task pill and a timer-only option, each with its own saved window size.
- Visible play/pause and completion controls; native menu for navigation, Do later, removal, layout, optional edge snapping, and expanding.
- Add five minutes to the current countdown without changing the task estimate; preserve the extension across task switches.
- Move tasks to the end of the session while retaining remaining time.
- Show paused/break/overtime state, a bottom progress line, a drag grip, and an Add a task empty state.
- Keep compact notifications from covering the controls.
- Includes the Todoist-duration and ten-minute-default behavior from 3.0.4.

## 3.0.4 — Todoist task durations and ten-minute default

- Use a saved Focus task duration first, then the Todoist duration, then 10 minutes.
- Apply the same duration policy to countdowns, session estimates, planning, and duration-editor defaults.
- Ignore legacy work-length and estimate-toggle settings; replace conflicting controls with an explanation in Settings.
- Preserve valid paused countdowns and explicit per-task durations.

## 3.0.3 — Everyday performance and convenience

- Keep unchanged Manage Tasks rows and preserve search selection during refreshes.
- Coordinate background task and device syncing on one schedule.
- Skip unchanged timer control and visual-state updates.
- Restore main-window size and position; recover windows from disconnected monitors.
- Show task sync success time, task/device sync failures, and a manual retry button.
- Verified with unit tests and the isolated desktop smoke test, including search row reuse and timer control mutation checks.

# Focus 3.0.2

- Fix saved task durations being ignored when their legacy Challenge timer switch was off. Any saved task duration now controls the countdown and planner regardless of that old flag.
- Remove the on/off switches from the duration chip and editor. A selected duration is always active; “Use default duration” removes the custom value explicitly.
- Add a five-minute main preset. Label historical elapsed time as “spent total” to distinguish it from the selected countdown length.
- Regression: restore a disabled five-minute goal with an obsolete 24:47 remainder from a 25-minute interval; verify a 5:00 countdown, five-minute estimate, and five-minute selection from the editor after reload.

# Focus 3.0.1

- Save timer presets and custom durations to the selected task, including a new 10-minute preset. Each new task loads its chosen duration; revisiting partially worked tasks resumes their remaining time.
- Edit any task’s duration directly from the session queue. New selections replace stale parked countdowns, and editing the running task re-arms its timer to the new length.
- Enable Todoist time estimates once for existing installations, so tasks with estimates start with those lengths. Tasks without a selected duration or estimate use the default work interval.
- Verify custom 10-minute and queued 20-minute durations, switching before first start, paused resumption, duration changes during a running interval, persistence, and a simulated completion advancing to the next 20-minute countdown. External API traffic is blocked during tests.

# Focus 3.0.0

- Rebuild the main workspace with a responsive session queue, warm light/dark themes, clearer timer controls and a wider default desktop window. Compact mode and the original storage origin are preserved.
- Plan a focus block against a 30–180 minute budget. Suggestions favor overdue work, today, then priority; applying brings those tasks to the front without removing the rest. Planning uses whole-task estimates, excludes breaks, and requires pausing or finishing the active interval.
- Capture distractions with D, review or dismiss them later, and keep the timer running. Notes and the daily goal are saved on this device only.
- Add a daily focus goal and seven-day chart using existing combined sync statistics. Focus minutes reflect completed intervals, matching the existing statistics model.
- Add 15/25/50-minute presets, keyboard-accessible timer editing, and a focused view (Z) that hides the surrounding workspace.
- Remove remote font requests, reuse unchanged timer digits/icons, and batch workspace updates with animation frames. Task rows and the chart rebuild only when their underlying data changes.
- Fix global shortcuts intercepting typing and focused-button activation. New dialogs trap focus and isolate keyboard events from task completion.

Validation: eight unit/regression tests plus an isolated Electron smoke test with external API access blocked. Covers planner ordering and budget, note escaping and persistence across reload, timer controls, focus view, narrow layout, compact restore, and DOM reuse over 100 identical timer updates. Desktop screenshots inspected in light and dark themes; narrow-window layout checked. No live Todoist tasks were completed during testing.

# Focus 2.0.1

- Serve the tested, bundled interface at the existing HTTPS origin inside Electron. This removes website availability from startup and keeps existing local storage. Desktop interface updates now require a rebuild.
- Compare merged sync state with the freshly fetched remote state to avoid unchanged uploads and repair remote regressions.
- Capture local changes after network reads; queue a follow-up when a sync request arrives during another request.
- Bound sync requests to 20 seconds and report oversized sync payloads as failures.
- Skip hidden-window task polling and redundant main timer digit rendering.
- Escape quotation marks in task/project markup.
- Restrict native IPC to the app's main frame and route outside navigation to the browser.
- Preserve normal window bounds on repeated compact requests and save pending compact bounds on close.
- Update Electron to 44.2.0 and electron-builder to 26.15.3; add a reproducible dependency lockfile.

Validation: five sync regression tests, isolated Electron launch/renderer checks,
original storage origin, text escaping, repeated compact toggle and restore.
The isolated smoke test blocks external APIs and does not complete real tasks.
Run `npm test` and `node_modules/.bin/electron test/smoke.cjs` from this directory
(after `node copy-app.js`).
