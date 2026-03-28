'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { ReferencePhotoUpload } from '@/features/tryon/ReferencePhotoUpload'
import { useGarments } from '@/hooks/useGarments'
import { useGenerateVTO } from '@/hooks/useVTO'
import { useAuthStore } from '@/stores/authStore'
import { createClient } from '@/lib/supabase/client'
import type { Garment, GarmentCategory } from '@/lib/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VTO_CATEGORIES: GarmentCategory[] = ['Top', 'Bottom', 'Dress', 'Outerwear']
const MAX_REFERENCE_PHOTOS = 2
const PROGRESS_MESSAGES = [
  'Uploading...',
  'Processing...',
  'Generating try-on...',
  'Almost done...',
]

function getVtoStorageKey(userId: string): string {
  return `vto_reference_photo_paths_${userId}`
}

function loadStoredPhotos(userId: string | undefined): string[] {
  if (typeof window === 'undefined' || !userId) return []
  try {
    const raw = localStorage.getItem(getVtoStorageKey(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) {
      return parsed as string[]
    }
  } catch {
    // corrupted — ignore
  }
  return []
}

function saveStoredPhotos(userId: string | undefined, paths: string[]): void {
  if (typeof window === 'undefined' || !userId) return
  if (paths.length === 0) {
    localStorage.removeItem(getVtoStorageKey(userId))
  } else {
    localStorage.setItem(getVtoStorageKey(userId), JSON.stringify(paths))
  }
}

// ---------------------------------------------------------------------------
// GarmentThumb
// ---------------------------------------------------------------------------

interface GarmentThumbProps {
  garment: Garment
  isSelected: boolean
  onSelect: () => void
}

const supabase = createClient()

function GarmentThumb({ garment, isSelected, onSelect }: GarmentThumbProps) {
  const { data: { publicUrl } } = supabase.storage
    .from('garments')
    .getPublicUrl(garment.thumb_path)
  const thumbUrl = `${publicUrl}?width=160&height=192&resize=cover`

  return (
    <button
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-label={`Select ${garment.name}`}
      className={[
        'relative shrink-0 w-20 rounded-xl overflow-hidden border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        isSelected ? 'border-brand' : 'border-transparent',
      ].join(' ')}
    >
      <div className="relative aspect-[3/4] bg-surface-raised">
        <Image
          src={thumbUrl}
          alt={garment.name}
          fill
          sizes="80px"
          className="object-cover"
          unoptimized
        />
      </div>

      {/* Checkmark overlay */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            key="check"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-brand/20 flex items-start justify-end p-1"
          >
            <div className="w-5 h-5 rounded-full bg-brand flex items-center justify-center">
              <svg className="w-3 h-3 text-brand-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Name label */}
      <div className="px-1 py-1 bg-surface">
        <p className="text-[10px] text-foreground truncate leading-tight">{garment.name}</p>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// ExistingReferencePhoto
// ---------------------------------------------------------------------------

interface ExistingReferencePhotoProps {
  path: string
  index: number
  onRemove: () => void
}

function ExistingReferencePhoto({ path, index, onRemove }: ExistingReferencePhotoProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)

  useEffect(() => {
    supabase.storage
      .from('vto-results')
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) {
          // File no longer exists in storage — mark as stale
          setIsStale(true)
        } else {
          setSignedUrl(data.signedUrl)
        }
      })
  }, [path])

  // Auto-remove stale paths
  useEffect(() => {
    if (isStale) onRemove()
  }, [isStale, onRemove])

  if (isStale) return null

  return (
    <div className="flex gap-3 items-center p-3 rounded-xl bg-surface-raised border border-border">
      <div className="relative w-14 h-18 rounded-lg overflow-hidden bg-surface shrink-0">
        {signedUrl ? (
          <Image src={signedUrl} alt={`Reference photo ${index + 1}`} fill className="object-cover" unoptimized />
        ) : (
          <div className="w-full h-full animate-pulse bg-surface" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Photo {index + 1}</p>
        <p className="text-xs text-muted mt-0.5">Reference photo ready</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="shrink-0">
        Remove
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GenerationJobProgress
// ---------------------------------------------------------------------------

interface GenerationJob {
  garmentId: string
  garmentName: string
  photoIndex: number
  status: 'pending' | 'generating' | 'done' | 'error'
  error?: string
}

function GenerationJobProgress({ jobs }: { jobs: GenerationJob[] }) {
  const [progressIdx, setProgressIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setProgressIdx((i) => (i + 1) % PROGRESS_MESSAGES.length)
    }, 3000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-col gap-3">
      {jobs.map((job, i) => (
        <div
          key={`${job.garmentId}-${job.photoIndex}`}
          className="flex items-center gap-3 p-3 rounded-xl bg-surface-raised border border-border"
        >
          {/* Status icon */}
          <div className="w-8 h-8 shrink-0 flex items-center justify-center">
            {job.status === 'generating' && (
              <svg className="animate-spin h-5 w-5 text-brand" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {job.status === 'done' && (
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
            {job.status === 'error' && (
              <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            )}
            {job.status === 'pending' && (
              <div className="w-6 h-6 rounded-full bg-surface border-2 border-border" />
            )}
          </div>

          {/* Label */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {job.garmentName}
              {jobs.some((j) => j.photoIndex !== jobs[0].photoIndex) && (
                <span className="text-muted font-normal"> · Photo {job.photoIndex + 1}</span>
              )}
            </p>
            {job.status === 'generating' && (
              <AnimatePresence mode="wait">
                <motion.p
                  key={progressIdx}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-muted"
                >
                  {PROGRESS_MESSAGES[progressIdx]}
                </motion.p>
              </AnimatePresence>
            )}
            {job.status === 'error' && (
              <p className="text-xs text-red-500">{job.error ?? 'Generation failed'}</p>
            )}
          </div>

          {/* Job number */}
          <span className="text-xs text-muted shrink-0">{i + 1}/{jobs.length}</span>
        </div>
      ))}
      <p className="text-xs text-muted text-center">Each generation may take 30–90 seconds</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// VTOGenerator
// ---------------------------------------------------------------------------

interface VTOGeneratorProps {
  onSuccess?: () => void
}

export function VTOGenerator({ onSuccess }: VTOGeneratorProps) {
  const user = useAuthStore((s) => s.user)
  const userId = user?.id

  const [selectedCategory, setSelectedCategory] = useState<GarmentCategory | undefined>(undefined)
  const [selectedGarmentIds, setSelectedGarmentIds] = useState<string[]>([])
  const [referencePhotoPaths, setReferencePhotoPaths] = useState<string[]>(() =>
    loadStoredPhotos(userId)
  )
  const [generationJobs, setGenerationJobs] = useState<GenerationJob[]>([])
  const [isGenerating, setIsGenerating] = useState(false)

  const { data, isLoading: garmentsLoading } = useGarments({
    category: selectedCategory,
    limit: 50,
  })
  // Only show VTO-compatible categories (upper-body garments)
  const garments = (data?.garments ?? []).filter(
    (g) => selectedCategory || VTO_CATEGORIES.includes(g.category)
  )
  const generateMutation = useGenerateVTO()

  // Reload stored photos when user changes
  useEffect(() => {
    setReferencePhotoPaths(loadStoredPhotos(userId))
    setSelectedGarmentIds([])
    setGenerationJobs([])
  }, [userId])

  const handleUploadComplete = useCallback((path: string) => {
    setReferencePhotoPaths((prev) => {
      const updated = [...prev, path].slice(0, MAX_REFERENCE_PHOTOS)
      saveStoredPhotos(userId, updated)
      return updated
    })
  }, [userId])

  function removePhoto(index: number) {
    setReferencePhotoPaths((prev) => {
      const updated = prev.filter((_, i) => i !== index)
      saveStoredPhotos(userId, updated)
      return updated
    })
  }

  function toggleGarment(garmentId: string) {
    setSelectedGarmentIds((prev) =>
      prev.includes(garmentId)
        ? prev.filter((id) => id !== garmentId)
        : [...prev, garmentId]
    )
  }

  async function handleGenerate() {
    if (selectedGarmentIds.length === 0 || referencePhotoPaths.length === 0) return

    // Build job list: each garment x each photo
    const jobs: GenerationJob[] = []
    for (const garmentId of selectedGarmentIds) {
      const garment = garments.find((g) => g.id === garmentId)
      for (let photoIdx = 0; photoIdx < referencePhotoPaths.length; photoIdx++) {
        jobs.push({
          garmentId,
          garmentName: garment?.name ?? 'Unknown',
          photoIndex: photoIdx,
          status: 'pending',
        })
      }
    }
    setGenerationJobs(jobs)
    setIsGenerating(true)

    // Process sequentially to avoid rate limits
    for (let i = 0; i < jobs.length; i++) {
      setGenerationJobs((prev) =>
        prev.map((j, idx) => (idx === i ? { ...j, status: 'generating' } : j))
      )
      try {
        await generateMutation.mutateAsync({
          garment_id: jobs[i].garmentId,
          source_photo_path: referencePhotoPaths[jobs[i].photoIndex],
        })
        setGenerationJobs((prev) =>
          prev.map((j, idx) => (idx === i ? { ...j, status: 'done' } : j))
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed'
        setGenerationJobs((prev) =>
          prev.map((j, idx) => (idx === i ? { ...j, status: 'error', error: errorMsg } : j))
        )
        // If reference photo not found, remove the stale path
        if (errorMsg.toLowerCase().includes('reference photo not found') || errorMsg.toLowerCase().includes('object not found')) {
          const stalePhotoIdx = jobs[i].photoIndex
          setReferencePhotoPaths((prev) => {
            const updated = prev.filter((_, idx) => idx !== stalePhotoIdx)
            saveStoredPhotos(userId, updated)
            return updated
          })
        }
      }
    }

    setIsGenerating(false)
    onSuccess?.()
  }

  const totalJobs = selectedGarmentIds.length * referencePhotoPaths.length
  const canGenerate = selectedGarmentIds.length > 0 && referencePhotoPaths.length > 0 && !isGenerating

  return (
    <div className="flex flex-col gap-8">

      {/* -- Step 1: Garment selector -- */}
      <section aria-labelledby="vto-step1-heading">
        <h2 id="vto-step1-heading" className="text-sm font-semibold text-foreground mb-1">
          1. Choose garments
        </h2>
        <p className="text-xs text-muted mb-3">Tops, bottoms, dresses, and outerwear · select multiple</p>

        {/* Category filter chips */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setSelectedCategory(undefined)}
            className={[
              'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              !selectedCategory
                ? 'bg-brand text-brand-foreground'
                : 'bg-surface-raised text-muted hover:text-foreground border border-border',
            ].join(' ')}
          >
            All
          </button>
          {VTO_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === selectedCategory ? undefined : cat)}
              className={[
                'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                selectedCategory === cat
                  ? 'bg-brand text-brand-foreground'
                  : 'bg-surface-raised text-muted hover:text-foreground border border-border',
              ].join(' ')}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Selection count */}
        {selectedGarmentIds.length > 0 && (
          <p className="text-xs text-brand font-medium mb-2">
            {selectedGarmentIds.length} garment{selectedGarmentIds.length !== 1 ? 's' : ''} selected
          </p>
        )}

        {/* Horizontal garment scroll */}
        {garmentsLoading ? (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: 'none' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width={80} height={112} className="rounded-xl shrink-0" />
            ))}
          </div>
        ) : garments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 rounded-2xl bg-surface-raised border border-border text-center">
            <p className="text-sm text-muted">No garments found</p>
            <Link href="/closet/upload" className="text-xs text-brand underline-offset-2 hover:underline">
              Add some to your wardrobe
            </Link>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: 'none' }}>
            {garments.map((garment) => (
              <GarmentThumb
                key={garment.id}
                garment={garment}
                isSelected={selectedGarmentIds.includes(garment.id)}
                onSelect={() => toggleGarment(garment.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* -- Step 2: Reference photos -- */}
      <section aria-labelledby="vto-step2-heading">
        <h2 id="vto-step2-heading" className="text-sm font-semibold text-foreground mb-1">
          2. Your reference photos (up to {MAX_REFERENCE_PHOTOS})
        </h2>
        <p className="text-xs text-muted mb-3">
          Full-body photos of yourself for the AI to dress you
        </p>

        <div className="flex flex-col gap-3">
          {/* Existing photos */}
          {referencePhotoPaths.map((path, idx) => (
            <ExistingReferencePhoto
              key={path}
              path={path}
              index={idx}
              onRemove={() => removePhoto(idx)}
            />
          ))}

          {/* Upload another if under limit */}
          {referencePhotoPaths.length < MAX_REFERENCE_PHOTOS && userId && (
            <ReferencePhotoUpload
              userId={userId}
              onUploadComplete={handleUploadComplete}
            />
          )}
        </div>
      </section>

      {/* -- Step 3: Generate -- */}
      <section aria-labelledby="vto-step3-heading">
        <h2 id="vto-step3-heading" className="text-sm font-semibold text-foreground mb-3">
          3. Generate try-on{totalJobs > 1 ? 's' : ''}
        </h2>

        {isGenerating ? (
          <GenerationJobProgress jobs={generationJobs} />
        ) : generationJobs.length > 0 && generationJobs.every((j) => j.status === 'done' || j.status === 'error') ? (
          /* Post-generation summary */
          <div className="flex flex-col gap-3">
            <GenerationJobProgress jobs={generationJobs} />
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setGenerationJobs([])
                setSelectedGarmentIds([])
              }}
              className="w-full"
            >
              Start new try-on
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              size="lg"
              disabled={!canGenerate}
              onClick={handleGenerate}
              className="w-full"
            >
              Generate {totalJobs > 0 ? `${totalJobs} ` : ''}Try-On{totalJobs !== 1 ? 's' : ''}
            </Button>
            {totalJobs > 1 && (
              <p className="text-xs text-muted text-center">
                {totalJobs} combinations ({selectedGarmentIds.length} garment{selectedGarmentIds.length !== 1 ? 's' : ''} x {referencePhotoPaths.length} photo{referencePhotoPaths.length !== 1 ? 's' : ''})
              </p>
            )}
            <p className="text-xs text-muted text-center">Each may take 30–90 seconds</p>
          </div>
        )}
      </section>
    </div>
  )
}
