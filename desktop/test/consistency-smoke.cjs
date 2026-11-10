// Regression checks for shared controls, settings and utility-dialog behavior.
const assert = require('node:assert/strict');
module.exports = async win => {
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const saved={tasks,currentIndex,taskGoals,taskTimeLeft,apiToken,loadProjects,initSync,scheduleSync,
      fetch:window.fetch,soundEnabled,autoStartNext,pomodoroEnabled,shortBreakMins,longBreakMins,
      syncReady:_syncReady,tokenValue:apiTokenInput.value};
    const result={};let requests=0;
    const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
    const frame=()=>new Promise(resolve=>{refreshWorkspace();requestAnimationFrame(resolve);});
    const clock=()=>({seconds:timerSeconds,initial:initialTimerSeconds,extra:timerExtraSeconds,end:timerEndTime,interval:timerInterval});
    const sameClock=before=>timerSeconds===before.seconds && initialTimerSeconds===before.initial && timerExtraSeconds===before.extra && timerEndTime===before.end && timerInterval===before.interval;
    const key=(target,key,shiftKey=false)=>target.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true,shiftKey}));
    try {
      if(timerRunning)pauseTimer();exitOvertime();isOnBreak=false;
      if(isCompact)toggleCompactMode();showFocusScreen();
      tasks=[{id:'consistency-a',content:'Current task',duration:{amount:10,unit:'minute'}},{id:'consistency-b',content:'Next task'}];
      currentIndex=0;taskGoals={};taskTimeLeft={};soundEnabled=false;autoStartNext=false;pomodoroEnabled=false;
      apiToken='isolated-settings-token';apiTokenInput.value=apiToken;_syncReady=false;
      // Settings save must not fetch Todoist for an unchanged token. The settings
      // screen's ordinary project refresh and device sync are isolated separately.
      loadProjects=async()=>{};initSync=()=>{};scheduleSync=()=>{};
      window.fetch=async()=>{requests++;throw new Error('Unexpected request while saving existing settings');};
      armTimerForArrival(false,false);renderCurrentTask();extendCurrentSession();await frame();
      const extendedClock=clock();
      document.querySelector('[data-move-task="consistency-a"][data-direction="down"]').click();await frame();
      result.unstartedExtension={current:currentTask().id,seconds:timerSeconds,initial:initialTimerSeconds,extra:timerExtraSeconds,sameClock:sameClock(extendedClock),running:timerRunning};
      timerSeconds=811;startTimer();const runningClock=clock();
      settingsBtn.click();await turn();
      result.settingsLabels={title:$('settingsTitle').textContent,save:connectBtn.textContent,back:cancelSettingsBtn.textContent};
      connectBtn.click();await turn();
      result.runningSave={active:focusScreen.classList.contains('active'),running:timerRunning,sameClock:sameClock(runningClock),requests,focus:document.activeElement.id};
      pauseTimer();timerSeconds=733;const pausedClock=clock();
      settingsBtn.click();await turn();connectBtn.click();await turn();
      result.pausedSave={running:timerRunning,sameClock:sameClock(pausedClock),requests};
      settingsBtn.click();await turn();soundToggle.checked=true;soundToggle.dispatchEvent(new Event('change',{bubbles:true}));
      cancelSettingsBtn.click();
      result.back={active:focusScreen.classList.contains('active'),soundEnabled,stored:localStorage.getItem('sound_enabled'),focus:document.activeElement.id,sameClock:sameClock(pausedClock)};
      shortcutsBtn.focus();shortcutsBtn.click();
      result.helpOpen={active:shortcutsOverlay.classList.contains('active'),inert:document.querySelector('.container').inert,focus:document.activeElement.id};
      key(closeShortcutsBtn,'Tab');result.helpTrap=document.activeElement.id;
      key(closeShortcutsBtn,'Escape');
      result.helpClose={active:shortcutsOverlay.classList.contains('active'),inert:document.querySelector('.container').inert,focus:document.activeElement.id};
      timerDisplay.focus();timerDisplay.click();
      result.timerOpen={active:timerEditOverlay.classList.contains('active'),inert:document.querySelector('.container').inert,focus:document.activeElement.id};
      const controls=Array.from(timerEditOverlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')).filter(el=>el.getClientRects().length);
      const first=controls[0],last=controls[controls.length-1];
      last.focus();key(last,'Tab');result.timerForward=document.activeElement.id===first.id;
      first.focus();key(first,'Tab',true);result.timerBackward=document.activeElement.id===last.id;
      key(document.activeElement,'Escape');
      result.timerClose={active:timerEditOverlay.classList.contains('active'),inert:document.querySelector('.container').inert,focus:document.activeElement.id,sameClock:sameClock(pausedClock)};
      result.durationPresets=Array.from(document.querySelectorAll('.goal-preset')).map(b=>Number(b.dataset.mins));
    } finally {
      if(timerRunning)pauseTimer();exitOvertime();isOnBreak=false;
      closeUtilityDialog(timerEditOverlay);closeUtilityDialog(shortcutsOverlay);
      tasks=saved.tasks;currentIndex=saved.currentIndex;taskGoals=saved.taskGoals;taskTimeLeft=saved.taskTimeLeft;
      apiToken=saved.apiToken;apiTokenInput.value=saved.tokenValue;loadProjects=saved.loadProjects;initSync=saved.initSync;scheduleSync=saved.scheduleSync;window.fetch=saved.fetch;
      soundEnabled=saved.soundEnabled;autoStartNext=saved.autoStartNext;pomodoroEnabled=saved.pomodoroEnabled;shortBreakMins=saved.shortBreakMins;longBreakMins=saved.longBreakMins;_syncReady=saved.syncReady;
      persistSession();showFocusScreen();armTimerForArrival(false,false);renderCurrentTask();await frame();
    }
    return result;
  })()`);
  assert.deepEqual(result.unstartedExtension,{current:'consistency-a',seconds:900,initial:900,extra:300,sameClock:true,running:false});
  assert.deepEqual(result.settingsLabels,{title:'Settings',save:'Save settings',back:'Back to focus'});
  assert.deepEqual(result.runningSave,{active:true,running:true,sameClock:true,requests:0,focus:'settingsBtn'});
  assert.deepEqual(result.pausedSave,{running:false,sameClock:true,requests:0});
  assert.deepEqual(result.back,{active:true,soundEnabled:true,stored:'true',focus:'settingsBtn',sameClock:true});
  assert.deepEqual(result.helpOpen,{active:true,inert:true,focus:'closeShortcutsBtn'});
  assert.equal(result.helpTrap,'closeShortcutsBtn');
  assert.deepEqual(result.helpClose,{active:false,inert:false,focus:'shortcutsBtn'});
  assert.deepEqual(result.timerOpen,{active:true,inert:true,focus:'timerMinutes'});
  assert.equal(result.timerForward,true);assert.equal(result.timerBackward,true);
  assert.deepEqual(result.timerClose,{active:false,inert:false,focus:'timerDisplay',sameClock:true});
  assert.deepEqual(result.durationPresets,[5,10,15,25,50]);
  console.log('PASS: unstarted extension reorder, settings preserve timers without refetching, shared duration presets, utility dialog focus and Escape');
};
