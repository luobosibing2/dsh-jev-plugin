/** Profile-owned stage judgments, separate from native Session history. */
import { createHash } from 'node:crypto'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { StageAnalysisRecord } from './stage-types.ts'

const recordSchema: z.ZodType<StageAnalysisRecord> = z.object({
  id: z.string().min(1), sessionId: z.string().min(1), stepId: z.string().min(1), revision: z.number().int().min(1),
  sourceFingerprint: z.string().min(1), ruleVersion: z.string().min(1),
  status: z.enum(['unanalysed', 'pending', 'succeeded', 'failed', 'cancelled', 'interrupted', 'stale', 'unavailable']),
  label: z.enum(['input_parsing', 'problem_understanding', 'solution_planning', 'implementation',
    'review_validation', 'delivery_finalization', 'mixed', 'unknown']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
  model: z.string().optional(), configuredModel: z.string().optional(), operationId: z.string().optional(),
  connectionId: z.enum(['jev', 'luna-openrouter', 'luna-openai']).optional(),
  recordId: z.string().optional(),
  failure: z.object({ code: z.string(), message: z.string() }).optional(),
  updatedAt: z.string().optional(),
})

/** One profile never shares auxiliary classifications with another profile. */
export function stageStoreSpec(profileDir: string) {
  return defineDomain({
    name: 'jev_stage_' + createHash('sha256').update(profileDir).digest('hex').slice(0, 20),
    version: 1, layout: 'per-record', tables: { records: domainTable<string, StageAnalysisRecord>(recordSchema) },
  })
}

export class StageStore {
  private constructor(private readonly domain: Domain<ReturnType<typeof stageStoreSpec>>) {}

  static async open(facility: { open: (spec: ReturnType<typeof stageStoreSpec>) => Promise<Domain<ReturnType<typeof stageStoreSpec>>> }, profileDir: string): Promise<StageStore> {
    const store = new StageStore(await facility.open(stageStoreSpec(profileDir)))
    for (const record of store.all()) {
      if (record.status === 'pending') await store.save({ ...record, status: 'interrupted', updatedAt: new Date().toISOString() })
    }
    return store
  }

  all(): StageAnalysisRecord[] { return [...this.domain.table('records').entries()].map(([, record]) => record) }
  forSession(sessionId: string): StageAnalysisRecord[] { return this.all().filter(record => record.sessionId === sessionId) }
  async save(record: StageAnalysisRecord): Promise<void> { await this.domain.table('records').put(record.id, record) }
  async close(): Promise<void> { await this.domain.close() }
}
