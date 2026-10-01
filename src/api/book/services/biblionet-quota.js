'use strict';

/**
 * Biblionet API quota management
 * In-memory daily counter — resets at midnight.
 * Max 900 calls/day (buffer 100 from the 1000 API limit for admin use).
 */

const MAX_DAILY_CALLS = 900;

let callCount = 0;
let currentDate = new Date().toDateString();

/**
 * Reset counter if date has changed
 */
function resetIfNewDay() {
  const today = new Date().toDateString();
  if (today !== currentDate) {
    callCount = 0;
    currentDate = today;
  }
}

module.exports = {
  /**
   * Check if we can make more API calls today
   * @returns {boolean}
   */
  canMakeCall() {
    resetIfNewDay();
    return callCount < MAX_DAILY_CALLS;
  },

  /**
   * Increment the call counter
   * @param {number} count - Number of calls to add (default 1)
   */
  increment(count = 1) {
    resetIfNewDay();
    callCount += count;
  },

  /**
   * Get current usage stats
   * @returns {{ used: number, remaining: number, limit: number }}
   */
  getUsage() {
    resetIfNewDay();
    return {
      used: callCount,
      remaining: MAX_DAILY_CALLS - callCount,
      limit: MAX_DAILY_CALLS,
    };
  },

  /**
   * Reset the counter (used by tests).
   */
  reset() {
    callCount = 0;
    currentDate = new Date().toDateString();
  },
};
