export function assertPositiveIntegerUserId(userId: unknown, context: string = "userId"): number {
  if (!Number.isInteger(userId) || Number(userId) <= 0) {
    throw new Error(`${context} must be a positive integer`);
  }

  return Number(userId);
}
