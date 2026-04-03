'use client'

import { useState, useCallback } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import PageHeader from '@/components/layout/PageHeader'
import { Button, Input, ColorPicker } from '@/components/ui'
import { UploadProgress } from '@/features/closet/UploadProgress'
import { ImageCropper } from '@/features/closet/ImageCropper'
import { uploadGarmentFile, type UploadStage } from '@/hooks/useUploadGarment'
import {
  MAX_UPLOAD_SIZE_MB,
  CATEGORIES,
  FABRICS,
  VIBES,
  WARMTH_LEVELS,
} from '@/lib/constants'
import type {
  Garment,
  GarmentTagResult,
  GarmentCategory,
  GarmentFabric,
  GarmentVibe,
  DetectedGarment,
} from '@/lib/types'

const ACCEPTED_MIME_TYPES: Record<string, string[]> = {
  'image/jpeg': [],
  'image/png': [],
  'image/webp': [],
}

const MAX_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

interface EditableTags {
  name: string
  category: GarmentCategory
  color_primary: string
  color_secondary: string | null
  fabric: GarmentFabric | null
  vibe: GarmentVibe[]
  warmth_level: number
  purchase_price: number
  maintenance_cost: number
}

interface FileEntry {
  id: string
  file: File
  previewUrl: string
  croppedFile?: File
  stage: UploadStage
  progress: number
  garment?: Garment
  tags?: GarmentTagResult
  editedTags?: EditableTags
  saved?: boolean
  error?: string
}

type UploadMode = 'single' | 'scan'

type PagePhase =
  | 'dropzone'
  | 'crop'
  | 'preview'
  | 'uploading'
  | 'review'
  // Scan-specific phases
  | 'scan-detecting'
  | 'scan-review'

function getPhase(
  entries: FileEntry[],
  cropIndex: number | null,
  mode: UploadMode,
  scanPhase: 'idle' | 'detecting' | 'detected' | null,
): PagePhase {
  // Scan phases checked first — entries are empty until user confirms items
  if (mode === 'scan') {
    if (scanPhase === 'detecting') return 'scan-detecting'
    if (scanPhase === 'detected') return 'scan-review'
  }

  if (entries.length === 0) return 'dropzone'

  if (cropIndex !== null) return 'crop'
  const hasActiveUpload = entries.some(
    (e) => e.stage === 'uploading' || e.stage === 'processing' || e.stage === 'tagging'
  )
  const allDoneOrError = entries.every((e) => e.stage === 'done' || e.stage === 'error')
  const anyStarted = entries.some((e) => e.stage !== 'idle')
  if (!anyStarted) return 'preview'
  if (hasActiveUpload) return 'uploading'
  if (allDoneOrError) return 'review'
  return 'uploading'
}

/**
 * Crop a region from an image using canvas.
 * bbox is normalised (0-1) relative to image dimensions.
 */
async function cropBboxFromImage(
  imageSrc: string,
  bbox: DetectedGarment['bbox'],
): Promise<Blob> {
  const image = new window.Image()
  image.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = imageSrc
  })

  const sx = Math.round(bbox.x * image.naturalWidth)
  const sy = Math.round(bbox.y * image.naturalHeight)
  const sw = Math.round(bbox.width * image.naturalWidth)
  const sh = Math.round(bbox.height * image.naturalHeight)

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get canvas context')

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png',
      0.95,
    )
  })
}

