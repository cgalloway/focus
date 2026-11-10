const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const area = {x:0,y:25,width:1440,height:875};
const context = vm.createContext({screen:{getDisplayMatching:()=>({workArea:area}),getPrimaryDisplay:()=>({workArea:area})}});
vm.runInContext(source.slice(source.indexOf('function fitWindowBounds('),source.indexOf('function createWindow(')),context);
const defaults = {width:1120,height:820,minWidth:380,minHeight:600};
const fit = bounds => JSON.parse(JSON.stringify(context.fitWindowBounds(bounds,defaults)));
test('normal window keeps saved size and position',()=>{
 const bounds={x:80,y:50,width:900,height:700};
 assert.deepEqual(fit(bounds),bounds);
});
test('disconnected monitor and oversized bounds restore inside the available screen',()=>{
 assert.deepEqual(fit({x:4000,y:-2000,width:2000,height:1500}),{x:0,y:25,width:1440,height:875});
});
test('missing or malformed window state uses centered defaults',()=>{
 assert.deepEqual(fit(null),{x:160,y:53,width:1120,height:820});
 assert.deepEqual(fit({x:'bad'}),fit(null));
});
