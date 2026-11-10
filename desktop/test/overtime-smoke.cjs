const assert = require('node:assert/strict');
module.exports = async win => {
  const results = await win.webContents.executeJavaScript(`(()=>{
    const saved={tasks,currentIndex,taskGoals,taskTimeLeft,pomodoroEnabled,pomodoroCount,autoStartNext,stats:localStorage.getItem('focus_stats_v1')};
    const originalNow=Date.now, originalSet=window.setInterval, originalClear=window.clearInterval;
    const ticks=new Map();let clock=Date.now(), sequence=0;
    if(timerRunning)pauseTimer();exitOvertime();
    Date.now=()=>clock;
    window.setInterval=callback=>{const id=--sequence;ticks.set(id,callback);return id;};
    window.clearInterval=id=>{if(ticks.has(id))ticks.delete(id);else originalClear(id);};
    const results=[];
    try {
      for(const mode of ['todoist','fallback-after-switch','custom','pomodoro']) {
        tasks=[{id:'overtime-a',content:'First task',duration:{amount:15,unit:'minute'}},{id:'overtime-b',content:'Next task'}];
        taskGoals={};taskTimeLeft={};currentIndex=0;isOnBreak=false;autoStartNext=false;
        pomodoroEnabled=mode==='pomodoro';pomodoroCount=0;_breakPendingTaskId=null;
        if(mode==='custom')taskGoals['overtime-a']={minutes:5};
        armTimerForArrival(false,false);
        if(mode==='fallback-after-switch')switchFocusedTask(1);
        const duration=initialTimerSeconds;
        // Drive the actual countdown callback without waiting minutes.
        timerSeconds=1;startTimer();clock+=1000;ticks.get(timerInterval)();
        const entered=inOvertime;clock+=2000;ticks.get(overtimeInterval)();
        results.push({mode,duration,entered,seconds:overtimeSeconds,main:timerDisplay.textContent,compact:compactTimer.textContent,id:_overtimeTaskId,breakStarted:isOnBreak,pendingBreak:_breakPendingTaskId,notice:timerNotificationText().body});
        switchFocusedTask(currentIndex===0?1:0);
        results[results.length-1].clearedOnSwitch=!inOvertime;
        exitOvertime();if(timerRunning)pauseTimer();
      }
      isOnBreak=true;pomodoroEnabled=true;timerSeconds=1;initialTimerSeconds=1;
      startTimer();clock+=1000;ticks.get(timerInterval)();
      results.push({mode:'break',overtime:inOvertime,break:isOnBreak,seconds:timerSeconds});
    } finally {
      if(timerRunning)pauseTimer();exitOvertime();Date.now=originalNow;window.setInterval=originalSet;window.clearInterval=originalClear;
      tasks=saved.tasks;currentIndex=saved.currentIndex;taskGoals=saved.taskGoals;taskTimeLeft=saved.taskTimeLeft;
      pomodoroEnabled=saved.pomodoroEnabled;pomodoroCount=saved.pomodoroCount;autoStartNext=saved.autoStartNext;
      isOnBreak=false;_breakPendingTaskId=null;hideBreakOverlay();
      if(saved.stats===null)localStorage.removeItem('focus_stats_v1');else localStorage.setItem('focus_stats_v1',saved.stats);
      armTimerForArrival(false,false);renderCurrentTask();
    }
    return results;
  })()`);
  for(const result of results.slice(0,4)) {
    assert.equal(result.entered,true,result.mode);assert.equal(result.seconds,2,result.mode);
    assert.match(result.main,/\+0:02/);assert.match(result.compact,/\+0:02/);
    assert.equal(result.breakStarted,false);assert.equal(result.clearedOnSwitch,true);
    assert.match(result.notice,/counting overtime/);
    assert.equal(result.id,result.mode==='fallback-after-switch'?'overtime-b':'overtime-a');
    assert.equal(result.pendingBreak,result.mode==='pomodoro'?'overtime-a':null);
  }
  assert.equal(results[0].duration,900);assert.equal(results[1].duration,600);assert.equal(results[2].duration,300);
  assert.equal(results[4].overtime,false);assert.equal(results[4].break,false);assert.ok(results[4].seconds>0);
  console.log('PASS: all task durations count up after zero, including after switching; break timers remain bounded');
};
