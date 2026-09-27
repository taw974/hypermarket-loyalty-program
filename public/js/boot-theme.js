// Applies the saved theme before first paint (no flash).
try { document.documentElement.dataset.theme = localStorage.getItem('rl.theme') || 'dark'; } catch (e) { /* storage blocked */ }
