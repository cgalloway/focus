// Runs the real desktop shell with an isolated profile and no live API access.
const { app, BrowserWindow, session, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'focus-smoke-')));
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.url.startsWith('https://') && !details.url.startsWith('https://cgalloway.github.io/focus/') });
  });
});
const errors = [];
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
});
require('../main.js');
const timeout = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    const state = await win.webContents.executeJavaScript(`({ origin: location.origin, bridge: !!window.focusAPI, ready: typeof timerTextCache === 'object', setup: !!document.getElementById('connectBtn') })`);
    assert.equal(state.origin, 'https://cgalloway.github.io');
    assert.equal(state.bridge, true);
    assert.equal(state.ready, true);
    assert.equal(state.setup, true);
    const version = await win.webContents.executeJavaScript(`window.focusAPI.getVersion()`);
    assert.equal(version, app.getVersion());
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.app-version').textContent`), `Focus ${version} · Your space for meaningful work`);
    const escaped = await win.webContents.executeJavaScript(`escHtml('A \"quoted\" <project> & more')`);
    assert.equal(escaped, 'A &quot;quoted&quot; &lt;project&gt; &amp; more');
    await win.webContents.executeJavaScript(`
      projects = { work: {name:'School & leadership', color:'olive_green'}, personal:{name:'Personal',color:'orange'} };
      tasks = [
        {id:'test-1', content:'Make space for the work that matters', project_id:'work', duration:{unit:'minute',amount:25}, due:{date:localDateKey()}},
        {id:'test-2', content:'Prepare next week’s priorities', project_id:'work', duration:{unit:'minute',amount:15}, priority:4},
        {id:'test-3', content:'Review the team’s project plan', project_id:'work', duration:{unit:'minute',amount:30}},
        {id:'test-4', content:'A little time for a new idea', project_id:'personal', duration:{unit:'minute',amount:10}}
      ];
      currentIndex = 0; soundEnabled = false;
      localStorage.setItem('focus_stats_v1', JSON.stringify({[localDateKey()]:{focusSeconds:2700,tasksCompleted:3}}));
      showFocusScreen(); renderCurrentTask(); renderStatsToday();
    `);
    await new Promise(resolve => setTimeout(resolve, 150));
    const workspace = await win.webContents.executeJavaScript(`({rows:document.querySelectorAll('.queue-row').length, minutes:document.getElementById('focusedMinutes').textContent, overflow:document.documentElement.scrollWidth > innerWidth})`);
    assert.equal(workspace.rows,4); assert.equal(workspace.minutes,'45 min'); assert.equal(workspace.overflow,false);
    fs.writeFileSync(path.join(os.tmpdir(),'focus-workspace-desktop.png'), (await win.webContents.capturePage()).toPNG());
    const stable = await win.webContents.executeJavaScript(`
      updateTimerDisplay();
      const digit=document.querySelector('#compactTimer .digit');
      const mainIcon=document.querySelector('#timerStartIcon > *');
      const compactIcon=document.querySelector('#compactPlayIcon > *');
      const row=document.querySelector('.queue-row');
      for(let i=0;i<100;i++) updateTimerDisplay();
      ({digit:digit===document.querySelector('#compactTimer .digit'),mainIcon:mainIcon===document.querySelector('#timerStartIcon > *'),compactIcon:compactIcon===document.querySelector('#compactPlayIcon > *'),row:row===document.querySelector('.queue-row')});
    `);
    assert.deepEqual(stable,{digit:true,mainIcon:true,compactIcon:true,row:true});
    const durationPolicy = await win.webContents.executeJavaScript(`
      const savedTasks=tasks, savedIndex=currentIndex, savedGoals=taskGoals;
      tasks=[{id:'policy',content:'Duration policy',duration:{unit:'minute',amount:35}}];
      currentIndex=0; taskGoals={};
      applyRemoteSettings({workDurationMins:25,useTaskDurations:false});
      const todoist=taskWorkSeconds();
      delete tasks[0].duration;
      armTimerForArrival(false,false);
      const fallback=timerSeconds;
      const seed=goalSeedMinutes(tasks[0]);
      taskGoals.policy={minutes:7,enabled:false};
      const custom=taskWorkSeconds();
      tasks=savedTasks;currentIndex=savedIndex;taskGoals=savedGoals;
      armTimerForArrival(false,false);renderCurrentTask();
      ({todoist,fallback,seed,custom});
    `);
    assert.deepEqual(durationPolicy,{todoist:2100,fallback:600,seed:10,custom:420});
    const refreshChecks = await win.webContents.executeJavaScript(`
      renderTaskList();
      const sessionRow = taskList.firstElementChild;
      renderTaskList();
      const sessionStable = sessionRow === taskList.firstElementChild;
      const candidates = [{id:'search-a',content:'Alpha'},{id:'search-b',content:'Beta'}];
      renderSearchResults(candidates);
      const rowA = searchResults.firstElementChild;
      rowA.classList.add('keyboard-selected'); selectedSearchIndex = 0;
      renderSearchResults([{id:'search-c',content:'New'}, ...candidates]);
      const preserved = selectedSearchIndex === 1 && searchResults.children[1] === rowA && rowA.classList.contains('keyboard-selected');
      renderSearchResults([{id:'search-a',content:'Changed'},candidates[1]]);
      const updated = searchResults.firstElementChild === rowA && rowA.textContent.includes('Changed');
      renderSearchResults([candidates[1]]);
      const removed = selectedSearchIndex === -1 && !searchResults.contains(rowA);
      updateWorkspaceTimer();
      const observer = new MutationObserver(()=>{});
      observer.observe(document.querySelector('.duration-presets'),{subtree:true,attributes:true,childList:true});
      for(let i=0;i<100;i++) updateWorkspaceTimer();
      const mutations = observer.takeRecords().length; observer.disconnect();
      taskSyncStatus.error = true; refreshWorkspace();
      ({sessionStable,preserved,updated,removed,mutations});
    `);
    assert.deepEqual(refreshChecks,{sessionStable:true,preserved:true,updated:true,removed:true,mutations:0});
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.match(await win.webContents.executeJavaScript(`document.getElementById('connectionLabel').textContent`), /Task sync failed/);
    await win.webContents.executeJavaScript(`taskSyncStatus.error=false; taskSyncStatus.lastSuccess=Date.now(); refreshWorkspace();`);
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.match(await win.webContents.executeJavaScript(`document.getElementById('connectionLabel').textContent`), /Tasks synced at/);
    const retry = await win.webContents.executeJavaScript(`(async()=>{
      const originalSync = _doSync;
      const originalToken = apiToken; apiToken = 'isolated-test-token';
      let calls = 0;
      _doSync = async()=>{calls++; return true;};
      taskSyncStatus.error = true;
      try {
        await document.getElementById('retrySync').onclick();
        return {calls,success:taskSyncStatus.lastSuccess>0,error:taskSyncStatus.error,busy:_syncInFlight};
      } finally { _doSync = originalSync; apiToken = originalToken; }
    })()`);
    assert.deepEqual(retry,{calls:1,success:true,error:false,busy:false});
    const savedBounds = win.getBounds();
    win.setBounds({x:savedBounds.x+10,y:savedBounds.y+10,width:1000,height:750});
    await new Promise(resolve=>setTimeout(resolve,550));
    const restoredBounds = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'window-state.json'),'utf8'));
    assert.deepEqual(restoredBounds.normalBounds,win.getBounds());
    win.setBounds(savedBounds);
    nativeTheme.themeSource = 'dark';
    await new Promise(resolve=>setTimeout(resolve,100));
    fs.writeFileSync(path.join(os.tmpdir(),'focus-workspace-dark.png'), (await win.webContents.capturePage()).toPNG());
    nativeTheme.themeSource = 'light';
    const removedCapture = await win.webContents.executeJavaScript(`
      localStorage.setItem('focus_distractions_v1',JSON.stringify([{id:'existing-note',text:'Saved before inbox removal'}]));
      ({
      capture:!!document.getElementById('captureOpen'),inbox:!!document.querySelector('.capture-card'),
      shortcut:Array.from(document.querySelectorAll('.shortcuts-list dd')).some(el=>/thought/i.test(el.textContent))
    })`);
    assert.deepEqual(removedCapture,{capture:false,inbox:false,shortcut:false});
    const planned = await win.webContents.executeJavaScript(`
      document.getElementById('planOpen').click();
      document.getElementById('blockBudget').value='60';
      document.getElementById('blockBudget').dispatchEvent(new Event('change'));
      const caption = document.getElementById('planCaption').textContent;
      document.getElementById('applyPlan').click();
      ({caption, ids:tasks.map(t=>t.id), open:document.getElementById('workspaceDialog').open});
    `);
    assert.equal(planned.caption,'3 tasks · 50 min of focused work');
    assert.deepEqual(planned.ids,['test-1','test-2','test-4','test-3']); assert.equal(planned.open,false);
    const timer = await win.webContents.executeJavaScript(`
      document.querySelector('[data-duration="15"]').click();
      const secs=timerSeconds;
      document.getElementById('timerStartBtn').click();
      const running=timerRunning;
      document.querySelector('[data-duration="50"]').click();
      const protectedSeconds=initialTimerSeconds;
      document.getElementById('timerStartBtn').click();
      document.getElementById('zenBtn').click();
      const hidden=getComputedStyle(document.querySelector('.session-panel')).display;
      document.getElementById('zenBtn').click();
      ({secs,running,protectedSeconds,paused:!timerRunning,hidden});
    `);
    assert.deepEqual(timer,{secs:900,running:true,protectedSeconds:900,paused:true,hidden:'none'});
    await new Promise(resolve => setTimeout(resolve, 100));
    const durations = await win.webContents.executeJavaScript(`
      // Custom edits belong to the selected task, including before first start.
      document.getElementById('customDuration').click();
      document.getElementById('timerMinutes').value='10';
      document.getElementById('timerSeconds').value='0';
      document.getElementById('timerEditSave').click();
      const first=timerSeconds;
      const goal=taskGoals['test-1'].minutes;
      // Editing a different queue task must clear its old parked countdown,
      // preserve focus, and use the chosen duration on arrival.
      taskTimeLeft['test-2']={left:200,initial:900};
      document.querySelector('[data-edit-duration="test-2"]').click();
      document.getElementById('popGoalMinutes').value='20';
      document.getElementById('popGoalSet').click();
      const selected=currentTask().id;
      switchFocusedTask(1);
      const second=timerSeconds;
      switchFocusedTask(0);
      const returnUntouched=timerSeconds;
      timerSeconds=543;
      switchFocusedTask(1); switchFocusedTask(0);
      const resumed=timerSeconds;
      document.querySelector('[data-duration="10"]').click();
      ({first,goal,selected,second,returnUntouched,resumed,reselected:timerSeconds,estimates:useTaskDurations});
    `);
    assert.deepEqual(durations,{first:600,goal:10,selected:'test-1',second:1200,returnUntouched:600,resumed:543,reselected:600,estimates:true});
    const completion = await win.webContents.executeJavaScript(`(async()=>{
      const originalFetch=window.fetch;
      const calls=[];
      const originalToken=apiToken; apiToken='isolated-test-token';
      // Simulate only this fixture's successful close. No live Todoist writes.
      window.fetch=async (url,options)=>{
        if (url==='https://api.todoist.com/api/v1/sync') {
          const command=JSON.parse(new URLSearchParams(options.body).get('commands'))[0];
          if(command.type!=='item_close' || command.args.id!=='test-1') throw new Error('Wrong completion command');
          calls.push(options.method); return Response.json({sync_status:{[command.uuid]:'ok'}});
        }
        throw new Error('Unexpected request during completion test');
      };
      try {
        startTimer();
        commitGoal(currentTask(),12,true);
        if (timerSeconds!==720 || !timerRunning) throw new Error('Running duration edit did not re-arm the task');
        commitGoal(currentTask(),10,true);
        await completeTask();
        await new Promise(resolve=>setTimeout(resolve,350));
        const result={id:currentTask().id,initial:initialTimerSeconds,running:timerRunning,calls};
        pauseTimer(); return result;
      } finally {window.fetch=originalFetch;apiToken=originalToken;}
    })()`);
    assert.deepEqual(completion,{id:'test-2',initial:1200,running:true,calls:['POST']});
    await require('./completion-smoke.cjs')(win);
    await require('./task-picker-smoke.cjs')(win);
    await require('./session-queue-smoke.cjs')(win);
    await require('./consistency-smoke.cjs')(win);
    await require('./overtime-smoke.cjs')(win);
    win.setSize(390,844);
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'),true);
    fs.writeFileSync(path.join(os.tmpdir(),'focus-workspace-mobile.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(1120,820);
    const normal = win.getBounds();
    await win.webContents.executeJavaScript('focusAPI.toggleCompact(true)');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(win.isAlwaysOnTop(), true);
    await win.webContents.executeJavaScript('focusAPI.toggleCompact(true)');
    await win.webContents.executeJavaScript('focusAPI.toggleCompact(false)');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(win.isAlwaysOnTop(), false);
    assert.equal(win.getBounds().height, normal.height);
    console.log("Checking compact behavior");
    const compactBehavior = await win.webContents.executeJavaScript(`
      tasks=[{id:'compact-a',content:'Prepare next week’s priorities'},{id:'compact-b',content:'Review notes'}];
      currentIndex=0;taskGoals={};taskTimeLeft={};armTimerForArrival(false,false);
      timerSeconds=480; extendCurrentSession();
      const extended={remaining:timerSeconds,initial:initialTimerSeconds,goal:goalFor(currentTask()),estimate:taskWorkSeconds()};
      deferCurrentTask();
      const next=currentTask().id;
      switchFocusedTask(1);
      const compactResumed=timerSeconds;
      toggleCompactMode();
      updateCompactBar();
      ({extended,next,resumed:compactResumed,paused:document.querySelector('.compact-status').textContent});
    `);
    assert.deepEqual(compactBehavior,{extended:{remaining:780,initial:900,goal:null,estimate:600},next:'compact-b',resumed:780,paused:'Paused'});
    await new Promise(resolve=>setTimeout(resolve,400));
    fs.writeFileSync(path.join(os.tmpdir(),'focus-compact-task.png'),(await win.webContents.capturePage()).toPNG());
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.compact-bar').scrollWidth <= document.querySelector('.compact-bar').clientWidth`),true);
    console.log("Checking automatic width");
    const originalWidth=win.getBounds().width;
    await win.webContents.executeJavaScript(`currentTask().content='Prepare the complete presentation and supporting materials for the upcoming department planning meeting';updateCompactBar();`);
    await new Promise(resolve=>setTimeout(resolve,600));
    assert.ok(win.getBounds().width>originalWidth,'longer task expands the pill');
    assert.equal(await win.webContents.executeJavaScript(`compactTask.scrollWidth <= compactTask.clientWidth+1 && compactTask.scrollHeight <= compactTask.clientHeight+1`),true);
    fs.writeFileSync(path.join(os.tmpdir(),'focus-compact-autofit.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`currentTask().content='A very long task title that must wrap safely within the available screen. '.repeat(30);updateCompactBar();`);
    await new Promise(resolve=>setTimeout(resolve,600));
    const area=require('electron').screen.getDisplayMatching(win.getBounds()).workArea;
    assert.ok(win.getBounds().width<=area.width);
    assert.ok(win.getBounds().height>80);
    assert.equal(await win.webContents.executeJavaScript(`compactTask.scrollHeight <= compactTask.clientHeight+1`),true);
    await win.webContents.executeJavaScript(`currentTask().content='Review notes';updateCompactBar();`);
    await new Promise(resolve=>setTimeout(resolve,600));
    assert.ok(win.getBounds().width<originalWidth);
    assert.equal(win.getBounds().height,80);
    await win.webContents.executeJavaScript(`document.body.classList.add('compact-timer-only');focusAPI.setCompactLayout('timer')`);
    await new Promise(resolve=>setTimeout(resolve,200));
    fs.writeFileSync(path.join(os.tmpdir(),'focus-compact-timer.png'),(await win.webContents.capturePage()).toPNG());
    assert.ok(win.getBounds().width>=400);
    await win.webContents.executeJavaScript(`tasks=[];currentIndex=0;updateCompactBar();`);
    assert.equal(await win.webContents.executeJavaScript(`compactTask.textContent`),'Add Todoist tasks');
    fs.writeFileSync(path.join(os.tmpdir(),'focus-compact-empty.png'),(await win.webContents.capturePage()).toPNG());
    console.log('Checking restored duration');
    const menuResult=win.webContents.executeJavaScript(`focusAPI.compactMenu({hasTask:true,multiple:true,canExtend:true})`);
    let popup;
    for(let i=0;i<40;i++) { popup=BrowserWindow.getAllWindows().find(w=>w!==win);if(popup && !popup.webContents.isLoading())break;await new Promise(resolve=>setTimeout(resolve,50)); }
    assert.ok(popup,'compact menu opens a separate window');
    await new Promise(resolve=>setTimeout(resolve,200));
    assert.equal(await popup.webContents.executeJavaScript(`document.querySelectorAll('button').length`),10);
    assert.match(await popup.webContents.executeJavaScript(`document.body.innerText`),/Do later/);
    fs.writeFileSync(path.join(os.tmpdir(),'focus-compact-menu.png'),(await popup.webContents.capturePage()).toPNG());
    await popup.webContents.executeJavaScript(`document.querySelector('button').click()`);
    assert.equal(await menuResult,'extend');
    await require('./compact-controls-smoke.cjs')(win);
    await win.webContents.executeJavaScript(`
      toggleCompactMode();document.body.classList.remove('compact-timer-only');
      tasks=[{id:'test-2',content:'Legacy saved duration'}];currentIndex=0;timerExtraSeconds=0;
    `);

    // Reproduce the reported state: saved five-minute goal switched off,
    // 24:47 left in an obsolete 25-minute countdown, 25 minutes spent overall.
    await win.webContents.executeJavaScript(`
      taskGoals['test-2']={minutes:5,enabled:false,ts:Date.now()};
      taskElapsed['test-2']=1500;
      timerSeconds=1487; initialTimerSeconds=1500;
      saveGoals(); saveElapsed(); persistSession(); stashCurrentTaskTimer();
    `);
    win.webContents.reload();
    await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
    const preservedNotes = await win.webContents.executeJavaScript(`
      showFocusScreen(); JSON.parse(localStorage.getItem('focus_distractions_v1'))[0].text;
    `);
    assert.equal(preservedNotes,'Saved before inbox removal');
    const legacy = await win.webContents.executeJavaScript(`
      restoreSession(); loadGoals(); loadElapsed();
      armTimerForArrival(false,false); renderCurrentTask();
      const result={seconds:timerSeconds,initial:initialTimerSeconds,estimate:FocusWorkspaceCore.estimate(currentTask(),taskGoals),chip:document.getElementById('goalChip').textContent,toggle:!!document.getElementById('goalQuickToggle')};
      document.getElementById('goalChip').click();
      document.querySelector('.goal-preset[data-mins="5"]').click();
      result.afterSelection=timerSeconds;
      startTimer();result.running=timerRunning;pauseTimer();
      result;
    `);
    assert.equal(legacy.seconds,300); assert.equal(legacy.initial,300);
    assert.equal(legacy.estimate,5); assert.equal(legacy.toggle,false);
    assert.match(legacy.chip,/5 min duration/); assert.match(legacy.chip,/25 min spent total/);
    assert.equal(legacy.afterSelection,300); assert.equal(legacy.running,true);
    assert.deepEqual(errors, []);
    console.log('PASS: bundled UI, original storage origin, inline session controls, planner, timer presets, focus view, mobile layout, compact round trip, no renderer errors');
    clearTimeout(timeout);
    app.exit(0);
  } catch (err) { console.error(err); console.error(errors); app.exit(1); }
});
