// Uses only fixtures in smoke.cjs's isolated profile, with external APIs blocked.
const assert = require('node:assert/strict');
const { BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settle = () => new Promise(resolve => setTimeout(resolve, 450));

module.exports = async win => {
  async function chooseLayout(label) {
    await win.webContents.executeJavaScript(`document.getElementById('compactMenu').click()`);
    let popup;
    for (let i = 0; i < 40; i++) {
      popup = BrowserWindow.getAllWindows().find(w => w !== win);
      if (popup && !popup.webContents.isLoading()) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(popup, 'layout menu opens');
    await popup.webContents.executeJavaScript(`
      [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(label)})).click();
    `);
    await settle();
  }
  async function checkVisible() {
    const state = await win.webContents.executeJavaScript(`(() => {
      const bar=document.querySelector('.compact-bar'), bounds=bar.getBoundingClientRect();
      return ['compactPrev','compactNext','compactSkip'].map(id => {
        const el=document.getElementById(id), rect=el.getBoundingClientRect();
        const visible=[el,el.parentElement].every(node => {
          const style=getComputedStyle(node);
          return style.display!=='none' && style.visibility==='visible' && Number(style.opacity)>0;
        });
        return {id,visible,label:el.getAttribute('aria-label'),fits:rect.left>=bounds.left && rect.right<=bounds.right && rect.top>=bounds.top && rect.bottom<=bounds.bottom,width:rect.width};
      });
    })()`);
    for (const button of state) {
      assert.equal(button.visible, true, button.id+' is visible without hover');
      assert.equal(button.fits, true, button.id+' fits inside the pill');
      assert.ok(button.label, button.id+' has an accessible label');
      assert.ok(button.width >= 32, button.id+' keeps its click target');
    }
    assert.equal(await win.webContents.executeJavaScript(`
      document.querySelector('.compact-bar').scrollWidth <= document.querySelector('.compact-bar').clientWidth
    `), true, 'controls do not overflow');
  }

  await win.webContents.executeJavaScript(`
    if(timerRunning)pauseTimer();exitOvertime();isOnBreak=false;
    tasks=[{id:'nav-a',content:'Prepare next week’s priorities'},
      {id:'nav-b',content:'Review notes',duration:{amount:20,unit:'minute'}},
      {id:'nav-c',content:'Plan the next session'}];
    currentIndex=0;taskGoals={};taskTimeLeft={};
    itemsById=Object.fromEntries(tasks.map(t=>[t.id,t]));
    persistSession();armTimerForArrival(false,false);renderCurrentTask();
  `);
  await chooseLayout('Timer and task');
  await checkVisible();
  fs.writeFileSync(path.join(os.tmpdir(),'focus-compact-controls-task.png'),(await win.webContents.capturePage()).toPNG());

  // Controls precede the title, so a different title length must not move them on screen.
  const controlPositions = async () => {
    const lefts = await win.webContents.executeJavaScript(`['compactTimer','compactPlayPause','compactPrev','compactNext','compactSkip','compactComplete'].map(id=>Math.round(document.getElementById(id).getBoundingClientRect().left))`);
    return {window:win.getBounds().x, lefts, width:win.getBounds().width};
  };
  const longTitle = await controlPositions();
  await win.webContents.executeJavaScript(`compactNext.click()`);
  await settle();
  const shortTitle = await controlPositions();
  await win.webContents.executeJavaScript(`compactPrev.click()`);
  await settle();
  assert.ok(shortTitle.width < longTitle.width, 'pill still resizes to the title');
  assert.equal(shortTitle.window, longTitle.window, 'pill keeps its left edge');
  assert.deepEqual(shortTitle.lefts, longTitle.lefts, 'controls stay put across titles');
  assert.ok(longTitle.lefts.every((left,i,all)=>i===0 || left>all[i-1]), 'timer, play, then task controls in order');
  assert.ok(await win.webContents.executeJavaScript(`compactComplete.getBoundingClientRect().right <= compactTask.getBoundingClientRect().left`), 'title comes after the controls');

  const navigation = await win.webContents.executeJavaScript(`(() => {
    timerSeconds=543;updateTimerDisplay();
    compactNext.click();
    const next={id:currentTask().id,seconds:timerSeconds,running:timerRunning};
    compactPrev.click();
    const previous={id:currentTask().id,seconds:timerSeconds};
    compactPrev.click();const wrapBack=currentTask().id;
    compactNext.click();const wrapForward=currentTask().id;
    startTimer();compactNext.click();
    const running={id:currentTask().id,seconds:timerSeconds,running:timerRunning};
    compactPrev.click();pauseTimer();
    return {next,previous,wrapBack,wrapForward,running,resumed:timerSeconds};
  })()`);
  assert.deepEqual(navigation, {
    next:{id:'nav-b',seconds:1200,running:false},previous:{id:'nav-a',seconds:543},
    wrapBack:'nav-c',wrapForward:'nav-a',running:{id:'nav-b',seconds:1200,running:true},resumed:543
  });

  await chooseLayout('Timer only');
  await checkVisible();
  assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(compactTask).display`),'none');
  fs.writeFileSync(path.join(os.tmpdir(),'focus-compact-controls-timer.png'),(await win.webContents.capturePage()).toPNG());
  const priorTheme=nativeTheme.themeSource;
  nativeTheme.themeSource='dark';
  await settle();
  fs.writeFileSync(path.join(os.tmpdir(),'focus-compact-controls-dark.png'),(await win.webContents.capturePage()).toPNG());
  nativeTheme.themeSource=priorTheme;

  const removal = await win.webContents.executeJavaScript(`(() => {
    const oldFetch=window.fetch;let requests=0;
    window.fetch=()=>{requests++;throw new Error('Session controls must not submit Todoist commands');};
    const statsBefore=localStorage.getItem('focus_stats_v1');
    try {
      compactNext.click();compactSkip.click();
      const removed={ids:tasks.map(t=>t.id),focused:currentTask().id,seconds:timerSeconds,
        keptInTodoist:!!itemsById['nav-b'],statsUnchanged:localStorage.getItem('focus_stats_v1')===statsBefore};
      applyItemsToSession();
      const afterRefresh=tasks.map(t=>t.id);
      tasks=[];restoreSession();
      const restored=tasks.map(t=>t.id);
      compactSkip.click();
      const single={previousDisabled:compactPrev.disabled,nextDisabled:compactNext.disabled,removeDisabled:compactSkip.disabled};
      startTimer();compactSkip.click();compactSkip.click();
      const empty={count:tasks.length,running:timerRunning,previousDisabled:compactPrev.disabled,nextDisabled:compactNext.disabled,removeDisabled:compactSkip.disabled,title:compactTask.textContent};
      return {removed,afterRefresh,restored,single,empty,requests};
    } finally {window.fetch=oldFetch;}
  })()`);
  assert.deepEqual(removal, {
    removed:{ids:['nav-a','nav-c'],focused:'nav-a',seconds:543,keptInTodoist:true,statsUnchanged:true},
    afterRefresh:['nav-a','nav-c'],restored:['nav-a','nav-c'],
    single:{previousDisabled:true,nextDisabled:true,removeDisabled:false},
    empty:{count:0,running:false,previousDisabled:true,nextDisabled:true,removeDisabled:true,title:'Add Todoist tasks'},requests:0
  });
  await settle();
  await checkVisible();
  fs.writeFileSync(path.join(os.tmpdir(),'focus-compact-controls-empty.png'),(await win.webContents.capturePage()).toPNG());
  // Restore the real layout state before the remaining full-window checks.
  await chooseLayout('Timer and task');
  console.log('PASS: visible compact navigation and session removal in both layouts, countdown preservation, wraparound, persistence, empty state, no task mutation');
};
