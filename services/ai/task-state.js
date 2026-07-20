'use strict';

const TERMINAL_TASK_STATES = new Set(['cancelled', 'aborted', 'completed', 'failed']);

const LEGAL_TRANSITIONS = Object.freeze({
  queued: new Set(['running', 'cancelled']),
  running: new Set(['paused', 'terminating', 'completed', 'failed', 'aborted']),
  paused: new Set(['running', 'terminating', 'aborted']),
  terminating: new Set(['aborted', 'failed']),
  cancelled: new Set(),
  aborted: new Set(),
  completed: new Set(),
  failed: new Set(),
});

function canTransition(from, to) {
  return Boolean(from && to && LEGAL_TRANSITIONS[from] && LEGAL_TRANSITIONS[from].has(to));
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const err = new Error(`Illegal AI task state transition: ${from || '<missing>'} -> ${to || '<missing>'}`);
    err.code = 'ILLEGAL_TASK_TRANSITION';
    throw err;
  }
}

function isTerminal(status) {
  return TERMINAL_TASK_STATES.has(status);
}

module.exports = {
  LEGAL_TRANSITIONS,
  TERMINAL_TASK_STATES,
  canTransition,
  assertTransition,
  isTerminal,
};
