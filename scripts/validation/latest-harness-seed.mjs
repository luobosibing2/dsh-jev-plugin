/** Freeze only the initial completion fixture; native supplemental work uses real Flash. */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'latest-harness-seed'
export const inject = ['llm']
export function apply(ctx) {
  let index = 0
  ctx.on('llm/stream', (options, next) => {
    if (options.provider !== 'deepseek-official' || options.model !== 'deepseek-flash') return next()
    const supplemented = (options.messages ?? []).some(message => message.source?.kind === 'jev-supervision' && message.source.action === 'supplement')
    if (supplemented) {
      appendFileSync(join(process.env.JEV_VALIDATION_CASE_ROOT, 'seed-delegation.jsonl'), JSON.stringify({ phase: 'real-Flash-supplement', messages: options.messages }) + '\n')
      return next()
    }
    const sequence = index++
    if (sequence > 1) throw new Error('Seed fixture received an unexpected request without a native supplement')
    const content = sequence === 0
      ? { type: 'tool-call', id: 'seed-write-summary', name: 'bash', arguments: JSON.stringify({ command: "printf 'ready\\n' > summary.txt && cat summary.txt", description: 'Create and verify the seeded summary.' }) }
      : { type: 'text', text: process.env.JEV_VALIDATION_SEED === 'accurate'
        ? 'summary.txt is present and contains ready followed by a newline. I read it and verified the content.'
        : 'Both summary.txt and checksum.txt are present and correct. I created and verified both files.' }
    return (async function* () {
      yield { type: 'block-start', index: 0, blockType: content.type }
      if (content.type === 'tool-call') yield { type: 'tool-call-delta', index: 0, id: content.id, name: content.name, argumentsDelta: content.arguments }
      else yield { type: 'text-delta', index: 0, text: content.text }
      yield { type: 'block-end', index: 0, block: content }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 7 } }
      yield { type: 'finish', reason: { kind: content.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    })()
  })
}
