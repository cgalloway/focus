// Runs the actual inline session and timer functions in a Node VM. DOM drawing
// and clock scheduling are stubs; these tests cover state, not browser layout.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const functions=['moveSessionTask','addTaskToSession','removeTaskFromSession','renderCurrentTask','applyTaskDurationIfIdle','armTimerForArrival','taskWorkSeconds'];
const source=functions.map(name=>{
  const start=html.indexOf(`        function ${name}(`);
  assert.ok(start>=0,`${name} exists`);
  const end=html.indexOf('\n        }',start);
  return html.slice(start,end+'\n        }'.length);
}).join('\n');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(mode='paused') {
  const node=()=>({style:{},addEventListener(){},focus(){},select(){}});
  const ctx={
    tasks:[{id:'a',content:'First',duration:{amount:10,unit:'minute'}},{id:'b',content:'Current',duration:{amount:17,unit:'minute'}},{id:'c',content:'Last',duration:{amount:8,unit:'minute'}}],
    currentIndex:1,taskGoals:{},taskTimeLeft:{},projects:{},_completing:false,
    timerSeconds:733,initialTimerSeconds:1020,timerExtraSeconds:0,timerEndTime:123456,timerInterval:987,
    timerRunning:mode==='running'||mode==='break',isOnBreak:mode==='break',inOvertime:mode==='overtime',
    timerManuallySet:false,_overtimeTaskId:mode==='overtime'?'b':null,overtimeStart:777,overtimeInterval:888,
    _elapsedTaskId:'b',_breakPendingTaskId:'b',useTaskDurations:true,sessionDay:'2026-10-30',
    window:{refreshWorkspace(){}},taskArea:node(),taskCounter:node(),skipBtn:node(),prevBtn:node(),completeBtn:node(),dropBtn:node(),
    taskOrderOverlay:{classList:{contains(){return false;}}},taskSearchInput:node(),
    FocusWorkspaceCore:require('../../workspace-core.js'),
    $:()=>node(),escHtml:String,projectColor:()=>'',goalActive:()=>false,goalChipHtml:()=>'',
    updateCompactBar(){},updateTimerDisplay(){},renderTaskList(){},searchTasks(){},flushElapsed(){},beginElapsed(){},openTaskInTodoist(){},localDateKey:()=> '2026-10-30',
    persistSession(){ctx.persisted={ids:ctx.tasks.map(t=>t.id),currentIndex:ctx.currentIndex};},
    currentTask(){return ctx.tasks[ctx.currentIndex];},
    pauseTimer(){ctx.timerRunning=false;ctx.pauseCalls++;},
    startTimer(){ctx.timerRunning=true;ctx.timerEndTime=999999;ctx.timerInterval=999;ctx.startCalls++;},
    exitOvertime(){ctx.inOvertime=false;ctx._overtimeTaskId=null;ctx.exitCalls++;},
    fetch(){ctx.requests++;throw new Error('Unexpected network call');},
    pauseCalls:0,startCalls:0,exitCalls:0,requests:0
  };
  if(mode==='unstarted-extension') {ctx.timerSeconds=1320;ctx.initialTimerSeconds=1320;ctx.timerExtraSeconds=300;}
  if(mode==='overtime')ctx.timerSeconds=0;
  if(mode==='break'){ctx.timerSeconds=193;ctx.initialTimerSeconds=300;}
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return ctx;
}
function state(ctx){return plain(Object.fromEntries(['timerSeconds','initialTimerSeconds','timerExtraSeconds','timerEndTime','timerInterval','timerRunning','isOnBreak','inOvertime','_overtimeTaskId','overtimeStart','overtimeInterval'].map(k=>[k,ctx[k]])));}
for(const mode of ['unstarted-extension','running','paused','overtime','break']) {
  test(`reorder preserves current task and ${mode} timer`,()=>{
    const ctx=fixture(mode),before=state(ctx);
    assert.equal(ctx.moveSessionTask('a',2),true);
    assert.deepEqual(plain(ctx.tasks.map(t=>t.id)),['b','c','a']);assert.equal(ctx.currentTask().id,'b');assert.equal(ctx.currentIndex,0);
    assert.deepEqual(state(ctx),before);assert.deepEqual(ctx.persisted,{ids:['b','c','a'],currentIndex:0});
    assert.equal(ctx.moveSessionTask('b',2),true);assert.equal(ctx.currentTask().id,'b');assert.equal(ctx.currentIndex,2);
    assert.deepEqual(state(ctx),before);assert.equal(ctx.pauseCalls+ctx.startCalls+ctx.exitCalls+ctx.requests,0);
  });
  test(`adding and removing a different task preserves ${mode} timer`,()=>{
    const ctx=fixture(mode),before=state(ctx);
    ctx.addTaskToSession({id:'new',content:'New'},false);assert.deepEqual(state(ctx),before);
    ctx.removeTaskFromSession(0);assert.equal(ctx.currentTask().id,'b');assert.deepEqual(state(ctx),before);
    assert.equal(ctx.requests,0);
  });
}
test('completion guard blocks every inline session mutation',()=>{
  const ctx=fixture('running'),before=state(ctx);ctx._completing=true;
  assert.equal(ctx.moveSessionTask('b',0),false);ctx.addTaskToSession({id:'new'},false);ctx.removeTaskFromSession(0);
  assert.deepEqual(plain(ctx.tasks.map(t=>t.id)),['a','b','c']);assert.deepEqual(state(ctx),before);assert.equal(ctx.persisted,undefined);
});
test('duplicate IDs cannot be added and invalid reorder requests are safe',()=>{
  const ctx=fixture();ctx.tasks[0].id=123;
  ctx.addTaskToSession({id:'123'},false);assert.equal(ctx.tasks.length,3);
  assert.equal(ctx.moveSessionTask('missing',0),false);assert.equal(ctx.moveSessionTask('b',NaN),false);
  assert.equal(ctx.moveSessionTask('b',Infinity),false);assert.equal(ctx.moveSessionTask('b',1),false);
  assert.equal(ctx.moveSessionTask('123',99),true);assert.equal(ctx.currentTask().id,'b');assert.equal(ctx.tasks[2].id,123);
});
test('removing focused and final tasks arms the right countdown and stops an empty session',()=>{
  const ctx=fixture('running');ctx.removeTaskFromSession(1);
  assert.deepEqual(plain(ctx.tasks.map(t=>t.id)),['a','c']);assert.equal(ctx.currentTask().id,'a');assert.equal(ctx.timerSeconds,600);assert.equal(ctx.timerRunning,true);
  assert.equal(ctx._breakPendingTaskId,null);ctx.removeTaskFromSession(1);ctx.removeTaskFromSession(0);
  assert.equal(ctx.tasks.length,0);assert.equal(ctx.currentIndex,0);assert.equal(ctx.timerRunning,false);assert.equal(ctx.requests,0);
});
test('first task initializes its Todoist duration',()=>{
  const ctx=fixture();ctx.tasks=[];ctx.currentIndex=0;ctx.timerSeconds=42;ctx.initialTimerSeconds=42;
  ctx.addTaskToSession({id:'first',content:'First',duration:{amount:17,unit:'minute'}},false);
  assert.equal(ctx.currentTask().id,'first');assert.equal(ctx.timerSeconds,1020);assert.equal(ctx.initialTimerSeconds,1020);assert.equal(ctx.timerRunning,false);assert.equal(ctx.requests,0);
});
