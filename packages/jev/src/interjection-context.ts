/** Bounded original facts used by running-user-message classification. */
import { z } from 'zod'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { redactToolArguments } from './credential-redaction.ts'

type Material = { id: string; text: string; excerpt: boolean }
type ToolMaterial = { callId: string; name: string; arguments: string; excerpt: boolean; status: 'running' | 'completed' | 'failed' }
const MAX_TOOL_ARGUMENT_CHARS = 1_000_000

/** The live execution phase; no model infers these values. */
export type RoutingActivity = 'model-response' | 'model-retry-wait' | 'tool-execution' | 'other'

/** Bounded, replayable task facts; transient request ownership is kept by the caller. */
export interface RoutingContextState {
  budget: number
  turn: number
  step: number
  latestUserId: string
  users: Material[]
  previous: Material[]
  assistant: Material | null
  tool: ToolMaterial | null
  missingUserText: boolean
  omittedUsers: boolean
}

const materialSchema = z.object({ id: z.string(), text: z.string(), excerpt: z.boolean() })

/** Extract original text without retaining reasoning or tool-output blocks. */
function material(id: string, blocks: readonly ContentBlock[], limit: number): Material {
  let value = ''
  let excerpt = false
  for (const block of blocks) {
    if (block.type !== 'text') continue
    const separator = value.length === 0 ? '' : '\n'
    const available = Math.max(0, limit - value.length)
    const part = separator + block.text
    value += part.slice(0, available)
    if (part.length > available) excerpt = true
  }
  return { id, text: value, excerpt }
}

/** Keep the original task plus a bounded recent suffix of direct-user amendments. */
function retain(users: readonly Material[], incoming: Material, limit: number): Material[] {
  if (incoming.text.length === 0 || users.some(item => item.id === incoming.id)) return [...users]
  const first = users[0]
  if (first === undefined) return [incoming]
  const recent = [...users.slice(1), incoming]
  let available = limit
  const kept: Material[] = []
  for (const item of recent.toReversed()) {
    if (available === 0) break
    const text = item.text.slice(0, available)
    kept.unshift({ ...item, text, excerpt: item.excerpt || text.length < item.text.length })
    available -= text.length
  }
  return [first, ...kept]
}

/**
 * Define the Host-only input-material projection for one configured context budget.
 * @param limit - maximum characters retained per current-material category.
 * @returns a pure projection whose checkpoint rejects a changed budget.
 */
export function routingContextProjection(limit: number): ProjectionDefinition<'jev-interjection-context', RoutingContextState> {
  const boundedMaterialSchema = materialSchema.extend({ text: z.string().max(limit) })
  const stateSchema: z.ZodType<RoutingContextState> = z.object({
    budget: z.literal(limit), turn: z.number().int().nonnegative(), step: z.number().int().nonnegative(), latestUserId: z.string(),
    users: z.array(boundedMaterialSchema).max(limit + 1), previous: z.array(boundedMaterialSchema).max(limit + 1),
    assistant: boundedMaterialSchema.nullable(),
    tool: z.object({ callId: z.string(), name: z.string().max(limit), arguments: z.string().max(limit), excerpt: z.boolean(), status: z.enum(['running', 'completed', 'failed']) }).nullable(),
    missingUserText: z.boolean(), omittedUsers: z.boolean(),
  })
  return {
    // Separate versions for each budget and for checkpoints created before tool redaction.
    key: 'jev-interjection-context', stateVersion: 2_000_001 + limit, stateSchema,
    init: (): RoutingContextState => ({
      budget: limit, turn: 0, step: 0, latestUserId: '',
      users: [], previous: [], assistant: null, tool: null, missingUserText: false, omittedUsers: false,
    }),
    apply: (state: RoutingContextState, event: SessionEvent): RoutingContextState => {
      switch (event.type) {
        case 'turn/start':
          return { ...state, turn: event.data.turn, step: 0, previous: state.users.length > 0 ? state.users : state.previous,
            users: [], missingUserText: false, omittedUsers: false, assistant: null, tool: null }
        case 'step/start':
          return { ...state, step: event.data.step }
        case 'user/message': {
          if (event.data.source.kind !== 'user') return state
          const next = material(event.data.id, event.data.content, limit)
          const users = retain(state.users, next, limit)
          return { ...state, latestUserId: event.data.id, users,
            missingUserText: state.missingUserText || next.text.trim().length === 0,
            omittedUsers: state.omittedUsers || users.length < state.users.length + (next.text.length > 0 ? 1 : 0) }
        }
        case 'assistant/message':
          return { ...state, assistant: material(event.data.message.id, event.data.message.content, limit) }
        case 'tool/call': {
          // Decode the whole argument value before clipping. A prefix can cut through a credential.
          const args = event.data.arguments.length > MAX_TOOL_ARGUMENT_CHARS
            ? { text: '[REDACTED: oversized tool arguments]', withheld: true }
            : redactToolArguments(event.data.arguments)
          return { ...state, tool: {
            callId: event.data.callId, name: event.data.name.slice(0, limit),
            arguments: args.text.slice(0, limit),
            excerpt: args.withheld || args.text.length > limit || event.data.name.length > limit, status: 'running',
          } }
        }
        case 'tool/result':
          return state.tool?.callId === event.data.message.toolCallId
            ? { ...state, tool: { ...state.tool, status: event.data.message.isError ? 'failed' : 'completed' } } : state
        default:
          return state
      }
    },
  }
}

