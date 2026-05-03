export interface RampWindowCapInput {
  intendedSize: number;
  intendedMaxDayLoss: number;
  liveStartedAt: Date | null;
  rampWindowHours: number;
  rampSizeMultiplier: number;
}

export interface RampWindowCapResult {
  cappedSize: number;
  cappedMaxDayLoss: number;
  rampActive: boolean;
  hoursRemaining: number;
}

export function isInRampWindow(liveStartedAt: Date | null, rampWindowHours: number): boolean {
  if (!liveStartedAt) return false;
  const elapsed = (Date.now() - liveStartedAt.getTime()) / (60 * 60 * 1000);
  return elapsed < rampWindowHours;
}

export function applyRampWindowCap(input: RampWindowCapInput): RampWindowCapResult {
  const { intendedSize, intendedMaxDayLoss, liveStartedAt, rampWindowHours, rampSizeMultiplier } = input;

  if (!isInRampWindow(liveStartedAt, rampWindowHours)) {
    return { cappedSize: intendedSize, cappedMaxDayLoss: intendedMaxDayLoss, rampActive: false, hoursRemaining: 0 };
  }

  const elapsed = liveStartedAt ? (Date.now() - liveStartedAt.getTime()) / (60 * 60 * 1000) : 0;
  const hoursRemaining = Math.max(0, rampWindowHours - elapsed);

  return {
    cappedSize: Math.floor(intendedSize * rampSizeMultiplier),
    cappedMaxDayLoss: Math.floor(intendedMaxDayLoss * rampSizeMultiplier),
    rampActive: true,
    hoursRemaining: Math.round(hoursRemaining),
  };
}
