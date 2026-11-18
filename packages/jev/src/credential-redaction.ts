/** Credential masking for auxiliary tool evidence; original Session data is unchanged. */
import type { Json } from './types.ts'

export function redactCredentialText(value: string, secrets: readonly string[]): string {
  let text = value
  for (const secret of secrets) if (secret.length >= 4) text = text.replaceAll(secret, '[REDACTED]')
  return text
    .replace(/\b(Bearer|Basic)\s+[^\s"']+/gi, '$1 [REDACTED]')
    .replace(/\b(?:sk|key|token|apikey)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|auth[_-]?token)["']?)\s*[:=]\s*)(["'])(.*?)\2/gi, '$1$2[REDACTED]$2')
    .replace(/((?:["']?(?:password|passwd|authorization)["']?)\s*[:=]\s*)(?!["'])[^\r\n,;}\]]+/gi, '$1[REDACTED]')
    .replace(/((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|auth[_-]?token)["']?)\s*[:=]\s*)(?!["'])[^\s,"';}]+/gi, '$1[REDACTED]')
    .replace(/([?&#](?:api[_-]?key|access[_-]?token|refresh[_-]?token|key|token|secret|auth)\s*=)[^&#\s"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
}

/** Redact decoded strings so JSON escaping cannot hide credentials from the text rules. */
function redactArgumentValue(value: Json, secrets: readonly string[]): Json {
  if (typeof value === 'string') return redactCredentialText(value, secrets)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => redactArgumentValue(item, secrets))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactCredentialText(key, secrets),
    /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|auth[_-]?token)$/i.test(key)
      ? '[REDACTED]' : redactArgumentValue(item, secrets)]))
}

export function redactToolArguments(value: string, secrets: readonly string[] = []): { text: string; withheld: boolean } {
  try { return { text: JSON.stringify(redactArgumentValue(JSON.parse(value) as Json, secrets)), withheld: false } }
  // Interrupted calls can contain incomplete JSON. Do not dispatch undecodable credential text.
  catch { return { text: '[REDACTED: invalid JSON tool arguments]', withheld: true } }
}
