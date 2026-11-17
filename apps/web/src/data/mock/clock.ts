/** Fixed mock clock: 2026-10-21T10:00:00Z. */
export const MOCK_NOW: bigint = 1792576800n;

export function mockNow(): bigint {
  return MOCK_NOW;
}
