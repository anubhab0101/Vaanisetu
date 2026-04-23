const fs = require('fs');
const path = 'c:/Users/wwwan/Documents/GitHub/Vaanisetu/public/index.html';
let content = fs.readFileSync(path, 'utf8');

const leaderboardCard = `
        <!-- Leaderboard Manager (Admin) -->
        <div class="mt-8" id="admin-leaderboard-section">
          <div class="card col-span-1 lg:col-span-3 border border-zinc-800 bg-zinc-900/30"
            style="padding:0;align-items:stretch;text-align:left;">
            <div class="px-6 py-5 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
              <h2 class="text-lg text-white m-0 font-bold tracking-tight flex items-center gap-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
                  <path d="M4 22h16"></path>
                  <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
                  <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
                </svg>
                Leaderboard Manager
              </h2>
              <button onclick="if(window.loadAdminLeaderboard) window.loadAdminLeaderboard()" class="icon-btn hover-bg bg-black shadow-inner border border-zinc-800"
                style="width:32px;height:32px" title="Refresh">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 2v6h6" />
                </svg>
              </button>
            </div>
            <div class="p-6">
              <div id="admin-leaderboard-list" style="display:flex;flex-direction:column;gap:0.5rem;max-height:400px;overflow-y:auto;">
                <p style="color:#71717a;font-size:0.875rem;">Click refresh to load leaderboard entries.</p>
              </div>
            </div>
          </div>
        </div>
`;

// Insert the leaderboardCard after admin-messages-section
const endMarker = '<!-- END admin-view -->';
let parts = content.split(endMarker);
if (parts.length > 1) {
  // We need to inject right before the end of max-w-6xl container.
  // The max-w-6xl container ends around line 1111 with '</div>' and then '</div>' for admin-view.
  // Let's just do a simpler search for the end of the admin-messages-section div
  
  // admin-messages-section looks like: <div class="mt-8" id="admin-messages-section"> ... </div> ... </div>
  // Actually, I can just append it before `<!-- END admin-view -->` but wait, it needs to be inside `<div class="max-w-6xl mx-auto w-full">`
  
  // Find where max-w-6xl ends.
  content = content.replace(/(<\/div>\s*<\/div>\s*<!-- END admin-view -->)/, leaderboardCard + '\n      $1');
  fs.writeFileSync(path, content, 'utf8');
  console.log('index.html patched with leaderboard admin card');
} else {
  console.error('Marker not found');
}
