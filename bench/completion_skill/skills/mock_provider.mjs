/** Scripted local main model for native skill plumbing probes; zero external calls. */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const requireFromDsh = createRequire(process.env.JEV_EVAL_DSH_PACKAGE_JSON)
const { LlmAdapter, ToolCallId, ReasoningEffortId } = await import(requireFromDsh.resolve('@deepseek-ai/dsh-llm'))

const CASE_CALLS = {
  'empty-directory': [],
  'single-relevant': ['incident-triage'],
  'dense-relevance': ['launch-rollout', 'launch-support', 'launch-quality', 'launch-rollback', 'launch-stakeholders'],
  'two-required-near-names': ['invoice-reconcile', 'privacy-retention'],
  'all-irrelevant': [],
  'catalog-recovery': ['zenith-codebook'],
}
let calls = 0

function toolResults(options) {
  return options.messages.flatMap(message => message.role === 'tool'
    ? [message]
    : (message.content ?? []).filter(block => block.type === 'tool-result'))
}

function resultText(block) {
  return (block.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n')
}

class SkillProbeAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model,
      context: { contextWindow: Number(process.env.JEV_EVAL_CONTEXT_WINDOW) },
      reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
        defaultEffort: ReasoningEffortId('high') } }
  }

  async * stream(options) {
    calls += 1
    const caseId = process.env.JEV_EVAL_SKILL_CASE
    if (!(caseId in CASE_CALLS)) throw new Error('Unknown scripted skill probe case')
    if (calls === 1 && process.env.JEV_EVAL_MOCK_TOOLS_LOG) {
      const tools = [...(options.tools ?? [])].sort((left, right) => left.name.localeCompare(right.name))
      writeFileSync(process.env.JEV_EVAL_MOCK_TOOLS_LOG, JSON.stringify({
        count: tools.length, names: tools.map(tool => tool.name),
        schema_sha256: createHash('sha256').update(JSON.stringify(tools)).digest('hex'),
      }) + '\n')
    }
    const existing = toolResults(options)
    let next = []
    if (calls === 1 && ['empty-directory', 'all-irrelevant', 'catalog-recovery'].includes(caseId)) {
      next = [{ name: 'skill_catalog', arguments: {} }]
    } else if (calls === 1 || caseId === 'catalog-recovery' && calls === 2) {
      next = CASE_CALLS[caseId].map(name => ({ name: 'skill', arguments: { name } }))
    }
    if (next.length > 0) {
      for (const [index, item] of next.entries()) {
        const id = ToolCallId(`skill-probe-${calls}-${index}`)
        const args = JSON.stringify(item.arguments)
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name: item.name, argumentsDelta: args }
        yield { type: 'block-end', index,
          block: { type: 'tool-call', id, name: item.name, arguments: args } }
      }
      yield { type: 'usage', usage: { inputTokens: 13, outputTokens: 8,
        cacheReadTokens: 0, cacheWriteTokens: 0 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const loaded = existing.map(resultText).join('\n')
    const reply = ['empty-directory', 'all-irrelevant'].includes(caseId)
      ? '19 + 23 = 42.'
      : `Loaded local instructions and report their required facts:\n${loaded}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7,
      cacheReadTokens: 0, cacheWriteTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'eval-skill-model'
export const inject = ['llm']

export function apply(ctx) {
  ctx.llm.registerAdapter(['eval-local'], new SkillProbeAdapter())
}
