/** Native approval through the published ToolRuntime, ApprovalService, AgentLoop, and Jev service. */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { createVolatile, updateVolatile, type Volatile } from '@deepseek-ai/cosmokit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { ShellExecutor, type ShellExecRequest, type ShellExecSpec, type ShellExecution } from '@deepseek-ai/dsh-shell'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolPwsh from '@deepseek-ai/dsh-tool-pwsh'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import JevService from '../src/index.ts'
import * as workspaceApproval from '../src/workspace-approval.ts'

type Step = StreamChunk[]
const text = (value: string): Step => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const call = (id: string, name: string, args: object): Step => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
class MainModel extends LlmAdapter {
  constructor(private readonly steps: Step[]) { super() }
  async *stream(_request: GenerateOptions): AsyncIterable<StreamChunk> {
    const next = this.steps.shift()
    if (next === undefined) throw new Error('Main-model fixture exhausted')
    yield* next
  }
}
class PtcFixture extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fixture'
  override get sandboxMode() { return 'workspace-write' as const }
  runs = 0
  last?: PtcRunRequest
  runInner = false
  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 }
  }
  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    this.runs++
    this.last = request
    if (this.runInner) await request.bindings[0]!.functions.write!({ file_path: 'inner.txt', content: 'inside', sandbox_permissions: 'danger-full-access', justification: 'Write generated inner file' })
    return { logs: [], value: 'program ran' }
  }
}
class ShellFixture extends ShellExecutor {
  modes: string[] = []
  override get sandboxMode() { return 'workspace-write' as const }
  resolve(request: ShellExecRequest): ShellExecSpec {
    return { command: request.command, workdir: request.workdir ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 60_000, onExpiry: request.onExpiry ?? 'kill',
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000, sandboxPolicy: request.sandboxPolicy,
      ...request.signal ? { signal: request.signal } : {} }
  }
  async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    this.modes.push(spec.sandboxPolicy?.mode ?? 'none')
    const silent = { readFrom: (fromByte: number) => ({ text: '', nextOffset: fromByte, lossy: false }) }
    return { status: 'completed', exitCode: 0, signal: null, done: Promise.resolve(),
      readOutput: () => ({ delta: '', lossy: false }), observed: { stdout: silent, stderr: silent }, kill: () => false,
      result: () => Promise.resolve({ exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: spec.timeoutMs,
        stdout: { text: 'fixture shell', truncated: false }, stderr: { text: '', truncated: false },
        sandbox: { mode: spec.sandboxPolicy?.mode ?? 'workspace-write', denied: false, enforcement: 'full', runnerFailed: false } }) }
  }
}

interface Wire { state: { currentContext: { pending: unknown[] }; operation: { tool: string; arguments: object }; script: { status: string; content?: string } }; questions: object }
type Reply = { choice: 'approve' | 'unauthorized' | 'unknown' } | { invalid: true } | (() => Promise<{ choice: 'approve' | 'unauthorized' | 'unknown' }>)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean() })

