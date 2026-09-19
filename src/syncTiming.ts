export type SyncTimingStage =
  | 'account'
  | 'token'
  | 'lockWait'
  | 'remoteMetadata'
  | 'remoteContent'
  | 'localRead'
  | 'localPersist'
  | 'remoteWrite'
  | 'syncMetaPersist'

export class SyncDurationTrace {
  private readonly startedAt: number
  private readonly durations: Partial<Record<SyncTimingStage, number>> = {}

  constructor(private readonly now: () => number = () => performance.now()) {
    this.startedAt = now()
  }

  timestamp() {
    return this.now()
  }

  add(stage: SyncTimingStage, durationMs: number) {
    this.durations[stage] = (this.durations[stage] ?? 0) + durationMs
  }

  addSince(stage: SyncTimingStage, startedAt: number) {
    this.add(stage, this.now() - startedAt)
  }

  async measure<T>(stage: SyncTimingStage, operation: () => Promise<T>) {
    const startedAt = this.now()
    try {
      return await operation()
    } finally {
      this.addSince(stage, startedAt)
    }
  }

  summary(details: {
    outcome: 'success' | 'error' | 'skipped'
    attempts: number
    uploaded: boolean
    documentBytes: number
  }) {
    return {
      totalMs: Math.round(this.now() - this.startedAt),
      stages: Object.fromEntries(
        Object.entries(this.durations).map(([stage, duration]) => [stage, Math.round(duration)])
      ),
      ...details
    }
  }
}
