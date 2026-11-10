# Focus macOS desktop app

The desktop app runs its bundled interface, including offline, at the original
app origin inside Electron. Existing settings, sessions and sync identity stay
in the same storage location. Website changes require rebuilding the desktop.
Todoist and Focus Sync continue to use their normal network APIs.

Run `npm ci`, then `npm start` to develop or `npm run dist` to build a DMG.
`copy-app.js` refreshes the bundled interface before each start/build.
Keep the bundle identifier and app name unchanged to preserve existing data.

## Focus workspace

The canonical interface is in the parent `focus/` directory. `workspace.css`
provides the visual design, `workspace.js` connects the workspace to the original
timer and sync functions, and `workspace-core.js` holds pure planning helpers.
The older sibling `focus-app/` is not the source for this desktop version.

Use **Plan a focus block** to choose work that fits your time. Suggestions use
per-task goals, Todoist duration estimates and a 10-minute fallback; breaks
are additional. Applying a block changes session order, retaining other tasks.

Press **Z** to hide the queue and progress card. Use **Add Todoist tasks** beside
Your session, or press **A**, to add existing Todoist tasks. The picker offers
Today & overdue, All tasks, and In your session. Search covers names,
descriptions, projects and labels across all dates (or just the session when
that scope is selected). **Remove** takes a task out of Focus, keeping it open
in Todoist. Every Add entry point, including compact mode, opens this picker.

Drag a handle in the main session list to reorder, use the visible up/down
buttons, or focus the handle and press the arrow keys. Moving tasks preserves
the currently focused task and timer. The × removes a task from the session.
**Session options** holds bulk Today/Weekly Planner additions and Clear session.
The list extends alongside the focus and momentum cards. The distraction inbox
and its shortcut have been retired; existing stored notes are not deleted.
The daily goal is local to this device. The progress card uses the existing
synced totals for completed focus intervals.
Timer presets and custom durations save a per-task time goal without editing Todoist estimates. Click a duration in the queue to set that task’s time; the countdown loads it on arrival. A partially worked task resumes its remaining time when revisited.

Validation: `npm test`, then `node copy-app.js` and
`node_modules/.bin/electron test/smoke.cjs`. The smoke test uses an isolated
profile, blocks external API calls, and captures previews in the OS temp folder.
It never reads the production profile or completes a real Todoist task.

### Everyday convenience (3.0.3)

Both window layouts remember their size and position. Saved windows are moved
inside the available display when a monitor is disconnected. The workspace
footer reports the latest successful task sync or a sync failure, and **Sync
now** / **Retry sync** refreshes tasks and device state. Background refreshes
preserve search selection and reuse unchanged search rows.

### Task duration policy (3.0.4)

A duration explicitly selected in Focus takes priority. Otherwise, Focus reads
Todoist's task duration and uses 10 minutes when none is available or valid.
Legacy work-session settings and estimate toggles no longer override this rule.
The existing 999-minute timer limit applies. Paused work resumes when its saved
starting duration still matches the task's duration.

### Compact timer (3.0.5)

The three-dot menu switches between Timer only and Timer and task, opens the
full window, adds tasks, navigates, moves the current task to the end, or removes
it from the session. Enable Snap to screen edges there if desired. Drag the grip
to move the pill. The +5 control appears on hover or keyboard focus and is also
in the menu; it extends only the current countdown, preserving the task estimate.
It is unavailable during breaks, overtime, or without a task.

### Miniature task controls (3.0.9)

Previous (‹), Next (›), and Remove from session (×) are always visible in both
miniature layouts. Navigation wraps around the queue and preserves each task's
remaining countdown. Removing a task leaves it open in Todoist. The bar fits
these controls automatically; navigation is disabled when fewer than two tasks
remain, and removal is disabled when empty or while completion is saving.
