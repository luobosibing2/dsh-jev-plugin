/** Request cold classification of one newly recorded real Session through a published Web profile. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
export const name = 'latest-harness-stage'
export const inject = ['jev', 'sessionController', 'sessionQuery']
export function apply(ctx) {
  const root = process.env.JEV_VALIDATION_CASE_ROOT
  const sessionId = process.env.JEV_VALIDATION_STAGE_SESSION
  let work
  const timer = setTimeout(() => {
    work = (async () => {
      await mkdir(root, { recursive: true })
      const signal = new AbortController().signal
      let before
      const deadline = Date.now() + 10_000
      for (;;) {
        try { before = await ctx.jev.getStageNavigation(sessionId, signal); break }
        catch (error) {
          if (error.code !== 'UNAVAILABLE' || Date.now() >= deadline) throw error
          await new Promise(resolve => setTimeout(resolve, 30))
        }
      }
      const countBefore = (await ctx.jev.listRecords({ limit: 100 })).items.length
      await writeFile(join(root, 'stage-before.json'), JSON.stringify({ snapshot: before, records: countBefore }, null, 2) + '\n')
      const batch = await ctx.jev.startStageAnalysis({ sessionId, scope: { kind: 'turn', turn: 1 }, mode: 'missing' })
      const end = Date.now() + 120_000
      let after
      for (;;) {
        after = await ctx.jev.getStageNavigation(sessionId, signal)
        if (!after.batch || !['running', 'pending'].includes(after.batch.status)) break
        if (Date.now() >= end) throw new Error('Stage analysis exceeded bounded wait')
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const countAfter = (await ctx.jev.listRecords({ limit: 100 })).items.length
      const second = await ctx.jev.startStageAnalysis({ sessionId, scope: { kind: 'turn', turn: 1 }, mode: 'missing' })
      const countSecond = (await ctx.jev.listRecords({ limit: 100 })).items.length
      const details = []
      for (const turn of after.turns) for (const step of turn.steps) {
        if (step.analysis.recordId) details.push(await ctx.jev.getStageAnalysisRecord(sessionId, step.id, step.analysis.recordId))
      }
      const records = await Promise.all((await ctx.jev.listRecords({ limit: 100 })).items.map(item => ctx.jev.getRecord(item.id)))
      await writeFile(join(root, 'stage-after.json'), JSON.stringify({ batch, snapshot: after, second, countBefore, countAfter, countSecond, details }, null, 2) + '\n')
      await writeFile(join(root, 'ledger.json'), JSON.stringify(records, null, 2) + '\n')
      await writeFile(join(root, 'done.json'), JSON.stringify({ ok: true, sessionId, countBefore, countAfter, countSecond }) + '\n')
    })().catch(async error => {
      await writeFile(join(root, 'done.json'), JSON.stringify({ ok: false, name: error.name, code: error.code, message: error.message }) + '\n')
    })
  }, 0)
  ctx.effect(() => async () => { clearTimeout(timer); await work }, 'latest-harness-stage.wait')
}
