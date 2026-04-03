import { Client, handle_file } from '@gradio/client'
import { VTO_TIMEOUT_MS } from '@/lib/constants'

export class VTOError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VTOError'
  }
}

export type VTOCategory = 'upper_body' | 'lower_body' | 'full_body'

const HF_SPACE_IDM_VTON = 'yisol/IDM-VTON'

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

async function downloadImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new VTOError(`Failed to download image: ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function generateWithOpenAI(
  modelImageUrl: string,
  garmentImageUrl: string,
  category: 'lower_body' | 'full_body',
): Promise<{ resultUrl: string; generationMs: number }> {
  const started = Date.now()

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new VTOError('OPENAI_API_KEY is not configured')
  }

  const [personBuffer, garmentBuffer] = await Promise.all([
    downloadImageBuffer(modelImageUrl),
    downloadImageBuffer(garmentImageUrl),
  ])

  const garmentType = category === 'lower_body' ? 'pants/bottoms/shorts/skirt' : 'dress/full outfit'
  const changeArea = category === 'lower_body'
    ? 'lower body clothing only (pants, shorts, or skirt area)'
    : 'the full outfit'

  const prompt = `Virtual try-on: Take the person from the first image and dress them in the ${garmentType} shown in the second image. Keep the person's face, body shape, pose, skin tone, and background exactly the same. Only change ${changeArea} to match the garment. The result must look like a natural, photorealistic photo.`

  const formData = new FormData()
  formData.append('model', 'gpt-image-1')
  formData.append('prompt', prompt)
  formData.append('n', '1')
  formData.append('size', '1024x1024')
  formData.append('quality', 'medium')

  const personBlob = new Blob([new Uint8Array(personBuffer)], { type: 'image/png' })
  const garmentBlob = new Blob([new Uint8Array(garmentBuffer)], { type: 'image/png' })
  formData.append('image[]', personBlob, 'person.png')
  formData.append('image[]', garmentBlob, 'garment.png')

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('OpenAI Images API error:', errorBody)
    throw new VTOError(`OpenAI API error: ${response.status} - ${errorBody}`)
  }

  const data = await response.json()
  const generationMs = Date.now() - started

  const imageData = data.data?.[0]

  if (imageData?.url) {
    return { resultUrl: imageData.url, generationMs }
  }

  if (imageData?.b64_json) {
    const dataUrl = `data:image/png;base64,${imageData.b64_json}`
    return { resultUrl: dataUrl, generationMs }
  }

  throw new VTOError('OpenAI did not return a try-on image.')
}

export async function generateVTO(
  modelImageUrl: string,
  garmentImageUrl: string,
  category: VTOCategory = 'upper_body',
): Promise<{ resultUrl: string; generationMs: number }> {
  try {
    if (category === 'lower_body' || category === 'full_body') {
      return await generateWithOpenAI(modelImageUrl, garmentImageUrl, category)
    } else {
      return await generateWithIDMVTON(modelImageUrl, garmentImageUrl)
    }
  } catch (err) {
    if (err instanceof VTOError) throw err
    throw new VTOError(
      err instanceof Error ? err.message : 'VTO generation failed',
    )
  }
}