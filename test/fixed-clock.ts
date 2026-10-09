import type { Clock } from "../src/domain/clock.ts";

export function fixedClock(iso: string): Clock & { set(iso: string): void } {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set(next) {
      current = new Date(next);
    },
  };
}
