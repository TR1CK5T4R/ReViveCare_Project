// deepFreeze(): makes a config object and everything inside it read-only, so
// nothing can change settings at runtime. Used by config/env.js and config/riskRules.js.

/**
 * @template T
 * @param {T} value
 * @returns {Readonly<T>} the same object, frozen all the way down
 */
export function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
