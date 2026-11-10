// Exercises the real picker inside smoke.cjs's isolated desktop profile.
// Task data and refreshes are fixtures; no Todoist requests are sent.
const assert = require('node:assert/strict');

module.exports = async win => {
  let result;
  try {
    result = await win.webContents.executeJavaScript(`(async () => {
      const saved = {
        tasks, allTasks, itemsById, projects, currentIndex, currentUserId, apiToken,
        loadAllTasks, completeTask, fetch:window.fetch, syncReady:_syncReady, syncInFlight:_syncInFlight,
        status:{...taskSyncStatus}, soundEnabled, autoStartNext, taskGoals, completing:_completing,
        online:Object.getOwnPropertyDescriptor(navigator,'onLine')
      };
      const nextTurn = () => new Promise(resolve => setTimeout(resolve,0));
      const refreshFrame = () => new Promise(resolve => { refreshWorkspace(); requestAnimationFrame(resolve); });
      const rows = () => Array.from($('pickerResults').querySelectorAll('[data-picker-task]')).map(b => b.dataset.pickerTask);
      const button = id => Array.from($('pickerResults').querySelectorAll('[data-picker-task]')).find(b => b.dataset.pickerTask === id);
      const search = value => { $('pickerSearch').value=value; $('pickerSearch').dispatchEvent(new Event('input',{bubbles:true})); };
      const setOnline = value => Object.defineProperty(navigator,'onLine',{configurable:true,value});
      const open = async () => { $('queueAdd').focus(); $('queueAdd').click(); await nextTurn(); };
      const close = async () => { $('pickerDone').click(); await nextTurn(); };
      let refreshCount=0, failRefresh=false, networkCalls=0, completionAttempts=0;
      window.__taskPickerSmokeCleanup = async () => {
        if ($('workspaceDialog').open) $('workspaceDialog').close();
        if (timerRunning) pauseTimer();
        tasks=saved.tasks; allTasks=saved.allTasks; itemsById=saved.itemsById;
        projects=saved.projects; currentIndex=saved.currentIndex; currentUserId=saved.currentUserId;
        apiToken=saved.apiToken; loadAllTasks=saved.loadAllTasks; completeTask=saved.completeTask; window.fetch=saved.fetch;
        _syncReady=saved.syncReady; _syncInFlight=saved.syncInFlight;
        Object.assign(taskSyncStatus,saved.status); soundEnabled=saved.soundEnabled;
        autoStartNext=saved.autoStartNext; taskGoals=saved.taskGoals; _completing=saved.completing;
        if(saved.online) Object.defineProperty(navigator,'onLine',saved.online); else delete navigator.onLine;
        persistSession(); renderCurrentTask(); armTimerForArrival(false,false);
        delete window.__taskPickerSmokeCleanup;
      };
      if (timerRunning) pauseTimer();
      if (isCompact) toggleCompactMode();
      if ($('workspaceDialog').open) $('workspaceDialog').close();
      document.querySelectorAll('.task-order-overlay,.timer-edit-overlay,.shortcuts-overlay,.goal-popover,.break-overlay').forEach(el=>el.classList.remove('active'));
      showFocusScreen(); soundEnabled=false; autoStartNext=false;
      _syncReady=false; _syncInFlight=false; apiToken='isolated-picker-token'; currentUserId='picker-user'; taskGoals={};
      window.fetch=async()=>{networkCalls++;throw new Error('Unexpected network request in task picker test');};
      completeTask=()=>{completionAttempts++;};
      setOnline(true);
      projects={school:{name:'School leadership'},baseball:{name:'Baseball coaching'},inbox:{name:'Inbox'}};
      const today=localDateKey();
      const previous=new Date(); previous.setDate(previous.getDate()-1);
      const future=new Date(); future.setDate(future.getDate()+5);
      const literal='Review <img src=x onerror="window.pickerInjected=true"> & "notes"';
      const fixtures=[
        {id:'picker-current',content:'Current focus',project_id:'school',due:{date:today},duration:{amount:25,unit:'minute'}},
        {id:'picker-today',content:'Call families',project_id:'school',due:{date:today},duration:{amount:17,unit:'minute'}},
        {id:'picker-overdue',content:'Review overdue notes',project_id:'school',due:{date:localDateKey(previous)}},
        {id:'picker-future',content:'Plan Saturday practice',project_id:'baseball',due:{date:localDateKey(future)},labels:['fieldwork']},
        {id:'picker-undated',content:'Organize equipment',project_id:'baseball',labels:['gear']},
        {id:'picker-html',content:literal,project_id:'school',due:{date:today}},
        {id:'picker-complete',content:'Completed fixture',checked:true,due:{date:today}},
        {id:'picker-deleted',content:'Deleted fixture',is_deleted:true,due:{date:today}},
        {id:'picker-other-user',content:'Assigned elsewhere',responsible_uid:'different-user',due:{date:today}},
        {id:'picker-sync-store',content:'focus-state',due:{date:today}}
      ];
      tasks=[fixtures[0]]; currentIndex=0;
      allTasks=fixtures; itemsById=Object.fromEntries(fixtures.map(t=>[t.id,t]));
      loadAllTasks=async()=>{refreshCount++;taskSyncStatus.error=failRefresh;return allTasks;};
      renderCurrentTask(); armTimerForArrival(false,false);
      const result={};
      await open();
      result.open={native:$('workspaceDialog') instanceof HTMLDialogElement,open:$('workspaceDialog').open,focus:document.activeElement.id,scope:$('pickerScope').value,rows:rows()};
      result.escaped={text:button('picker-html').querySelector('strong').textContent,images:$('pickerResults').querySelectorAll('img').length,injected:!!window.pickerInjected};
      result.search={};
      for(const [key,value] of Object.entries({title:'Saturday',project:'Baseball coaching',label:'gear'})) { search(value); result.search[key]=rows(); }
      search('nothing matches this');
      result.empty={rows:rows(),message:$('pickerResults').textContent};
      search(''); $('pickerScope').value='all'; $('pickerScope').dispatchEvent(new Event('change',{bubbles:true}));
      result.all=rows();
      $('pickerSearch').focus(); $('pickerSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true,cancelable:true}));
      result.arrowFocus=document.activeElement.dataset.pickerTask;

      timerSeconds=123; initialTimerSeconds=1500; startTimer();
      const before={id:currentTask().id,index:currentIndex,seconds:timerSeconds,initial:initialTimerSeconds,end:timerEndTime,interval:timerInterval};
      const originalAdd=button('picker-today'); originalAdd.focus(); originalAdd.click(); originalAdd.click();
      button('picker-today').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));
      result.added={ids:tasks.map(t=>t.id),focused:currentTask().id,index:currentIndex,running:timerRunning,
        sameTimer:timerSeconds===before.seconds && initialTimerSeconds===before.initial && timerEndTime===before.end && timerInterval===before.interval,
        removeEnabled:!!button('picker-today').dataset.removeTask && !button('picker-today').disabled && button('picker-today').getAttribute('aria-disabled')!=='true',rowFocused:document.activeElement.dataset.pickerTask,
        announcement:$('pickerAnnouncement').textContent,saved:JSON.parse(localStorage.getItem('focus_session')).tasks.map(t=>t.id)};
      // The session filter must include a saved session task that is absent
      // from the latest task results, and removal must not touch Todoist.
      const cachedOnly={id:'picker-session-only',content:'Saved session task',project_id:'baseball'};
      tasks.push(cachedOnly); persistSession();
      $('pickerScope').value='session'; $('pickerScope').dispatchEvent(new Event('change',{bubbles:true}));
      result.sessionScope=rows();
      search('Baseball coaching'); result.sessionSearch=rows(); search('');
      const beforeRemove={seconds:timerSeconds,initial:initialTimerSeconds,end:timerEndTime,interval:timerInterval};
      button('picker-today').focus(); button('picker-today').click();
      result.removed={ids:tasks.map(t=>t.id),focused:currentTask()?.id,running:timerRunning,
        sameTimer:timerSeconds===beforeRemove.seconds && initialTimerSeconds===beforeRemove.initial && timerEndTime===beforeRemove.end && timerInterval===beforeRemove.interval,
        noLongerVisible:!button('picker-today'),focusInside:$('workspaceDialog').contains(document.activeElement),
        stillInTodoist:allTasks.some(t=>t.id==='picker-today'),completionAttempts};
      // Completing a task must temporarily block conflicting session edits.
      _completing=true; await refreshFrame();
      button('picker-session-only').click();
      result.completionGuard=tasks.some(t=>t.id==='picker-session-only');
      _completing=false; await refreshFrame();
      button('picker-session-only').click();
      $('pickerScope').value='all'; $('pickerScope').dispatchEvent(new Event('change',{bubbles:true}));
      button('picker-today').click();
      pauseTimer();
      // Background refresh can remove the focused result. Keep focus inside
      // the picker, and never let Enter complete the task behind the dialog.
      button('picker-overdue').focus();
      allTasks=allTasks.filter(task=>task.id!=='picker-overdue');
      await refreshFrame();
      result.removedFocus={focus:document.activeElement.id,removed:!button('picker-overdue')};
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
      // Explicitly exercise the legacy document guard as well as the input's
      // propagation guard, matching a temporarily detached focused element.
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
      result.removedFocus.completionAttempts=completionAttempts;
      result.removedFocus.ids=tasks.map(task=>task.id);
      allTasks=fixtures; await refreshFrame();
      await close(); result.done={open:$('workspaceDialog').open,focus:document.activeElement.id};

      // The first task must initialize its own countdown instead of inheriting
      // the previous task's time or the empty screen's fallback duration.
      tasks=[]; currentIndex=0; timerSeconds=42; initialTimerSeconds=42;
      renderCurrentTask(); await open(); button('picker-today').click();
      result.first={ids:tasks.map(t=>t.id),focused:currentTask()?.id,seconds:timerSeconds,initial:initialTimerSeconds,running:timerRunning};
      await close();

      // Saved tasks remain useful offline and after a failed refresh.
      setOnline(false); const callsBeforeOffline=refreshCount;
      await open(); result.offline={rows:rows(),status:$('pickerStatus').textContent,disabled:$('pickerRefresh').disabled,noRefresh:refreshCount===callsBeforeOffline};
      await close(); setOnline(true); failRefresh=true;
      await open(); result.failed={rows:rows(),status:$('pickerStatus').textContent,label:$('pickerRefresh').textContent,disabled:$('pickerRefresh').disabled};
      const callsBeforeRetry=refreshCount; failRefresh=false;
      $('pickerRefresh').click(); await nextTurn();
      result.retry={calls:refreshCount-callsBeforeRetry,status:$('pickerStatus').textContent,label:$('pickerRefresh').textContent,disabled:$('pickerRefresh').disabled};
      await close();
      // A picker opened during another sync must observe that sync's result,
      // even though it did not initiate the refresh itself.
      _syncInFlight=true; taskSyncStatus.error=false;
      const callsBeforeBackground=refreshCount;
      await open();
      result.backgroundBusy={status:$('pickerStatus').textContent,disabled:$('pickerRefresh').disabled,noRefresh:refreshCount===callsBeforeBackground};
      _syncInFlight=false; taskSyncStatus.error=true; await refreshFrame();
      result.backgroundFailed={status:$('pickerStatus').textContent,label:$('pickerRefresh').textContent,disabled:$('pickerRefresh').disabled};
      taskSyncStatus.error=false; taskSyncStatus.lastSuccess=Date.now(); await refreshFrame();
      result.backgroundRecovered={status:$('pickerStatus').textContent,label:$('pickerRefresh').textContent,disabled:$('pickerRefresh').disabled};
      await close();
      // Keep this dialog open for a trusted Escape keyboard event from Electron.
      await open();
      result.networkCalls=networkCalls;
      return result;
    })()`);
    assert.deepEqual(result.open, {
      native: true, open: true, focus: 'pickerSearch', scope: 'today',
      rows: ['picker-today', 'picker-overdue', 'picker-html', 'picker-current']
    });
    assert.deepEqual(result.escaped, { text: 'Review <img src=x onerror="window.pickerInjected=true"> & "notes"', images: 0, injected: false });
    assert.deepEqual(result.search.title, ['picker-future']);
    assert.deepEqual(result.search.project, ['picker-future', 'picker-undated']);
    assert.deepEqual(result.search.label, ['picker-undated']);
    assert.deepEqual(result.empty.rows, []);
    assert.match(result.empty.message, /No matching tasks/);
    assert.deepEqual(new Set(result.all), new Set(['picker-current', 'picker-today', 'picker-overdue', 'picker-future', 'picker-undated', 'picker-html']));
    assert.ok(result.arrowFocus && result.arrowFocus !== 'picker-current');
    assert.deepEqual(result.added, {
      ids: ['picker-current', 'picker-today'], focused: 'picker-current', index: 0, running: true, sameTimer: true,
      removeEnabled: true, rowFocused: 'picker-today', announcement: 'Added “Call families” to your session.', saved: ['picker-current', 'picker-today']
    });
    assert.deepEqual(new Set(result.sessionScope),new Set(['picker-current','picker-today','picker-session-only']));
    assert.deepEqual(result.sessionSearch,['picker-session-only']);
    assert.deepEqual(result.removed,{ids:['picker-current','picker-session-only'],focused:'picker-current',running:true,sameTimer:true,noLongerVisible:true,focusInside:true,stillInTodoist:true,completionAttempts:0});
    assert.equal(result.completionGuard,true);
    assert.deepEqual(result.done, { open: false, focus: 'queueAdd' });
    assert.deepEqual(result.removedFocus, { focus: 'pickerSearch', removed: true, completionAttempts: 0, ids: ['picker-current', 'picker-today'] });
    assert.deepEqual(result.first, { ids: ['picker-today'], focused: 'picker-today', seconds: 1020, initial: 1020, running: false });
    assert.ok(result.offline.rows.includes('picker-today'));
    assert.match(result.offline.status, /saved tasks/);
    assert.equal(result.offline.disabled, true);
    assert.equal(result.offline.noRefresh, true);
    assert.ok(result.failed.rows.includes('picker-today'));
    assert.match(result.failed.status, /Couldn’t refresh/);
    assert.equal(result.failed.label, 'Retry'); assert.equal(result.failed.disabled, false);
    assert.equal(result.retry.calls, 1); assert.equal(result.retry.label, 'Refresh'); assert.equal(result.retry.disabled, false);
    assert.match(result.retry.status, /in your session/);
    assert.deepEqual(result.backgroundBusy, { status: 'Refreshing Todoist tasks…', disabled: true, noRefresh: true });
    assert.match(result.backgroundFailed.status, /Couldn’t refresh/);
    assert.equal(result.backgroundFailed.label, 'Retry'); assert.equal(result.backgroundFailed.disabled, false);
    assert.match(result.backgroundRecovered.status, /in your session/);
    assert.equal(result.backgroundRecovered.label, 'Refresh'); assert.equal(result.backgroundRecovered.disabled, false);
    assert.equal(result.networkCalls, 0);

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await new Promise(resolve => setTimeout(resolve, 40));
    const escape = await win.webContents.executeJavaScript(`({open:$('workspaceDialog').open,focus:document.activeElement.id,task:currentTask()?.id,running:timerRunning})`);
    assert.deepEqual(escape, { open: false, focus: 'queueAdd', task: 'picker-today', running: false });
    console.log('Task picker: scopes, session removal, search, escaping, timer preservation, first task, offline/retry and focus restoration passed');
  } finally {
    await win.webContents.executeJavaScript(`window.__taskPickerSmokeCleanup?.()`);
  }
};
