import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, useIntlLocale } from '@/lib/datetime'
import { readServerError } from '@/lib/forms/serverErrors'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '../ConfirmDialog'
import { formatBytes } from './formatBytes'
import { DEFAULT_ACCEPT, MAX_FILE_BYTES, type AttachmentApi, type FileMeta } from './types'

interface AttachmentPanelProps {
  /** `api.key` identifies the document; when it changes the panel resets and reloads. */
  api: AttachmentApi
  readOnly?: boolean
  /** Extensions without the dot. */
  accept?: readonly string[]
  maxBytes?: number
  title?: string
  className?: string
}

interface Upload {
  key: string
  name: string
  controller: AbortController
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function AttachmentPanel({
  api,
  readOnly = false,
  accept = DEFAULT_ACCEPT,
  maxBytes = MAX_FILE_BYTES,
  title,
  className,
}: AttachmentPanelProps) {
  const { t } = useTranslation('common')
  const locale = useIntlLocale()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const apiRef = useRef(api)
  const inFlight = useRef(new Set<AbortController>())
  const seq = useRef(0)
  const [files, setFiles] = useState<FileMeta[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reload, setReload] = useState(0)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<FileMeta | null>(null)
  const maxLabel = formatBytes(maxBytes, locale)
  const scope = api.key
  const scopeRef = useRef(scope)
  // A different document: drop everything shown or pending for the previous one.
  const [loadedScope, setLoadedScope] = useState(scope)
  if (loadedScope !== scope) {
    setLoadedScope(scope)
    setFiles([])
    setStatus('loading')
    setUploads([])
    setErrors([])
    setPendingDelete(null)
  }

  useEffect(() => {
    apiRef.current = api
    scopeRef.current = scope
  })

  useEffect(() => {
    let alive = true
    apiRef.current.list().then(
      (list) => {
        if (!alive) return
        setFiles(list)
        setStatus('ready')
      },
      () => {
        if (alive) setStatus('error')
      },
    )
    return () => {
      alive = false
    }
  }, [scope, reload])

  useEffect(() => {
    const active = new Set<AbortController>()
    inFlight.current = active
    return () => active.forEach((c) => c.abort())
  }, [scope])

  const uploadOne = async (file: File) => {
    const ext = extension(file.name)
    if (file.size > maxBytes) {
      setErrors((e) => [...e, t('attachments.tooLarge', { name: file.name, size: maxLabel })])
      return
    }
    if (!accept.includes(ext)) {
      setErrors((e) => [...e, t('attachments.unsupported', { name: file.name })])
      return
    }
    seq.current += 1
    const upload: Upload = {
      key: `${seq.current}-${file.name}`,
      name: file.name,
      controller: new AbortController(),
    }
    const owner = scopeRef.current
    const active = inFlight.current
    active.add(upload.controller)
    setUploads((u) => [...u, upload])
    try {
      const meta = await apiRef.current.upload(file, upload.controller.signal)
      if (scopeRef.current === owner) setFiles((f) => [...f, meta])
    } catch (error) {
      if (upload.controller.signal.aborted || scopeRef.current !== owner) return
      const server = readServerError(error)
      const message =
        server?.code === 'FILE_TOO_LARGE'
          ? t('attachments.tooLarge', { name: file.name, size: maxLabel })
          : server?.code === 'UNSUPPORTED_FILE_TYPE'
            ? t('attachments.unsupported', { name: file.name })
            : t('attachments.uploadFailed', { name: file.name })
      setErrors((e) => [...e, message])
    } finally {
      active.delete(upload.controller)
      if (!upload.controller.signal.aborted && scopeRef.current === owner)
        setUploads((u) => u.filter((x) => x.key !== upload.key))
    }
  }

  const handleFiles = (list: FileList | null) => {
    if (!list) return
    setErrors([])
    for (const file of Array.from(list)) void uploadOne(file)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (!readOnly) handleFiles(e.dataTransfer.files)
  }

  const confirmDelete = async () => {
    const target = pendingDelete
    if (!target) return
    const owner = scopeRef.current
    try {
      await apiRef.current.remove(target.id)
    } catch (error) {
      if (scopeRef.current !== owner) return
      setErrors([readServerError(error)?.message ?? t('states.errorTitle')])
      throw error
    }
    if (scopeRef.current === owner) setFiles((f) => f.filter((x) => x.id !== target.id))
  }

  return (
    <section aria-label={title ?? t('attachments.title')} className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2">
        <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">{title ?? t('attachments.title')}</h2>
        {status === 'ready' && (
          <span className="text-xs text-muted-foreground">({files.length})</span>
        )}
      </div>

      {!readOnly && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-wrap items-center justify-center gap-3 rounded-md border border-dashed border-border-strong px-4 py-5 text-sm text-muted-foreground transition-colors',
            dragging && 'border-primary bg-primary-soft',
          )}
        >
          <Upload className="size-4" aria-hidden="true" />
          <span>{t('attachments.drop')}</span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            accept={accept.map((a) => `.${a}`).join(',')}
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            {t('attachments.choose')}
          </Button>
          <span className="w-full text-center text-xs">
            {t('attachments.hint', { size: maxLabel })}
          </span>
        </div>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 text-xs text-danger">
          {errors.map((message, i) => (
            <li key={`${i}-${message}`}>{message}</li>
          ))}
        </ul>
      )}

      {status === 'loading' && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {status === 'error' && (
        <div role="alert" className="flex items-center justify-between gap-2 text-sm">
          <span>{t('attachments.loadFailed')}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStatus('loading')
              setReload((r) => r + 1)
            }}
          >
            {t('actions.retry')}
          </Button>
        </div>
      )}
      {status === 'ready' && files.length === 0 && uploads.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('attachments.empty')}</p>
      )}

      {(files.length > 0 || uploads.length > 0) && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <a
                  href={api.downloadUrl(file.id)}
                  className="block truncate text-sm font-medium hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {file.original_name}
                </a>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size, locale)} · {formatDateTime(file.created_at, locale)}
                  {file.uploaded_by ? ` · ${file.uploaded_by.name}` : ''}
                </p>
              </div>
              <Button asChild variant="ghost" size="icon-sm">
                <a
                  href={api.downloadUrl(file.id)}
                  aria-label={t('attachments.download', { name: file.original_name })}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download aria-hidden="true" />
                </a>
              </Button>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('attachments.remove', { name: file.original_name })}
                  onClick={() => setPendingDelete(file)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
          {uploads.map((u) => (
            <li
              key={u.key}
              className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
              {t('attachments.uploading', { name: u.name })}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t('attachments.removeTitle')}
        description={t('attachments.removeBody', { name: pendingDelete?.original_name ?? '' })}
        confirmLabel={t('actions.delete')}
        onConfirm={confirmDelete}
      />
    </section>
  )
}
