var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
/** Jev common Host service and typed consumer API. */
import { Service } from '@deepseek-ai/cordis';
import s from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
import { JevAdapter, JEV_PROVIDER } from "./adapter.js";
import { JevLedger } from "./ledger.js";
import { aggregateUsage, replayNetworkResponses, validateRequest } from "./wire.js";
import { resolveConnectionIdentity } from "./types.js";
export { JEV_PROVIDER } from "./adapter.js";
/** Stable failure code without provider payload or credential text. */
export class JevError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'JevError';
    }
}
const PROBE = {
    state: { diagnostic: 'jev-connection-test' },
    questions: [
        { id: 'route', kind: 'choice', prompt: 'Choose the diagnostic option.', options: [
                { id: 'left', description: 'Diagnostic option left' }, { id: 'right', description: 'Diagnostic option right' },
            ] },
        { id: 'risk', kind: 'score', prompt: 'Score this fixed diagnostic on the supplied levels.', levels: ['low', 'medium', 'high'] },
        { id: 'ready', kind: 'noul', prompt: 'Is this a fixed connection diagnostic?' },
    ],
};
/** Validated live configuration presented through DSH settings. */
export const Config = s.object({
    baseUrl: s.string().pattern(/^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/).default('').volatile(),
    model: s.string().pattern(/^[^\s]+$/).default('jev-latest').volatile(),
    credentialRef: s.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('JEV_API_KEY').volatile(),
    timeoutMs: s.number().step(1).min(1).max(300_000).default(10_000).volatile(),
    features: s.dict(s.boolean()).default({}).volatile(),
    judgmentModel: s.union(['jev', 'luna']).default('jev').volatile(),
    lunaApi: s.union(['openrouter', 'openai']).default('openrouter').volatile(),
    lunaOpenRouterBaseUrl: s.string().pattern(/^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/).default('https://openrouter.ai/api/alpha/decisions').volatile(),
    lunaOpenRouterCredentialRef: s.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('JEV_LUNA_OPENROUTER_API_KEY').volatile(),
    lunaOpenAIBaseUrl: s.string().pattern(/^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/).default('https://api.openai.com/v1/decisions').volatile(),
    lunaOpenAICredentialRef: s.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('JEV_LUNA_OPENAI_API_KEY').volatile(),
});
function safeFailure(error) {
    if (error instanceof JevError)
        return { code: error.code, message: error.message };
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
        const code = error.code;
        if (['AUTH', 'PAYMENT_REQUIRED', 'RATE_LIMIT', 'SERVER', 'BAD_REQUEST', 'NETWORK', 'ABORTED', 'TIMEOUT', 'REFUSAL', 'INVALID_RESPONSE', 'FEATURE_DISABLED'].includes(code)) {
            return { code, message: `Jev ${code.toLowerCase().replaceAll('_', ' ')}` };
        }
    }
    return { code: 'SERVICE_FAILURE', message: 'Jev request failed' };
}
/** One profile's public judgment service and browser Remote namespace. */
let JevService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _listFeatures_decorators;
    let _listRecords_decorators;
    let _getRecord_decorators;
    let _getStageNavigation_decorators;
    let _startStageAnalysis_decorators;
    let _cancelStageAnalysis_decorators;
    let _getStageAnalysisRecord_decorators;
    let _getCredentialStatus_decorators;
    let _setCredential_decorators;
    let _testConnection_decorators;
    return class JevService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _listFeatures_decorators = [Remote('listFeatures')];
            _listRecords_decorators = [Remote('listRecords')];
            _getRecord_decorators = [Remote('getRecord')];
            _getStageNavigation_decorators = [Remote('getStageNavigation')];
            _startStageAnalysis_decorators = [Remote('startStageAnalysis')];
            _cancelStageAnalysis_decorators = [Remote('cancelStageAnalysis')];
            _getStageAnalysisRecord_decorators = [Remote('getStageAnalysisRecord')];
            _getCredentialStatus_decorators = [Remote('getCredentialStatus')];
            _setCredential_decorators = [Remote('setCredential')];
            _testConnection_decorators = [Remote('testConnection')];
            __esDecorate(this, null, _listFeatures_decorators, { kind: "method", name: "listFeatures", static: false, private: false, access: { has: obj => "listFeatures" in obj, get: obj => obj.listFeatures }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listRecords_decorators, { kind: "method", name: "listRecords", static: false, private: false, access: { has: obj => "listRecords" in obj, get: obj => obj.listRecords }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getRecord_decorators, { kind: "method", name: "getRecord", static: false, private: false, access: { has: obj => "getRecord" in obj, get: obj => obj.getRecord }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getStageNavigation_decorators, { kind: "method", name: "getStageNavigation", static: false, private: false, access: { has: obj => "getStageNavigation" in obj, get: obj => obj.getStageNavigation }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _startStageAnalysis_decorators, { kind: "method", name: "startStageAnalysis", static: false, private: false, access: { has: obj => "startStageAnalysis" in obj, get: obj => obj.startStageAnalysis }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _cancelStageAnalysis_decorators, { kind: "method", name: "cancelStageAnalysis", static: false, private: false, access: { has: obj => "cancelStageAnalysis" in obj, get: obj => obj.cancelStageAnalysis }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getStageAnalysisRecord_decorators, { kind: "method", name: "getStageAnalysisRecord", static: false, private: false, access: { has: obj => "getStageAnalysisRecord" in obj, get: obj => obj.getStageAnalysisRecord }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getCredentialStatus_decorators, { kind: "method", name: "getCredentialStatus", static: false, private: false, access: { has: obj => "getCredentialStatus" in obj, get: obj => obj.getCredentialStatus }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setCredential_decorators, { kind: "method", name: "setCredential", static: false, private: false, access: { has: obj => "setCredential" in obj, get: obj => obj.setCredential }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _testConnection_decorators, { kind: "method", name: "testConnection", static: false, private: false, access: { has: obj => "testConnection" in obj, get: obj => obj.testConnection }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        config = __runInitializers(this, _instanceExtraInitializers);
        static inject = ['llm', 'credentials', 'storageDomain', 'userQuestions', 'profileContext', 'settings'];
        static Config = Config;
        adapter = new JevAdapter();
        features = new Map();
        ledger;
        active = new Set();
        controllers = new Set();
        disposing = false;
        featureListeners = new Set();
        stageNavigation;
        constructor(ctx, config) {
            super(ctx, 'jev');
            this.config = config;
        }
        async [Service.init]() {
            this.ledger = await JevLedger.open(this.ctx.storageDomain, this.ctx.profileContext.dir);
            this.ctx.effect(() => async () => {
                this.disposing = true;
                for (const controller of this.controllers)
                    controller.abort();
                await Promise.allSettled([...this.active]);
                await this.ledger?.close();
            }, 'jev.ledger');
            this.ctx.effect(() => this.ctx.llm.registerAdapter([JEV_PROVIDER], this.adapter), 'jev.adapter');
            this.ctx.effect(() => this.ctx.settings.configure({ auto: false }, this.ctx.fiber), 'jev.settings');
            let features = JSON.stringify(this.config.features.get());
            this.ctx.on('loader/volatile-update', () => {
                const next = this.config.features.get();
                const identity = JSON.stringify(next);
                if (identity === features)
                    return;
                features = identity;
                const snapshot = Object.freeze({ ...next });
                for (const listener of this.featureListeners)
                    listener(snapshot);
            });
        }
        records() {
            if (this.ledger === undefined)
                throw new JevError('UNAVAILABLE', 'Jev service is unavailable');
            return this.ledger;
        }
        /** Register a consumer feature for this Host lifetime; the caller owns the disposer. */
        registerFeature(feature) {
            if (!/^[a-z][a-z0-9-]*$/.test(feature.id) || !feature.name.trim() || !feature.description.trim()) {
                throw new JevError('INVALID_FEATURE', 'Jev feature identity and description are required');
            }
            if (this.features.has(feature.id))
                throw new JevError('DUPLICATE_FEATURE', `Jev feature ${feature.id} is already registered`);
            this.features.set(feature.id, feature);
            return () => { if (this.features.get(feature.id) === feature)
                this.features.delete(feature.id); };
        }
        /** Current registrations, with unknown and newly registered ids disabled by default. */
        async listFeatures() {
            const enabled = this.config.features.get();
            return [...this.features.values()].map(feature => ({ ...feature, enabled: enabled[feature.id] === true }));
        }
        /** Query only the current profile, with bounded page size and optional filters. */
        async listRecords(filter) {
            if (filter.limit !== undefined && (!Number.isSafeInteger(filter.limit) || filter.limit < 1 || filter.limit > 100)) {
                throw new JevError('INVALID_FILTER', 'Jev record limit must be between 1 and 100');
            }
            return this.records().list(filter);
        }
        /** Read one current-profile operation after the list has identified it. */
        async getRecord(id) { return this.records().get(id); }
        /** Bind the optional Host stage consumer while its plugin row is active. */
        registerStageNavigation(manager) {
            if (this.stageNavigation !== undefined)
                throw new JevError('DUPLICATE_FEATURE', 'Stage navigation is already registered');
            this.stageNavigation = manager;
            return () => { if (this.stageNavigation === manager)
                this.stageNavigation = undefined; };
        }
        stages() {
            if (this.stageNavigation === undefined)
                throw new JevError('UNAVAILABLE', 'Stage navigation is unavailable');
            return this.stageNavigation;
        }
        /** Read one complete authorized Session cut and its auxiliary stage results. */
        getStageNavigation(sessionId, signal) {
            return this.stages().read(sessionId, signal);
        }
        /** Start only a user-requested batch; returning does not await model calls. */
        startStageAnalysis(request) {
            return this.stages().start(request);
        }
        /** Cancel auxiliary requests without cancelling the native Agent. */
        cancelStageAnalysis(batchId) { return this.stages().cancel(batchId); }
        /** Load exact persisted input and raw Jev answer for one selected step. */
        getStageAnalysisRecord(sessionId, stepId, recordId) {
            return this.stages().detail(sessionId, stepId, recordId);
        }
        /** Report credential presence, source, and writability without its value. */
        async getCredentialStatus(connection) {
            const identity = this.savedConnection(connection);
            const info = await this.ctx.credentials.describe(credentialRef(identity.credentialRef));
            return { connection: identity, configured: info.configured, writable: info.writable, ...info.source === undefined ? {} : { source: info.source } };
        }
        /** Save or replace the current profile's configured credential reference. */
        async setCredential(connection, value) {
            if (value.trim().length === 0)
                throw new JevError('INVALID_CREDENTIAL', 'Jev key must not be blank');
            const identity = this.savedConnection(connection);
            await this.ctx.credentials.set(credentialRef(identity.credentialRef), value.trim());
            const info = await this.ctx.credentials.describe(credentialRef(identity.credentialRef));
            return { connection: identity, configured: info.configured, writable: info.writable, ...info.source === undefined ? {} : { source: info.source } };
        }
        /** Run one fixed diagnostic without a business feature or user state. */
        async testConnection(connection, signal) {
            const identity = this.savedConnection(connection, true);
            return this.runActive(signal, async (lifetime) => {
                const started = Date.now();
                const operation = await this.records().create('diagnostic', {}, true);
                try {
                    const result = await this.tryOnce(operation.id, PROBE, undefined, lifetime, undefined, identity);
                    if (lifetime.aborted)
                        await this.records().setStatus(operation.id, 'cancelled');
                    return {
                        ok: result.ok,
                        latencyMs: Date.now() - started,
                        recordId: operation.id,
                        connection: identity,
                        ...result.ok ? {} : { failure: result.failure },
                    };
                }
                catch (error) {
                    if (!(error instanceof JevError && error.code === 'LOG_WRITE_FAILED')) {
                        await this.records().setStatus(operation.id, lifetime.aborted ? 'cancelled' : 'failed');
                    }
                    throw error;
                }
            });
        }
        /** Judge one dependent operation; only a human retry invokes `refresh` again. */
        judge(options) {
            return this.runActive(options.signal, lifetime => this.judgeOwned(options, lifetime));
        }
        /** Make one logged attempt without human waiting or automatic retry. Only `ok` permits adoption. */
        judgeOnce(options) {
            return this.runActive(options.signal, async (lifetime) => {
                let operationId;
                try {
                    if (!this.features.has(options.featureId))
                        throw new JevError('UNKNOWN_FEATURE', 'Jev feature is not registered');
                    if (!this.isEnabled(options.featureId))
                        throw new JevError('FEATURE_DISABLED', 'Jev feature is disabled');
                    const operation = await this.records().create(options.featureId, options.link);
                    operationId = operation.id;
                    if (lifetime.aborted)
                        return this.cancel(operation.id);
                    const request = await this.untilAbort(Promise.resolve(options.refresh(lifetime)), lifetime);
                    validateRequest(request);
                    const attempted = await this.tryOnce(operation.id, request, options.interpret, lifetime, options.featureId, options.connection);
                    if (lifetime.aborted)
                        return this.cancel(operation.id);
                    if (!attempted.ok)
                        return { kind: 'failed', operationId, failure: attempted.failure };
                    const current = options.canAdopt === undefined ? true
                        : await this.untilAbort(Promise.resolve(options.canAdopt(attempted.response, lifetime)), lifetime);
                    if (lifetime.aborted)
                        return this.cancel(operation.id);
                    if (current !== true) {
                        const reason = current || 'Target is no longer current';
                        await this.writeReceipt(operation.id, { id: 'not-adopted', status: 'not-adopted', reason, at: new Date().toISOString() });
                        return { kind: 'not-adopted', operationId, reason };
                    }
                    return { kind: 'ok', operationId, attemptId: attempted.attemptId, response: attempted.response };
                }
                catch (error) {
                    const code = error instanceof JevError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'SERVICE_FAILURE';
                    const failure = { code, message: 'Jev ' + code.toLowerCase().replaceAll('_', ' ') };
                    if (operationId !== undefined) {
                        try {
                            if (lifetime.aborted)
                                await this.records().setStatus(operationId, 'cancelled');
                            else
                                await this.records().failOperation(operationId, failure);
                        }
                        catch { /* A failed ledger remains unconfirmed; this background path never blocks the Agent. */ }
                    }
                    if (lifetime.aborted && operationId !== undefined)
                        return { kind: 'cancelled', operationId };
                    return { kind: 'failed', ...operationId === undefined ? {} : { operationId }, failure };
                }
            }).catch(error => ({ kind: 'failed', failure: safeFailure(error) }));
        }
        runActive(outer, execute) {
            if (this.disposing)
                return Promise.reject(new JevError('UNAVAILABLE', 'Jev service is stopping'));
            const controller = new AbortController();
            this.controllers.add(controller);
            const signal = outer === undefined ? controller.signal : AbortSignal.any([controller.signal, outer]);
            const task = execute(signal).finally(() => {
                this.controllers.delete(controller);
                this.active.delete(task);
            });
            this.active.add(task);
            return task;
        }
        async untilAbort(work, signal) {
            if (signal.aborted)
                throw new JevError('CANCELLED', 'Jev operation was cancelled');
            return new Promise((resolve, reject) => {
                const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(new JevError('CANCELLED', 'Jev operation was cancelled')); };
                signal.addEventListener('abort', onAbort, { once: true });
                void work.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                });
            });
        }
        async judgeOwned(options, lifetime) {
            if (!this.features.has(options.featureId))
                throw new JevError('UNKNOWN_FEATURE', 'Jev feature is not registered');
            if (!this.isEnabled(options.featureId))
                throw new JevError('FEATURE_DISABLED', 'Jev feature is disabled');
            if (this.disposing)
                throw new JevError('UNAVAILABLE', 'Jev service is stopping');
            const operation = await this.records().create(options.featureId, options.link);
            try {
                for (;;) {
                    if (lifetime.aborted)
                        return this.cancel(operation.id);
                    if (!this.isEnabled(options.featureId)) {
                        const choice = await this.ask(options.agent, lifetime, 'Jev feature is disabled. Enable it to retry or cancel.');
                        if (choice === 'cancel')
                            return this.cancel(operation.id);
                        continue;
                    }
                    const request = await this.untilAbort(Promise.resolve(options.refresh(lifetime)), lifetime);
                    validateRequest(request);
                    const attempted = await this.tryOnce(operation.id, request, options.interpret, lifetime, options.featureId);
                    if (lifetime.aborted)
                        return this.cancel(operation.id);
                    if (attempted.ok) {
                        if (options.canAdopt !== undefined) {
                            const current = await this.untilAbort(Promise.resolve(options.canAdopt(attempted.response, lifetime)), lifetime);
                            if (lifetime.aborted)
                                return this.cancel(operation.id);
                            if (current !== true) {
                                const reason = current || 'Target is no longer current';
                                await this.writeReceipt(operation.id, { id: 'not-adopted', status: 'not-adopted', reason, at: new Date().toISOString() });
                                return { kind: 'not-adopted', operationId: operation.id, reason };
                            }
                        }
                        return { kind: 'ok', operationId: operation.id, attemptId: attempted.attemptId, response: attempted.response };
                    }
                    await this.records().setStatus(operation.id, 'waiting');
                    const choice = await this.ask(options.agent, lifetime, `${attempted.failure.message}. Retry with current input or cancel?`);
                    if (choice === 'cancel')
                        return this.cancel(operation.id);
                }
            }
            catch (error) {
                if (!(error instanceof JevError && (error.code === 'LOG_WRITE_FAILED' || error.code === 'RECEIPT_NOT_SAVED'))) {
                    await this.records().setStatus(operation.id, lifetime.aborted ? 'cancelled' : 'failed');
                }
                if (lifetime.aborted)
                    return { kind: 'cancelled', operationId: operation.id };
                throw error;
            }
        }
        async cancel(operationId) {
            await this.records().setStatus(operationId, 'cancelled');
            return { kind: 'cancelled', operationId };
        }
        isEnabled(id) { return this.isFeatureEnabled(id); }
        /** Read this profile's current enablement synchronously; absent feature ids are disabled. */
        isFeatureEnabled(featureId) { return this.config.features.get()[featureId] === true; }
        /** Observe committed feature-setting changes synchronously; the consumer owns the disposer. */
        onFeatureStateChange(listener) {
            this.featureListeners.add(listener);
            return () => { this.featureListeners.delete(listener); };
        }
        async ask(agent, signal, detail) {
            try {
                const answer = await this.untilAbort(this.ctx.userQuestions.ask({
                    agent, signal,
                    questions: [{ id: 'jev-resolution', question: 'Jev 判断需要您的决定 / Jev judgment needs your decision',
                            detail: `${detail}\n失败后不会自动继续。请选择重试或取消。 / Jev will not continue automatically. Choose retry or cancel.`,
                            options: [{ label: '重试 / Retry' }, { label: '取消 / Cancel' }] }],
                }), signal);
                const choice = answer.answers.find(item => item.id === 'jev-resolution');
                if (choice?.selected.length !== 1 || (choice.custom ?? '').trim() !== '') {
                    throw new JevError('INVALID_HUMAN_ANSWER', 'Jev needs an explicit Retry or Cancel selection');
                }
                const [selected] = choice.selected;
                if (selected === '重试 / Retry' || selected === '重试' || selected === 'Retry')
                    return 'retry';
                if (selected === '取消 / Cancel' || selected === '取消' || selected === 'Cancel')
                    return 'cancel';
                throw new JevError('INVALID_HUMAN_ANSWER', 'Jev needs an explicit Retry or Cancel selection');
            }
            catch (error) {
                if (signal.aborted)
                    throw new JevError('CANCELLED', 'Jev operation was cancelled');
                if (error instanceof JevError)
                    throw error;
                throw new JevError('NO_INTERFACE', 'Jev requires an available Web question interface to continue');
            }
        }
        configValues() {
            return { baseUrl: this.config.baseUrl.get(), model: this.config.model.get(), credentialRef: this.config.credentialRef.get(),
                timeoutMs: this.config.timeoutMs.get(), features: this.config.features.get(),
                judgmentModel: this.config.judgmentModel.get(), lunaApi: this.config.lunaApi.get(),
                lunaOpenRouterBaseUrl: this.config.lunaOpenRouterBaseUrl.get(), lunaOpenRouterCredentialRef: this.config.lunaOpenRouterCredentialRef.get(),
                lunaOpenAIBaseUrl: this.config.lunaOpenAIBaseUrl.get(), lunaOpenAICredentialRef: this.config.lunaOpenAICredentialRef.get() };
        }
        connectionIdentity(id) {
            return resolveConnectionIdentity(this.configValues(), id);
        }
        savedConnection(expected, active = false) {
            if (!['jev', 'luna-openrouter', 'luna-openai'].includes(expected.connectionId))
                throw new JevError('CONNECTION_CHANGED', 'Refresh the saved judgment connection');
            const identity = this.connectionIdentity(active ? undefined : expected.connectionId);
            if (expected.connectionId !== identity.connectionId || expected.baseUrl !== identity.baseUrl || expected.model !== identity.model
                || expected.credentialRef !== identity.credentialRef || expected.timeoutMs !== identity.timeoutMs) {
                throw new JevError('CONNECTION_CHANGED', 'The saved judgment connection changed; refresh before continuing');
            }
            return identity;
        }
        /** Stable non-secret connection settings used to decide whether an old stage result is current. */
        stageConnectionIdentity() {
            const { connectionId, ...legacy } = this.connectionIdentity();
            // Retain existing Jev fingerprint bytes; Luna includes its explicit protocol identity.
            return connectionId === 'jev' ? legacy : { ...legacy, connectionId };
        }
        /** All saved references must be checked before historical input is released to a provider. */
        stageConnections() {
            return ['jev', 'luna-openrouter', 'luna-openai'].map(id => this.connectionIdentity(id));
        }
        /** Current saved connection without authentication values. */
        judgmentConnectionIdentity() {
            return this.connectionIdentity();
        }
        async tryOnce(operationId, request, interpret, outerSignal, featureId, expectedConnection) {
            let snapshot;
            try {
                snapshot = JSON.parse(JSON.stringify(request));
                validateRequest(snapshot);
            }
            catch {
                throw new JevError('INVALID_INPUT', 'Jev request must contain valid JSON state and questions');
            }
            const identity = expectedConnection === undefined ? this.connectionIdentity() : this.savedConnection(expectedConnection, true);
            const attempt = await this.records().startAttempt(operationId, snapshot, {
                baseUrl: identity.baseUrl, model: identity.model, credentialRef: identity.credentialRef, connectionId: identity.connectionId,
            }).catch(() => { throw new JevError('LOG_WRITE_FAILED', 'Jev input could not be saved; no request was sent'); });
            let rawResponse;
            let response;
            let networkRecords = [];
            let usage;
            let usageComplete = false;
            const timeout = AbortSignal.timeout(identity.timeoutMs);
            const signal = AbortSignal.any([timeout, ...outerSignal === undefined ? [] : [outerSignal]]);
            try {
                if (!identity.baseUrl || !identity.model || !identity.credentialRef) {
                    throw new JevError('CONNECTION_MISSING', 'Jev service address, model, or credential reference is missing');
                }
                const key = await this.untilAbort(this.ctx.credentials.resolve(credentialRef(identity.credentialRef)), signal);
                if (key === undefined)
                    throw new JevError('CREDENTIAL_MISSING', 'Jev credential is not configured');
                const connection = { ...identity, apiKey: key.value };
                const issued = this.adapter.issue(snapshot, connection, featureId === undefined ? undefined : () => this.isEnabled(featureId), records => this.records().saveNetwork(operationId, attempt.id, records));
                networkRecords = issued.records;
                try {
                    let text;
                    let finished = false;
                    for await (const chunk of this.ctx.llm.stream({
                        provider: JEV_PROVIDER, model: identity.model,
                        messages: [{ role: 'user', content: [{ type: 'text', text: issued.envelope }] }], signal,
                    })) {
                        if (chunk.type === 'block-end' && chunk.block.type === 'text')
                            text = chunk.block.text;
                        if (chunk.type === 'finish') {
                            finished = true;
                            if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
                                throw new JevError(outerSignal?.aborted ? 'CANCELLED' : timeout.aborted ? 'TIMEOUT' : chunk.reason.failure.code, outerSignal?.aborted ? 'Jev operation was cancelled' : timeout.aborted ? 'Jev request timed out' : 'Jev request failed');
                            }
                            if (chunk.reason.kind !== 'stop')
                                throw new JevError('INVALID_RESPONSE', 'Jev did not complete a typed answer');
                        }
                    }
                    if (!finished || text === undefined)
                        throw new JevError('INVALID_RESPONSE', 'Jev returned no answer');
                    try {
                        response = replayNetworkResponses(snapshot, networkRecords, identity.connectionId);
                        rawResponse = networkRecords.length === 1 ? networkRecords[0]?.rawResponse : undefined;
                        const aggregated = aggregateUsage(networkRecords, true);
                        usage = aggregated.usage;
                        usageComplete = aggregated.usageComplete;
                    }
                    catch {
                        throw new JevError('INVALID_RESPONSE', 'Jev answer failed complete type validation');
                    }
                }
                finally {
                    issued.release();
                }
                if (outerSignal?.aborted)
                    throw new JevError('CANCELLED', 'Jev operation was cancelled');
                const interpretation = interpret === undefined ? { usable: true }
                    : await this.untilAbort(Promise.resolve(interpret(response, outerSignal ?? signal)), outerSignal ?? signal);
                if (!interpretation.usable) {
                    await this.records().settleAttempt(operationId, attempt.id, {
                        status: 'failed', rawResponse, response, usage, usageComplete, networkRecords,
                        interpretation,
                        failure: { code: 'UNDETERMINED', message: interpretation.reason },
                    }).catch(() => { throw new JevError('LOG_WRITE_FAILED', 'Jev result could not be saved'); });
                    return { ok: false, failure: { code: 'UNDETERMINED', message: interpretation.reason } };
                }
                if (outerSignal?.aborted)
                    throw new JevError('CANCELLED', 'Jev operation was cancelled');
                await this.records().settleAttempt(operationId, attempt.id, { status: 'succeeded', rawResponse, response, usage, usageComplete, networkRecords, interpretation })
                    .catch(() => { throw new JevError('LOG_WRITE_FAILED', 'Jev result could not be saved'); });
                return { ok: true, attemptId: attempt.id, response };
            }
            catch (error) {
                if (error instanceof JevError && error.code === 'LOG_WRITE_FAILED')
                    throw error;
                const failure = outerSignal?.aborted ? { code: 'CANCELLED', message: 'Jev operation was cancelled' }
                    : timeout.aborted ? { code: 'TIMEOUT', message: 'Jev request timed out' } : safeFailure(error);
                rawResponse = networkRecords.length === 1 ? networkRecords[0]?.rawResponse : undefined;
                const expectedPackets = identity.connectionId === 'luna-openrouter' ? Math.ceil(snapshot.questions.length / 200) : 1;
                const receivedAll = networkRecords.length === expectedPackets
                    && networkRecords.every(record => record.dispatchedAt !== undefined && record.rawResponseText !== undefined);
                const aggregate = aggregateUsage(networkRecords, receivedAll);
                usage = aggregate.usage;
                usageComplete = aggregate.usageComplete;
                await this.records().settleAttempt(operationId, attempt.id, {
                    status: failure.code === 'CANCELLED' ? 'cancelled' : 'failed',
                    ...rawResponse === undefined ? {} : { rawResponse },
                    ...usage === undefined ? {} : { usage }, usageComplete, networkRecords, failure,
                }).catch(() => { throw new JevError('LOG_WRITE_FAILED', 'Jev result could not be saved'); });
                return { ok: false, failure };
            }
        }
        /** Record interrupted input without a model call, human question, or attempt; stable message links are idempotent. */
        recordInterrupted(featureId, link) {
            return this.runActive(undefined, async () => {
                if (!this.features.has(featureId))
                    throw new JevError('UNKNOWN_FEATURE', 'Jev feature is not registered');
                if (!link.sessionId?.trim() || !link.inputVersion?.trim())
                    throw new JevError('INVALID_LINK', 'Interrupted records require a session and input identity');
                return this.records().createInterrupted(featureId, link);
            });
        }
        /** Record one rules-only candidate result with zero model attempts. */
        recordRuleObservation(featureId, link) {
            return this.runActive(undefined, async () => {
                if (!this.features.has(featureId))
                    throw new JevError('UNKNOWN_FEATURE', 'Jev feature is not registered');
                return this.records().createRuleObservation(featureId, link);
            });
        }
        /** Attach a consumer fallback reason to an already failed or cancelled operation. */
        async noteFailure(operationId, code, message) {
            if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code) || !message.trim())
                throw new JevError('INVALID_NOTE', 'A failure code and reason are required');
            await this.records().noteFailure(operationId, { code, message });
        }
        /** Persist one action receipt; a failed write leaves execution status unconfirmed. */
        async writeReceipt(operationId, receipt) {
            if (this.records().get(operationId) === null)
                throw new JevError('UNKNOWN_OPERATION', 'Jev operation is not in this profile');
            try {
                return await this.records().receipt(operationId, receipt);
            }
            catch (error) {
                if (error instanceof Error && error.message.includes('conflicts'))
                    throw new JevError('RECEIPT_CONFLICT', 'Jev action receipt id already has different facts');
                throw new JevError('RECEIPT_NOT_SAVED', 'Jev action receipt was not saved; do not repeat the action');
            }
        }
    };
})();
export { JevService };
export default JevService;
//# sourceMappingURL=index.js.map