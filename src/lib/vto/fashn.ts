import { Client, handle_file } from '@gradio/client'
import { VTO_TIMEOUT_MS } from '@/lib/constants'

export class VTOError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VTOError'
  }
}

// ---------------------------------------------------------------------------
// Garment category → try-on mode mapping
// ---------------------------------------------------------------------------

export type VTOCategory = 'upper_body' | 'lower_body' | 'full_body'

const HF_SPACE_IDM_VTON = 'yisol/IDM-VTON'
const HF_SPACE_CATVTON = 'zhengchong/CatVTON'

// ---------------------------------------------------------------------------
// IDM-VTON — upper-body try-on (existing logic)
// ---------------------------------------------------------------------------

async function generateWithIDMVTON(
  modelImageUrl: string,
  garmentImageUrl: string,
): Promise<{ resultUrl: string; generationMs: number }> {
  const started = Date.now()

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new VTOError(`VTO timed out after ${VTO_TIMEOUT_MS}ms`)),
      VTO_TIMEOUT_MS,
    ),
  )

  const hfToken = process.env.HF_TOKEN
  const app = await Client.connect(HF_SPACE_IDM_VTON, {
    ...(hfToken ? { token: hfToken as `hf_${string}` } : {}),
  })

  const result = await Promise.race([
    app.predict('/tryon', [
      { background: handle_file(modelImageUrl), layers: [], composite: null },
      handle_file(garmentImageUrl),
      '',
      true,
      true,
      30,
      42,
    ]),
    timeout,
  ])

  const generationMs = Date.now() - started
  const data = result.data as unknown[]
  const outputEntry = data[0]

  let resultUrl: string | undefined
  if (outputEntry && typeof outputEntry === 'object' && 'url' in outputEntry) {
    resultUrl = (outputEntry as { url: string }).url
  } else if (typeof outputEntry === 'string') {
    resultUrl = outputEntry
  }

  if (!resultUrl) {
    throw new VTOError('No result image returned from IDM-VTON')
  }

  return { resultUrl, generationMs }
}

// ---------------------------------------------------------------------------
// CatVTON — supports upper, lower, and full body try-on
// ---------------------------------------------------------------------------

async function generateWithCatVTON(
  modelImageUrl: string,
  garmentImageUrl: string,
  clothType: 'upper' | 'lower' | 'overall',
): Promise<{ resultUrl: string; generationMs: number }> {
  const started = Date.now()

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new VTOError(`VTO timed out after ${VTO_TIMEOUT_MS}ms`)),
      VTO_TIMEOUT_MS,
    ),
  )

  const hfToken = process.env.HF_TOKEN
  const app = await Client.connect(HF_SPACE_CATVTON, {
    ...(hfToken ? { token: hfToken as `hf_${string}` } : {}),
  })

  const result = await Promise.race([
    app.predict('/submit', [
      handle_file(modelImageUrl),   // person image
      handle_file(garmentImageUrl), // garment image
      clothType,                    // "upper", "lower", or "overall"
      50,                           // num_inference_steps
      2.5,                          // guidance_scale
      42,                           // seed
      true,                         // show_type (return overlaid result)
    ]),
    timeout,
  ])

  const generationMs = Date.now() - started
  const data = result.data as unknown[]
  const outputEntry = data[0]

  let resultUrl: string | undefined
  if (outputEntry && typeof outputEntry === 'object' && 'url' in outputEntry) {
    resultUrl = (outputEntry as { url: string }).url
  } else if (typeof outputEntry === 'string') {
    resultUrl = outputEntry
  }

  if (!resultUrl) {
    throw new VTOError('No result image returned from CatVTON')
  }

  return { resultUrl, generationMs }
}

// ---------------------------------------------------------------------------
// Main entry point — routes to correct model based on category
// ---------------------------------------------------------------------------

export async function generateVTO(
  modelImageUrl: string,
  garmentImageUrl: string,
  category: VTOCategory = 'upper_body',
): Promise<{ resultUrl: string; generationMs: number }> {
  try {
    if (category === 'lower_body') {
      // Use CatVTON for lower body (pants, skirts, shorts)
      return await generateWithCatVTON(modelImageUrl, garmentImageUrl, 'lower')
    } else if (category === 'full_body') {
      // Use CatVTON for full body (dresses)
      return await generateWithCatVTON(modelImageUrl, garmentImageUrl, 'overall')
    } else {
      // Use IDM-VTON for upper body (tops, outerwear) — original behavior
      return await generateWithIDMVTON(modelImageUrl, garmentImageUrl)
    }
  } catch (err) {
    if (err instanceof VTOError) throw err
    throw new VTOError(
      err instanceof Error ? err.message : 'VTO generation failed',
    )
  }
}
