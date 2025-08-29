// Sharing token resolution removed. Any import now throws to surface accidental usage.
export function resolveShareTokenStrict(): never {
  throw new Error('resolveShareTokenStrict: sharing feature removed');
}