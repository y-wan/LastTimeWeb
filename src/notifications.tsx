import { useEffect, useId, useState, type ReactNode } from 'react'

export function Notice({
  className = '',
  message,
  detail,
  showDetailsLabel,
  hideDetailsLabel,
  copyDetailsLabel,
  copiedLabel,
  copyFailedLabel,
  dismissLabel,
  onDismiss,
  children
}: {
  className?: string
  message: ReactNode
  detail?: string
  showDetailsLabel?: string
  hideDetailsLabel?: string
  copyDetailsLabel?: string
  copiedLabel?: string
  copyFailedLabel?: string
  dismissLabel?: string
  onDismiss?: () => void
  children?: ReactNode
}) {
  const detailId = useId()
  const [expanded, setExpanded] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    setExpanded(false)
    setCopyStatus('idle')
  }, [detail])
  const copyDetail = async () => {
    if (!detail) return
    try {
      await navigator.clipboard.writeText(detail)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }

  return <div className={`notice ${className}`.trim()} role={detail ? 'alert' : 'status'}>
    <div className="notice-content">
      <span className="notice-message">{message}</span>
      {detail && <button
        className="notice-detail-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? hideDetailsLabel : showDetailsLabel}
      </button>}
      {detail && expanded && <div className="notice-detail" id={detailId}>
        <code>{detail}</code>
        <button className="notice-copy" type="button" onClick={() => void copyDetail()}>
          {copyStatus === 'copied' ? copiedLabel : copyStatus === 'failed' ? copyFailedLabel : copyDetailsLabel}
        </button>
        <span className="sr-only" aria-live="polite">{copyStatus === 'copied' ? copiedLabel : copyStatus === 'failed' ? copyFailedLabel : ''}</span>
      </div>}
    </div>
    {(children || onDismiss) && <div className="notice-actions">
      {children}
      {onDismiss && <button className="notice-dismiss" type="button" onClick={onDismiss}>{dismissLabel}</button>}
    </div>}
  </div>
}
