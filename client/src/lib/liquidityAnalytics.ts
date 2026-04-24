export type FeedSnapshot = {
  marketId: string;
  title?: string;
  currentSnapshot?: {
    yesPrice: number;
    noPrice: number;
    yesVolume: number;
    noVolume: number;
    impliedProbability: number;
    timestamp?: number;
  };
  priceHistory?: Array<{ impliedProbability: number; yesPrice?: number; noPrice?: number; timestamp: number }>;
  volumeHistory?: Array<{ yesVolume: number; noVolume: number; timestamp: number }>;
  dataQualityScore?: number;
  status?: string;
};

export function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function buildLiquidityRow(feed: FeedSnapshot) {
  const snapshot = feed.currentSnapshot;
  if (!snapshot) return null;

  const totalVolume = snapshot.yesVolume + snapshot.noVolume;
  const spreadProxy = Math.abs(snapshot.yesPrice + snapshot.noPrice - 1);
  const imbalance = totalVolume > 0 ? Math.abs(snapshot.yesVolume - snapshot.noVolume) / totalVolume : 0;
  const history = feed.priceHistory ?? [];
  const volumeHistory = feed.volumeHistory ?? [];
  const oldest = history[0]?.impliedProbability ?? snapshot.impliedProbability;
  const newest = history[history.length - 1]?.impliedProbability ?? snapshot.impliedProbability;
  const momentum = newest - oldest;
  const latestVolumePoint = volumeHistory[volumeHistory.length - 1];
  const oldestVolumePoint = volumeHistory[0];
  const currentDepth = totalVolume;
  const previousDepth = oldestVolumePoint ? oldestVolumePoint.yesVolume + oldestVolumePoint.noVolume : currentDepth;
  const depthMomentum = previousDepth > 0 ? (currentDepth - previousDepth) / previousDepth : 0;
  const microstructurePressure = clampUnit((imbalance * 0.45) + (Math.abs(momentum) * 2.5) + Math.max(0, depthMomentum) * 0.2);
  const tradabilityScore = clampUnit(Math.max(0, Math.min(1, totalVolume / 25000)) * 0.55 + (1 - Math.min(1, spreadProxy / 0.12)) * 0.3 + (feed.dataQualityScore ?? 0) * 0.15);

  return {
    marketId: feed.marketId,
    status: feed.status ?? "unknown",
    dataQualityScore: feed.dataQualityScore ?? 0,
    yesPrice: snapshot.yesPrice,
    noPrice: snapshot.noPrice,
    impliedProbability: snapshot.impliedProbability,
    totalVolume,
    yesVolume: snapshot.yesVolume,
    noVolume: snapshot.noVolume,
    spreadProxy,
    imbalance,
    momentum,
    depthMomentum,
    microstructurePressure,
    tradabilityScore,
  };
}

export function summarizeLiquidityRows(rows: Array<ReturnType<typeof buildLiquidityRow> extends infer T ? Exclude<T, null> : never>) {
  if (rows.length === 0) {
    return {
      tracked: 0,
      avgLiquidity: 0,
      avgSpread: 0,
      avgTradability: 0,
      avgPressure: 0,
    };
  }

  return {
    tracked: rows.length,
    avgLiquidity: rows.reduce((sum, row) => sum + row.totalVolume, 0) / rows.length,
    avgSpread: rows.reduce((sum, row) => sum + row.spreadProxy, 0) / rows.length,
    avgTradability: rows.reduce((sum, row) => sum + row.tradabilityScore, 0) / rows.length,
    avgPressure: rows.reduce((sum, row) => sum + row.microstructurePressure, 0) / rows.length,
  };
}
