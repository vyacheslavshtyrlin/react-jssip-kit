export function logSipError(
  scope: string,
  details: Record<string, unknown> = {}
): void {
  console.error(`[react-jssip-kit] ${scope}`, details);
}