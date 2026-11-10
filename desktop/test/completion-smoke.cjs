// Runs inside the isolated shell used by smoke.cjs; every API call is mocked.
const assert = require('node:assert/strict');
module.exports = async win => {
  const result = await win.webContents.executeJavaScript(`(async()=>{
    const originalFetch=window.fetch, originalToken=apiToken, originalBump=bumpStat;
    const savedTasks=tasks, savedIndex=currentIndex, savedItems=itemsById;
    apiToken='isolated-test-token';
    function fixture(){
      if(timerRunning) pauseTimer();
      tasks=[{id:'complete-a',content:'Complete fixture'},{id:'complete-b',content:'Keep fixture'}];
      currentIndex=0;itemsById=Object.fromEntries(tasks.map(t=>[t.id,t]));
      persistSession();persistItemStore();renderCurrentTask();armTimerForArrival(false,false);
    }
    function ack(options){const c=JSON.parse(new URLSearchParams(options.body).get('commands'))[0];return Response.json({sync_status:{[c.uuid]:'ok'}});}
    const result={};
    try {
      fixture();tasks[0].due={date:localDateKey(),is_recurring:true};
      let finish, calls=0;
      window.fetch=(url,options)=>{calls++;return new Promise(resolve=>{finish=()=>resolve(ack(options));});};
      compactComplete.click();
      const pending=(async()=>{for(let i=0;i<1000 && _completing;i++)await new Promise(r=>setTimeout(r,5));if(_completing)throw new Error('Completion stayed busy');})();
      for(let i=0;i<10 && !finish;i++) await new Promise(r=>setTimeout(r,0));
      await completeTask(); await completeTaskAt(1);
      result.pending={ids:tasks.map(t=>t.id),saved:JSON.parse(localStorage.getItem('focus_session')).tasks.map(t=>t.id),busy:_completing,disabled:completeBtn.disabled,compactDisabled:compactComplete.disabled,removeDisabled:compactSkip.disabled,calls};
      // Reordering/navigating while awaiting Todoist must preserve focus by ID.
      switchFocusedTask(1);
      finish();await pending;
      result.success={ids:tasks.map(t=>t.id),focused:currentTask().id,busy:_completing,notice:$('toastPill').textContent};

      result.failures=[];
      for(const failure of ['offline','timeout','auth','command']) {
        fixture();const before=loadStats()[localDateKey()].tasksCompleted;
        window.fetch=async(url,options)=>{
          if(failure==='offline')throw new TypeError('Network unavailable');
          if(failure==='timeout')throw new DOMException('Timed out','TimeoutError');
          if(failure==='auth')return new Response(null,{status:401});
          const c=JSON.parse(new URLSearchParams(options.body).get('commands'))[0];
          return Response.json({sync_status:{[c.uuid]:{error_code:22,error:'Invalid task'}}});
        };
        await completeTask();
        result.failures.push({ids:tasks.map(t=>t.id),saved:JSON.parse(localStorage.getItem('focus_session')).tasks.map(t=>t.id),busy:_completing,countUnchanged:loadStats()[localDateKey()].tasksCompleted===before,notice:$('toastPill').textContent});
      }
      fixture();
      window.fetch=async(url,options)=>ack(options);
      await completeTaskAt(1);
      result.row={ids:tasks.map(t=>t.id),focused:currentTask().id};

      fixture();
      let finishSync;
      const staleItems=tasks.map(t=>({...t}));
      window.fetch=(url,options)=>{
        if(new URLSearchParams(options.body).has('commands'))return Promise.resolve(ack(options));
        return new Promise(resolve=>{finishSync=()=>resolve(Response.json({items:staleItems,full_sync:true,sync_token:'test'}));});
      };
      const sync=_doSync('*');
      await completeTask(); finishSync(); await sync;
      applyItemsToSession();
      result.stale={ids:tasks.map(t=>t.id),closedInStore:!!itemsById['complete-a']};

      fixture();
      window.fetch=async(url,options)=>ack(options);
      bumpStat=()=>{throw new Error('Simulated local statistics failure');};
      await completeTask();
      result.localFailure={ids:tasks.map(t=>t.id),busy:_completing,notice:$('toastPill').textContent};
    } finally {
      if(timerRunning)pauseTimer();window.fetch=originalFetch;apiToken=originalToken;bumpStat=originalBump;
      tasks=savedTasks;currentIndex=savedIndex;itemsById=savedItems;persistSession();renderCurrentTask();armTimerForArrival(false,false);
    }
    return result;
  })()`);
  assert.deepEqual(result.pending,{ids:['complete-a','complete-b'],saved:['complete-a','complete-b'],busy:true,disabled:true,compactDisabled:true,removeDisabled:true,calls:1});
  assert.deepEqual(result.success,{ids:['complete-b'],focused:'complete-b',busy:false,notice:'Completed in Todoist — next occurrence scheduled'});
  for(const failure of result.failures){
    assert.deepEqual(failure.ids,['complete-a','complete-b']);
    assert.deepEqual(failure.saved,failure.ids);assert.equal(failure.busy,false);assert.equal(failure.countUnchanged,true);
    assert.ok(failure.notice.length>10);
  }
  assert.deepEqual(result.row,{ids:['complete-a'],focused:'complete-a'});
  assert.deepEqual(result.stale,{ids:['complete-b'],closedInStore:false});
  assert.deepEqual(result.localFailure,{ids:['complete-b'],busy:false,notice:'Completed in Todoist'});
  console.log('Completion confirmation, failures, double clicks, row completion, sync race and local-error checks passed');
};