async function fixture(steps: Step[], replies: Reply[], options: { enabled?: boolean; mode?: 'workspace-write' | 'read-only' | 'danger-full-access'; policy?: 'ask' | 'never'; ptc?: boolean; ptcInner?: boolean; shell?: boolean; captureDetach?: boolean } = {}) {
  const root = await mkdtemp(join(process.cwd(), '.jev-approval-test-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  const received: Wire[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Wire)
    const reply = replies.shift()
    const answer = typeof reply === 'function' ? await reply() : reply
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(answer && 'invalid' in answer ? { answers: {} }
      : { answers: { authorization: { choice: answer?.choice ?? 'unknown' } } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture server unavailable')

  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: options.ptc ? { mode: 'ptc' } : {} })
  await ctx.plugin(SandboxPolicy, { mode: options.mode ?? 'workspace-write', workspaceRoot: workspace })
  await ctx.plugin(ApprovalService, { policy: options.policy ?? 'ask' })
  await ctx.plugin(SandboxedFileSystem, { cwd: workspace })
  await ctx.plugin(WorkingDirectory)
  await ctx.plugin(ToolFs)
  if (options.ptc) await ctx.plugin(PtcFixture)
  if (options.ptcInner) (ctx.ptcRuntime as PtcFixture).runInner = true
  if (options.shell) {
    await ctx.plugin(ShellFixture)
    await ctx.plugin(ShellEnv)
    await ctx.plugin(ToolBash)
    await ctx.plugin(ToolPwsh)
  }
  await ctx.plugin(Storage)
  await ctx.plugin(UserQuestions)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.storage.backend.register('json', new JsonStorageBackend(join(root, 'storage')))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
  ctx.provide('profileContext', { dir: join(root, 'profile') } as never)
  ctx.provide('settings', { configure: () => () => {} } as never)
  ctx.provide('credentials', { resolve: async () => ({ value: 'localhost-fixture', source: 'fixture' }) } as never)
  const jevFiber = await ctx.plugin(JevService, { baseUrl: `http://127.0.0.1:${address.port}/v1/systemone`, model: 'fixture-judge', credentialRef: 'JEV_FIXTURE', timeoutMs: 10_000,
    features: options.enabled === false ? {} : { 'workspace-approval': true } })
  const consumer = await ctx.plugin(workspaceApproval, { maxScriptBytes: 128_000 })
  ctx.llm.registerAdapter(['fixture'], new MainModel(steps))
  let detachAgent: (() => void) | undefined
  if (options.captureDetach) {
    const enter = ctx.agents.enter.bind(ctx.agents)
    vi.spyOn(ctx.agents, 'enter').mockImplementation((agent, owner) => {
      const detach = enter(agent, owner)
      if (agent.id === SessionId('approval-fixture')) detachAgent = detach
      return detach
    })
  }
  const agent = await ctx.agentLoop.create(SessionId('approval-fixture'), { provider: 'fixture', model: 'fixture' }, { cwd: workspace })
  const send = async (message = 'Fix the file and verify the build without publishing') => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: message }] }))
    await agent.whenIdle()
  }
  const outcomes = () => agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').map(event => event.data.outcome)
  return { ctx, agent, consumer, jevFiber, root, workspace, outside, received, send, outcomes,
    detachAgent: () => detachAgent?.(),
    ptc: ctx.ptcRuntime as PtcFixture | undefined, shell: ctx.get('shell') as ShellFixture | undefined }
}

it('grants one real native write and records approval separately from its tool result', async () => {
  const dest = 'placeholder'
  const h = await fixture([call('write-1', 'write', { file_path: dest, content: 'first', sandbox_permissions: 'danger-full-access', justification: 'Write generated file' }), text('done')], [{ choice: 'approve' }])
  // The approval is native even for an in-workspace path; the explicit wider request is per call.
  await h.send()
  expect((await h.ctx.jev.listFeatures()).find(feature => feature.id === 'workspace-approval')).toMatchObject({ enabled: true })
  expect(h.received).toHaveLength(1)
  expect(h.outcomes()).toEqual(['allowed-once'])
  expect(await readFile(join(h.workspace, dest), 'utf8')).toBe('first')
  expect(h.received[0]?.state.operation.arguments).toMatchObject({ file_path: dest, content: 'first' })
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'sandbox/mode')).toHaveLength(0)
  await vi.waitFor(async () => {
    const record = (await h.ctx.jev.listRecords({ featureId: 'workspace-approval' })).items[0]
    expect(record?.actionStatus).toBe('executed')
  })
})

