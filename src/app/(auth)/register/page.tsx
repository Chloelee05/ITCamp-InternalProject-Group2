'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function RegisterPage() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // const [googleLoading, setGoogleLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  // const [devMode, setDevMode] = useState(false)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // SANITIZE INPUTS
      const sanitizedEmail = email.trim().toLowerCase()
      const sanitizedPassword = password.trim()
      const sanitizedName = displayName.trim()

      // VALIDATE
      if (sanitizedName.length < 2) {
        throw new Error('Name must be at least 2 characters')
      }
      if (sanitizedName.length > 100) {
        throw new Error('Name must be less than 100 characters')
      }
      if (sanitizedPassword.length < 8) {
        throw new Error('Password must be at least 8 characters')
      }
      // if (devMode) {
      //   // Dev mode: server uses service role to create user with email pre-confirmed
      //   const res = await fetch('/api/dev/register', {
      //     method: 'POST',
      //     headers: { 'Content-Type': 'application/json' },
      //     body: JSON.stringify({
      //       email: sanitizedEmail,
      //       password: sanitizedPassword,
      //       display_name: sanitizedName,
      //     }),
      //   })
      //   const json = (await res.json()) as { error?: string }
      //   if (!res.ok) throw new Error(json.error ?? 'Registration failed')
      //   // Sign in immediately since email is already confirmed
      //   const supabase = createClient()
      //   const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      //   if (signInError) throw signInError
      //   router.push('/closet')
      //   router.refresh()}
      else {
        const supabase = createClient()
        const { data, error: authError } = await supabase.auth.signUp({
          email: sanitizedEmail,
          password: sanitizedPassword,
          options: { data: { display_name: sanitizedName } },
        })
        if (authError) throw authError
        // If session is null, email confirmation is required
        if (!data.session) {
          setEmailSent(true)
        } else {
          router.push('/closet')
          router.refresh()
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }
  // //BROKEN Need to set up google cloud
  // async function handleGoogleLogin() {
  //   setError(null)
  //   setGoogleLoading(true)
  //   try {
  //     const supabase = createClient()
  //     const { error: authError } = await supabase.auth.signInWithOAuth({
  //       provider: 'google',
  //       options: {
  //         redirectTo: `${window.location.origin}/auth/callback`,
  //       },
  //     })
  //     if (authError) throw authError
  //   } catch (err) {
  //     setError(err instanceof Error ? err.message : 'Google sign in failed. Please try again.')
  //     setGoogleLoading(false)
  //   }
  // }

  if (emailSent) {
    return (
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 mb-4">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-green-600 dark:text-green-400"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Check your email</h2>
        <p className="text-sm text-muted mb-6">
          We sent a confirmation link to <strong className="text-foreground">{email}</strong>. Click
          the link to activate your account.
        </p>
        <Link href="/login" className="text-sm text-brand font-medium hover:underline">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-foreground mb-1">Create your account</h2>
      <p className="text-sm text-muted mb-6">Start building your digital wardrobe</p>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-950 dark:border-red-800 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleRegister} className="space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-foreground mb-1.5">
            Name
          </label>
          <input
            id="displayName"
            type="text"
            autoComplete="name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
          />
        </div>

        {/* <label className="flex items-center gap-2 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={devMode}
            onClick={() => setDevMode((v) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 ${devMode ? 'bg-amber-400' : 'bg-border'}`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${devMode ? 'translate-x-4' : 'translate-x-0'}`}
            />
          </button>
          <span className="text-xs text-muted">
            Dev mode{' '}
            <span className="text-amber-600 dark:text-amber-400">(skip email confirmation)</span>
          </span>
        </label> */}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 rounded-lg bg-brand text-white font-medium text-sm hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Creating account…
            </span>
          ) : (
            'Create account'
          )}
        </button>
      </form>

      {/* <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs text-muted">
          <span className="bg-surface px-2">or</span>
        </div>
      </div> */}

      {/* <button
        onClick={handleGoogleLogin}
        disabled={googleLoading}
        className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition"
      >
        {googleLoading ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
              fill="#4285F4"
            />
            <path
              d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
              fill="#34A853"
            />
            <path
              d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
              fill="#FBBC05"
            />
            <path
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
              fill="#EA4335"
            />
          </svg>
        )}
        Continue with Google
      </button> */}

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-brand font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </>
  )
}
