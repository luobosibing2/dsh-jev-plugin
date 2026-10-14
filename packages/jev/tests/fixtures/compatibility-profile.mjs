/** Run keyless compatibility cases through one installed official Web profile. */
import assert from 'node:assert/strict'
import { writeFile, readFile, rename } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'jev-compatibility-profile'
export const inject = ['loader', 'jev', 'llm', 'agentLoop', 'agents', 'sessions', 'agentPresets', 'goals']
const user = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

async function until(read, accept, description) {
  const deadline = Date.now() + 30_000
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + description)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

/**
 * Install a deterministic adapter and export completed native-profile evidence.
 * @param ctx - Official profile context that owns this disposable fixture.
 * @returns Nothing; the context owns the adapter and background verification.
 */
export function apply(ctx) {
  const root = process.env.JEV_COMPAT_CASE_ROOT
  if (!root) throw new Error('JEV_COMPAT_CASE_ROOT is required')
  const results = { version: process.env.JEV_COMPAT_VERSION, cases: [], errors: [], modelRequests: [], unexpectedQuestions: [] }
  assert(ctx.llm instanceof LlmRuntime, 'Fixture and official LLM provider must share a runtime identity')
  const scripts = new Map()
  const agents = new Map()
  const runningJudgments = new Set()
  ctx.on('llm/stream', (options, next) => {
    if (!['jev-compatibility-fixture', 'jev-system-one'].includes(options.provider)) throw new Error('The compatibility fixture refuses all external model routes')
    return next()
  }, { prepend: true })
  ctx.on('agent/error', ({ error }) => results.errors.push({ name: error.name, code: error.code, message: error.message }))
  ctx.on('user-questions/request', request => {
    results.unexpectedQuestions.push(request.questions.map(question => question.id))
    return { answers: request.questions.map(question => ({ id: question.id, selected: ['取消 / Cancel'] })) }
  }, { prepend: true })
  const originalJudgeOnce = ctx.jev.judgeOnce.bind(ctx.jev)
  // The fixture waits for the actual background call, including its adoption checks.
  ctx.effect(() => {
    ctx.jev.judgeOnce = options => {
      const promise = originalJudgeOnce(options)
      runningJudgments.add(promise)
      promise.then(() => runningJudgments.delete(promise), () => runningJudgments.delete(promise))
      return promise
    }
    return () => { ctx.jev.judgeOnce = originalJudgeOnce }
  })
  class FixtureModel extends LlmAdapter {
    async *stream(request) {
      const id = request.sessionId ?? request.agent?.session.id
      let script = scripts.get(id)
      if (!script && ctx.agents.get(id) && !ctx.agents.roots().includes(ctx.agents.get(id))) {
        script = { actions: [{}], child: true }
        scripts.set(id, script)
      }
      if (!script) throw new Error('No deterministic script for ' + id)
      await Promise.all([...runningJudgments])
      let newSettlements = []
      if (script.sharedReports) {
        for (const message of request.messages.filter(message => message.role === 'tool' && script.delegationCallIds.has(message.source.callId))) {
          const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
          const childId = /^started subagent ([^\s]+)$/.exec(text)?.[1]
          if (childId) script.delegatedChildIds.add(childId)
        }
        assert(script.delegatedChildIds.size <= 2, 'Shared-report fixture may delegate at most two children')
        for (const message of request.messages.filter(message => message.source.kind === 'subagent-settled')) {
          const childId = message.source.senderSessionId
          assert(script.delegatedChildIds.has(childId), 'Settled notice must identify a child delegated by this fixture')
          if (!script.settledChildIds.has(childId)) {
            script.settledChildIds.add(childId)
            newSettlements.push(childId)
          }
        }
      }
      // Native child completion can admit one more root turn after its final reply.
      const action = script.actions.shift() ?? (script.sharedReports && newSettlements.length > 0 ? {} : undefined)
      if (!action) throw new Error('Deterministic script exhausted for ' + id)
      results.modelRequests.push({ sessionId: id, action: action.name ?? 'final', messages: request.messages })
      if (script.correct && !script.corrected && results.modelRequests.filter(item => item.sessionId === id).length === 2) {
        script.corrected = true
        agents.get(id).steer(user('Correction: continue only the current isolated compatibility fixture plan.'))
      }
      const delegated = action.name === '$delegate'
      if (delegated) {
        const tool = request.tools.find(tool => tool.description.includes('self-contained task') && tool.parameters.properties?.prompt)
        assert(tool, 'Standard preset must expose native self-contained delegation')
        action.name = tool.name
        if (!Object.hasOwn(tool.parameters.properties, 'run_in_background')) delete action.arguments.run_in_background
      }
      if (action.name === 'update_goal') {
        const goal = ctx.goals.get(agents.get(id))
        assert(goal, 'Native goal must exist before completion')
        action.arguments = { goal_id: goal.id, revision: goal.revision, action: 'complete' }
      }
      const block = action.name ? { type: 'tool-call', id: 'compat-' + randomUUID(), name: action.name, arguments: JSON.stringify(action.arguments) } : { type: 'text', text: script.child ? 'COMPAT_SHARED_FINDING: the isolated project marker exists.' : 'Deterministic fixture completed with recorded native results.' }
      if (delegated && script.sharedReports) script.delegationCallIds.add(block.id)
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 7 } }
      yield { type: 'finish', reason: { kind: action.name ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['jev-compatibility-fixture'], new FixtureModel()))
  const rows = () => [...ctx.loader.entries()].filter(entry => entry.options.name?.startsWith('@dsh-jev/plugin')).map(entry => ({ id: entry.id, name: entry.options.name, state: entry.fiber?.state }))
  async function runCase(label, cwd, actions, correct = false) {
    const id = SessionId('compat-' + label + '-' + randomUUID())
    const script = { actions: [...actions, {}], correct, sharedReports: label === 'shared-reports',
      delegationCallIds: new Set(), delegatedChildIds: new Set(), settledChildIds: new Set() }
    scripts.set(id, script)
    const { agent } = await ctx.agents.create({ sessionId: id, agentOptions: { provider: 'jev-compatibility-fixture', model: 'fixture' }, meta: { cwd, agentPreset: 'standard' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'standard') } })
    agents.set(id, agent)
    // An absolute artifact path containing "ok" protects every TAP passing line.
    const approvedFixturePath = relative(cwd, join(root, 'approval-outside.txt'))
    agent.followup(user('Use native tools to read this isolated project, load its own skill, run its fixture scripts, and follow its AGENTS.md. I authorize the single fixture write at ' + approvedFixturePath + ' with danger-full-access for that operation only.'))
    await agent.whenIdle()
    if (script.sharedReports && script.delegatedChildIds.size > 0) {
      await until(() => agent.session.deriveMessages(), messages => {
        const settled = new Set(messages.filter(message => message.source.kind === 'subagent-settled').map(message => message.source.senderSessionId))
        return script.delegatedChildIds.size === 2 && [...script.delegatedChildIds].every(childId => settled.has(childId))
      }, 'both delegated native child reports')
      await agent.whenIdle()
    }
    await Promise.all([...runningJudgments])
    const summaries = (await ctx.jev.listRecords({ sessionId: id, limit: 100 })).items
    const records = await Promise.all(summaries.map(record => ctx.jev.getRecord(record.id)))
    const messages = agent.session.deriveMessages()
    const toolErrors = messages.filter(message => message.role === 'tool' && message.isError)
    if (toolErrors.length > 0) results.toolErrors = toolErrors
    assert.equal(toolErrors.length, 0, 'Native tools must succeed')
    const item = { label, sessionId: id, initialCwd: cwd, records, messages, sessionEvents: agent.session.events }
    results.cases.push(item)
    return item
  }
  async function run() {
    results.hostRows = await until(rows, value => value.length === 9 && value.every(row => row.state === 2), 'all nine Jev Host rows ACTIVE')
    const manifest = JSON.parse(await readFile(new URL('../node_modules/@dsh-jev/plugin/package.json', import.meta.url), 'utf8'))
    results.hostExports = []
    for (const key of Object.keys(manifest.exports)) {
      if (key === './client' || key.endsWith('.json') || key.endsWith('.yml')) continue
      await import('@dsh-jev/plugin' + (key === '.' ? '' : key.slice(1)))
      results.hostExports.push(key)
    }
    results.features = await ctx.jev.listFeatures()
    results.diagnostic = await ctx.jev.testConnection(ctx.jev.judgmentConnectionIdentity(), new AbortController().signal)
    assert(results.diagnostic.ok, 'Choice, Score and Noul diagnostic must pass')
    const simple = marker => [
      { name: 'todo_write', arguments: { todos: [{ content: 'Project ' + marker.toUpperCase() + ': report native reads, loaded skill and observed fixture results; unverified work remains pending.', status: 'pending' }] } },
      { name: 'glob', arguments: { pattern: '*.txt' } },
      { name: 'skill', arguments: { name: 'compat-' + marker } },
      { name: 'read', arguments: { file_path: 'guide.txt' } },
      { name: 'read', arguments: { file_path: 'guide.txt' } },
    ]
    await runCase('session-a', join(root, 'projects/a'), [...simple('a'),
      { name: 'bash', arguments: { command: 'node build.mjs', description: 'Run the isolated deterministic build log fixture' } },
      { name: 'bash', arguments: { command: 'node --test --test-reporter=tap checks.test.mjs', description: 'Run the isolated deterministic test log fixture' } },
      { name: 'write', arguments: { file_path: join(root, 'approval-outside.txt'), content: 'COMPAT_APPROVAL_OK', sandbox_permissions: 'danger-full-access', justification: 'Write the exact isolated file authorized in the fixture user request' } },
      { name: 'read', arguments: { file_path: 'guide.txt' } },
    ], true)
    await runCase('session-b', join(root, 'projects/b'), simple('b'))
    if (ctx.reflect.get('workingDirectory')) await runCase('native-cwd-switch', join(root, 'projects/a'), [
      { name: 'working_directory', arguments: { cd: '../b' } }, ...simple('b'),
    ])
    await runCase('native-goal', join(root, 'projects/a'), [
      { name: 'create_goal', arguments: { objective: 'Complete the isolated deterministic native goal fixture.' } },
      { name: 'update_goal', arguments: { status: 'complete' } },
    ])
    await runCase('shared-reports', join(root, 'projects/a'), [
      { name: '$delegate', arguments: { description: 'Read first fixture finding', prompt: 'Return the fixed factual compatibility finding.', run_in_background: false } },
      { name: '$delegate', arguments: { description: 'Read second fixture finding', prompt: 'Return the same fixed factual compatibility finding.', run_in_background: false } },
      { name: 'read', arguments: { file_path: 'guide.txt' } },
    ])
    const selected = results.cases[0]
    const batch = await ctx.jev.startStageAnalysis({ sessionId: selected.sessionId, scope: { kind: 'all' }, mode: 'missing' })
    const stage = await until(() => ctx.jev.getStageNavigation(selected.sessionId, new AbortController().signal), value => !value.batch || !['running', 'pending'].includes(value.batch.status), 'stage classification completion')
    results.stage = { batch, snapshot: stage }
    assert.equal(stage.batch?.failed ?? 0, 0, 'Stage classification must not fail')
    assert((stage.batch?.completed ?? 0) > 0, 'At least one complete native step must be classified')
    results.finalHostRows = rows()
    assert(results.finalHostRows.every(row => row.state === 2), 'Host rows must remain ACTIVE after business cases')
    assert.equal(results.errors.length, 0, 'Agent loop must not report runtime errors')
    assert.equal(results.unexpectedQuestions.length, 0, 'Deterministic valid replies must not reach human Retry/Cancel')
    for (const label of ['session-a', 'session-b']) {
      const item = results.cases.find(item => item.label === label)
      assert(item.records.some(record => record.featureId === 'skill-selection' && record.status === 'succeeded'), label + ' skill judgment must complete')
      assert(item.records.some(record => record.featureId === 'file-ranking' && record.status === 'succeeded'), label + ' file judgment must complete')
      assert(item.records.some(record => record.featureId === 'instruction-guidance' && record.status === 'succeeded'), label + ' instruction judgment must complete')
      const completion = item.records.find(record => record.featureId === 'completion-check' && record.status === 'succeeded')
      assert(completion, label + ' native Todo must trigger a successful completion judgment')
      const request = completion.attemptRecords.find(attempt => attempt.status === 'succeeded').request
      assert.deepEqual(request.questions.map(question => question.id), ['assessment', 'focus'], label + ' completion must use two bounded questions')
      assert(request.questions.every(question => question.kind === 'choice'), label + ' completion questions must both be Choice')
      assert.deepEqual(request.questions[0].options.map(option => option.id), ['complete', 'omission', 'contradiction', 'needs-user', 'unknown'])
      const state = request.state
      const original = item.messages.find(message => message.role === 'user' && message.source.kind === 'user')
      assert.equal(state.originalRequirementsAvailable, true, label + ' completion must retain original current-turn requirements')
      assert.deepEqual(state.requirements[0], { id: original.id, content: original.content }, label + ' completion must use the actual original request')
      assert.deepEqual(state.todos, [{ content: 'Project ' + (label.endsWith('a') ? 'A' : 'B') + ': report native reads, loaded skill and observed fixture results; unverified work remains pending.', status: 'pending' }], label + ' completion must retain the complete latest native Todo')
      assert.equal(state.finalAnswer, 'Deterministic fixture completed with recorded native results.', label + ' completion must use the latest final answer')
      assert.equal(state.supplementsUsed, 0, label + ' the first judgment must not consume a supplement')
      assert(!Object.hasOwn(state, 'messages') && !Object.hasOwn(state, 'goal'), label + ' ordinary completion must exclude tool history and Goal input')
      assert(completion.receipts.some(receipt => receipt.id === 'completion-checked' && receipt.status === 'observed'), label + ' completion adoption must be recorded')
      const visible = JSON.stringify(item.messages)
      assert(visible.includes('GUIDE_' + (label.endsWith('a') ? 'A' : 'B')), label + ' native reads must use its directory')
      assert(visible.includes('jev-instruction-guidance'), label + ' must adopt an instruction reminder')
      const marker = label.endsWith('a') ? 'a' : 'b'
      const other = marker === 'a' ? 'b' : 'a'
      for (const record of item.records.filter(record => record.featureId === 'skill-selection')) {
        const questions = JSON.stringify(record.attemptRecords[0].request.questions)
        assert(questions.includes('Skill: compat-' + marker), label + ' must judge its own skill')
        assert(!questions.includes('Skill: compat-' + other), label + ' must not judge the other Session skill')
      }
      const instructionReads = item.records.filter(record => record.featureId === 'instruction-guidance' && record.attemptRecords[0]?.request.state.operation.name === 'read')
      assert(instructionReads.length > 0, label + ' must check a real native read')
      for (const record of instructionReads) {
        const state = record.attemptRecords[0].request.state
        assert.equal(state.operation.cwd, join(root, 'projects', marker))
        assert(state.sources.some(source => source.text.includes('RULE_' + marker.toUpperCase())))
        assert(!state.sources.some(source => source.text.includes('RULE_' + other.toUpperCase())))
      }
    }
    const switched = results.cases.find(item => item.label === 'native-cwd-switch')
    if (switched) {
      const skillQuestions = switched.records.filter(record => record.featureId === 'skill-selection').map(record => JSON.stringify(record.attemptRecords[0].request.questions))
      assert(skillQuestions.some(text => text.includes('Skill: compat-b')), 'Native cwd switch must publish the new directory skill')
      const reads = switched.records.filter(record => record.featureId === 'instruction-guidance' && record.attemptRecords[0]?.request.state.operation.name === 'read')
      assert(reads.length > 0)
      assert(reads.every(record => record.attemptRecords[0].request.state.operation.cwd === join(root, 'projects/b')), 'Instruction checks must follow the native changed cwd')
      assert(JSON.stringify(switched.messages).includes('GUIDE_B'))
    }
    const logMessages = results.cases[0].messages.filter(message => message.role === 'tool').map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
    assert(logMessages.filter(text => text.includes('Jev omitted')).length >= 2, 'Generic and test logs must adopt deterministic omissions')
    results.logOmissionsAdopted = true
    const shared = results.cases.find(item => item.label === 'shared-reports')
    assert(shared.records.some(record => record.featureId === 'shared-findings' && record.status === 'succeeded'), 'Native shared reports must reach the relation judge')
    results.approvalFile = await readFile(join(root, 'approval-outside.txt'), 'utf8')
    assert.equal(results.approvalFile, 'COMPAT_APPROVAL_OK')
    results.ok = true
  }
  let work
  ctx.effect(() => {
    const timer = setTimeout(() => {
      work = run().catch(error => { results.ok = false; results.failure = { name: error.name, code: error.code, message: error.message, stack: error.stack } }).finally(async () => {
        const temporary = join(root, '.fixture-result.tmp')
        await writeFile(temporary, JSON.stringify(results, null, 2) + '\n')
        await rename(temporary, join(root, 'fixture-result.json'))
      })
    }, 0)
    return async () => { clearTimeout(timer); await work }
  })
}
