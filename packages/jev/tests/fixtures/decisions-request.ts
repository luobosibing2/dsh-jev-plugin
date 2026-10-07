/** Published OpenRouter input alternatives used by keyless HTTP fixtures. */
import { z } from 'zod'

const input = z.union([z.string(), z.array(z.json()), z.record(z.string(), z.json())])

export const routerRequest = z.object({
  model: z.string(), state: input,
  questions: z.record(z.string(), z.discriminatedUnion('type', [
    z.object({ type: z.literal('choice'), instructions: input, criteria: z.record(z.string(), input.nullable()) }),
    z.object({ type: z.literal('score'), instructions: input, criteria: z.array(input).min(2).max(10) }),
    z.object({ type: z.literal('noul'), instructions: input, criteria: z.object({ true: input, false: input }).optional() }),
  ])).refine(questions => Object.keys(questions).length >= 1 && Object.keys(questions).length <= 200),
})
