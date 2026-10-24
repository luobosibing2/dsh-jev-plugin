/** Native Spill budgets captured for one tool execution and invalidated by policy changes. */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Config as NativeSpillConfig } from '@deepseek-ai/dsh-spill-policy'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

type Budget = { kind: 'unbounded' } | { kind: 'bounded'; maxTokens: number } | { kind: 'unknown'; reason: string }
interface Policy { fiber: Fiber; config: NativeSpillConfig; maxTokens: number | undefined }
interface Observation { budget: Budget; policies: Policy[] }
interface Snapshot extends Observation {
  visible: (context: Context) => boolean
  invalidated?: string
  reported?: boolean
}

/** Check execution stability and, when supplied, complete model-visible content. */
export interface SpillBudgetGuard {
  /**
   * Keep only content within this execution's stable native budget.
   * @param exec - original tool execution whose pre-execute snapshot was captured.
   * @param receiver - current tool event receiver, including its public listener filter.
   * @param content - complete proposed content, or omitted for a stability check only.
   * @returns false for oversized content, an unknown budget, or an invalidated execution.
   */
  allows(exec: ToolExecution, receiver: object, content?: readonly ContentBlock[]): boolean
}

/** Preserve the exact service and Agent filtering used by the tool event dispatcher. */
function visibility(receiver: object): (context: Context) => boolean {
  const filter: unknown = Reflect.get(receiver, Context.filter)
  if (filter === undefined) return () => true
  if (typeof filter !== 'function') throw new Error('Tool event listener filter is unavailable')
  return context => filter.call(receiver, context) === true
}

/**
 * Observe native policy identity without activating it or requiring the optional package to load.
 * @param ctx - admission plugin context; all observers belong to its fiber.
 * @returns an execution-scoped guard; unknown or changing policy state keeps the original result.
 */
export function createSpillBudgetGuard(ctx: Context): SpillBudgetGuard {
  let native: typeof import('@deepseek-ai/dsh-spill-policy') | undefined
  let unavailable = 'Native Spill policy identity is unavailable'
  const ready = import('@deepseek-ai/dsh-spill-policy').then(module => { native = module }, error => {
    unavailable = `Native Spill policy identity is unavailable: ${String(error)}`
  })
  const snapshots = new Map<ToolExecution['token'], Snapshot>()
  ctx.effect(() => () => { snapshots.clear() }, 'jev-output-admission.spill-budgets')

  function observe(visible: Snapshot['visible']): Observation {
    if (native === undefined) return { budget: { kind: 'unknown', reason: unavailable }, policies: [] }
    const policies: Policy[] = []
    for (const fiber of ctx.registry.get(native)?.fibers ?? []) {
      if (fiber.uid === null || !visible(fiber.ctx)) continue
      // ACTIVE is the published Cordis const-enum value; all other states may own an in-flight callback.
      if (fiber.state !== 2) return { budget: { kind: 'unknown', reason: 'Native Spill policy is not active' }, policies }
      const config: NativeSpillConfig = fiber.config
      policies.push({ fiber, config, maxTokens: config.maxInlineTokens })
    }
    const bounded = policies.filter(policy => policy.maxTokens !== undefined)
    const budget: Budget = bounded.length > 1
      ? { kind: 'unknown', reason: 'Multiple native Spill budgets apply to this tool execution' }
      : bounded.length === 1 ? { kind: 'bounded', maxTokens: bounded[0]!.maxTokens! } : { kind: 'unbounded' }
    return { budget, policies }
  }

  function changed(fiber: Fiber): void {
    if (native === undefined || fiber.runtime?.callback !== native.apply) return
    for (const snapshot of snapshots.values()) {
      if (snapshot.policies.some(policy => policy.fiber === fiber) || snapshot.visible(fiber.ctx)) {
        snapshot.invalidated = 'Native Spill policy changed during tool execution'
      }
    }
  }
  ctx.on('internal/plugin', changed, { global: true })
  ctx.on('internal/status', changed, { global: true })
  ctx.on('loader/patch-context', (_entry, next) => {
    for (const snapshot of snapshots.values()) snapshot.invalidated = 'Loader context changed during tool execution'
    next()
  }, { global: true, prepend: true })
  ctx.on('tools/pre-execute', async function (exec, next) {
    await ready
    try {
      const visible = visibility(this)
      snapshots.set(exec.token, { ...observe(visible), visible })
    } catch (error) {
      snapshots.set(exec.token, { budget: { kind: 'unknown', reason: String(error) }, policies: [], visible: () => false })
    }
    return next()
  }, { prepend: true })
  ctx.on('tools/result', (exec) => { snapshots.delete(exec.token) })

  return {
    allows(exec, receiver, content) {
      const snapshot = snapshots.get(exec.token)
      if (snapshot === undefined) {
        ctx.logger.warn('Jev output admission kept original tool result: native Spill execution snapshot is unavailable')
        return false
      }
      let reason = snapshot.invalidated ?? (snapshot.budget.kind === 'unknown' ? snapshot.budget.reason : undefined)
      if (reason === undefined) {
        const current = observe(visibility(receiver))
        if (current.budget.kind === 'unknown') reason = current.budget.reason
        else if (current.policies.length !== snapshot.policies.length
          || current.policies.some((policy, index) => {
            const previous = snapshot.policies[index]!
            return policy.fiber !== previous.fiber || policy.config !== previous.config || policy.maxTokens !== previous.maxTokens
          })) reason = 'Native Spill policy or visibility changed during tool execution'
      }
      if (reason !== undefined) {
        if (!snapshot.reported) {
          snapshot.reported = true
          ctx.logger.warn(`Jev output admission kept original tool result: ${reason}`)
        }
        return false
      }
      return content === undefined || snapshot.budget.kind !== 'bounded'
        || estimateContent(content) <= snapshot.budget.maxTokens
    },
  }
}
