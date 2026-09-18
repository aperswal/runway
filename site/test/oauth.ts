import { oauthSignature, type OauthSecrets } from '../src/social/x'
export const oauthParams = (header: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (header ?? '')
      .replace(/^OAuth /, '')
      .split(', ')
      .map((pair) => {
        const [key, value] = pair.split('=')
        return [
          decodeURIComponent(key ?? ''),
          decodeURIComponent((value ?? '').replaceAll('"', '')),
        ]
      }),
  )

export async function oauthSignatureMatches(
  header: string | undefined,
  url: string,
  secrets: OauthSecrets,
): Promise<boolean> {
  const { oauth_signature: signature, ...params } = oauthParams(header)
  return (await oauthSignature('POST', url, params, secrets)) === signature
}
