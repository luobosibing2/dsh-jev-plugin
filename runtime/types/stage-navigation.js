/** Manual, persisted Jev classification over complete historical DSH steps. */
import { randomUUID } from 'node:crypto';
import s from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { SessionId } from '@deepseek-ai/dsh-session';
import { JevError } from "./index.js";
import { assembleStageHistory } from "./stage-history.js";
import { buildStageInput, STAGE_RULE_VERSION } from "./stage-input.js";
import { StageStore } from "./stage-store.js";
export const name = 'jev-stage-navigation';
export const inject = ['jev', 'sessionQuery', 'sessionController', 'storageDomain', 'profileContext', 'credentials', 'settings'];
export const FEATURE = 'stage-navigation';
export const Config = s.object({
    previousSteps: s.number().step(1).min(0).max(20).default(2).volatile(),
    previousChars: s.number().step(1).min(0).max(100_000).default(700).volatile(),
    maxRequestChars: s.number().step(1).min(2048).max(10_000_000).default(48_000).volatile(),
    concurrency: s.number().step(1).min(1).max(8).default(1).volatile(),
});
function latest(records) {
    return records.toSorted((a, b) => b.revision - a.revision)[0];
}
function summary(records, fingerprint, unavailable) {
    const current = records.filter(record => record.sourceFingerprint === fingerprint);
    const selected = latest(current) ?? latest(records.filter(record => record.status === 'succeeded')) ?? latest(records);
    if (selected === undefined)
        return unavailable === undefined ? { status: 'unanalysed' }
            : { status: 'unavailable', failure: { code: unavailable, message: unavailable.toLowerCase().replaceAll('_', ' ') } };
    const stale = selected.sourceFingerprint !== fingerprint;
    const previous = selected.status === 'succeeded' ? undefined
        : latest(records.filter(record => record.status === 'succeeded' && record.id !== selected.id && record.label !== undefined));
    return {
        status: stale ? 'stale' : selected.status,
        recordId: selected.id,
        ...selected.label === undefined ? {} : { label: selected.label },
        ...selected.confidence === undefined ? {} : { confidence: selected.confidence },
        ...selected.probabilities === undefined ? {} : { probabilities: selected.probabilities },
        ...selected.model === undefined ? {} : { model: selected.model },
        ...selected.configuredModel === undefined ? {} : { configuredModel: selected.configuredModel },
        ...selected.connectionId === undefined ? {} : { connectionId: selected.connectionId },
        ...selected.operationId === undefined ? {} : { operationId: selected.operationId },
        ...selected.failure === undefined ? {} : { failure: selected.failure },
        ...selected.updatedAt === undefined ? {} : { updatedAt: selected.updatedAt },
        ...previous === undefined ? {} : { previousResult: {
                recordId: previous.id, label: previous.label, stale: previous.sourceFingerprint !== fingerprint,
                ...previous.confidence === undefined ? {} : { confidence: previous.confidence },
                ...previous.probabilities === undefined ? {} : { probabilities: previous.probabilities },
                ...previous.model === undefined ? {} : { model: previous.model },
                ...previous.configuredModel === undefined ? {} : { configuredModel: previous.configuredModel },
                ...previous.connectionId === undefined ? {} : { connectionId: previous.connectionId },
                ...previous.updatedAt === undefined ? {} : { updatedAt: previous.updatedAt },
            } },
    };
}
/** Optional Host manager bound to the common Jev Remote namespace. */
export class StageNavigationManager {
    ctx;
    config;
    store;
    batches = new Map();
    bySession = new Map();
    starting = new Map();
    preparations = new Map();
    stopping = false;
    constructor(ctx, config, store) {
        this.ctx = ctx;
        this.config = config;
        this.store = store;
    }
    settings() {
        return { previousSteps: this.config.previousSteps.get(), previousChars: this.config.previousChars.get(),
            maxRequestChars: this.config.maxRequestChars.get(), concurrency: this.config.concurrency.get() };
    }
    async preparation(signal) {
        for (;;) {
            signal.throwIfAborted();
            const connections = this.ctx.jev.stageConnections();
            const connection = this.ctx.jev.judgmentConnectionIdentity();
            const identity = this.identity();
            const refs = [...new Set(connections.map(item => item.credentialRef))];
            const secrets = [];
            for (const ref of refs) {
                let value;
                try {
                    value = (await this.ctx.credentials.resolve(credentialRef(ref)))?.value;
                }
                catch {
                    throw new JevError('CREDENTIAL_UNAVAILABLE', 'Judgment credentials could not be checked for stage input redaction');
                }
                signal.throwIfAborted();
                if (value === undefined)
                    continue;
                if (value.length < 4)
                    throw new JevError('CREDENTIAL_UNSAFE', 'A judgment credential is too short for safe stage input redaction');
                secrets.push(value);
            }
            if (JSON.stringify(connections) === JSON.stringify(this.ctx.jev.stageConnections()) && identity === this.identity())
                return { secrets, identity, connection };
        }
    }
    identity() { return JSON.stringify(this.ctx.jev.stageConnectionIdentity()); }
    /** Probe the native history API's durable address checks before reading the same immutable cut. */
    async source(sessionId, signal) {
        const observation = await this.ctx.sessionQuery.observeSession(SessionId(sessionId), { signal, projectionMode: 'none' });
        try {
            const header = observation.header;
            const address = header.origin === 'subagent'
                ? header.parentSession === undefined
                    ? null
                    : { kind: 'subagent', parentSessionId: header.parentSession, childSessionId: header.id, mode: 'unknown' }
                : { kind: 'session', sessionId: header.id };
            if (address === null)
                throw new JevError('SESSION_ADDRESS_UNAVAILABLE', 'The selected subagent has no durable parent address');
            await this.ctx.sessionController.page({ address, throughSeq: observation.cursor, maxMessages: 1 }, signal);
            signal.throwIfAborted();
            return { cursor: observation.cursor, turns: assembleStageHistory(sessionId, observation.events) };
        }
        finally {
            observation[Symbol.dispose]();
        }
    }
    /** Read history and status without starting Jev or the native Agent. */
    async read(sessionId, signal) {
        const source = await this.source(sessionId, signal);
        const records = this.store.forSession(sessionId);
        const { secrets, identity } = await this.preparation(signal);
        const settings = this.settings();
        const turns = source.turns.map(turn => ({ ...turn, steps: turn.steps.map(step => {
                const input = buildStageInput(source.turns, step, settings, identity, secrets);
                const saved = records.filter(record => record.stepId === step.id);
                const analysis = summary(saved, input.fingerprint, input.kind === 'unavailable' ? input.code : undefined);
                const batch = this.bySession.get(sessionId);
                const claimed = batch?.tasks.findIndex(item => item.step.id === step.id) ?? -1;
                if ((analysis.status === 'pending' || analysis.status === 'unanalysed' && claimed >= 0 && claimed < (batch?.next ?? 0))
                    && batch !== undefined && batch.state.status !== 'running') {
                    return { ...step, classifiable: input.kind === 'ready', materialStatus: input.kind === 'ready' ? 'ready' : input.code,
                        analysis: { ...analysis, status: batch.state.status === 'cancelled' ? 'cancelled' : 'failed',
                            failure: batch.state.failure ?? { code: 'INTERRUPTED', message: 'Stage analysis did not finish' } } };
                }
                return { ...step, classifiable: input.kind === 'ready', materialStatus: input.kind === 'ready' ? 'ready' : input.code,
                    analysis };
            }) }));
        return {
            sessionId, cursor: source.cursor, turns, featureEnabled: this.ctx.jev.isFeatureEnabled(FEATURE),
            ...this.bySession.get(sessionId) === undefined ? {} : { batch: { ...this.bySession.get(sessionId).state } },
        };
    }
    /** Return the selected record only after the same native history check. */
    async detail(sessionId, stepId, requestedRecordId) {
        const snapshot = await this.read(sessionId, new AbortController().signal);
        const step = snapshot.turns.flatMap(turn => turn.steps).find(item => item.id === stepId);
        const recordId = requestedRecordId ?? step?.analysis.recordId;
        if (recordId === undefined)
            return null;
        if (step === undefined)
            return null;
        const record = this.store.forSession(sessionId).find(item => item.id === recordId && item.stepId === stepId);
        if (record === undefined)
            return null;
        const ledger = record.operationId === undefined ? null : await this.ctx.jev.getRecord(record.operationId);
        const attempt = ledger?.attemptRecords.at(-1);
        return {
            ...record, status: recordId === step.analysis.recordId ? step.analysis.status : record.status,
            ...attempt?.request === undefined ? {} : { request: attempt.request },
            ...attempt?.response === undefined ? {} : { response: attempt.response },
            ...attempt?.rawResponse === undefined ? {} : { rawResponse: attempt.rawResponse },
            ...attempt?.connection === undefined ? {} : { connection: attempt.connection },
            ...attempt?.networkRecords === undefined ? {} : { networkRecords: attempt.networkRecords },
            ...attempt?.usage === undefined ? {} : { usage: attempt.usage },
            ...attempt?.usageComplete === undefined ? {} : { usageComplete: attempt.usageComplete },
        };
    }
    /** Freeze one explicit user-selected scope; duplicate clicks share its active batch. */
    start(request) {
        if (this.stopping)
            throw new JevError('UNAVAILABLE', 'Stage navigation is stopping');
        if (!this.ctx.jev.isFeatureEnabled(FEATURE))
            throw new JevError('FEATURE_DISABLED', 'Stage navigation is disabled');
        const active = this.bySession.get(request.sessionId);
        if (active !== undefined && !active.done)
            return Promise.resolve({ ...active.state });
        const starting = this.starting.get(request.sessionId);
        if (starting !== undefined)
            return starting;
        if (!['missing', 'retry-failed', 'refresh'].includes(request.mode))
            throw new JevError('INVALID_SCOPE', 'Invalid stage analysis mode');
        const controller = new AbortController();
        this.preparations.set(request.sessionId, controller);
        const work = this.prepare(request, controller).finally(() => {
            if (this.preparations.get(request.sessionId) === controller)
                this.preparations.delete(request.sessionId);
            if (this.starting.get(request.sessionId) === work)
                this.starting.delete(request.sessionId);
        });
        this.starting.set(request.sessionId, work);
        return work;
    }
    async prepare(request, controller) {
        const snapshot = await this.read(request.sessionId, controller.signal);
        const selectedTurn = request.scope.kind === 'turn' ? request.scope.turn : undefined;
        const selected = selectedTurn !== undefined
            ? snapshot.turns.filter(turn => turn.turn === selectedTurn)
            : request.scope.kind === 'all' ? snapshot.turns.filter(turn => turn.endSeq !== undefined) : [];
        if (selected.length === 0 || selected.some(turn => turn.endSeq === undefined)) {
            throw new JevError('INVALID_SCOPE', 'Select one ended turn or all ended turns');
        }
        const { secrets, identity } = await this.preparation(controller.signal);
        if (controller.signal.aborted || this.stopping || !this.ctx.jev.isFeatureEnabled(FEATURE)) {
            throw new JevError('CANCELLED', 'Stage analysis was cancelled before dispatch');
        }
        const settings = this.settings();
        const tasks = [];
        for (const turn of selected)
            for (const step of turn.steps) {
                const status = step.analysis.status;
                if (request.mode === 'missing' && status !== 'unanalysed')
                    continue;
                if (request.mode === 'retry-failed' && !['failed', 'cancelled', 'interrupted'].includes(status))
                    continue;
                const input = buildStageInput(snapshot.turns, step, settings, identity, secrets);
                if (input.kind === 'ready')
                    tasks.push({ step, input });
            }
        const state = { id: randomUUID(), sessionId: request.sessionId,
            status: tasks.length === 0 ? 'completed' : 'running', total: tasks.length, completed: 0, failed: 0, cancelled: 0 };
        const batch = { state, controller, tasks, sourceTurns: snapshot.turns.slice(),
            next: 0, halt: false, done: tasks.length === 0 };
        this.batches.set(state.id, batch);
        this.bySession.set(request.sessionId, batch);
        if (tasks.length > 0)
            batch.work = this.run(batch, settings.concurrency).catch(() => {
                batch.state.status = 'failed';
                batch.state.failure = { code: 'RECORD_FAILURE', message: 'Stage batch could not finish recording results' };
            }).finally(() => { batch.done = true; });
        return { ...state };
    }
    async currentFingerprint(sessionId, stepId, signal) {
        const source = await this.source(sessionId, signal);
        const step = source.turns.flatMap(turn => turn.steps).find(item => item.id === stepId);
        if (step === undefined)
            return undefined;
        const { secrets, identity } = await this.preparation(signal);
        return buildStageInput(source.turns, step, this.settings(), identity, secrets).fingerprint;
    }
    async classify(batch, task) {
        const { step } = task;
        const prepared = await this.preparation(batch.controller.signal);
        const fresh = buildStageInput(batch.sourceTurns, step, this.settings(), prepared.identity, prepared.secrets);
        if (fresh.kind === 'unavailable')
            return 'failed';
        task.input = fresh;
        const input = fresh;
        const at = new Date().toISOString();
        const record = { id: randomUUID(), sessionId: batch.state.sessionId,
            stepId: step.id, revision: this.store.forSession(batch.state.sessionId).filter(item => item.stepId === step.id).length + 1,
            sourceFingerprint: input.fingerprint, ruleVersion: STAGE_RULE_VERSION,
            status: 'pending', updatedAt: at };
        await this.store.save(record);
        if (batch.controller.signal.aborted || !this.ctx.jev.isFeatureEnabled(FEATURE)) {
            await this.store.save({ ...record, status: 'cancelled', updatedAt: new Date().toISOString() });
            return 'cancelled';
        }
        const outcome = await this.ctx.jev.judgeOnce({
            featureId: FEATURE, signal: batch.controller.signal,
            connection: prepared.connection,
            link: { sessionId: batch.state.sessionId, stepId: step.id, inputVersion: input.fingerprint },
            refresh: () => input.request,
            canAdopt: async () => {
                if (batch.controller.signal.aborted || !this.ctx.jev.isFeatureEnabled(FEATURE))
                    return 'Stage analysis was cancelled';
                return await this.currentFingerprint(batch.state.sessionId, step.id, batch.controller.signal) === input.fingerprint
                    ? true : 'Recorded step material or classification settings changed';
            },
        });
        const updatedAt = new Date().toISOString();
        if (outcome.kind === 'ok') {
            const answer = outcome.response.answers.find(item => item.id === 'stage');
            if (answer?.kind !== 'choice')
                throw new JevError('INVALID_RESPONSE', 'Jev did not return a stage choice');
            const ledger = await this.ctx.jev.getRecord(outcome.operationId);
            const attempt = ledger?.attemptRecords.find(item => item.id === outcome.attemptId);
            const raw = attempt?.rawResponse;
            const rawModel = raw !== undefined && raw !== null && typeof raw === 'object'
                ? Object.entries(raw).find(([key]) => key === 'model')?.[1] : undefined;
            const returnedModel = attempt?.networkRecords?.at(-1)?.returnedModel ?? (typeof rawModel === 'string' ? rawModel : undefined);
            const successful = { ...record, status: 'succeeded', label: answer.optionId,
                ...answer.confidence === undefined ? {} : { confidence: answer.confidence },
                ...answer.probabilities === undefined ? {} : { probabilities: answer.probabilities },
                ...returnedModel === undefined ? {} : { model: returnedModel },
                configuredModel: attempt?.connection.model ?? prepared.connection.model,
                ...attempt?.connection.connectionId === undefined ? {} : { connectionId: attempt.connection.connectionId },
                operationId: outcome.operationId, updatedAt };
            let current;
            if (!batch.controller.signal.aborted && this.ctx.jev.isFeatureEnabled(FEATURE)) {
                try {
                    current = await this.currentFingerprint(batch.state.sessionId, step.id, batch.controller.signal);
                }
                catch (error) {
                    if (!batch.controller.signal.aborted)
                        throw error;
                }
            }
            if (batch.controller.signal.aborted || !this.ctx.jev.isFeatureEnabled(FEATURE)
                || current !== input.fingerprint) {
                await this.store.save({ ...record, status: 'cancelled', operationId: outcome.operationId, updatedAt });
                return 'cancelled';
            }
            await this.store.save(successful);
            if (batch.controller.signal.aborted || !this.ctx.jev.isFeatureEnabled(FEATURE)) {
                await this.store.save({ ...record, status: 'cancelled', operationId: outcome.operationId,
                    updatedAt: new Date().toISOString() });
                return 'cancelled';
            }
            return 'ok';
        }
        if (outcome.kind === 'cancelled' || batch.controller.signal.aborted) {
            await this.store.save({ ...record, status: 'cancelled',
                ...'operationId' in outcome ? { operationId: outcome.operationId } : {}, updatedAt });
            return 'cancelled';
        }
        const failure = outcome.kind === 'failed' ? outcome.failure : { code: 'NOT_ADOPTED', message: outcome.reason };
        await this.store.save({ ...record, status: 'failed', failure,
            ...outcome.operationId === undefined ? {} : { operationId: outcome.operationId }, updatedAt });
        return ['AUTH', 'PAYMENT_REQUIRED', 'CREDENTIAL_MISSING', 'RATE_LIMIT'].includes(failure.code) ? 'halt' : 'failed';
    }
    async run(batch, concurrency) {
        const worker = async () => {
            while (!batch.controller.signal.aborted && !batch.halt && batch.next < batch.tasks.length) {
                const task = batch.tasks[batch.next++];
                try {
                    const outcome = await this.classify(batch, task);
                    if (outcome === 'ok')
                        batch.state.completed++;
                    else if (outcome === 'cancelled')
                        batch.state.cancelled++;
                    else {
                        batch.state.failed++;
                        if (outcome === 'halt') {
                            batch.halt = true;
                            batch.state.failure = { code: 'CONNECTION_BLOCKED', message: 'Jev credentials or account require attention' };
                        }
                    }
                }
                catch {
                    batch.halt = true;
                    batch.state.failed++;
                    batch.state.failure = { code: 'RECORD_FAILURE', message: 'Stage result could not be saved or read' };
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, batch.tasks.length) }, () => worker()));
        if (batch.controller.signal.aborted) {
            for (const task of batch.tasks.slice(batch.next)) {
                try {
                    await this.store.save({ id: randomUUID(), sessionId: batch.state.sessionId, stepId: task.step.id,
                        revision: this.store.forSession(batch.state.sessionId).filter(item => item.stepId === task.step.id).length + 1,
                        sourceFingerprint: task.input.fingerprint, ruleVersion: STAGE_RULE_VERSION,
                        status: 'cancelled', updatedAt: new Date().toISOString() });
                }
                catch {
                    batch.state.failure = { code: 'RECORD_FAILURE', message: 'Some cancelled targets could not be saved' };
                }
                batch.state.cancelled++;
            }
        }
        batch.state.status = batch.controller.signal.aborted ? 'cancelled' : batch.halt ? 'failed' : 'completed';
    }
    async cancel(batchId) {
        const batch = this.batches.get(batchId);
        if (batch?.state.status === 'running')
            batch.controller.abort();
        await batch?.work;
    }
    /** Disablement and unload stop only this consumer's auxiliary work. */
    async stop() {
        this.stopping = true;
        for (const controller of this.preparations.values())
            controller.abort();
        for (const batch of this.batches.values())
            if (batch.state.status === 'running')
                batch.controller.abort();
        await Promise.allSettled([...this.starting.values()]);
        await Promise.allSettled([...this.batches.values()].map(batch => batch.work));
        await this.store.close();
    }
    cancelRunning() {
        for (const controller of this.preparations.values())
            controller.abort();
        for (const batch of this.batches.values())
            if (batch.state.status === 'running')
                batch.controller.abort();
    }
}
/** Register a disabled-by-default Jev feature and its optional Host history provider. */
export async function apply(ctx, config) {
    const store = await StageStore.open(ctx.storageDomain, ctx.profileContext.dir);
    const manager = new StageNavigationManager(ctx, config, store);
    ctx.effect(() => ctx.jev.registerFeature({ id: FEATURE, name: 'Stage navigation',
        description: 'Manually classify complete recorded Session steps for historical navigation' }), 'jev-stage-navigation.feature');
    ctx.effect(() => ctx.jev.registerStageNavigation(manager), 'jev-stage-navigation.remote');
    ctx.effect(() => ctx.jev.onFeatureStateChange(features => {
        if (features[FEATURE] !== true)
            manager.cancelRunning();
    }), 'jev-stage-navigation.enabled');
    ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), 'jev-stage-navigation.settings');
    ctx.effect(() => () => manager.stop(), 'jev-stage-navigation.storage');
}
//# sourceMappingURL=stage-navigation.js.map