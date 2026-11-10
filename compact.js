/* Compact controls share the existing timer/session state. */
(() => {
  const bar = document.querySelector('.compact-bar');
  compactTask.setAttribute('role', 'button');
  compactTask.tabIndex = 0;
  compactTask.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); compactTask.click(); }
  });
  const grip = document.createElement('span');
  grip.className = 'compact-grip'; grip.textContent = '⠿'; grip.title = 'Drag to move';
  bar.prepend(grip);
  const timeGroup = document.createElement('div'); timeGroup.className = 'compact-time-group';
  compactTimer.before(timeGroup); timeGroup.append(compactTimer);
  const status = document.createElement('span'); status.className = 'compact-status'; timeGroup.append(status);
  const menu = document.createElement('button');
  menu.id = 'compactMenu'; menu.className = 'compact-btn'; menu.textContent = '•••';
  menu.title = 'Timer options'; menu.setAttribute('aria-label','Timer options'); menu.setAttribute('aria-haspopup','menu');
  bar.append(menu);
  const progress = document.createElement('div'); progress.className = 'compact-progress'; bar.append(progress);
  const add = document.createElement('button'); add.id='compactAddTime'; add.className='compact-add-time';
  add.textContent='+5'; add.title='Add five minutes to this session'; add.setAttribute('aria-label',add.title);
  menu.before(add);
  let layout = localStorage.getItem('focus_compact_layout') === 'timer' ? 'timer' : 'task';
  function applyLayout() { document.body.classList.toggle('compact-timer-only',layout==='timer'); }
  applyLayout();
  // Reserve room for every visible control in both layouts; the native shell
  // keeps the bar on screen and wraps long task names when needed.
  const measure = document.createElement('span');
  measure.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;white-space:pre;pointer-events:none;';
  measure.setAttribute('aria-hidden','true'); document.body.append(measure);
  let fitTimer=null, fitKey='', fitting=false, fitAgain=false;
  async function fitTitle() {
    if (!isCompact || !focusBridge?.fitCompactContent) return;
    if (fitting) { fitAgain=true; return; }
    fitting=true;
    try {
      const style=getComputedStyle(compactTask);
      measure.style.font=style.font; measure.style.letterSpacing=style.letterSpacing;
      measure.textContent=compactTask.textContent;
      const children=Array.from(bar.children).filter(el=>getComputedStyle(el).display!=='none' && getComputedStyle(el).position!=='absolute');
      const fixed=children.filter(el=>el!==compactTask).reduce((sum,el)=>sum+el.getBoundingClientRect().width,0);
      const bs=getComputedStyle(bar), body=getComputedStyle(document.body);
      const outer=(parseFloat(body.paddingLeft)||0)+(parseFloat(body.paddingRight)||0);
      const titleVisible=children.includes(compactTask);
      const width=Math.ceil((titleVisible?measure.getBoundingClientRect().width:0)+fixed+(parseFloat(bs.columnGap)||0)*(children.length-1)+(parseFloat(bs.paddingLeft)||0)+(parseFloat(bs.paddingRight)||0)+2+outer+4);
      // Width first, then height for titles wider than the available display.
      await focusBridge.fitCompactContent(width,innerHeight);
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if (isCompact) {
        const height=titleVisible?Math.max(80,Math.ceil(compactTask.scrollHeight+36)):80;
        await focusBridge.fitCompactContent(width,height);
      }
    } finally { fitting=false; if(fitAgain){fitAgain=false;queueFit(true);} }
  }
  function queueFit(force=false) {
    const key=[isCompact,layout,compactTask.textContent,compactTimer.textContent.length,!!currentTask()].join('|');
    if(!force && key===fitKey) return;
    fitKey=key; clearTimeout(fitTimer); fitTimer=setTimeout(fitTitle,80);
  }
  window.addEventListener('resize',()=>{ if(!fitting) queueFit(true); });
  document.fonts?.ready.then(()=>queueFit(true));
  let notice = '', noticeTitle = '', noticeTimer;
  window.showCompactNotice = (text, detail = text) => {
    notice=text; noticeTitle=detail; clearTimeout(noticeTimer); refreshCompactControls();
    noticeTimer=setTimeout(()=>{notice='';refreshCompactControls();},4000);
  };
  window.refreshCompactControls = () => {
    const task = currentTask();
    document.body.classList.toggle('compact-empty', !task);
    status.textContent = isOnBreak ? 'Break' : inOvertime ? 'Overtime' : timerRunning ? 'Focusing' : timerSeconds < initialTimerSeconds ? 'Paused' : 'Ready';
    if (notice) { status.textContent=notice; status.title=noticeTitle; } else status.title='';
    if (_completing) { status.textContent='Saving…'; status.title='Completing in Todoist…'; }
    compactPlayPause.title = isOnBreak ? timerRunning ? 'Pause break' : timerSeconds < initialTimerSeconds ? 'Resume break' : 'Start break' : inOvertime ? 'Finish overtime' : timerRunning ? 'Pause focus' : timerSeconds < initialTimerSeconds ? 'Resume focus' : 'Start focusing';
    compactPlayPause.setAttribute('aria-label',compactPlayPause.title);
    compactComplete.disabled = !task || _completing;
    compactSkip.disabled = !task || _completing;
    compactComplete.title = task?.due?.is_recurring ? 'Complete this occurrence in Todoist' : 'Complete task in Todoist';
    compactComplete.setAttribute('aria-label',compactComplete.title);
    compactTask.title = task ? `${task.content} — open in Todoist` : 'Add Todoist tasks';
    if (!task) { compactTask.textContent='Add Todoist tasks'; compactTask.onclick=openTasks; }
    add.disabled = !task || isOnBreak || inOvertime || timerSeconds <= 0;
    queueFit();
    progress.style.transform = `scaleX(${Math.min(1,Math.max(0,inOvertime?1:1-timerSeconds/initialTimerSeconds))})`;
  };
  function openTasks() {
    if (isCompact) toggleCompactMode();
    if (window.openFocusTaskPicker) window.openFocusTaskPicker();
    else document.getElementById('queueAdd')?.click();
  }
  add.onclick = () => extendCurrentSession();
  menu.onclick = async () => {
    if (!focusBridge?.compactMenu) { if(isCompact) toggleCompactMode(); return; }
    const action = await focusBridge.compactMenu({hasTask:!!currentTask(),multiple:tasks.length>1,canExtend:!add.disabled,layout});
    if (action==='expand') { if(isCompact) toggleCompactMode(); }
    if (action==='add') openTasks();
    if (action==='extend') extendCurrentSession();
    if (action==='previous') goToPrevTask();
    if (action==='next') goToNextTask();
    if (action==='later') deferCurrentTask();
    if (action==='remove') skipTaskFromSession();
    if (action==='timer' || action==='task') {
      layout=action; localStorage.setItem('focus_compact_layout',layout); applyLayout();
      await focusBridge.setCompactLayout(layout);
    }
    refreshCompactControls();
  };
  refreshCompactControls();
})();
