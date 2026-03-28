import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateSignedUrl, deleteStorageAsset } from '@/lib/storage'
import { vtoGenerateSchema } from '@/lib/validators'
import { generateVTO, VTOError } from '@/lib/vto/fashn'
import type { VTOResult, GarmentCategory } from '@/lib/types'
import type { VTOCategory } from '@/lib/vto/fashn'

// Map garment categories to VTO categories
function mapToVTOCategory(category: GarmentCategory): VTOCategory {
  switch (category) {
    case 'Bottom':
      return 'lower_body'
    case 'Dress':
      return 'full_body'
    case 'Top':
    case 'Outerwear':
    default:
      return 'upper_body'
  }
}

export async function POST(request: Request) {
  // 1. Auth
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Check VTO consent
  const { data: profile } = await supabase
    .from('users')
    .select('vto_consent')
    .eq('id', user.id)
    .single()

  if (!profile?.vto_consent) {
    return NextResponse.json(
      { error: 'VTO consent required' },
      { status: 403 },
    )
  }

  // 3. Parse and validate body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = vtoGenerateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { garment_id, source_photo_path } = parsed.data

  // 4. Fetch garment to get image_path AND category (also validates ownership via RLS)
  const { data: garment, error: garmentError } = await supabase
    .from('garments')
    .select('image_path, category')
    .eq('id', garment_id)
    .eq('user_id', user.id)
    .single()

  if (garmentError || !garment) {
    return NextResponse.json({ error: 'Garment not found' }, { status: 404 })
  }

  // 5. Generate signed URLs (both buckets are private)
  let modelSignedUrl: string
  let garmentSignedUrl: string
  try {
    modelSignedUrl = await generateSignedUrl('vto-results', source_photo_path, 300)
  } catch (err) {
    console.error('Reference photo signed URL error:', err, 'path:', source_photo_path)
    return NextResponse.json(
      { error: 'Reference photo not found. Please re-upload your reference photo.' },
      { status: 400 },
    )
  }
  try {
    garmentSignedUrl = await generateSignedUrl('garments', garment.image_path, 300)
  } catch (err) {
    console.error('Garment image signed URL error:', err, 'path:', garment.image_path)
    return NextResponse.json(
      { error: 'Garment image not found in storage.' },
      { status: 500 },
    )
  }

  // 6. Determine VTO category and call appropriate model
  const vtoCategory = mapToVTOCategory(garment.category as GarmentCategory)
  let resultUrl: string
  let generationMs: number
  try {
    ;({ resultUrl, generationMs } = await generateVTO(
      modelSignedUrl,
      garmentSignedUrl,
      vtoCategory,
    ))
  } catch (err) {
    console.error('VTO generation error:', err)
    if (err instanceof VTOError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    return NextResponse.json(
      { error: 'VTO generation failed' },
      { status: 500 },
    )
  }

  // 7. Download result image
  let resultBuffer: ArrayBuffer
  try {
    const res = await fetch(resultUrl)
    if (!res.ok) throw new Error(`Failed to download result: ${res.status}`)
    resultBuffer = await res.arrayBuffer()
  } catch (err) {
    console.error('Result download error:', err)
    return NextResponse.json(
      { error: 'Failed to download VTO result' },
      { status: 502 },
    )
  }

  // 8. Upload result to vto-results bucket
  const resultPath = `${user.id}/${crypto.randomUUID()}.png`
  const { error: uploadError } = await supabase.storage
    .from('vto-results')
    .upload(resultPath, resultBuffer, {
      contentType: 'image/png',
      upsert: false,
    })

  if (uploadError) {
    console.error('Result upload error:', uploadError)
    return NextResponse.json(
      { error: 'Failed to store VTO result' },
      { status: 500 },
    )
  }

  // 9. Insert vto_results row
  const apiProvider = vtoCategory === 'upper_body' ? 'idm-vton' : 'catvton'
  const { data: vtoResult, error: dbError } = await supabase
    .from('vto_results')
    .insert({
      user_id: user.id,
      garment_id,
      source_photo_path,
      result_path: resultPath,
      api_provider: apiProvider,
      generation_ms: generationMs,
    })
    .select()
    .single()

  if (dbError || !vtoResult) {
    console.error('DB insert error:', dbError)
    try {
      await deleteStorageAsset('vto-results', resultPath)
    } catch {
      // non-fatal
    }
    return NextResponse.json(
      { error: 'Failed to save VTO result' },
      { status: 500 },
    )
  }

  return NextResponse.json(
    { result: vtoResult as VTOResult },
    { status: 201 },
  )
}