export default function UploadPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [rejectedErrors, setRejectedErrors] = useState<string[]>([])
  const [cropIndex, setCropIndex] = useState<number | null>(null)
  const [mode, setMode] = useState<UploadMode>('single')

  // Scan outfit state
  const [scanPhase, setScanPhase] = useState<'idle' | 'detecting' | 'detected' | null>(null)
  const [scanImageUrl, setScanImageUrl] = useState<string | null>(null)
  const [scanFile, setScanFile] = useState<File | null>(null)
  const [detectedItems, setDetectedItems] = useState<(DetectedGarment & { selected: boolean })[]>([])
  const [scanError, setScanError] = useState<string | null>(null)

  const updateEntry = useCallback((id: string, patch: Partial<FileEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }, [])

  const onDrop = useCallback((acceptedFiles: File[], rejections: FileRejection[]) => {
    setRejectedErrors([])
    if (rejections.length > 0) {
      setRejectedErrors(
        rejections.map((r) => {
          const code = r.errors[0]?.code
          if (code === 'file-too-large') return `${r.file.name}: exceeds ${MAX_UPLOAD_SIZE_MB} MB limit`
          if (code === 'file-invalid-type') return `${r.file.name}: unsupported file type`
          return `${r.file.name}: ${r.errors[0]?.message ?? 'Unknown error'}`
        })
      )
    }
    if (acceptedFiles.length === 0) return

    if (mode === 'scan') {
      // Scan mode: take only the first file
      const file = acceptedFiles[0]
      if (scanImageUrl) URL.revokeObjectURL(scanImageUrl)
      setScanFile(file)
      setScanImageUrl(URL.createObjectURL(file))
      setScanPhase('idle')
      setDetectedItems([])
      setScanError(null)
      return
    }

    const newEntries: FileEntry[] = acceptedFiles.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      stage: 'idle' as UploadStage,
      progress: 0,
    }))

    setEntries((prev) => {
      const updated = [...prev, ...newEntries]
      const firstNewIdx = prev.length
      setCropIndex(firstNewIdx)
      return updated
    })
  }, [mode, scanImageUrl])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME_TYPES,
    maxSize: MAX_SIZE_BYTES,
    multiple: mode === 'single',
    noClick: false,
  })

  function removeEntry(id: string) {
    setEntries((prev) => {
      const entry = prev.find((e) => e.id === id)
      if (entry) URL.revokeObjectURL(entry.previewUrl)
      return prev.filter((e) => e.id !== id)
    })
  }

  function handleCropDone(blob: Blob) {
    if (cropIndex === null) return
    const entry = entries[cropIndex]
    if (!entry) return

    const croppedFile = new File([blob], entry.file.name, { type: 'image/png' })
    const newPreviewUrl = URL.createObjectURL(croppedFile)

    setEntries((prev) =>
      prev.map((e, i) => {
        if (i !== cropIndex) return e
        URL.revokeObjectURL(e.previewUrl)
        return { ...e, croppedFile, previewUrl: newPreviewUrl }
      })
    )

    const nextIdx = entries.findIndex((e, i) => i > cropIndex && !e.croppedFile)
    setCropIndex(nextIdx >= 0 ? nextIdx : null)
  }

  function handleSkipCrop() {
    if (cropIndex === null) return
    const nextIdx = entries.findIndex((e, i) => i > cropIndex && !e.croppedFile)
    setCropIndex(nextIdx >= 0 ? nextIdx : null)
  }

  // ── Scan Outfit: detect garments ──────────────────────────────────────────
  async function handleScanDetect() {
    if (!scanFile) return
    setScanPhase('detecting')
    setScanError(null)

    try {
      const formData = new FormData()
      formData.append('image', scanFile)

      const res = await fetch('/api/garments/detect', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setScanError(data.error ?? 'Detection failed')
        setScanPhase('idle')
        return
      }

      const items = (data.items as DetectedGarment[]).map((item) => ({
        ...item,
        selected: true,
      }))
      setDetectedItems(items)
      setScanPhase('detected')
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Detection failed')
      setScanPhase('idle')
    }
  }

  // ── Scan Outfit: confirm detected items and crop them into entries ─────────
  async function handleScanConfirm() {
    if (!scanImageUrl) return
    const selected = detectedItems.filter((item) => item.selected)
    if (selected.length === 0) return

    const newEntries: FileEntry[] = []

    for (const item of selected) {
      try {
        const blob = await cropBboxFromImage(scanImageUrl, item.bbox)
        const file = new File([blob], `${item.label}.png`, { type: 'image/png' })
        const previewUrl = URL.createObjectURL(file)
        newEntries.push({
          id: `${Date.now()}-${Math.random()}`,
          file,
          previewUrl,
          croppedFile: file,
          stage: 'idle' as UploadStage,
          progress: 0,
        })
      } catch (err) {
        console.warn(`Failed to crop ${item.label}:`, err)
      }
    }

    if (newEntries.length === 0) {
      setScanError('Failed to crop any detected items.')
      return
    }

    // Switch to normal flow with cropped entries
    setEntries(newEntries)
    setScanPhase(null)
    setCropIndex(null) // Skip crop phase since we already cropped
  }

  function toggleDetectedItem(index: number) {
    setDetectedItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item))
    )
  }

  // ── Upload all entries ────────────────────────────────────────────────────
  async function uploadAll() {
    const idleEntries = entries.filter((e) => e.stage === 'idle')

    await Promise.allSettled(
      idleEntries.map(async (entry) => {
        try {
          const tempId = `placeholder-${entry.id}`
          const filename = entry.file.name.replace(/\.[^.]+$/, '')
          const placeholder: Garment = {
            id: tempId,
            user_id: '',
            name: filename,
            category: 'Top',
            color_primary: '#000000',
            color_secondary: null,
            fabric: null,
            vibe: [],
            warmth_level: 3,
            purchase_price: 0,
            maintenance_cost: 0,
            times_worn: 0,
            last_worn_at: null,
            image_path: '',
            thumb_path: '',
            is_active: true,
            created_at: new Date().toISOString(),
          }
          await queryClient.cancelQueries({ queryKey: ['garments'] })
          queryClient.setQueriesData<{ garments: Garment[]; total: number }>(
            { queryKey: ['garments'] },
            (old) =>
              old
                ? { ...old, garments: [placeholder, ...old.garments], total: old.total + 1 }
                : old
          )

          const fileToUpload = entry.croppedFile ?? entry.file
          const result = await uploadGarmentFile(
            fileToUpload,
            (pct) => updateEntry(entry.id, { progress: pct }),
            (stage) => updateEntry(entry.id, { stage })
          )

          const editedTags: EditableTags = {
            name: result.tags.suggested_name,
            category: result.tags.category,
            color_primary: result.tags.color_primary,
            color_secondary: result.tags.color_secondary,
            fabric: result.tags.fabric,
            vibe: result.tags.vibe,
            warmth_level: result.tags.warmth_level,
            purchase_price: 0,
            maintenance_cost: 0,
          }
          updateEntry(entry.id, {
            garment: result.garment,
            tags: result.tags,
            editedTags,
            stage: 'done',
          })
          await queryClient.invalidateQueries({ queryKey: ['garments'] })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed'
          updateEntry(entry.id, { stage: 'error', error: msg })
          await queryClient.invalidateQueries({ queryKey: ['garments'] })
        }
      })
    )
  }

  async function saveEntry(entry: FileEntry) {
    if (!entry.garment || !entry.editedTags) return
    try {
      const res = await fetch(`/api/garments/${entry.garment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.editedTags),
      })
      if (res.ok) {
        updateEntry(entry.id, { saved: true })
        await queryClient.invalidateQueries({ queryKey: ['garments'] })
      } else {
        updateEntry(entry.id, { error: 'Failed to save tags. Please try again.' })
      }
    } catch {
      updateEntry(entry.id, { error: 'Network error. Please try again.' })
    }
  }

  function updateEditedTags(id: string, patch: Partial<EditableTags>) {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id && e.editedTags ? { ...e, editedTags: { ...e.editedTags, ...patch } } : e
      )
    )
  }

  // Reset to initial state
  function handleReset() {
    entries.forEach((e) => URL.revokeObjectURL(e.previewUrl))
    if (scanImageUrl) URL.revokeObjectURL(scanImageUrl)
    setEntries([])
    setCropIndex(null)
    setScanPhase(null)
    setScanImageUrl(null)
    setScanFile(null)
    setDetectedItems([])
    setScanError(null)
    setRejectedErrors([])
  }

  const phase = getPhase(entries, cropIndex, mode, scanPhase)
  const allSavedOrSkipped = entries.filter((e) => e.stage === 'done').every((e) => e.saved)

  return (
    <div className="min-h-screen bg-background pb-safe">
      <PageHeader title="Add to Closet" showBack />

      <div className="px-4 pt-4 pb-32">
        <AnimatePresence mode="wait">
          {/* ── Dropzone ── */}
          {phase === 'dropzone' && (
            <motion.div
              key="dropzone"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* Mode toggle */}
              <div className="flex gap-2 p-1 bg-surface-raised rounded-xl">
                <button
                  type="button"
                  onClick={() => { setMode('single'); handleReset() }}
                  className={[
                    'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors',
                    mode === 'single'
                      ? 'bg-brand text-brand-foreground shadow-sm'
                      : 'text-muted hover:text-foreground',
                  ].join(' ')}
                >
                  Single items
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('scan'); handleReset() }}
                  className={[
                    'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors',
                    mode === 'scan'
                      ? 'bg-brand text-brand-foreground shadow-sm'
                      : 'text-muted hover:text-foreground',
                  ].join(' ')}
                >
                  Scan outfit
                </button>
              </div>

              {/* Scan mode: show preview + detect button if image selected */}
              {mode === 'scan' && scanImageUrl && (
                <div className="space-y-3">
                  <div className="relative w-full aspect-[3/4] max-w-sm mx-auto rounded-2xl overflow-hidden bg-surface-raised">
                    <Image
                      src={scanImageUrl}
                      alt="Outfit to scan"
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  {scanError && (
                    <p className="text-xs text-red-600 dark:text-red-400 text-center">{scanError}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="md"
                      className="flex-1"
                      onClick={() => {
                        if (scanImageUrl) URL.revokeObjectURL(scanImageUrl)
                        setScanFile(null)
                        setScanImageUrl(null)
                        setScanError(null)
                      }}
                    >
                      Change photo
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      className="flex-1"
                      onClick={handleScanDetect}
                      loading={scanPhase === 'detecting'}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5" aria-hidden="true">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      Detect garments
                    </Button>
                  </div>
                </div>
              )}

              {/* Dropzone area */}
              {!(mode === 'scan' && scanImageUrl) && (
                <div
                  {...getRootProps()}
                  className={[
                    'relative border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer min-h-[280px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors duration-150',
                    isDragActive ? 'border-brand bg-brand/8' : 'border-border bg-transparent',
                  ].join(' ')}
                >
                  <input {...getInputProps()} />
                  <motion.div
                    animate={{ scale: isDragActive ? 1.15 : 1 }}
                    transition={{ duration: 0.15 }}
                    className="w-16 h-16 rounded-full bg-surface-raised flex items-center justify-center mb-4"
                  >
                    {mode === 'scan' ? (
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand" aria-hidden="true">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    )}
                  </motion.div>
                  <p className="text-base font-semibold text-foreground">
                    {mode === 'scan'
                      ? isDragActive ? 'Drop outfit photo' : 'Drop an outfit photo here'
                      : isDragActive ? 'Drop to add' : 'Drop clothes here'}
                  </p>
                  <p className="text-sm text-muted mt-1">
                    {mode === 'scan'
                      ? 'Upload a photo wearing an outfit — AI will detect each garment'
                      : `or tap to browse · JPEG, PNG, WebP · max ${MAX_UPLOAD_SIZE_MB} MB`}
                  </p>
                </div>
              )}

              {rejectedErrors.length > 0 && (
                <div className="space-y-1">
                  {rejectedErrors.map((msg, i) => (
                    <p key={i} className="text-xs text-red-600 dark:text-red-400">
                      {msg}
                    </p>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ── Scan: Detecting ── */}
          {phase === 'scan-detecting' && (
            <motion.div
              key="scan-detecting"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-4 py-12"
            >
              <svg className="animate-spin h-10 w-10 text-brand" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-base font-semibold text-foreground">Scanning outfit...</p>
              <p className="text-sm text-muted text-center">AI is detecting each garment in your photo. This may take a moment.</p>
            </motion.div>
          )}

          {/* ── Scan: Review detected items ── */}
          {phase === 'scan-review' && scanImageUrl && (
            <motion.div
              key="scan-review"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Detected {detectedItems.length} item{detectedItems.length !== 1 ? 's' : ''}
                </h2>
                <p className="text-sm text-muted mt-1">
                  Select the items you want to add to your closet. Each will be cropped and uploaded separately.
                </p>
              </div>

              {/* Original image with bounding boxes */}
              <div className="relative w-full aspect-[3/4] max-w-sm mx-auto rounded-2xl overflow-hidden bg-surface-raised">
                <Image
                  src={scanImageUrl}
                  alt="Scanned outfit"
                  fill
                  className="object-contain"
                  unoptimized
                />
               {/* Bounding box overlays — draggable & resizable */}
                {detectedItems.map((item, i) => (
                  <div
                    key={i}
                    className={[
                      'absolute border-2 rounded cursor-move select-none',
                      item.selected
                        ? 'border-brand bg-brand/10'
                        : 'border-muted/40 bg-black/10 opacity-50',
                    ].join(' ')}
                    style={{
                      left: `${item.bbox.x * 100}%`,
                      top: `${item.bbox.y * 100}%`,
                      width: `${item.bbox.width * 100}%`,
                      height: `${item.bbox.height * 100}%`,
                      touchAction: 'none',
                    }}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).dataset.resize) return
                      e.preventDefault()
                      e.stopPropagation()
                      const container = (e.currentTarget.parentElement as HTMLElement)
                      const rect = container.getBoundingClientRect()
                      const startX = e.clientX
                      const startY = e.clientY
                      const origBbox = { ...item.bbox }

                      function onMove(ev: PointerEvent) {
                        const dx = (ev.clientX - startX) / rect.width
                        const dy = (ev.clientY - startY) / rect.height
                        const newX = Math.max(0, Math.min(1 - origBbox.width, origBbox.x + dx))
                        const newY = Math.max(0, Math.min(1 - origBbox.height, origBbox.y + dy))
                        setDetectedItems(prev => prev.map((it, idx) =>
                          idx === i ? { ...it, bbox: { ...it.bbox, x: newX, y: newY } } : it
                        ))
                      }
                      function onUp() {
                        window.removeEventListener('pointermove', onMove)
                        window.removeEventListener('pointerup', onUp)
                      }
                      window.addEventListener('pointermove', onMove)
                      window.addEventListener('pointerup', onUp)
                    }}
                  >
                    {/* Label */}
                    <span
                      className={[
                        'absolute -top-5 left-0 text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap cursor-pointer',
                        item.selected ? 'bg-brand text-brand-foreground' : 'bg-muted/60 text-foreground',
                      ].join(' ')}
                      onClick={() => toggleDetectedItem(i)}
                    >
                      {i + 1}. {item.label}
                    </span>
                    {/* Toggle select on tap */}
                    <div
                      className="absolute inset-0"
                      onDoubleClick={() => toggleDetectedItem(i)}
                    />
                    {/* Resize handle — bottom right corner */}
                    <div
                      data-resize="true"
                      className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-brand rounded-full cursor-nwse-resize border-2 border-white shadow"
                      onPointerDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const container = (e.currentTarget.parentElement?.parentElement as HTMLElement)
                        const rect = container.getBoundingClientRect()
                        const startX = e.clientX
                        const startY = e.clientY
                        const origBbox = { ...item.bbox }

                        function onMove(ev: PointerEvent) {
                          const dx = (ev.clientX - startX) / rect.width
                          const dy = (ev.clientY - startY) / rect.height
                          const newW = Math.max(0.05, Math.min(1 - origBbox.x, origBbox.width + dx))
                          const newH = Math.max(0.05, Math.min(1 - origBbox.y, origBbox.height + dy))
                          setDetectedItems(prev => prev.map((it, idx) =>
                            idx === i ? { ...it, bbox: { ...it.bbox, width: newW, height: newH } } : it
                          ))
                        }
                        function onUp() {
                          window.removeEventListener('pointermove', onMove)
                          window.removeEventListener('pointerup', onUp)
                        }
                        window.addEventListener('pointermove', onMove)
                        window.addEventListener('pointerup', onUp)
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Item list */}
              <div className="space-y-2">
                {detectedItems.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDetectedItem(i)}
                    className={[
                      'w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left',
                      item.selected
                        ? 'border-brand bg-brand/5'
                        : 'border-border bg-surface opacity-60',
                    ].join(' ')}
                  >
                    <div className={[
                      'w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0',
                      item.selected ? 'border-brand bg-brand' : 'border-border',
                    ].join(' ')}>
                      {item.selected && (
                        <svg className="w-3.5 h-3.5 text-brand-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted">{item.category}</p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Crop ── */}
          {phase === 'crop' && cropIndex !== null && entries[cropIndex] && (
            <motion.div
              key={`crop-${cropIndex}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">
                  Crop image {cropIndex + 1} of {entries.length}
                </h2>
                <span className="text-xs text-muted">
                  {entries[cropIndex].file.name}
                </span>
              </div>
              <p className="text-sm text-muted">
                Crop to focus on the garment, or skip to use the full image.
              </p>
              <ImageCropper
                imageUrl={entries[cropIndex].previewUrl}
                onCropDone={handleCropDone}
                onCancel={handleSkipCrop}
              />
            </motion.div>
          )}

          {/* ── Preview ── */}
          {phase === 'preview' && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <h2 className="text-base font-semibold text-foreground">
                Ready to upload
              </h2>
              <p className="text-sm text-muted">
                {entries.length} item{entries.length !== 1 ? 's' : ''} selected. Tap &quot;Upload&quot; to process them with AI background removal and tagging.
              </p>

              <div className="grid grid-cols-2 gap-3">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="relative rounded-xl overflow-hidden border border-border bg-surface aspect-[3/4]"
                  >
                    <Image
                      src={entry.previewUrl}
                      alt={entry.file.name}
                      fill
                      className="object-cover"
                    />
                    {entry.croppedFile && (
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-brand/80 text-[10px] text-white font-medium">
                        Cropped
                      </div>
                    )}
                    <button
                      onClick={() => removeEntry(entry.id)}
                      aria-label={`Remove ${entry.file.name}`}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-2">
                      <p className="text-xs text-white truncate">{entry.file.name}</p>
                    </div>
                  </div>
                ))}
              </div>

              {rejectedErrors.length > 0 && (
                <div className="space-y-1">
                  {rejectedErrors.map((msg, i) => (
                    <p key={i} className="text-xs text-red-600 dark:text-red-400">
                      {msg}
                    </p>
                  ))}
                </div>
              )}

              {/* Hidden dropzone input for "Add more" */}
              <div {...getRootProps()} className="hidden">
                <input {...getInputProps()} />
              </div>
            </motion.div>
          )}

          {/* ── Uploading ── */}
          {phase === 'uploading' && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="text-base font-semibold text-foreground mb-1">
                Processing your items...
              </h2>
              <p className="text-sm text-muted mb-4">
                Removing backgrounds and tagging with AI. This may take a moment.
              </p>
              <UploadProgress
                items={entries.map((e) => ({
                  file: e.croppedFile ?? e.file,
                  previewUrl: e.previewUrl,
                  stage: e.stage,
                  progress: e.progress,
                  error: e.error,
                }))}
              />
            </motion.div>
          )}

          {/* ── Review ── */}
          {phase === 'review' && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div>
                <h2 className="text-base font-semibold text-foreground">Review &amp; save</h2>
                <p className="text-sm text-muted mt-1">
                  AI has tagged your items. Edit anything that looks wrong, then save.
                </p>
              </div>
              {entries.map((entry) => {
                if (entry.stage === 'error') {
                  return (
                    <div
                      key={entry.id}
                      className="bg-surface rounded-xl border border-border p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-surface-raised">
                          <Image
                            src={entry.previewUrl}
                            alt={entry.file.name}
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground truncate">
                            {entry.file.name}
                          </p>
                          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                            {entry.error ?? 'Upload failed'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                }

                if (!entry.editedTags) return null
                const t = entry.editedTags

                return (
                  <div
                    key={entry.id}
                    className={[
                      'bg-surface rounded-xl border p-4 space-y-4',
                      entry.saved ? 'border-green-500/50' : 'border-border',
                    ].join(' ')}
                  >
                    {/* Header */}
                    <div className="flex items-center gap-3">
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-surface-raised">
                        <Image
                          src={entry.previewUrl}
                          alt={entry.file.name}
                          fill
                          className="object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted truncate">{entry.file.name}</p>
                        {entry.saved && (
                          <p className="text-xs text-green-600 dark:text-green-400 font-medium mt-0.5">
                            Saved
                          </p>
                        )}
                      </div>
                    </div>

                    {!entry.saved && (
                      <>
                        {/* Name */}
                        <Input
                          label="Name"
                          value={t.name}
                          onChange={(e) => updateEditedTags(entry.id, { name: e.target.value })}
                        />

                        {/* Category */}
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-foreground">
                            Category
                          </label>
                          <select
                            value={t.category}
                            onChange={(e) =>
                              updateEditedTags(entry.id, {
                                category: e.target.value as GarmentCategory,
                              })
                            }
                            className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Primary colour */}
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-foreground">
                            Primary colour
                          </label>
                          <ColorPicker
                            value={t.color_primary}
                            onChange={(v) => updateEditedTags(entry.id, { color_primary: v })}
                          />
                        </div>

                        {/* Secondary colour */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="block text-sm font-medium text-foreground">
                              Secondary colour
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                updateEditedTags(entry.id, {
                                  color_secondary: t.color_secondary ? null : '#ffffff',
                                })
                              }
                              className="text-xs text-brand hover:underline"
                            >
                              {t.color_secondary ? 'Remove' : 'Add'}
                            </button>
                          </div>
                          {t.color_secondary !== null && (
                            <ColorPicker
                              value={t.color_secondary}
                              onChange={(v) =>
                                updateEditedTags(entry.id, { color_secondary: v })
                              }
                            />
                          )}
                        </div>

                        {/* Fabric */}
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-foreground">
                            Fabric
                          </label>
                          <select
                            value={t.fabric ?? ''}
                            onChange={(e) =>
                              updateEditedTags(entry.id, {
                                fabric: e.target.value
                                  ? (e.target.value as GarmentFabric)
                                  : null,
                              })
                            }
                            className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                          >
                            <option value="">Unknown</option>
                            {FABRICS.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Vibe */}
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-foreground">
                            Vibe{' '}
                            <span className="text-muted font-normal">(pick up to 3)</span>
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {VIBES.map((v) => {
                              const checked = t.vibe.includes(v as GarmentVibe)
                              const atMax = t.vibe.length >= 3 && !checked
                              return (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => {
                                    if (checked) {
                                      updateEditedTags(entry.id, {
                                        vibe: t.vibe.filter((x) => x !== v),
                                      })
                                    } else if (!atMax) {
                                      updateEditedTags(entry.id, {
                                        vibe: [...t.vibe, v as GarmentVibe],
                                      })
                                    }
                                  }}
                                  aria-pressed={checked}
                                  className={[
                                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                                    checked
                                      ? 'bg-brand text-brand-foreground border-brand'
                                      : 'bg-surface border-border text-foreground hover:bg-surface-raised',
                                    atMax ? 'opacity-40 cursor-not-allowed' : '',
                                  ].join(' ')}
                                >
                                  {v}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Warmth level */}
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-foreground">
                            Warmth level
                          </label>
                          <div className="space-y-1.5">
                            {WARMTH_LEVELS.map((wl) => (
                              <label
                                key={wl.value}
                                className="flex items-start gap-2.5 cursor-pointer"
                              >
                                <input
                                  type="radio"
                                  name={`warmth-${entry.id}`}
                                  value={wl.value}
                                  checked={t.warmth_level === wl.value}
                                  onChange={() =>
                                    updateEditedTags(entry.id, { warmth_level: wl.value })
                                  }
                                  className="mt-0.5 accent-brand"
                                />
                                <span className="text-sm">
                                  <span className="font-medium text-foreground">{wl.label}</span>
                                  <span className="text-muted"> — {wl.example}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Purchase price */}
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-foreground">
                            Purchase price
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={t.purchase_price || ''}
                              placeholder="0.00"
                              onChange={(e) =>
                                updateEditedTags(entry.id, {
                                  purchase_price: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full pl-7 pr-3 py-2.5 rounded-xl border border-border bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                            />
                          </div>
                        </div>

                        {/* Maintenance cost */}
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-foreground">
                            Maintenance cost
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={t.maintenance_cost || ''}
                              placeholder="0.00"
                              onChange={(e) =>
                                updateEditedTags(entry.id, {
                                  maintenance_cost: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full pl-7 pr-3 py-2.5 rounded-xl border border-border bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                            />
                          </div>
                        </div>

                        {/* Save */}
                        <Button
                          variant="primary"
                          className="w-full"
                          onClick={() => saveEntry(entry)}
                          disabled={t.vibe.length === 0}
                        >
                          Save to closet
                        </Button>
                      </>
                    )}
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sticky bottom bar — sits above BottomNav (h-16 = 4rem) */}
      <div className="fixed bottom-16 left-0 right-0 z-40 bg-background border-t border-border px-4 py-3">
        {phase === 'scan-review' && (
          <div className="flex gap-3">
            <Button variant="ghost" size="md" className="shrink-0" onClick={handleReset}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              onClick={handleScanConfirm}
              disabled={detectedItems.filter((d) => d.selected).length === 0}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload {detectedItems.filter((d) => d.selected).length} item{detectedItems.filter((d) => d.selected).length !== 1 ? 's' : ''}
            </Button>
          </div>
        )}
        {phase === 'preview' && (
          <div className="flex gap-3">
            {mode === 'single' && (
              <Button variant="ghost" size="md" className="shrink-0" onClick={open}>
                Add more
              </Button>
            )}
            <Button variant="primary" size="md" className="flex-1" onClick={uploadAll}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload {entries.length} item{entries.length !== 1 ? 's' : ''}
            </Button>
          </div>
        )}
        {phase === 'review' && (
          <Button
            variant="primary"
            size="md"
            className="w-full"
            disabled={!allSavedOrSkipped}
            onClick={() => router.push('/closet')}
          >
            Done
          </Button>
        )}
        {phase === 'dropzone' && (
          <Button
            variant="ghost"
            size="md"
            className="w-full"
            onClick={() => router.push('/closet')}
          >
            Cancel
          </Button>
        )}
        {(phase === 'uploading' || phase === 'scan-detecting') && (
          <div className="flex items-center justify-center gap-2 py-1">
            <svg className="animate-spin h-4 w-4 text-brand" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-sm text-muted">Processing...</span>
          </div>
        )}
      </div>
    </div>
  )
}
