'use strict';

const os = require('os');

/** Best-guess local-network IPv4 address (non-internal), for the phone remote QR/link. */
function getLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }
  if (candidates.length === 0) return '127.0.0.1';
  // Prefer typical home-network adapters (Wi-Fi/Ethernet) over virtual adapters.
  const preferred = candidates.find((c) => /wi-?fi|wlan|ethernet|en0|en1/i.test(c.name));
  return (preferred || candidates[0]).address;
}

module.exports = { getLanIp };
