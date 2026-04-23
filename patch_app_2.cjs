const fs = require('fs');
const path = 'c:/Users/wwwan/Documents/GitHub/Vaanisetu/public/app.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Update openMobAdminPanel('leaderboard') to scroll to admin-leaderboard-section inside admin-view
// We can just add 'leaderboard': 'admin-leaderboard-section' to the sectionMap!
const sectionMapTarget = `      const sectionMap = {
        films:    'admin-film-section',
        users:    'admin-user-section',
        messages: 'admin-messages-section'
      };`;
const sectionMapRepl = `      const sectionMap = {
        films:    'admin-film-section',
        users:    'admin-user-section',
        messages: 'admin-messages-section',
        leaderboard: 'admin-leaderboard-section'
      };`;
content = content.replace(sectionMapTarget, sectionMapRepl);

// And remove the special handling for 'leaderboard'
const oldLeaderTarget = `    if (section === 'leaderboard') {
      if (adminView)   adminView.classList.add('hidden');
      if (roomView)    roomView.classList.add('hidden');
      if (paymentView) paymentView.classList.add('hidden');
      dashView.classList.remove('hidden');
      if (typeof switchTab === 'function') switchTab('home');
      setTimeout(() => {
        const el = document.getElementById('leaderboard-list');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
      return;
    }`;
content = content.replace(oldLeaderTarget, '');

// Also add loadAdminLeaderboard() to the load list
content = content.replace("if (typeof loadHelpDeskMessages === 'function') loadHelpDeskMessages();", "if (typeof loadHelpDeskMessages === 'function') loadHelpDeskMessages();\n    if (typeof loadAdminLeaderboard === 'function') loadAdminLeaderboard();");

// Add loadAdminLeaderboard to btnAdminDash listener
content = content.replace("if(typeof loadVisitorStats === 'function') loadVisitorStats();", "if(typeof loadVisitorStats === 'function') loadVisitorStats();\n      if(typeof loadAdminLeaderboard === 'function') loadAdminLeaderboard();");


// Append the new Leaderboard Manager logic to the end of app.js
const newLogic = `
// ---- Admin Leaderboard Manager ----
window.loadAdminLeaderboard = async function() {
  const container = document.getElementById('admin-leaderboard-list');
  if (!container) return;
  container.innerHTML = '<p style="color:#71717a;font-size:0.875rem;">Loading leaderboard...</p>';
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    container.innerHTML = '';
    if (!data.success || !data.board || data.board.length === 0) {
      container.innerHTML = '<p style="color:#71717a;font-size:0.875rem;">No entries found this month.</p>';
      return;
    }
    data.board.forEach((entry, idx) => {
      const el = document.createElement('div');
      el.style.cssText = "display:flex;align-items:center;justify-content:space-between;background:#18181b;padding:0.75rem 1rem;border-radius:0.75rem;border:1px solid #27272a;";
      el.innerHTML = \`
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <div style="width:24px;height:24px;border-radius:50%;background:#eab308;color:black;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:0.75rem;">\${idx+1}</div>
          <span style="color:white;font-weight:600;font-size:0.9rem;">\${entry.name}</span>
          <span style="color:#a1a1aa;font-size:0.8rem;">(\${entry.count} films)</span>
        </div>
        <button onclick="removeLeaderboardEntry('\${entry.uid}')" style="background:transparent;border:none;color:#ef4444;font-size:1.25rem;cursor:pointer;padding:0 0.5rem;" title="Remove Entry">×</button>
      \`;
      container.appendChild(el);
    });
  } catch (err) {
    container.innerHTML = '<p style="color:#ef4444;font-size:0.875rem;">Failed to load leaderboard.</p>';
  }
};

window.removeLeaderboardEntry = async function(targetUserId) {
  if (!confirm('Are you sure you want to remove this user from the leaderboard for the month? This will delete their watch history for the current month.')) return;
  
  const container = document.getElementById('admin-leaderboard-list');
  if (container) container.style.opacity = '0.5';
  
  try {
    const adminEmail = currentUser?.email || '';
    const res = await fetch('/api/remove-leaderboard-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId: currentUser.uid, targetUserId })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    alert('User removed from leaderboard.');
    if (window.loadAdminLeaderboard) window.loadAdminLeaderboard();
  } catch(e) {
    alert('Failed to remove: ' + e.message);
  } finally {
    if (container) container.style.opacity = '1';
  }
};
`;

content += newLogic;
fs.writeFileSync(path, content, 'utf8');
console.log('app.js patched for leaderboard');
