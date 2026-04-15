'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'

interface ConsentModalProps {
  isOpen: boolean
  onConsent: () => void
}

export function ConsentModal({ isOpen, onConsent }: ConsentModalProps) {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAgree() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: dbError } = await supabase
        .from('users')
        .update({ vto_consent: true })
        .eq('id', user.id)
      if (dbError) throw dbError
      onConsent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleDecline() {
    router.push('/closet')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        // No-op — this modal requires an explicit choice.
        // dismissible={false} prevents overlay/Escape from firing onClose,
        // but we still need to provide a valid function signature.
      }}
      title="Enable Virtual Try-On"
      dismissible={false}
    >
      <div className="flex flex-col gap-5">
        {/* Icon */}
        <div className="flex items-center justify-center">
          <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-brand"
              aria-hidden="true"
            >
              <path d="M12 3c-1 0-2 .5-2 1.5S11 7 12 7s2-.5 2-1.5S13 3 12 3z" />
              <path d="M5 8l2 13h10l2-13" />
              <path d="M5 8c1-1 3-2 7-2s6 1 7 2" />
            </svg>
          </div>
        </div>

        {/* Explanation */}
        <div className="space-y-3 text-sm text-foreground/80">
          <p>
            Virtual Try-On lets you see how any garment looks on you using AI. To generate a try-on,
            this feature needs to send your reference photo to a third-party AI service.
          </p>

          <p>Here&apos;s what happens with your data:</p>

          <ul className="space-y-2 pl-1">
            {[
              'Your reference photo is transmitted to our third-party AI to generate the try-on composite.',
              'The generated result image is stored in your private Supabase Storage — only you can access it.',
              'Your reference photo is also stored privately and used only for try-on generation.',
              'You can delete any result and its associated photos at any time.',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <svg
                  className="w-4 h-4 mt-0.5 text-brand shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted">
            By enabling Try-On you consent to your reference photo being processed by our
            third-party AI in accordance with their privacy policy. You can withdraw consent at any
            time in Settings.
          </p>
        </div>

        {/* Error */}
        {error && (
          <p
            role="alert"
            className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2"
          >
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="primary"
            size="lg"
            loading={loading}
            onClick={handleAgree}
            className="w-full"
          >
            I agree, enable Try-On
          </Button>
          <Button
            variant="ghost"
            size="lg"
            disabled={loading}
            onClick={handleDecline}
            className="w-full"
          >
            No thanks
          </Button>
        </div>
      </div>
    </Modal>
  )
}
