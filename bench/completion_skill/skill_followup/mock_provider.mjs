/** Scripted local main for keyless native discovery, recovery, body, and repo-read probes. */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const requireFromDsh = createRequire(process.env.JEV_EVAL_DSH_PACKAGE_JSON)
const { LlmAdapter, ToolCallId, ReasoningEffortId } = await import(requireFromDsh.resolve('@deepseek-ai/dsh-llm'))

const CASES = {
  'research-one': { skills: ['session-renewal-trace'], read: 'study/session/settings.mjs' },
  'research-two': { skills: ['invoice-allocation-trace', 'audit-retention-trace'],
    read: 'study/billing/allocate.mjs' },
}
let modelCalls = 0

function toolResults(options) {
  return options.messages.flatMap(message => message.role === 'tool'
    ? [message]
    : (message.content ?? []).filter(block => block.type === 'tool-result'))
}

function resultText(item) {
  return (item.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
}

class FollowupMockAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model,
      context: { contextWindow: Number(process.env.JEV_EVAL_CONTEXT_WINDOW) },
      reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
        defaultEffort: ReasoningEffortId('high') } }
  }

  async * stream(options) {
    modelCalls += 1
    const caseId = process.env.JEV_EVAL_SKILL_CASE
    const definition = CASES[caseId]
    if (!definition) throw new Error('Unknown local follow-up probe case')
    if (modelCalls === 1 && process.env.JEV_EVAL_MOCK_TOOLS_LOG) {
      const tools = [...(options.tools ?? [])].sort((a, b) => a.name.localeCompare(b.name))
      writeFileSync(process.env.JEV_EVAL_MOCK_TOOLS_LOG, JSON.stringify({
        names: tools.map(tool => tool.name), count: tools.length,
        schema_sha256: createHash('sha256').update(JSON.stringify(tools)).digest('hex'),
      }) + '\n')
    }
    const next = modelCalls === 1 ? [{ name: 'skill_catalog', arguments: {} }]
      : modelCalls === 2 ? [
        ...definition.skills.map(name => ({ name: 'skill', arguments: { name } })),
        { name: 'read', arguments: { file_path: definition.read } },
      ] : []
    if (next.length) {
      for (const [index, item] of next.entries()) {
        const id = ToolCallId(`followup-${modelCalls}-${index}`)
        const args = JSON.stringify(item.arguments)
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name: item.name, argumentsDelta: args }
        yield { type: 'block-end', index,
          block: { type: 'tool-call', id, name: item.name, arguments: args } }
      }
      yield { type: 'usage', usage: { inputTokens: 15, outputTokens: 8,
        cacheReadTokens: 0, cacheWriteTokens: 0 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const toolText = toolResults(options).map(resultText).join('\n')
    const reply = `Local probe inspected catalog, instructions, and repository source.\n${toolText.slice(0, 160)}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 7,
      cacheReadTokens: 0, cacheWriteTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'followup-mock-model'
export const inject = ['llm']

export function apply(ctx) {
  ctx.llm.registerAdapter(['eval-local'], new FollowupMockAdapter())
}
