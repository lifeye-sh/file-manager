const ID_RE = /^(wf|def|task)_[a-zA-Z0-9_-]{6,96}$/;

function isValidAiId(value, expectedPrefix) {
  if (typeof value !== 'string' || !ID_RE.test(value)) return false;
  return !expectedPrefix || value.startsWith(expectedPrefix + '_');
}

function requireAiId(value, expectedPrefix) {
  if (!isValidAiId(value, expectedPrefix)) {
    const err = new Error('Invalid AI identifier');
    err.code = 'INVALID_AI_ID';
    throw err;
  }
  return value;
}

module.exports = { isValidAiId, requireAiId };
