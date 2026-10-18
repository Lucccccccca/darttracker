'use strict';

// Shared helpers, loaded first.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
