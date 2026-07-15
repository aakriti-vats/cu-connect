// Runtime config for the CU-Connect frontend.
//
// Local dev: leave both empty — the pages talk to the same origin that served
// them (the Express backend serves this HTML at http://localhost:4000).
//
// Split production deploy (this static site on Vercel, backend on Render):
// set BOTH to your Render backend URL, e.g.
//   API_BASE:   'https://cu-connect-backend.onrender.com'
//   SOCKET_URL: 'https://cu-connect-backend.onrender.com'
window.CUCONNECT = {
  API_BASE: '',
  SOCKET_URL: '',
};

// Convenience helpers the pages use so the base only lives in one place.
window.CUCONNECT.apiBase = function () {
  return (window.CUCONNECT.API_BASE || '') + '/api';
};
window.CUCONNECT.socketUrl = function () {
  return window.CUCONNECT.SOCKET_URL || undefined;
};
