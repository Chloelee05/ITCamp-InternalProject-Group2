'use client'

import Link from 'next/link'
import PageHeader from '@/components/layout/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { VTOResultCard } from '@/features/tryon/VTOResultCard'
import { useVTOResults } from '@/hooks/useVTO'

export default function VTOGalleryPage() {
  const { data: results, isLoading, isError } = useVTOResults()

  return (
    <>
      <PageHeader title="My Try-Ons" showBack />

      <div
        className="px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+6rem)] max-w-lg mx-auto"
      >
        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={480} className="rounded-2xl" />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted">Failed to load your try-ons.</p>
            <Link
              href="/try-on"
              className="text-xs text-brand underline-offset-2 hover:underline"
            >
              Go back to Try-On
            </Link>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && results?.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface-raised flex items-center justify-center">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No try-ons yet</p>
              <p className="text-xs text-muted mt-1">Generate your first look to see it here</p>
            </div>
            <Link
              href="/try-on"
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-brand-foreground text-sm font-medium hover:bg-brand-hover transition-colors"
            >
              Generate your first look
            </Link>
          </div>
        )}

        {/* Results list */}
        {!isLoading && !isError && results && results.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {results.map((result) => (
              <VTOResultCard key={result.id} result={result} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
