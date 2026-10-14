/** Luna Decisions request validation used by keyless HTTP fixtures. */
import { z } from 'zod'

const input = z.union([z.string(), z.array(z.json()), z.record(z.string(), z.json())])

export const routerRequest = z.object({
  model: z.string(), state: input,
  questions: z.record(z.string(), z.discriminatedUnion('type', [
    z.object({ type: z.literal('choice'), instructions: input, criteria: z.record(z.string(), input.nullable())
      .refine(criteria => Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 255) }),
    z.object({ type: z.literal('score'), instructions: input, criteria: z.array(input).min(2).max(10) }),
    z.object({ type: z.literal('noul'), instructions: input, criteria: z.object({ true: input, false: input }).optional() }),
  ])).refine(questions => Object.keys(questions).length >= 1 && Object.keys(questions).length <= 200),
})

export const nativeRequest = z.object({
  model: z.string(), input: z.string(),
  questions: z.array(z.discriminatedUnion('type', [
    z.object({ name: z.string(), type: z.literal('choice'), instructions: z.string(),
      choices: z.array(z.object({ value: z.string(), description: z.string().optional() })).min(2).max(255)
        .refine(choices => new Set(choices.map(choice => choice.value)).size === choices.length) }),
    z.object({ name: z.string(), type: z.literal('score'), instructions: z.string(),
      levels: z.array(z.object({ label: z.string(), description: z.string().optional() })).min(2).max(10) }),
    z.object({ name: z.string(), type: z.literal('predicate'), instructions: z.string() }),
  ])).min(1),
})
