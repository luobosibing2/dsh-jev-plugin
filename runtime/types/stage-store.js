/** Profile-owned stage judgments, separate from native Session history. */
import { createHash } from 'node:crypto';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
const recordSchema = z.object({
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
});
/** One profile never shares auxiliary classifications with another profile. */
export function stageStoreSpec(profileDir) {
    return defineDomain({
        name: 'jev_stage_' + createHash('sha256').update(profileDir).digest('hex').slice(0, 20),
        version: 1, layout: 'per-record', tables: { records: domainTable(recordSchema) },
    });
}
export class StageStore {
    domain;
    constructor(domain) {
        this.domain = domain;
    }
    static async open(facility, profileDir) {
        const store = new StageStore(await facility.open(stageStoreSpec(profileDir)));
        for (const record of store.all()) {
            if (record.status === 'pending')
                await store.save({ ...record, status: 'interrupted', updatedAt: new Date().toISOString() });
        }
        return store;
    }
    all() { return [...this.domain.table('records').entries()].map(([, record]) => record); }
    forSession(sessionId) { return this.all().filter(record => record.sessionId === sessionId); }
    async save(record) { await this.domain.table('records').put(record.id, record); }
    async close() { await this.domain.close(); }
}
//# sourceMappingURL=stage-store.js.map