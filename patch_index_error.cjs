const fs = require('fs');
const path = 'c:/Users/wwwan/Documents/GitHub/Vaanisetu/public/index.html';
let content = fs.readFileSync(path, 'utf8');

const script = `
<script>
  window.addEventListener('error', function(e) {
    if (e.message && e.message.includes('ResizeObserver')) return;
    alert('Global Error: ' + e.message + ' at ' + e.filename + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function(e) {
    alert('Unhandled Promise: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
  });
</script>
`;

if (!content.includes('Global Error:')) {
  content = content.replace('</body>', script + '\n</body>');
  fs.writeFileSync(path, content, 'utf8');
  console.log('Injected error handler');
} else {
  console.log('Already injected');
}
