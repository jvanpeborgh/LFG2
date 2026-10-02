import defaults from "../../../docs/standards/defaults.json";

/**
 * The world bible values (docs/standards/defaults.json).
 * Modules read numbers from here instead of hard-coding them, so a standards
 * change (a world event) updates existing content too.
 */
export type Standards = typeof defaults;

export const DEFAULT_STANDARDS: Standards = defaults;

export function cloneStandards(s: Standards = DEFAULT_STANDARDS): Standards {
  return JSON.parse(JSON.stringify(s));
}
