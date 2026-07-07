const net = require('net');

function ipToNumber(ip) {
  return net.isIPv6(ip) ? null : ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function cidrMatch(clientIP, cidr) {
  // Normalize IPv4-mapped IPv6 addresses to IPv4
  if (clientIP.startsWith('::ffff:')) clientIP = clientIP.slice(7);

  if (cidr.includes('/')) {
    const [rangeIP, bits] = cidr.split('/');
    const prefixLen = parseInt(bits, 10);

    if (net.isIPv6(clientIP) || net.isIPv6(rangeIP)) {
      // Simplified IPv6 handling: only exact match (full CIDR support is more complex)
      return clientIP === rangeIP;
    }

    const clientNum = ipToNumber(clientIP);
    const rangeNum = ipToNumber(rangeIP);
    if (clientNum === null || rangeNum === null) return false;

    const mask = ~(2 ** (32 - prefixLen) - 1) >>> 0;
    return (clientNum & mask) === (rangeNum & mask);
  }

  return clientIP === cidr;
}

function isWhitelisted(clientIP, whitelist) {
  if (!whitelist || whitelist.length === 0) return true;
  if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1') return true;
  return whitelist.some(entry => cidrMatch(clientIP, entry));
}

function createWhitelistMiddleware(config) {
  return function whitelistMiddleware(req, res, next) {
    const clientIP = req.ip || req.socket.remoteAddress || '127.0.0.1';
    if (!isWhitelisted(clientIP, config.whitelist)) {
      return res.status(403).json({ error: 'Access denied: IP not in whitelist' });
    }
    next();
  };
}

module.exports = { createWhitelistMiddleware, isWhitelisted, cidrMatch };
