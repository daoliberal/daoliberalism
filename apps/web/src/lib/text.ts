/** Length in Unicode code points (what the 80 / 500 / 200 limits count). */
export const codePoints = (s: string): number => Array.from(s).length;

/** "1 credit" / "3 credits". */
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Error text when the trimmed value is longer than `max` code points; undefined otherwise. */
export function lengthError(v: string, max: number): string | undefined {
  return codePoints(v.trim()) > max ? `Use ${max} characters or fewer.` : undefined;
}
