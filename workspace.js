/* Focus workspace. Existing timer, Todoist and sync state remain authoritative. */
(() => {
  'use strict';
  const core = window.FocusWorkspaceCore;
  const icon = (name) => {
    const paths = {
      leaf: '<path d="M19 4C8 2 3 7 5 14c2 7 13 6 14-10Z"/><path d="M5 20 15 9"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      arrow: '<path d="m9 5 7 7-7 7"/>',
      up: '<path d="m6 14 6-6 6 6"/>',
      down: '<path d="m6 10 6 6 6-6"/>',
      grip: '<path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01" stroke-width="3"/>',
      spark: '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/>',
      focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
      tray: '<path d="m5 4-3 11v5h20v-5L19 4ZM2 15h6l2 3h4l2-3h6"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      close: '<path d="m6 6 12 12M6 18 18 6"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.focus}</svg>`;
  };
  const screen = $('focusScreen');
  const header = screen.querySelector('.focus-header');
  header.insertAdjacentHTML('afterbegin', `<div class="brand">${icon('leaf')}<span>focus<span class="brand-dot">.</span></span></div>`);
  // The session queue now owns task management; keep the old engine off-screen.
  $('reorderBtn').hidden = true;
  $('reorderBtn').style.display = 'none';
  header.querySelector('div[style]').classList.add('header-tools');
  header.querySelector('.header-tools').insertAdjacentHTML('afterbegin', `<button class="header-btn" id="zenBtn" title="Hide the queue (Z)" aria-label="Enter focus view" aria-pressed="false">${icon('focus')}</button>`);
  header.insertAdjacentHTML('afterend', `<section class="workspace-heading"><div><div class="eyebrow" id="workspaceDate"></div><h1>A little less noise.<br><em>A little more focus.</em></h1></div><button class="ws-button quiet" id="planOpen">${icon('spark')} Plan a focus block</button></section>`);
  const desk = document.createElement('div');
  desk.className = 'workspace-grid';
  desk.innerHTML = `<section class="focus-card" aria-label="Current focus"><div class="card-top"><span class="eyebrow"><i class="live-dot"></i> YOUR FOCUS</span><span class="status-badge" id="sessionStatus">Ready when you are</span></div><div class="current-project" id="currentProject"></div><div id="taskMount"></div><div id="timerMount"></div><div id="actionMount"></div><div class="focus-footnote"><span><kbd>space</kbd> to start or pause</span></div></section><aside class="session-panel" aria-label="Session queue"><div class="panel-heading"><div><span class="eyebrow">ONE THING AT A TIME</span><h2>Your session <span id="queueCount">0</span></h2></div><button id="queueAdd" class="icon-button" aria-label="Add tasks to session" title="Add tasks">${icon('plus')}</button></div><div class="queue-summary"><span id="queueEstimate">A little room to breathe</span><span id="queueFinish"></span></div><p class="queue-help" id="queueHelp">Drag the handle or use the arrows to reorder. Remove keeps tasks in Todoist.</p><div id="sessionQueue" class="session-queue" aria-label="Tasks in session" aria-describedby="queueHelp"></div><div id="queueAnnouncement" class="sr-only" role="status" aria-live="polite"></div><details class="session-options"><summary>Session options</summary><div class="session-options-actions" id="sessionOptionsActions"></div></details></aside><article class="progress-card"><div class="panel-heading"><div><span class="eyebrow">SMALL STEPS ADD UP</span><h2>Today’s momentum</h2></div><label class="target-control">Daily goal <select id="dailyTarget" aria-label="Daily focus goal"><option value="30">30 min</option><option value="60">60 min</option><option value="90">90 min</option><option value="120">120 min</option><option value="180">180 min</option><option value="240">240 min</option></select></label></div><div class="momentum-content"><div class="momentum-numbers"><strong id="focusedMinutes">0<span> min</span></strong><span id="momentumSummary">A fresh start.</span><div class="daily-track" role="progressbar" aria-label="Daily focus goal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="dailyFill"></div></div><small id="goalCaption">Completed focus time</small></div><div id="weekChart" class="week-chart" aria-label="Focus minutes over the last seven days"></div></div></article><footer class="workspace-footer"><span>${icon('leaf')} A calmer place to get things done.</span><span><span id="connectionLabel" role="status">Checking sync</span> <button id="retrySync" class="text-button">Sync now</button></span></footer>`;
  screen.appendChild(desk);
  // The queue spans both the focus and momentum cards in wide windows.
  screen.appendChild(desk.querySelector('.workspace-footer'));
  for (const [id, label] of [['loadTodayBtn','Add today’s tasks'],['loadPlannerBtn','Add Weekly Planner'],['clearAllBtn','Clear session']]) {
    const button = $(id);
    button.textContent = label;
    button.classList.add('ws-button','quiet');
    $('sessionOptionsActions').appendChild(button);
  }
  $('taskMount').appendChild($('taskArea'));
  $('timerMount').appendChild(screen.querySelector('.timer-container'));
  $('actionMount').appendChild($('taskContextBar'));
  $('timerStartBtn').insertAdjacentHTML('beforeend', '<span id="startLabel">Start focusing</span>');
  $('timerResetBtn').setAttribute('aria-label', 'Reset timer');
  $('timerResetBtn').title = 'Reset timer';
  $('completeBtn').insertAdjacentHTML('beforeend', '<span>Complete task</span>');
  $('dropBtn').title = 'Remove from this session (keeps task in Todoist)';
  screen.querySelector('.timer-controls').insertAdjacentHTML('beforebegin', `<div class="duration-presets" aria-label="Selected task duration">${[5,10,15,25,50].map(m=>`<button data-duration="${m}">${m} min</button>`).join('')}<button id="customDuration">Custom</button></div>`);
  $('timerDisplay').tabIndex = 0;
  $('timerDisplay').setAttribute('role', 'button');
  $('timerDisplay').setAttribute('aria-label', 'Edit timer duration');
  $('timerDisplay').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); $('timerDisplay').click(); }
  });
  document.querySelector('.duration-presets').addEventListener('click', e => {
    const button = e.target.closest('[data-duration]');
    if (!button || timerRunning || inOvertime || isOnBreak) return;
    selectTaskDuration(Number(button.dataset.duration));
  });
  $('customDuration').onclick = () => $('timerDisplay').click();
  $('queueAdd').className = 'ws-button quiet task-picker-open';
  $('queueAdd').innerHTML = `${icon('plus')} Add Todoist tasks`;
  $('queueAdd').setAttribute('aria-label', 'Add existing Todoist tasks to your session');
  $('queueAdd').title = 'Add Todoist tasks (A)';
  $('queueAdd').onclick = () => openTaskPicker();
  window.openFocusTaskPicker = openTaskPicker;
  $('taskArea').addEventListener('click', e => {
    if (e.target.closest('#emptyAddBtn')) { e.stopImmediatePropagation(); openTaskPicker(); }
  }, true);
  const queue = $('sessionQueue');
  const taskIndex = id => tasks.findIndex(t => String(t.id) === String(id));
  function focusQueueControl(id, attribute) {
    renderWorkspace();
    const control = Array.from(queue.querySelectorAll(`[${attribute}]`)).find(el => el.getAttribute(attribute) === String(id));
    (control || $('queueAdd')).focus({preventScroll:true});
  }
  function queueControlState() {
    const active = document.activeElement;
    if (!queue.contains(active)) return null;
    const attribute = ['data-drag-task','data-task-id','data-edit-duration','data-move-task','data-remove-task'].find(name => active.hasAttribute(name));
    return attribute ? {attribute,id:active.getAttribute(attribute),direction:active.dataset.direction} : null;
  }
  function moveQueueTask(id, toIndex, focusAttribute = 'data-drag-task') {
    if (!moveSessionTask(id, toIndex)) return;
    focusQueueControl(id, focusAttribute);
    const index = taskIndex(id);
    $('queueAnnouncement').textContent = `Moved “${tasks[index].content}” to position ${index + 1} of ${tasks.length}.`;
  }
  queue.onclick = e => {
    if (_completing) return;
    const move = e.target.closest('[data-move-task]');
    if (move) {
      const direction = move.dataset.direction;
      moveQueueTask(move.dataset.moveTask, taskIndex(move.dataset.moveTask) + (direction === 'up' ? -1 : 1), 'data-move-task');
      const same = Array.from(queue.querySelectorAll('[data-move-task]')).find(b => b.dataset.moveTask === move.dataset.moveTask && b.dataset.direction === direction);
      (same && !same.disabled ? same : queue.querySelector(`[data-drag-task="${CSS.escape(move.dataset.moveTask)}"]`))?.focus({preventScroll:true});
      return;
    }
    const remove = e.target.closest('[data-remove-task]');
    if (remove) {
      if (!queue.contains(remove) || e.detail > 1) return;
      const index = taskIndex(remove.dataset.removeTask);
      if (index < 0) return;
      const task = tasks[index];
      removeTaskFromSession(index);
      focusQueueControl(tasks[Math.min(index,tasks.length - 1)]?.id, 'data-remove-task');
      $('queueAnnouncement').textContent = `Removed “${task.content}” from your session. It is still in Todoist.`;
      return;
    }
    const duration = e.target.closest('[data-edit-duration]');
    if (duration) {
      const index = taskIndex(duration.dataset.editDuration);
      if (index >= 0) openGoalPopover(index, duration);
      return;
    }
    const row = e.target.closest('[data-task-id]');
    if (row) switchFocusedTask(taskIndex(row.dataset.taskId));
  };
  queue.addEventListener('keydown', e => {
    const grip = e.target.closest('[data-drag-task]');
    if (!grip || !['ArrowUp','ArrowDown'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    moveQueueTask(grip.dataset.dragTask, taskIndex(grip.dataset.dragTask) + (e.key === 'ArrowUp' ? -1 : 1));
  });
  let queueDragId = null;
  function clearQueueDrag() {
    queueDragId = null;
    queue.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(row => row.classList.remove('dragging','drop-before','drop-after'));
  }
  function queueDropTarget(y) {
    const rows = Array.from(queue.querySelectorAll('[data-queue-id]')).filter(row => row.dataset.queueId !== queueDragId);
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (y < rect.bottom) return {row, before:y < rect.top + rect.height/2};
    }
    return rows.length ? {row:rows[rows.length-1], before:false} : null;
  }
  queue.addEventListener('dragstart', e => {
    const grip = e.target.closest('[data-drag-task]');
    if (!grip || _completing) { e.preventDefault(); return; }
    queueDragId = grip.dataset.dragTask;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', queueDragId);
    const row = grip.closest('.queue-row');
    e.dataTransfer.setDragImage(row, 20, 20);
    row.classList.add('dragging');
  });
  queue.addEventListener('dragover', e => {
    if (!queueDragId || _completing) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    queue.querySelectorAll('.drop-before,.drop-after').forEach(row => row.classList.remove('drop-before','drop-after'));
    const target = queueDropTarget(e.clientY);
    target?.row.classList.add(target.before ? 'drop-before' : 'drop-after');
    const rect = queue.getBoundingClientRect();
    if (e.clientY < rect.top + 36) queue.scrollTop -= 12;
    else if (e.clientY > rect.bottom - 36) queue.scrollTop += 12;
  });
  queue.addEventListener('drop', e => {
    if (!queueDragId) return;
    e.preventDefault();
    const id = queueDragId, target = queueDropTarget(e.clientY), from = taskIndex(id);
    clearQueueDrag();
    if (!target || from < 0) return;
    let insertion = taskIndex(target.row.dataset.queueId) + (target.before ? 0 : 1);
    if (from < insertion) insertion--;
    moveQueueTask(id, insertion);
  });
  queue.addEventListener('dragend', clearQueueDrag);
  $('zenBtn').onclick = () => {
    const zen = document.body.classList.toggle('zen-mode');
    $('zenBtn').setAttribute('aria-pressed', String(zen));
    $('zenBtn').setAttribute('aria-label', zen ? 'Exit focus view' : 'Enter focus view');
    $('zenBtn').title = zen ? 'Show workspace (Z)' : 'Hide the queue (Z)';
  };
  // A native dialog gives all new tools focus trapping, inert background and Esc.
  const dialog = document.createElement('dialog');
  dialog.id = 'workspaceDialog';
  dialog.className = 'workspace-dialog';
  document.body.appendChild(dialog);
  let returnFocus = null;
  function restoreDialogFocus() {
    const target = [returnFocus, $('queueAdd'), $('zenBtn')].find(el => el?.isConnected && !el.disabled && el.getClientRects().length);
    target?.focus();
  }
  function closeDialog() { dialog.close(); restoreDialogFocus(); }
  dialog.addEventListener('close', restoreDialogFocus);
  dialog.addEventListener('click', e => { if (e.target === dialog) closeDialog(); });
  // Let dialog controls handle keys, then keep them away from timer shortcuts.
  dialog.addEventListener('keydown', e => e.stopPropagation());
  function openDialog(title, subtitle, content) {
    returnFocus = document.activeElement;
    dialog.innerHTML = `<div class="dialog-top"><div><span class="eyebrow">YOUR FOCUS TOOLKIT</span><h2 id="workspaceDialogTitle">${title}</h2></div><button class="icon-button" id="wsClose" aria-label="Close">${icon('close')}</button></div><p class="dialog-description">${subtitle}</p>${content}`;
    dialog.setAttribute('aria-labelledby', 'workspaceDialogTitle');
    $('wsClose').onclick = closeDialog;
    dialog.showModal();
  }
  let pickerBusy = false;
  let pickerSignature = '';
  function renderTaskPicker() {
    if (!dialog.open || !$('pickerSearch')) return;
    const input = $('pickerSearch');
    const query = input.value.trim().toLowerCase();
    const scope = $('pickerScope').value;
    const sessionIds = new Set(tasks.map(t => String(t.id)));
    const candidates = new Map(tasks.map(task => [String(task.id), task]));
    for (const task of allTasks) candidates.set(String(task.id), task);
    const matches = Array.from(candidates.values()).filter(task => {
      if (task.checked || task.is_deleted || isSyncStoreItem(task)) return false;
      if (scope === 'session' && !sessionIds.has(String(task.id))) return false;
      if (!sessionIds.has(String(task.id)) && task.responsible_uid && currentUserId && String(task.responsible_uid) !== String(currentUserId)) return false;
      if (scope === 'session' && !query) return true;
      if (!query) return scope === 'all' || isTodayOrOverdue(task);
      return [task.content, task.description, projects[task.project_id]?.name, ...(task.labels || [])]
        .some(value => String(value || '').toLowerCase().includes(query));
    }).sort((a,b) => scope === 'session' ? taskIndex(a.id) - taskIndex(b.id) : Number(sessionIds.has(String(a.id))) - Number(sessionIds.has(String(b.id))) || todayViewOrder(a,b));
    const signature = JSON.stringify([query, scope, _completing, matches.map(t => [t.id,t.content,t.project_id,t.due,sessionIds.has(String(t.id)),projects[t.project_id]?.name])]);
    if (signature !== pickerSignature) {
      pickerSignature = signature;
      const list = $('pickerResults');
      const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.pickerTask : null;
      const scrollTop = list.scrollTop;
      list.innerHTML = matches.length ? matches.map(task => {
        const added = sessionIds.has(String(task.id));
        const due = task.due?.date?.slice(0,10);
        const dueText = due ? due < localDateKey() ? 'Overdue' : due === localDateKey() ? 'Today' : due : 'No due date';
        return `<button type="button" class="picker-task ${added ? 'added' : ''}" data-picker-task="${escHtml(task.id)}" data-${added ? 'remove' : 'add'}-task="${escHtml(task.id)}" ${_completing ? 'disabled' : ''} aria-label="${escHtml(`${added ? 'Remove from session' : 'Add to session'}: ${task.content}`)}" ${added ? 'title="Remove from this session; keep in Todoist"' : ''}><span class="picker-task-copy"><strong>${escHtml(task.content)}</strong><small>${escHtml(projects[task.project_id]?.name || 'Inbox')} · ${escHtml(dueText)}${added ? ' · In your session' : ''}</small></span><span class="picker-task-action">${icon(added ? 'close' : 'plus')}${added ? 'Remove' : 'Add'}</span></button>`;
      }).join('') : `<div class="tool-empty">${scope === 'session' && !query ? 'Your session is empty. Choose Today & overdue or All tasks to add tasks.' : 'No matching tasks. Try a different search or choose All tasks.'}</div>`;
      if (focusedId) (Array.from(list.querySelectorAll('[data-picker-task]')).find(b => b.dataset.pickerTask === focusedId && !b.disabled) || input).focus({preventScroll:true});
      list.scrollTop = scrollTop;
    }
    const failed = taskSyncStatus.error;
    $('pickerStatus').textContent = pickerBusy || _syncInFlight ? 'Refreshing Todoist tasks…' : failed || !navigator.onLine ? 'Showing saved tasks. Couldn’t refresh from Todoist.' : `${matches.length} task${matches.length === 1 ? '' : 's'} · ${tasks.length} in your session`;
    $('pickerRefresh').disabled = pickerBusy || _syncInFlight || !navigator.onLine;
    $('pickerRefresh').textContent = failed ? 'Retry' : 'Refresh';
  }
  async function refreshPickerTasks() {
    if (pickerBusy || _syncInFlight || !navigator.onLine) { renderTaskPicker(); return; }
    pickerBusy = true; renderTaskPicker();
    try { await loadAllTasks(); }
    catch { taskSyncStatus.error = true; }
    finally { pickerBusy = false; renderTaskPicker(); }
  }
  function openTaskPicker() {
    pickerSignature = '';
    if (!allTasks.length) allTasks = Object.values(itemsById);
    openDialog('Add Todoist tasks', 'Choose tasks for this session, or remove ones you no longer need here. Removed tasks stay in Todoist.', `<div class="picker-search"><label class="sr-only" for="pickerSearch">Search Todoist tasks</label><input id="pickerSearch" type="search" autocomplete="off" placeholder="Search tasks, projects or labels"><label class="sr-only" for="pickerScope">Tasks to show</label><select id="pickerScope"><option value="today">Today & overdue</option><option value="all">All tasks</option><option value="session">In your session</option></select></div><p class="picker-hint" id="pickerHint">Search includes all your tasks, even those due later.</p><div class="picker-status"><span id="pickerStatus" role="status"></span><button type="button" id="pickerRefresh" class="text-button">Refresh</button></div><div id="pickerResults" class="picker-results" aria-label="Todoist tasks"></div><div class="picker-footer"><span id="pickerAnnouncement" role="status" aria-live="polite"></span><button type="button" id="pickerDone" class="ws-button">Done</button></div>`);
    $('pickerSearch').oninput = renderTaskPicker;
    $('pickerScope').onchange = () => {
      $('pickerHint').textContent = $('pickerScope').value === 'session' ? 'Search within your session. Reorder these tasks in the main list.' : 'Search includes all your tasks, even those due later.';
      renderTaskPicker();
    };
    $('pickerRefresh').onclick = refreshPickerTasks;
    $('pickerDone').onclick = closeDialog;
    $('pickerResults').onclick = e => {
      const button = e.target.closest('[data-picker-task]');
      if (!button || !$('pickerResults').contains(button) || _completing || e.detail > 1) return;
      const id = button.dataset.pickerTask;
      if (button.hasAttribute('data-remove-task')) {
        const index = taskIndex(id);
        if (index < 0) return;
        const task = tasks[index];
        removeTaskFromSession(index);
        $('pickerAnnouncement').textContent = `Removed “${task.content}” from your session. It is still in Todoist.`;
      } else {
        const task = allTasks.find(t => String(t.id) === id);
        if (!task || taskIndex(id) >= 0) { renderTaskPicker(); return; }
        addTaskToSession(task, false);
        $('pickerAnnouncement').textContent = `Added “${task.content}” to your session.`;
      }
      renderTaskPicker();
    };
    $('pickerSearch').onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); $('pickerResults').querySelector('button:not(:disabled)')?.focus(); }
    };
    renderTaskPicker();
    $('pickerSearch').focus();
    refreshPickerTasks();
  }
  function openPlanner() {
    openDialog('Make time for what matters.', 'Choose a time budget. We’ll suggest tasks from your session, putting overdue work, today’s tasks and priorities first.', `<label class="budget-label" for="blockBudget">I have <select id="blockBudget"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="90">90 minutes</option><option value="120">2 hours</option><option value="180">3 hours</option></select> to focus.</label><div class="plan-caption" id="planCaption"></div><div id="planList" class="plan-list"></div><p class="planner-note">Estimates use time goals, then Todoist durations, then your default work interval. Breaks are extra. Other tasks stay in your session.</p><button class="ws-button plan-apply" id="applyPlan">Move this block to the front ${icon('arrow')}</button>`);
    function draw() {
      const selection = core.plan(tasks, taskGoals, Number($('blockBudget').value), localDateKey(), workDurationMins);
      $('planCaption').textContent = `${selection.length} task${selection.length === 1 ? '' : 's'} · ${selection.reduce((s,t)=>s+t.minutes,0)} min of focused work`;
      $('planList').innerHTML = selection.length ? selection.map((item,i)=>`<div class="plan-row"><span class="queue-number">${String(i+1).padStart(2,'0')}</span><div><strong>${escHtml(item.task.content)}</strong><small>${item.reason}</small></div><span>${item.minutes}m</span></div>`).join('') : '<div class="tool-empty">No tasks fit this block. Try a longer budget or add a smaller task to your session.</div>';
      $('applyPlan').disabled = !selection.length || timerRunning || inOvertime || isOnBreak || _completing;
      if (timerRunning || inOvertime || isOnBreak) $('planCaption').textContent += ' · Pause or finish your interval to apply.';
    }
    $('blockBudget').onchange = draw;
    $('applyPlan').onclick = () => {
      if (timerRunning || inOvertime || isOnBreak || _completing) return;
      // Recalculate from current state; a sync may have removed a task since preview.
      const selection = core.plan(tasks, taskGoals, Number($('blockBudget').value), localDateKey(), workDurationMins);
      if (!selection.length) { draw(); return; }
      stashCurrentTaskTimer();
      const ids = new Set(selection.map(item => String(item.task.id)));
      tasks = [...selection.map(item => item.task), ...tasks.filter(t => !ids.has(String(t.id)))];
      currentIndex = 0; sessionDay = localDateKey();
      persistSession(); renderCurrentTask(); armTimerForArrival(false, false);
      closeDialog(); showToast(`${selection.length} task${selection.length === 1 ? '' : 's'} lined up. One at a time.`);
    };
    draw();
  }
  $('planOpen').onclick = openPlanner;
  const savedTarget = Number(localStorage.getItem('focus_daily_target_v1'));
  if ([30,60,90,120,180,240].includes(savedTarget)) $('dailyTarget').value = String(savedTarget);
  else $('dailyTarget').value = '120';
  $('dailyTarget').onchange = () => {
    try { localStorage.setItem('focus_daily_target_v1', $('dailyTarget').value); } catch { showToast('Couldn’t save your daily goal.'); }
    refreshWorkspace();
  };
  $('retrySync').onclick = async () => {
    if (_syncInFlight) return;
    $('retrySync').disabled = true;
    try { await Promise.all([refreshTaskData(), _syncReady ? FocusSync.sync() : Promise.resolve()]); }
    finally { refreshWorkspace(); }
  };
  let frame = null;
  let queueSignature = '';
  let statsSignature = '';
  function renderWorkspace() {
    frame = null;
    renderTaskPicker();
    if (!screen.classList.contains('active') || isCompact || document.hidden) return;
    const date = new Date();
    $('workspaceDate').textContent = date.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
    $('currentProject').textContent = tasks[currentIndex] ? projects[tasks[currentIndex].project_id]?.name || 'Inbox' : 'A fresh start';
    const signature = JSON.stringify([localDateKey(), tasks.map(t=>[t.id,t.content,t.project_id,t.due,t.duration,t.priority]), currentIndex, taskGoals, projects, workDurationMins, _completing]);
    const minutes = tasks.reduce((sum,t)=>sum+core.estimate(t,taskGoals,workDurationMins),0);
    if (signature !== queueSignature) {
      queueSignature = signature;
      const focused = queueControlState();
      const scrollTop = queue.scrollTop;
      $('queueCount').textContent = tasks.length;
      $('queueEstimate').textContent = tasks.length ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} · ~${minutes >= 60 ? `${Math.floor(minutes/60)}h ${minutes%60 ? minutes%60+'m' : ''}`.trim() : minutes+'m'} planned` : 'A little room to breathe';
      $('sessionQueue').innerHTML = tasks.length ? tasks.map((task,i)=> {
        const due = task.due?.date?.slice(0,10);
        const dueLabel = due && due < localDateKey() ? 'Overdue' : due === localDateKey() ? 'Today' : due || 'No due date';
        const id = escHtml(task.id), title = escHtml(task.content), disabled = _completing ? 'disabled' : '';
        return `<div class="queue-row ${i===currentIndex?'current':''}" data-queue-id="${id}"><button class="queue-grip" data-drag-task="${id}" draggable="${!_completing}" ${disabled} title="Drag to reorder, or use ↑ and ↓" aria-label="Reorder ${title}; use up and down arrow keys">${icon('grip')}</button><button class="queue-select" data-task-id="${id}" ${disabled} ${i===currentIndex?'aria-current="step"':''}><span class="queue-number">${i===currentIndex?icon('focus'):String(i+1).padStart(2,'0')}</span><span class="queue-copy"><strong>${title}</strong><small>${escHtml(projects[task.project_id]?.name || 'Inbox')}<span class="${dueLabel==='Overdue'?'overdue':''}"> · ${escHtml(dueLabel)}</span></small></span></button><div class="queue-actions"><button class="queue-duration" data-edit-duration="${id}" ${disabled} title="Set task duration" aria-label="Set duration for ${title}">${icon('clock')}${core.estimate(task,taskGoals,workDurationMins)}m</button><button class="queue-tool" data-move-task="${id}" data-direction="up" ${_completing || i===0 ? 'disabled' : ''} title="Move up" aria-label="Move ${title} up">${icon('up')}</button><button class="queue-tool" data-move-task="${id}" data-direction="down" ${_completing || i===tasks.length-1 ? 'disabled' : ''} title="Move down" aria-label="Move ${title} down">${icon('down')}</button><button class="queue-tool queue-remove" data-remove-task="${id}" ${disabled} title="Remove from session; keep in Todoist" aria-label="Remove ${title} from session">${icon('close')}</button></div></div>`;
      }).join('') : `<div class="queue-empty">${icon('leaf')}<h3>Start with one thing.</h3><p>Add a few tasks from Todoist to make room for your best work.</p></div>`;
      if (focused) {
        const control = Array.from(queue.querySelectorAll(`[${focused.attribute}]`)).find(el => el.getAttribute(focused.attribute) === focused.id && (!focused.direction || el.dataset.direction === focused.direction) && !el.disabled);
        (control || $('queueAdd')).focus({preventScroll:true});
      }
      queue.scrollTop = scrollTop;
    }
    $('queueFinish').textContent = '';
    const deviceError = typeof FocusSync !== 'undefined' && _syncReady && FocusSync.lastError;
    const syncedAt = taskSyncStatus.lastSuccess ? new Date(taskSyncStatus.lastSuccess).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : '';
    $('connectionLabel').textContent = !navigator.onLine ? 'Offline · using saved tasks' : _syncInFlight ? 'Syncing tasks…' : taskSyncStatus.error ? 'Task sync failed · try again' : deviceError ? 'Device sync failed · try again' : syncedAt ? `Tasks synced at ${syncedAt}` : 'Tasks have not synced yet';
    $('retrySync').disabled = _syncInFlight || !navigator.onLine;
    $('retrySync').textContent = taskSyncStatus.error || deviceError ? 'Retry sync' : 'Sync now';
    const stats = loadStats();
    const days = Array.from({length:7},(_,i)=>{ const d=new Date(date); d.setDate(d.getDate()-6+i); return {date:d, minutes:Math.round(combinedStatsFor(localDateKey(d),stats).focusSeconds/60)}; });
    const today = combinedStatsFor(localDateKey(), stats);
    const target = Number($('dailyTarget').value);
    const statKey = JSON.stringify([localDateKey(), days.map(d=>d.minutes),today.tasksCompleted,target]);
    if (statKey !== statsSignature) {
      statsSignature = statKey;
      const mins = days[6].minutes;
      $('focusedMinutes').innerHTML = `${mins}<span> min</span>`;
      $('momentumSummary').textContent = `${today.tasksCompleted} task${today.tasksCompleted===1?'':'s'} completed today`;
      $('dailyFill').style.width = `${Math.min(100,mins/target*100)}%`;
      document.querySelector('.daily-track').setAttribute('aria-valuenow',String(Math.min(100,Math.round(mins/target*100))));
      $('goalCaption').textContent = mins >= target ? 'Daily goal reached. Make room for a break.' : `${Math.max(0,target-mins)} min to your daily goal · finished intervals`;
      const max = Math.max(target,...days.map(d=>d.minutes));
      $('weekChart').innerHTML = days.map((d,i)=>`<div class="chart-day ${i===6?'today':''}" title="${d.date.toLocaleDateString()}: ${d.minutes} focus minutes" aria-label="${escHtml(d.date.toLocaleDateString())}: ${d.minutes} focus minutes"><div class="chart-track"><div style="height:${Math.max(3,d.minutes/max*100)}%;${d.minutes===0?'opacity:.18':''}"></div></div><span>${d.date.toLocaleDateString(undefined,{weekday:'narrow'})}</span></div>`).join('');
    }
    updateWorkspaceTimer();
  }
  window.refreshWorkspace = function() { if (frame === null) frame = requestAnimationFrame(renderWorkspace); };
  let timerControlsSignature = '';
  const durationButtons = Array.from(document.querySelectorAll('[data-duration]'));
  window.updateWorkspaceTimer = function() {
    const signature = [timerRunning,inOvertime,isOnBreak,timerSeconds < initialTimerSeconds,initialTimerSeconds].join(':');
    if (signature === timerControlsSignature) return;
    timerControlsSignature = signature;
    const label = inOvertime ? 'Finish overtime' : isOnBreak ? (timerRunning ? 'Pause break' : timerSeconds < initialTimerSeconds ? 'Resume break' : 'Start break') : timerRunning ? 'Pause focus' : timerSeconds < initialTimerSeconds ? 'Resume focus' : 'Start focusing';
    if ($('startLabel').textContent !== label) $('startLabel').textContent = label;
    const status = isOnBreak ? 'Take a breather' : inOvertime ? 'In the flow · overtime' : timerRunning ? 'In the flow' : timerSeconds < initialTimerSeconds ? 'Paused · take your time' : 'Ready when you are';
    if ($('sessionStatus').textContent !== status) $('sessionStatus').textContent = status;
    const running = timerRunning || inOvertime;
    if (document.body.classList.contains('session-running') !== running) document.body.classList.toggle('session-running', running);
    durationButtons.forEach(btn => {
      btn.disabled = timerRunning || inOvertime || isOnBreak;
      btn.classList.toggle('selected', Number(btn.dataset.duration)*60 === initialTimerSeconds);
    });
    $('customDuration').disabled = timerRunning || inOvertime || isOnBreak;
  };
  // Capture shortcuts before the legacy document handler sees modal keystrokes.
  document.addEventListener('keydown', e => {
    if (dialog.open) { if (!dialog.contains(e.target)) e.stopImmediatePropagation(); return; }
    if (!screen.classList.contains('active') || document.querySelector('.active.timer-edit-overlay, .active.task-order-overlay, .active.shortcuts-overlay, .active.goal-popover, .active.break-overlay')) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (e.code === 'KeyZ' || e.code === 'KeyA') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (isCompact) toggleCompactMode();
      if (e.code === 'KeyA') openTaskPicker(); else $('zenBtn').click();
    }
  }, true);
  document.querySelector('.shortcuts-list').insertAdjacentHTML('beforeend','<dt><kbd>A</kbd></dt><dd>Add Todoist tasks</dd><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Reorder task when its handle is focused</dd><dt><kbd>Z</kbd></dt><dd>Toggle focus view</dd>');
  // Screen changes do not necessarily change tasks (e.g. leaving Settings).
  new MutationObserver(refreshWorkspace).observe(screen, { attributes:true, attributeFilter:['class'] });
  new MutationObserver(refreshWorkspace).observe(document.body, { attributes:true, attributeFilter:['class'] });
  document.addEventListener('visibilitychange', refreshWorkspace);
  window.addEventListener('online', refreshWorkspace);
  window.addEventListener('offline', refreshWorkspace);
  window.addEventListener('focus', refreshWorkspace);
  // Label existing icon-only buttons without changing their handlers.
  document.querySelectorAll('button[title]').forEach(b => { if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title); });
  refreshWorkspace();
})();
