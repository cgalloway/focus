const {test} = require('node:test');
const assert = require('node:assert/strict');
const {plan, estimate} = require('../../workspace-core');
const day = '2026-09-04';
const task = (id, minutes, extra={})=>({id,content:id,duration:{unit:'minute',amount:minutes},...extra});
test('planner prioritizes urgency then priority while respecting the budget',()=>{
 const tasks=[task('normal',10),task('today',15,{due:{date:day}}),task('priority',10,{priority:4}),task('late',20,{due:{date:'2026-09-03'}})];
 const result=plan(tasks,{},45,day);
 assert.deepEqual(result.map(t=>t.task.id),['late','today','priority']);
 assert.equal(result.reduce((s,t)=>s+t.minutes,0),45);
 assert.deepEqual(tasks.map(t=>t.id),['normal','today','priority','late']);
});
test('planner skips oversized and deleted tasks, deduplicates ids and preserves ties',()=>{
 const tasks=[task('large',90,{priority:4}),task('first',15),task('deleted',1,{is_deleted:true}),task('done',1,{checked:true}),task('first',15),task('second',10)];
 assert.deepEqual(plan(tasks,{},30,day).map(t=>t.task.id),['first','second']);
 assert.deepEqual(plan(tasks,{},0,day),[]);
});
test('saved durations override estimates even with a legacy disabled flag',()=>{
 assert.equal(estimate(task('a',20),{a:{minutes:10,enabled:true}}),10);
 assert.equal(estimate(task('a',20),{a:{minutes:10,enabled:false}}),10);
 assert.equal(estimate(task('a',-1),{},25),25);
 assert.equal(estimate({id:'a'},{},50),50);
});

test('Todoist duration takes precedence over the ten-minute fallback',()=>{
 assert.equal(estimate(task('a',35),{}),35);
 assert.equal(estimate({id:'a'},{}),10);
 assert.equal(estimate(task('a',0),{}),10);
 assert.equal(estimate(task('a',-2),{}),10);
 assert.equal(estimate(task('a','invalid'),{}),10);
 assert.equal(estimate({id:'a',duration:{unit:'day',amount:1}},{}),999);
 assert.equal(estimate(task('a',35),{a:{minutes:7}}),7);
 assert.equal(plan([{id:'a'},{id:'b'}],{},20,day).length,2);
});