it('does not carry a one-time grant into the next workspace-write call', async () => {
  const h = await fixture([
    call('outside-1', 'write', { file_path: '../outside/first.txt', content: 'granted', sandbox_permissions: 'danger-full-access', justification: 'Write outside file' }),
    call('outside-2', 'write', { file_path: '../outside/second.txt', content: 'must stay denied' }), text('done'),
  ], [{ choice: 'approve' }])
  await h.send()
  expect(h.received).toHaveLength(1)
  expect(h.outcomes()).toEqual(['allowed-once'])
  expect(await readFile(join(h.outside, 'first.txt'), 'utf8')).toBe('granted')
  await expect(readFile(join(h.outside, 'second.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.stringify(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result'))).toContain('FS_SANDBOX_DENIED')
})

it.each(['unauthorized', 'unknown'] as const)('hands %s to the native answerer without Jev Retry/Cancel', async choice => {
  const h = await fixture([call('write-2', 'write', { file_path: 'manual.txt', content: 'manual', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')], [{ choice }])
  let human = 0
  h.ctx.on('approval/request', () => { human++; return Promise.resolve<ApprovalOutcome>('allowed-once') })
  h.ctx.on('user-questions/request', () => { throw new Error('Jev Retry/Cancel should not open') })
  await h.send()
  expect(h.received).toHaveLength(1)
  expect(human).toBe(1)
  expect(h.outcomes()).toEqual(['allowed-once'])
  expect(await readFile(join(h.workspace, 'manual.txt'), 'utf8')).toBe('manual')
})

it('does not consult Jev for a pre-execute hook ask or a monotonic guard refusal', async () => {
  const args = { file_path: 'guarded.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'Write file' }
  const hook = await fixture([call('hook-ask', 'write', args), text('done')], [{ choice: 'approve' }])
  hook.ctx.on('tools/pre-execute', (exec, next) => exec.name === 'write'
    ? Promise.resolve({ kind: 'ask' as const, reason: 'Hook asks before dispatch' }) : next())
  hook.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
  await hook.send()
  expect(hook.received).toHaveLength(0)
  expect(hook.outcomes()).toEqual(['rejected'])

  const guard = await fixture([call('guard-refusal', 'write', args), text('done')], [{ choice: 'approve' }])
  guard.ctx.tools.guard(exec => exec.name === 'write' ? 'Fixed guard refused this call' : undefined)
  await guard.send()
  expect(guard.received).toHaveLength(0)
  expect(guard.outcomes()).toHaveLength(0)
  await expect(readFile(join(guard.workspace, 'guarded.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('does not reuse an active write for another call id or plugin_manager request', async () => {
  const h = await fixture([call('accurate', 'write', { file_path: 'accurate.txt', content: 'native', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')], [{ choice: 'approve' }])
  let human = 0
  h.ctx.on('approval/request', () => { human++; return Promise.resolve<ApprovalOutcome>('rejected') })
  h.ctx.on('tools/execute', async (exec, next) => {
    if (exec.name === 'write') {
      expect(await h.ctx.approval.request({ agent: exec.agent!, callId: ToolCallId('other-call'), toolName: 'write',
        reason: 'escalate sandbox to danger-full-access: Write file', signal: exec.signal })).toBe('rejected')
      expect(await h.ctx.approval.request({ agent: exec.agent!, callId: exec.callId, toolName: 'plugin_manager',
        reason: 'escalate sandbox to danger-full-access: Write file', signal: exec.signal })).toBe('rejected')
    }
    return next()
  })
  await h.send()
  expect(human).toBe(2)
  expect(h.received).toHaveLength(1)
  expect(h.outcomes()).toEqual(['rejected', 'rejected', 'allowed-once'])
})

it('leaves an invalid native write with its fixed validation failure before approval', async () => {
  const h = await fixture([call('invalid-write', 'write', { file_path: '', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')], [{ choice: 'approve' }])
  await h.send()
  expect(h.received).toHaveLength(0)
  expect(h.outcomes()).toHaveLength(0)
})

it('retries only after a human choice and refreshes the direct script', async () => {
  const h = await fixture([call('retry-script', 'bash', { command: 'python scripts/fix.py', description: 'Run direct script', sandbox_permissions: 'danger-full-access', justification: 'Write build cache' }), text('done')],
    [{ invalid: true }, { choice: 'approve' }], { shell: true })
  await mkdir(join(h.workspace, 'scripts'))
  await writeFile(join(h.workspace, 'scripts/fix.py'), 'original script\n')
  let questions = 0
  h.ctx.on('user-questions/request', async () => {
    questions++
    expect(h.shell?.modes).toEqual([])
    await writeFile(join(h.workspace, 'scripts/fix.py'), 'revised script\n')
    return { answers: [{ id: 'jev-resolution', selected: ['重试 / Retry'] }] }
  })
  await h.send()
  expect(questions).toBe(1)
  expect(h.received.map(item => item.state.script.content)).toEqual(['original script\n', 'revised script\n'])
  expect(h.shell?.modes).toEqual(['danger-full-access'])
})

it('cancels the native call after a failed Jev answer and human Cancel', async () => {
  const h = await fixture([call('cancel-script', 'bash', { command: 'python scripts/missing.py', description: 'Run direct script', sandbox_permissions: 'danger-full-access', justification: 'Write build cache' }), text('done')],
    [{ invalid: true }], { shell: true })
  let questions = 0
  h.ctx.on('user-questions/request', () => {
    questions++
    return Promise.resolve({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] })
  })
  await h.send()
  expect(questions).toBe(1)
  expect(h.received).toHaveLength(1)
  expect(h.outcomes()).toEqual(['cancelled'])
  expect(h.shell?.modes).toEqual([])
})

it('passes an unreadable direct script fact to Jev and hands unknown to the human', async () => {
  const h = await fixture([call('missing-script', 'bash', { command: 'python scripts/missing.py', description: 'Run direct script', sandbox_permissions: 'danger-full-access', justification: 'Write build cache' }), text('done')],
    [{ choice: 'unknown' }], { shell: true })
  h.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
  await h.send()
  expect(h.received[0]?.state.script).toMatchObject({ status: 'unavailable' })
  expect(h.received[0]?.state.script.content).toBeUndefined()
  expect(h.outcomes()).toEqual(['rejected'])
  expect(h.shell?.modes).toEqual([])
})

it('does not auto-grant when its approval-routing receipt cannot be saved', async () => {
  const h = await fixture([call('receipt-failure', 'write', { file_path: 'receipt-failure.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')], [{ choice: 'approve' }])
  const original = h.ctx.jev.writeReceipt.bind(h.ctx.jev)
  vi.spyOn(h.ctx.jev, 'writeReceipt').mockImplementation((id, receipt) => receipt.id === 'approval-routing'
    ? Promise.reject(new Error('fixture receipt failure')) : original(id, receipt))
  let human = 0
  h.ctx.on('approval/request', () => { human++; return Promise.resolve<ApprovalOutcome>('rejected') })
  await h.send()
  expect(human).toBe(1)
  expect(h.outcomes()).toEqual(['rejected'])
  await expect(readFile(join(h.workspace, 'receipt-failure.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('records an actual tool failure after an issued one-time grant', async () => {
  const h = await fixture([call('after-grant-failure', 'write', { file_path: '../outside/missing-parent/file.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')], [{ choice: 'approve' }])
  vi.spyOn(h.ctx.fs, 'writeText').mockRejectedValue(new Error('fixture provider failed after approval'))
  await h.send()
  expect(h.outcomes()).toEqual(['allowed-once'])
  const summary = (await h.ctx.jev.listRecords({ featureId: 'workspace-approval' })).items[0]!
  await vi.waitFor(async () => {
    const detail = await h.ctx.jev.getRecord(summary.id)
    expect(detail?.receipts.map(receipt => [receipt.id, receipt.status])).toContainEqual(['grant-issued', 'observed'])
    expect(detail?.receipts.map(receipt => [receipt.id, receipt.status])).toContainEqual(['tool-result', 'execution-failed'])
  })
})

it('does not record a grant when the Host cannot commit approval/decided', async () => {
  const h = await fixture([call('audit-failure', 'write', { file_path: 'audit-failure.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')], [{ choice: 'approve' }])
  const append = h.agent.session.append.bind(h.agent.session)
  vi.spyOn(h.agent.session, 'append').mockImplementation((type, data, ...rest) => {
    if (type === 'approval/decided') throw new Error('fixture audit write failure')
    return append(type, data, ...rest)
  })
  await h.send()
  expect(h.received).toHaveLength(1)
  expect(h.outcomes()).toHaveLength(0)
  await expect(readFile(join(h.workspace, 'audit-failure.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  const summary = (await h.ctx.jev.listRecords({ featureId: 'workspace-approval' })).items[0]!
  await vi.waitFor(async () => {
    const detail = await h.ctx.jev.getRecord(summary.id)
    expect(detail?.receipts.map(receipt => [receipt.id, receipt.status])).toContainEqual(['native-audit', 'not-adopted'])
    expect(detail?.receipts.some(receipt => receipt.id === 'grant-issued')).toBe(false)
  })
})

it('discards a late approval after a pending user correction and hands the live request to the native answerer', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const h = await fixture([call('late-inbox', 'write', { file_path: 'late.txt', content: 'old', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('first turn done'), text('correction received')],
    [async () => { entered.resolve(); await release.promise; return { choice: 'approve' } }])
  let human = 0
  h.ctx.on('approval/request', () => { human++; return Promise.resolve<ApprovalOutcome>('rejected') })
  const pending = h.send()
  await entered.promise
  h.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Correction: do not write late.txt' }] }))
  release.resolve()
  await pending
  expect(h.received).toHaveLength(1)
  expect(human).toBe(1)
  expect(h.outcomes()).toEqual(['rejected'])
  await expect(readFile(join(h.workspace, 'late.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('does not adopt an approval after the direct script changes while Jev waits', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const h = await fixture([call('changed-script', 'bash', { command: 'python scripts/fix.py', description: 'Run direct script', sandbox_permissions: 'danger-full-access', justification: 'Write build cache' }), text('done')],
    [async () => { entered.resolve(); await release.promise; return { choice: 'approve' } }], { shell: true })
  await mkdir(join(h.workspace, 'scripts'))
  await writeFile(join(h.workspace, 'scripts/fix.py'), 'old effect\n')
  let human = 0
  h.ctx.on('approval/request', () => { human++; return Promise.resolve<ApprovalOutcome>('rejected') })
  const pending = h.send()
  await entered.promise
  await writeFile(join(h.workspace, 'scripts/fix.py'), 'new effect\n')
  release.resolve()
  await pending
  expect(human).toBe(1)
  expect(h.shell?.modes).toEqual([])
  expect(h.outcomes()).toEqual(['rejected'])
})

it('does not grant after the Agent registry detaches the current owner without aborting the call', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const h = await fixture([call('detached-owner', 'write', { file_path: 'detached.txt', content: 'no grant', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')],
    [async () => { entered.resolve(); await release.promise; return { choice: 'approve' } }], { captureDetach: true })
  let callSignal: AbortSignal | undefined
  h.ctx.on('tools/execute', (exec, next) => { if (exec.name === 'write') callSignal = exec.signal; return next() })
  const pending = h.send()
  await entered.promise
  expect(callSignal?.aborted).toBe(false)
  h.detachAgent()
  expect(h.ctx.agents.get(h.agent.id)).toBeUndefined()
  expect(callSignal?.aborted).toBe(false)
  release.resolve()
  await pending
  expect(h.outcomes()).toEqual(['cancelled'])
  await expect(readFile(join(h.workspace, 'detached.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('hands a still askable request to the human when the feature is disabled during judgment', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const h = await fixture([call('disabled-late', 'write', { file_path: 'disabled.txt', content: 'human may allow', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')],
    [async () => { entered.resolve(); await release.promise; return { choice: 'approve' } }])
  let human = 0
  h.ctx.on('approval/request', () => { human++; return Promise.resolve<ApprovalOutcome>('rejected') })
  const pending = h.send()
  await entered.promise
  updateVolatile(h.jevFiber.config.features as Volatile<Record<string, boolean>>, createVolatile({ 'workspace-approval': false }))
  release.resolve()
  await pending
  expect(human).toBe(1)
  expect(h.outcomes()).toEqual(['rejected'])
})

it('closes a stale request without asking a human after policy changes to never', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const h = await fixture([call('never-late', 'write', { file_path: 'never.txt', content: 'no grant', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done'), text('policy notice')],
    [async () => { entered.resolve(); await release.promise; return { choice: 'approve' } }])
  let human = 0
  h.ctx.on('approval/request', () => { human++; return Promise.resolve<ApprovalOutcome>('allowed-once') })
  const pending = h.send()
  await entered.promise
  h.ctx.approval.setPolicy(h.agent, 'never')
  release.resolve()
  await pending
  expect(human).toBe(0)
  expect(h.outcomes()).toEqual(['rejected'])
  await expect(readFile(join(h.workspace, 'never.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rechecks after a delayed routing receipt before granting', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const h = await fixture([call('late-receipt', 'write', { file_path: 'receipt.txt', content: 'old', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('first turn done'), text('correction received')], [{ choice: 'approve' }])
  const original = h.ctx.jev.writeReceipt.bind(h.ctx.jev)
  vi.spyOn(h.ctx.jev, 'writeReceipt').mockImplementation(async (id, receipt) => {
    if (receipt.id === 'approval-routing' && receipt.reason?.includes('approve')) { entered.resolve(); await release.promise }
    return original(id, receipt)
  })
  let human = 0
  h.ctx.on('approval/request', () => { human++; return Promise.resolve<ApprovalOutcome>('rejected') })
  const pending = h.send()
  await entered.promise
  h.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Correction: do not write receipt.txt' }] }))
  release.resolve()
  await pending
  expect(human).toBe(1)
  expect(h.outcomes()).toEqual(['rejected'])
  await expect(readFile(join(h.workspace, 'receipt.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  const summary = (await h.ctx.jev.listRecords({ featureId: 'workspace-approval' })).items[0]!
  const detail = await h.ctx.jev.getRecord(summary.id)
  expect(detail?.receipts.map(receipt => [receipt.id, receipt.status])).toEqual([
    ['approval-routing', 'observed'], ['final-adoption', 'not-adopted'],
  ])
})

it('unloads while a delegated native human answer remains pending', async () => {
  const asked = Promise.withResolvers<void>()
  const human = Promise.withResolvers<ApprovalOutcome>()
  const h = await fixture([call('human-pending', 'write', { file_path: 'human.txt', content: 'human grant', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')], [{ choice: 'unknown' }])
  h.ctx.on('approval/request', () => { asked.resolve(); return human.promise })
  const pending = h.send()
  await asked.promise
  await h.consumer.dispose()
  human.resolve('allowed-once')
  await pending
  expect(h.outcomes()).toEqual(['allowed-once'])
  expect(await readFile(join(h.workspace, 'human.txt'), 'utf8')).toBe('human grant')
})

it('cancels its own pending judgment when the consumer unloads', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const h = await fixture([call('unload-judgment', 'write', { file_path: 'unload.txt', content: 'no grant', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')],
    [async () => { entered.resolve(); await release.promise; return { choice: 'approve' } }])
  const pending = h.send()
  await entered.promise
  await h.consumer.dispose()
  release.resolve()
  await pending
  expect(h.outcomes()).toEqual(['cancelled'])
  await expect(readFile(join(h.workspace, 'unload.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('cancels a final direct-script reread during consumer unload', async () => {
  const entered = Promise.withResolvers<void>()
  const h = await fixture([call('unload-final-read', 'bash', { command: 'python scripts/fix.py', description: 'Run direct script', sandbox_permissions: 'danger-full-access', justification: 'Write build cache' }), text('done')],
    [{ choice: 'approve' }], { shell: true })
  await mkdir(join(h.workspace, 'scripts'))
  await writeFile(join(h.workspace, 'scripts/fix.py'), 'script body\n')
  const original = h.ctx.fs.readText.bind(h.ctx.fs)
  let reads = 0
  vi.spyOn(h.ctx.fs, 'readText').mockImplementation((target, signal) => {
    reads++
    if (reads !== 3) return original(target, signal)
    entered.resolve()
    return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('read cancelled')), { once: true }))
  })
  const pending = h.send()
  await entered.promise
  await h.consumer.dispose()
  await pending
  expect(reads).toBe(3)
  expect(h.outcomes()).toEqual(['cancelled'])
  expect(h.shell?.modes).toEqual([])
})

it('does not judge disabled, read-only, full-access, or never sessions', async () => {
  for (const options of [{ enabled: false }, { mode: 'read-only' as const }, { mode: 'danger-full-access' as const }, { policy: 'never' as const }]) {
    const h = await fixture([call('excluded', 'write', { file_path: 'excluded.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'Write file' }), text('done')], [], options)
    h.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
    await h.send()
    if (options.enabled === false) expect((await h.ctx.jev.listFeatures()).find(feature => feature.id === 'workspace-approval')).toMatchObject({ enabled: false })
    expect(h.received).toHaveLength(0)
    expect(h.outcomes()).toEqual(options.policy === 'never' ? ['rejected'] : options.mode === 'danger-full-access' ? [] : ['rejected'])
  }
})

it('keeps PTC outer approval distinct from its program run', async () => {
  const h = await fixture([call('ptc-1', 'run_code', { code: 'return 1', description: 'Run validation', sandbox_permissions: 'danger-full-access', justification: 'Write build cache' }), text('done')], [{ choice: 'approve' }], { ptc: true })
  await h.send()
  expect(h.received).toHaveLength(1)
  expect(h.received[0]?.state.operation.tool).toBe('run_code')
  expect(h.outcomes()).toEqual(['allowed-once'])
  expect(h.ptc?.runs).toBe(1)
  expect(h.ptc?.last?.sandboxPolicy?.mode).toBe('danger-full-access')
})

it('judges PTC outer and inner native tool escalations as separate calls', async () => {
  const h = await fixture([call('ptc-nested', 'run_code', { code: 'await tools.write({ file_path: "inner.txt" })', description: 'Run nested write', sandbox_permissions: 'danger-full-access', justification: 'Write build cache' }), text('done')],
    [{ choice: 'approve' }, { choice: 'approve' }], { ptc: true, ptcInner: true })
  await h.send()
  expect(h.received.map(item => item.state.operation.tool)).toEqual(['run_code', 'write'])
  expect(h.outcomes()).toEqual(['allowed-once', 'allowed-once'])
  expect(h.ptc?.runs).toBe(1)
  expect(await readFile(join(h.workspace, 'inner.txt'), 'utf8')).toBe('inside')
})

it.each([
  { tool: 'bash', command: 'python "scripts/fix.py"', script: 'fix.py' },
  { tool: 'pwsh', command: 'pwsh -File scripts/fix.ps1', script: 'fix.ps1' },
])('supplies a direct script and grants one native $tool command', async ({ tool, command, script }) => {
  const h = await fixture([call('shell-1', tool, { command, description: 'Run direct fixture script', sandbox_permissions: 'danger-full-access', justification: 'Write build cache' }), text('done')], [{ choice: 'approve' }], { shell: true })
  await mkdir(join(h.workspace, 'scripts'))
  await writeFile(join(h.workspace, 'scripts', script), 'fixture script content\n')
  await h.send()
  expect(h.received).toHaveLength(1)
  expect(h.received[0]?.state.script).toMatchObject({ status: 'read', content: 'fixture script content\n' })
  expect(h.shell?.modes).toEqual(['danger-full-access'])
  expect(h.outcomes()).toEqual(['allowed-once'])
})
