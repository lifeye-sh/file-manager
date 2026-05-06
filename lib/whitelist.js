const net = require('net');

let WHITELIST = [];

function setWhitelist(list) {
  WHITELIST = list || [];
}

function ipToNumber(ip) {
  return net.isIPv6(ip) ? null : ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function cidrMatch(clientIP, cidr) {
  if (clientIP.startsWith('::ffff:')) clientIP = clientIP.slice(7);

  if (cidr.includes('/')) {
    const [rangeIP, bits] = cidr.split('/');
    const prefixLen = parseInt(bits, 10);

    if (net.isIPv6(clientIP) || net.isIPv6(rangeIP)) {
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

function isWhitelisted(clientIP) {
  if (!WHITELIST || WHITELIST.length === 0) return true;
  if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1') return true;
  return WHITELIST.some((entry) => cidrMatch(clientIP, entry));
}

function whitelistMiddleware(req, res, next) {
  const clientIP = req.ip || req.socket.remoteAddress || '127.0.0.1';
  if (!isWhitelisted(clientIP)) {
    return res.status(403).json({ error: 'Access denied: IP not in whitelist' });
  }
  next();
}

function validateWhitelist(entries) {
  if (!Array.isArray(entries)) return 'whitelist must be an array';
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim() === '') return 'whitelist entries must be non-empty strings';
    const trimmed = entry.trim();
    if (trimmed.includes('/')) {
      const [ip, bits] = trimmed.split('/');
      if (!net.isIPv4(ip) && !net.isIPv6(ip)) return `Invalid IP in CIDR: ${trimmed}`;
      const n = parseInt(bits, 10);
      if (isNaN(n) || n < 0 || n > 128) return `Invalid CIDR prefix: ${trimmed}`;
    } else if (!net.isIPv4(trimmed) && !net.isIPv6(trimmed)) {
      return `Invalid IP address: ${trimmed}`;
    }
  }
  return null;
}

module.exports = {
  setWhitelist,
  ipToNumber,
  cidrMatch,
  isWhitelisted,
  whitelistMiddleware,
  validateWhitelist,
};
