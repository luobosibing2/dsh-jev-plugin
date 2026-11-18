/** Export bounded, private real-run evidence from an isolated published DSH profile. */
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'latest-harness-observer'
export const inject = ['jev', 'agents', 'sessions']

export async function apply(ctx) {
  const root = process.env.JEV_VALIDATION_CASE_ROOT
  if (!root) throw new Error('JEV_VALIDATION_CASE_ROOT is required')
  await mkdir(root, { recursive: true })
  const features = await ctx.jev.listFeatures()
  await writeFile(join(root, 'features.json'), JSON.stringify(features, null, 2) + '\n')
  const interactions = []
  const errors = []
  const sessionIds = new Set()
  ctx.on('agent/status', ({ agent }) => sessionIds.add(agent.session.id))
  ctx.on('agent/error', ({ error }) => errors.push({ name: error.name, code: error.code, message: error.message }))
  const stepLimit = Number(process.env.JEV_VALIDATION_STEP_LIMIT ?? 0)
  let admittedSteps = 0
  if (stepLimit > 0) ctx.on('agent/pre-step', (request, next) => {
    if (++admittedSteps > stepLimit) throw new Error('Validation stopped at the explicit main-step budget')
    return next()
  }, { prepend: true })
  ctx.on('user-questions/request', request => {
    interactions.push({ event: 'user-questions/request', questionIds: request.questions.map(item => item.id) })
    return { answers: request.questions.map(item => ({ id: item.id, selected: ['取消 / Cancel'] })) }
  }, { prepend: true })
  ctx.on('approval/request', (request, next) => {
    interactions.push({ event: 'approval/request' })
    if (request.agent?.status === 'running') queueMicrotask(() => request.agent.cancel({ kind: 'user' }))
    return next()
  })
  if (process.env.JEV_VALIDATION_PROBE === '1') {
    const result = await ctx.jev.testConnection(ctx.jev.judgmentConnectionIdentity(), new AbortController().signal)
    await writeFile(join(root, 'probe.json'), JSON.stringify(result, null, 2) + '\n')
    if (!result.ok) throw new Error('Real Jev diagnostic failed; no automatic retry')
  }
  ctx.effect(() => async () => {
    const deadline = Date.now() + 12_000
    let records = []
    do {
      const items = (await ctx.jev.listRecords({ limit: 100 })).items
      records = await Promise.all(items.map(item => ctx.jev.getRecord(item.id)))
      if (!records.some(item => item && ['pending', 'waiting'].includes(item.status))) break
      await new Promise(resolve => setTimeout(resolve, 50))
    } while (Date.now() < deadline)
    await writeFile(join(root, 'ledger.json'), JSON.stringify(records, null, 2) + '\n')
    await writeFile(join(root, 'run-observation.json'), JSON.stringify({ sessionIds: [...sessionIds], interactions, errors }, null, 2) + '\n')
  }, 'latest-harness-validation.export')
}
