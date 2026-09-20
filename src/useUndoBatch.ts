import { useCallback, useEffect, useRef, useState } from 'react'
import { startUndoWindow } from './undoWindow'

export interface UndoBatch {
  generation: number
  occurrenceIds: string[]
}

export interface UndoFailure {
  occurrenceId: string
  detail: string
  restored: boolean
}

interface UndoPersistence {
  pendingDeletionIds?: string[]
  enqueue?: (occurrenceIds: string[]) => Promise<unknown>
  cancel?: (occurrenceId: string) => Promise<unknown>
}

const EMPTY_IDS: string[] = []

export function useUndoBatch(
  applyDeletion: (occurrenceId: string) => Promise<void>,
  onMutation: () => void,
  persistence: UndoPersistence = {}
) {
  const [batch, setBatch] = useState<UndoBatch>()
  const [failures, setFailures] = useState<UndoFailure[]>([])
  const [localPendingDeletionIds, setLocalPendingDeletionIds] = useState<string[]>([])
  const [retryingOccurrenceId, setRetryingOccurrenceId] = useState<string>()
  const activeRef = useRef<UndoBatch | undefined>(undefined)
  const timerRef = useRef<number | undefined>(undefined)
  const generationRef = useRef(0)
  const processingRef = useRef(new Set<string>())
  const applyDeletionRef = useRef(applyDeletion)
  const onMutationRef = useRef(onMutation)
  const enqueueRef = useRef(persistence.enqueue ?? (async () => {}))
  const cancelRef = useRef(persistence.cancel ?? (async () => {}))
  applyDeletionRef.current = applyDeletion
  onMutationRef.current = onMutation
  enqueueRef.current = persistence.enqueue ?? (async () => {})
  cancelRef.current = persistence.cancel ?? (async () => {})
  const persistedPendingDeletionIds = persistence.pendingDeletionIds ?? EMPTY_IDS
  const persistedPendingDeletionKey = persistedPendingDeletionIds.join('\0')
  const pendingDeletionIds = [...new Set([
    ...persistedPendingDeletionIds,
    ...localPendingDeletionIds
  ])]

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
      clearOwnedBatch(generation)
    })
    onMutationRef.current()
  }, [clearOwnedBatch])

  const deleteBatch = useCallback(async (captured: UndoBatch) => {
    const results = await Promise.all(captured.occurrenceIds.map(async (occurrenceId) => {
      if (processingRef.current.has(occurrenceId)) return { failure: undefined, deleted: false }
      processingRef.current.add(occurrenceId)
      try {
        await applyDeletionRef.current(occurrenceId)
        return { failure: undefined, deleted: true }
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause)
        try {
          await cancelRef.current(occurrenceId)
          return { failure: { occurrenceId, detail, restored: true }, deleted: false }
        } catch (cancelCause) {
          const cancelDetail = cancelCause instanceof Error ? cancelCause.message : String(cancelCause)
          return {
            failure: {
              occurrenceId,
              detail: `${detail}; pending undo cleanup failed: ${cancelDetail}`,
              restored: false
            },
            deleted: false
          }
        }
      } finally {
        processingRef.current.delete(occurrenceId)
      }
    }))
    const nextFailures = results
      .map((result) => result.failure)
      .filter((failure): failure is UndoFailure => Boolean(failure))
    const capturedIds = new Set(captured.occurrenceIds)
    setFailures((current) => [
      ...current.filter((failure) => !capturedIds.has(failure.occurrenceId)),
      ...nextFailures
    ])
    const retainedIds = new Set(nextFailures.filter((failure) => !failure.restored).map((failure) => failure.occurrenceId))
    setLocalPendingDeletionIds((current) =>
      current.filter((occurrenceId) => !capturedIds.has(occurrenceId) || retainedIds.has(occurrenceId))
    )
    if (results.some((result) => result.deleted)) onMutationRef.current()
  }, [])

  const undo = useCallback(() => {
    const captured = activeRef.current
    if (!captured || !clearOwnedBatch(captured.generation)) return
    void enqueueRef.current(captured.occurrenceIds).then(() => {
      setLocalPendingDeletionIds((current) => [
        ...current.filter((occurrenceId) => !captured.occurrenceIds.includes(occurrenceId)),
        ...captured.occurrenceIds
      ])
      return deleteBatch(captured)
    }).catch((cause) => {
      const detail = cause instanceof Error ? cause.message : String(cause)
      setFailures((current) => [
        ...current.filter((failure) => !captured.occurrenceIds.includes(failure.occurrenceId)),
        ...captured.occurrenceIds.map((occurrenceId) => ({ occurrenceId, detail, restored: true }))
      ])
    })
  }, [clearOwnedBatch, deleteBatch])

  const retryFailure = useCallback(async (occurrenceId: string) => {
    setRetryingOccurrenceId(occurrenceId)
    try {
      const failure = failures.find((item) => item.occurrenceId === occurrenceId)
      if (failure?.restored) {
        await enqueueRef.current([occurrenceId])
        setLocalPendingDeletionIds((current) => [...new Set([...current, occurrenceId])])
      }
      await deleteBatch({ generation: ++generationRef.current, occurrenceIds: [occurrenceId] })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      setFailures((current) => [
        ...current.filter((failure) => failure.occurrenceId !== occurrenceId),
        { occurrenceId, detail, restored: true }
      ])
    } finally {
      setRetryingOccurrenceId(undefined)
    }
  }, [deleteBatch, failures])

  const dismissFailure = useCallback((occurrenceId: string) => {
    setFailures((current) => current.filter((failure) => failure.occurrenceId !== occurrenceId))
  }, [])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])
  useEffect(() => {
    const resumableIds = (persistedPendingDeletionKey ? persistedPendingDeletionKey.split('\0') : []).filter((occurrenceId) =>
      !processingRef.current.has(occurrenceId)
    )
    if (resumableIds.length) {
      void deleteBatch({ generation: ++generationRef.current, occurrenceIds: resumableIds })
    }
  }, [deleteBatch, persistedPendingDeletionKey])

  return {
    batch,
    failures,
    pendingDeletionIds,
    retryingOccurrenceId,
    add,
    undo,
    retryFailure,
    dismissFailure
  }
}
