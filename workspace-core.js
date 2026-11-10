/* Pure planning helpers, shared by the renderer and regression tests. */
(function (root) {
  'use strict';
  function estimate(task, goals, fallback = 10) {
    const goal = goals[String(task.id)];
    const value = Number.isFinite(goal?.minutes) && goal.minutes > 0 ? goal.minutes
      : task.duration?.unit === 'minute' ? Number(task.duration.amount)
      : task.duration?.unit === 'day' ? Number(task.duration.amount) * 1440 : fallback;
    return Number.isFinite(value) && value > 0 ? Math.min(999, Math.ceil(value)) : fallback;
  }
  // Stable, explainable ranking: overdue, today, priority, original order.
  // Greedy fit deliberately skips oversized tasks so a small block stays useful.
  function plan(tasks, goals, budget, today, fallback = 10) {
    const seen = new Set();
    const ranked = tasks.filter(t => {
      if (!t || t.id == null || t.checked || t.is_deleted || seen.has(String(t.id))) return false;
      seen.add(String(t.id)); return true;
    }).map((task, index) => {
      const due = task.due?.date?.slice(0, 10);
      const urgency = due && due < today ? 2 : due === today ? 1 : 0;
      return { task, index, urgency, minutes: estimate(task, goals, fallback),
        reason: urgency === 2 ? 'Overdue' : urgency === 1 ? 'Due today' : Number(task.priority) > 1 ? 'Priority' : 'Fits your time' };
    }).sort((a, b) => b.urgency - a.urgency || (Number(b.task.priority) || 1) - (Number(a.task.priority) || 1) || a.index - b.index);
    let remaining = Math.max(0, Number(budget) || 0);
    return ranked.filter(item => {
      if (item.minutes > remaining) return false;
      remaining -= item.minutes; return true;
    });
  }
  const api = { estimate, plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FocusWorkspaceCore = api;
})(globalThis);