/**
 * Select original facts within one shared text budget, prioritizing user requirements.
 * @param state - prepared Host projection at the current Session cursor.
 * @param proposed - direct input already claimed for the imminent step.
 * @param goal - current native Goal identity and text, when present.
 * @param activity - observed live execution phase.
 * @returns bounded classification materials without summaries or generated text.
 */
export function selectRoutingContext(state: RoutingContextState, proposed: readonly UserMessage[], goal: { id: string; objective: string } | undefined, activity: RoutingActivity) {
  let users = state.users
  for (const message of proposed) users = retain(users, material(message.id, message.content, state.budget), state.budget)
  let remaining = state.budget
  let truncated = state.omittedUsers
  const take = (item: Material): Material | null => {
    const text = item.text.slice(0, remaining)
    remaining -= text.length
    const excerpt = item.excerpt || text.length < item.text.length
    if (excerpt) truncated = true
    return text.length === 0 ? null : { id: item.id, text, excerpt }
  }
  const selected = new Map<string, Material>()
  const latest = users.at(-1)
  const first = users[0]
  const priority = [latest, first, ...users.slice(1, -1).toReversed()]
  for (const item of priority) {
    if (item === undefined || selected.has(item.id)) continue
    const kept = take(item)
    if (kept !== null) selected.set(item.id, kept)
  }
  const taskMessages = users.flatMap(item => selected.has(item.id) ? [selected.get(item.id)!] : [])
  const selectedGoal = goal === undefined ? null : take({ id: goal.id, text: goal.objective, excerpt: false })
  const recentAssistant = state.assistant === null ? null : take(state.assistant)
  let recentTool: ToolMaterial | null = null
  if (state.tool !== null) {
    const name = take({ id: state.tool.callId, text: state.tool.name, excerpt: false })
    const args = take({ id: state.tool.callId, text: state.tool.arguments, excerpt: state.tool.excerpt })
    if (name !== null) recentTool = { ...state.tool, name: name.text, arguments: args?.text ?? '', excerpt: name.excerpt || args?.excerpt === true || args === null && state.tool.arguments.length > 0 }
  }
  const previousTask: Material[] = []
  for (const item of state.previous) {
    const kept = take(item)
    if (kept !== null) previousTask.push(kept)
  }
  return {
    taskMessages, goal: selectedGoal, recentAssistant, recentTool, previousTask,
    activity, contextTruncated: truncated, taskTextMissing: state.missingUserText || taskMessages.length === 0,
  }
}
