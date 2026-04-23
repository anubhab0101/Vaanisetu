const fs = require('fs');
const path = 'c:/Users/wwwan/Documents/GitHub/Vaanisetu/public/app.js';
let content = fs.readFileSync(path, 'utf8');

// Fix 1: Restore roomName
content = content.replace(
  /(\s*if\(dashboardUserName\)\s*dashboardUserName\.textContent\s*=\s*`Hi, \$\{currentUserDoc\.displayName\}`;)/,
  `$1
                if (currentUserDoc.roomName) {
                    const roomNameDisplay = document.getElementById('room-name-display');
                    if (roomNameDisplay) roomNameDisplay.textContent = currentUserDoc.roomName;
                }`
);

// Fix 2: Profile Picture Resize
const picTarget = `    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.getElementById('mob-profile-avatar-img');
      const letter = document.getElementById('mob-profile-avatar-letter');
      if (img) { img.src = e.target.result; img.style.display = 'block'; }
      if (letter) letter.style.display = 'none';
      // Save to localStorage for persistence
      try { localStorage.setItem('_vns_profile_pic', e.target.result); } catch(_) {}
    };
    reader.readAsDataURL(file);`;

const picReplacement = `    const reader = new FileReader();
    reader.onload = (e) => {
      const imgObj = new Image();
      imgObj.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 256;
        let w = imgObj.width, h = imgObj.height;
        if (w > h && w > MAX) { h *= MAX/w; w = MAX; }
        else if (h > MAX) { w *= MAX/h; h = MAX; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgObj, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const imgEl = document.getElementById('mob-profile-avatar-img');
        const letter = document.getElementById('mob-profile-avatar-letter');
        if (imgEl) { imgEl.src = dataUrl; imgEl.style.display = 'block'; }
        if (letter) letter.style.display = 'none';
        try { localStorage.setItem('_vns_profile_pic', dataUrl); } catch(_) {}
      };
      imgObj.src = e.target.result;
    };
    reader.readAsDataURL(file);`;

content = content.replace(picTarget, picReplacement);

fs.writeFileSync(path, content, 'utf8');
console.log('App.js patched successfully');
