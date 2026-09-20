import { useCallback, useEffect, useRef, useState } from 'react'
import { startUndoWindow } from './undoWindow'

export interface UndoBatch {
  generation: number
  occurrenceIds: string[]
}

export interface UndoFailure {
  occurrenceId: string
  detail: string
}

export function useUndoBatch(
  deleteOccurrence: (occurrenceId: string) => Promise<void>,
  onFinalize: () => void
) {
  const [batch, setBatch] = useState<UndoBatch>()
  const [failures, setFailures] = useState<UndoFailure[]>([])
  const [retryingOccurrenceId, setRetryingOccurrenceId] = useState<string>()
  const activeRef = useRef<UndoBatch | undefined>(undefined)
  const timerRef = useRef<number | undefined>(undefined)
  const generationRef = useRef(0)
  const deleteOccurrenceRef = useRef(deleteOccurrence)
  const onFinalizeRef = useRef(onFinalize)
  deleteOccurrenceRef.current = deleteOccurrence
  onFinalizeRef.current = onFinalize

  const clearOwnedBatch = useCallback((generation: number) => {
    if (activeRef.current?.generation !== generation) return false
    window.clearTimeout(timerRef.current)
    timerRef.current = undefined
    activeRef.current = undefined
    setBatch((current) => current?.generation === generation ? undefined : current)
    return true
  }, [])

  const add = useCallback((occurrenceId: string) => {
    const generation = ++generationRef.current
    const next: UndoBatch = {
      generation,
      occurrenceIds: [...(activeRef.current?.occurrenceIds ?? []), occurrenceId]
    }
    window.clearTimeout(timerRef.current)
    activeRef.current = next
    setBatch(next)
    timerRef.current = startUndoWindow(() => {
      if (!clearOwnedBatch(generation)) return
      onFinalizeRef.current()
    })
  }, [clearOwnedBatch])

  const deleteBatch = useCallback(async (captured: UndoBatch) => {
    const results = await Promise.all(captured.occurrenceIds.map(async (occurrenceId) => {
      try {
        await deleteOccurrenceRef.current(occurrenceId)
        return undefined
      } catch (cause) {
        return {
          occurrenceId,
          detail: cause instanceof Error ? cause.message : String(cause)
        }
      }
    }))
    const nextFailures = results.filter((failure): failure is UndoFailure => Boolean(failure))
    const capturedIds = new Set(captured.occurrenceIds)
    setFailures((current) => [
      ...current.filter((failure) => !capturedIds.has(failure.occurrenceId)),
      ...nextFailures
    ])
    onFinalizeRef.current()
  }, [])

  const undo = useCallback(() => {
    const captured = activeRef.current
    if (!captured || !clearOwnedBatch(captured.generation)) return
    void deleteBatch(captured)
  }, [clearOwnedBatch, deleteBatch])

  const retryFailure = useCallback(async (occurrenceId: string) => {
    setRetryingOccurrenceId(occurrenceId)
    try {
      await deleteOccurrenceRef.current(occurrenceId)
      setFailures((current) => current.filter((failure) => failure.occurrenceId !== occurrenceId))
      onFinalizeRef.current()
    } catch (cause) {
      const failure = {
        occurrenceId,
        detail: cause instanceof Error ? cause.message : String(cause)
      }
      setFailures((current) => [
        ...current.filter((item) => item.occurrenceId !== occurrenceId),
        failure
      ])
    } finally {
      setRetryingOccurrenceId(undefined)
    }
  }, [])

  const dismissFailure = useCallback((occurrenceId: string) => {
    setFailures((current) => current.filter((failure) => failure.occurrenceId !== occurrenceId))
  }, [])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  return {
    batch,
    failures,
    retryingOccurrenceId,
    add,
    undo,
    retryFailure,
    dismissFailure
  }
}
