import { z } from 'zod'
import { ExternalServiceError } from '../errors'

export type LinkedInCredentials = { accessToken: string; personUrn: string }

export const LINKEDIN_API_URL = 'https://api.linkedin.com'
const LINKEDIN_VERSION = '202508'

export const escapeLittleText = (text: string): string =>
  text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`)

const restHeaders = (creds: LinkedInCredentials): Record<string, string> => ({
  authorization: `Bearer ${creds.accessToken}`,
  'content-type': 'application/json',
  'linkedin-version': LINKEDIN_VERSION,
  'x-restli-protocol-version': '2.0.0',
})

const uploadSchema = z.object({ value: z.object({ uploadUrl: z.string(), image: z.string() }) })

export async function uploadLinkedInImage(
  image: Uint8Array,
  creds: LinkedInCredentials,
  baseUrl: string = LINKEDIN_API_URL,
): Promise<string> {
  const started = await fetch(`${baseUrl}/rest/images?action=initializeUpload`, {
    method: 'POST',
    headers: restHeaders(creds),
    body: JSON.stringify({ initializeUploadRequest: { owner: creds.personUrn } }),
  })
  const body = await started.text()
  if (!started.ok) {
    throw new ExternalServiceError('linkedin', started.status, body)
  }
  const parsed = uploadSchema.safeParse(JSON.parse(body))
  if (!parsed.success) {
    throw new ExternalServiceError('linkedin', started.status, `upload without url: ${body}`)
  }
  const put = await fetch(parsed.data.value.uploadUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${creds.accessToken}`,
      'content-type': 'application/octet-stream',
    },
    body: image,
  })
  if (!put.ok) {
    throw new ExternalServiceError('linkedin', put.status, await put.text())
  }
  return parsed.data.value.image
}

export async function postToLinkedIn(
  text: string,
  image: Uint8Array,
  creds: LinkedInCredentials,
  baseUrl: string = LINKEDIN_API_URL,
): Promise<string> {
  const imageUrn = await uploadLinkedInImage(image, creds, baseUrl)
  const res = await fetch(`${baseUrl}/rest/posts`, {
    method: 'POST',
    headers: restHeaders(creds),
    body: JSON.stringify({
      author: creds.personUrn,
      commentary: escapeLittleText(text),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: { media: { id: imageUrn, altText: 'Runway equity over time' } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  })
  if (!res.ok) {
    throw new ExternalServiceError('linkedin', res.status, await res.text())
  }
  const id = res.headers.get('x-restli-id')
  if (id === null) {
    throw new ExternalServiceError('linkedin', res.status, 'response without x-restli-id')
  }
  return id
}
