// Exercises inline session controls against fixture tasks and an isolated profile.
// Reordering/removing a session task must never send a Todoist mutation.
const assert = require('node:assert/strict');

module.exports = async win => {
  const result = await win.webContents.executeJavaScript(`(async () => {
    const saved={tasks,currentIndex,taskGoals,taskTimeLeft,projects,soundEnabled,autoStartNext,
      syncReady:_syncReady,completing:_completing,fetch:window.fetch,stats:localStorage.getItem('focus_stats_v1')};
    const frame=()=>new Promise(resolve=>{refreshWorkspace();requestAnimationFrame(resolve);});
    const ids=()=>tasks.map(t=>t.id);
    const move=(id,direction)=>$('sessionQueue').querySelector('[data-move-task="'+id+'"][data-direction="'+direction+'"]');
    const grip=id=>$('sessionQueue').querySelector('[data-drag-task="'+id+'"]');
    const remove=id=>$('sessionQueue').querySelector('[data-remove-task="'+id+'"]');
    const clock=()=>({seconds:timerSeconds,initial:initialTimerSeconds,end:timerEndTime,interval:timerInterval});
    const sameClock=before=>timerSeconds===before.seconds && initialTimerSeconds===before.initial && timerEndTime===before.end && timerInterval===before.interval;
    let networkCalls=0;
    const fixtures=[
      {id:'queue-a',content:'Prepare meeting',project_id:'school',duration:{amount:12,unit:'minute'}},
      {id:'queue-b',content:'Current work',project_id:'school',duration:{amount:17,unit:'minute'}},
      {id:'queue-c',content:'Review next steps',project_id:'school',duration:{amount:8,unit:'minute'}}
    ];
    const result={};
    try {
      if(timerRunning)pauseTimer();exitOvertime();isOnBreak=false;
      if(isCompact)toggleCompactMode();
      if($('workspaceDialog').open)$('workspaceDialog').close();
      showFocusScreen();soundEnabled=false;autoStartNext=false;_syncReady=false;_completing=false;
      window.fetch=async()=>{networkCalls++;throw new Error('Unexpected network request in inline queue test');};
      tasks=fixtures.slice();currentIndex=1;taskGoals={};taskTimeLeft={};projects={school:{name:'School'}};
      renderCurrentTask();armTimerForArrival(false,false);timerSeconds=611;startTimer();await frame();
      const runningClock=clock();
      move('queue-a','down').focus();move('queue-a','down').click();await frame();
      result.moveButton={ids:ids(),current:currentTask().id,index:currentIndex,running:timerRunning,sameClock:sameClock(runningClock),
        saved:JSON.parse(localStorage.getItem('focus_session')).tasks.map(t=>t.id),focusTask:document.activeElement.closest('[data-queue-id]')?.dataset.queueId};
      grip('queue-c').focus();
      grip('queue-c').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',code:'ArrowUp',bubbles:true,cancelable:true}));await frame();
      result.keyboard={ids:ids(),current:currentTask().id,index:currentIndex,sameClock:sameClock(runningClock),focusTask:document.activeElement.dataset.dragTask,
        firstDisabled:move('queue-b','up').disabled,lastDisabled:move('queue-a','down').disabled};
      move('queue-b','down').click();await frame();
      result.moveCurrent={ids:ids(),current:currentTask().id,index:currentIndex,sameClock:sameClock(runningClock)};
      // Drag to the first position, then to the final position. This covers
      // insertion adjustment when moving past the task's original index.
      const dragTo=(id,y)=>{
        const dataTransfer=new DataTransfer();
        grip(id).dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer}));
        $('sessionQueue').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientY:y,dataTransfer}));
        $('sessionQueue').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientY:y,dataTransfer}));
      };
      const firstRect=$('sessionQueue').querySelector('[data-queue-id="queue-c"]').getBoundingClientRect();
      dragTo('queue-a',firstRect.top+2);await frame();
      result.dragBefore={ids:ids(),current:currentTask().id,sameClock:sameClock(runningClock),indicators:!!$('sessionQueue').querySelector('.dragging,.drop-before,.drop-after')};
      const lastRect=$('sessionQueue').querySelector('[data-queue-id="queue-b"]').getBoundingClientRect();
      dragTo('queue-a',lastRect.bottom-2);await frame();
      result.dragAfter={ids:ids(),current:currentTask().id,sameClock:sameClock(runningClock)};
      // Paused time belongs to the task even if it moves to a different index.
      pauseTimer();timerSeconds=587;const pausedClock=clock();
      move('queue-b','up').click();await frame();
      result.paused={ids:ids(),current:currentTask().id,running:timerRunning,sameClock:sameClock(pausedClock)};
      // Overtime is also attached to the current task, not its queue position.
      timerSeconds=0;startOvertime();
      const overtime={start:overtimeStart,interval:overtimeInterval,task:_overtimeTaskId};
      move('queue-b','down').click();await frame();
      result.overtime={active:inOvertime,current:currentTask().id,
        preserved:overtimeStart===overtime.start && overtimeInterval===overtime.interval && _overtimeTaskId===overtime.task};
      exitOvertime();
      // Reordering must not restart or end a break countdown.
      isOnBreak=true;setTimer(5);startTimer();const breakClock=clock();
      move('queue-b','up').click();await frame();
      result.break={active:isOnBreak,running:timerRunning,current:currentTask().id,sameClock:sameClock(breakClock)};
      pauseTimer();isOnBreak=false;armTimerForArrival(false,false);timerSeconds=403;startTimer();
      const removalClock=clock();
      remove('queue-a').focus();remove('queue-a').click();await frame();
      result.removeOther={ids:ids(),current:currentTask().id,running:timerRunning,sameClock:sameClock(removalClock),
        focusSafe:document.activeElement!==document.body && $('focusScreen').contains(document.activeElement)};
      _completing=true;await frame();
      const guarded=ids();move('queue-b','down').click();remove('queue-c').click();
      moveSessionTask('queue-b',1);removeTaskFromSession(1);await frame();
      result.completionGuard={before:guarded,after:ids()};
      _completing=false;await frame();
      remove('queue-b').click();await frame();
      result.removeCurrent={ids:ids(),current:currentTask()?.id,running:timerRunning,initial:initialTimerSeconds,seconds:timerSeconds};
      remove('queue-c').click();await frame();
      result.removeLast={ids:ids(),current:currentTask()?.id || null,running:timerRunning,empty:!!$('emptyAddBtn'),
        saved:JSON.parse(localStorage.getItem('focus_session')).tasks.length,
        focusSafe:document.activeElement!==document.body && $('focusScreen').contains(document.activeElement)};
      result.networkCalls=networkCalls;
    } finally {
      if(timerRunning)pauseTimer();exitOvertime();isOnBreak=false;
      tasks=saved.tasks;currentIndex=saved.currentIndex;taskGoals=saved.taskGoals;taskTimeLeft=saved.taskTimeLeft;projects=saved.projects;
      soundEnabled=saved.soundEnabled;autoStartNext=saved.autoStartNext;_syncReady=saved.syncReady;_completing=saved.completing;window.fetch=saved.fetch;
      if(saved.stats===null)localStorage.removeItem('focus_stats_v1');else localStorage.setItem('focus_stats_v1',saved.stats);
      persistSession();armTimerForArrival(false,false);renderCurrentTask();await frame();
    }
    return result;
  })()`);
  assert.deepEqual(result.moveButton,{ids:['queue-b','queue-a','queue-c'],current:'queue-b',index:0,running:true,sameClock:true,saved:['queue-b','queue-a','queue-c'],focusTask:'queue-a'});
  assert.deepEqual(result.keyboard,{ids:['queue-b','queue-c','queue-a'],current:'queue-b',index:0,sameClock:true,focusTask:'queue-c',firstDisabled:true,lastDisabled:true});
  assert.deepEqual(result.moveCurrent,{ids:['queue-c','queue-b','queue-a'],current:'queue-b',index:1,sameClock:true});
  assert.deepEqual(result.dragBefore,{ids:['queue-a','queue-c','queue-b'],current:'queue-b',sameClock:true,indicators:false});
  assert.deepEqual(result.dragAfter,{ids:['queue-c','queue-b','queue-a'],current:'queue-b',sameClock:true});
  assert.deepEqual(result.paused,{ids:['queue-b','queue-c','queue-a'],current:'queue-b',running:false,sameClock:true});
  assert.deepEqual(result.overtime,{active:true,current:'queue-b',preserved:true});
  assert.deepEqual(result.break,{active:true,running:true,current:'queue-b',sameClock:true});
  assert.deepEqual(result.removeOther,{ids:['queue-b','queue-c'],current:'queue-b',running:true,sameClock:true,focusSafe:true});
  assert.deepEqual(result.completionGuard,{before:['queue-b','queue-c'],after:['queue-b','queue-c']});
  assert.deepEqual(result.removeCurrent,{ids:['queue-c'],current:'queue-c',running:true,initial:480,seconds:480});
  assert.deepEqual(result.removeLast,{ids:[],current:null,running:false,empty:true,saved:0,focusSafe:true});
  assert.equal(result.networkCalls,0);
  console.log('PASS: inline queue order, keyboard focus, persistence, running/paused/overtime/break preservation, session-only removal and completion guards');
};
