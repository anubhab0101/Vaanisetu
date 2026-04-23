const fs = require('fs');
const path = 'c:/Users/wwwan/Documents/GitHub/Vaanisetu/public/app.js';
let content = fs.readFileSync(path, 'utf8');

const target = `        loadVisitorStats();
        loadFreeDayStatus();`;
        
const repl = `        loadVisitorStats();
        loadFreeDayStatus();
        if (typeof loadHelpDeskMessages === 'function') loadHelpDeskMessages();
        if (typeof loadAdminLeaderboard === 'function') loadAdminLeaderboard();`;

content = content.replace(target, repl);
fs.writeFileSync(path, content, 'utf8');
console.log('patched btnAdminDash');
