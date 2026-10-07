/** Jev common Host service and typed consumer API. */
import { Service, type Context, type Volatile } from '@deepseek-ai/cordis';
import s from '@deepseek-ai/schemastery';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Agent } from '@deepseek-ai/dsh-agent/types';
import type { StageNavigationManager } from './stage-navigation.ts';
import type { StageAnalysisRecord, StageAnalysisRequest, StageBatchState, StageNavigationSnapshot } from './stage-types.ts';
import type { JevActionReceipt, JevCredentialStatus, JevFeatureDefinition, JevFeatureView, JevOperationLink, JevProbeResult, JevRecordDetail, JevRecordFilter, JevRecordPage, JevRequest, JevResponse, JevConfigValues, JevConnectionId, JevConnectionIdentity } from './types.ts';
export type * from './types.ts';
export type * from './stage-types.ts';
export { JEV_PROVIDER } from './adapter.ts';
/** Current-profile configuration. Every field is editable through DSH configForms. */
export interface Config {
    baseUrl: Volatile<string>;
    model: Volatile<string>;
    credentialRef: Volatile<string>;
    timeoutMs: Volatile<number>;
    features: Volatile<Record<string, boolean>>;
    judgmentModel: Volatile<'jev' | 'luna'>;
    lunaApi: Volatile<'openrouter' | 'openai'>;
    lunaOpenRouterBaseUrl: Volatile<string>;
    lunaOpenRouterCredentialRef: Volatile<string>;
    lunaOpenAIBaseUrl: Volatile<string>;
    lunaOpenAICredentialRef: Volatile<string>;
}
type ConfigValues = JevConfigValues;
/** A consumer refreshes this input for every manual attempt. */
export interface JevJudgeOptions {
    featureId: string;
    link: JevOperationLink;
    agent: Agent;
    refresh: (signal: AbortSignal) => JevRequest | Promise<JevRequest>;
    interpret?: (response: JevResponse, signal: AbortSignal) => {
        usable: true;
    } | {
        usable: false;
        reason: string;
    } | Promise<{
        usable: true;
    } | {
        usable: false;
        reason: string;
    }>;
    canAdopt?: (response: JevResponse, signal: AbortSignal) => true | string | Promise<true | string>;
    signal?: AbortSignal;
}
/** Single-attempt consumers may read historical data without a running Agent. */
export type JevJudgeOnceOptions = Omit<JevJudgeOptions, 'agent'> & {
    agent?: Agent;
    connection?: JevConnectionIdentity;
};
/** A completed judgment is safe to consider only while `kind` is `ok`. */
export type JevJudgeResult = {
    kind: 'ok';
    operationId: string;
    attemptId: string;
    response: JevResponse;
} | {
    kind: 'cancelled';
    operationId: string;
} | {
    kind: 'not-adopted';
    operationId: string;
    reason: string;
};
/** Non-interactive attempts return failure without opening a human question. */
export type JevJudgeOnceResult = JevJudgeResult | {
    kind: 'failed';
    operationId?: string;
    failure: {
        code: string;
        message: string;
    };
};
/** Stable failure code without provider payload or credential text. */
export declare class JevError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        jev: JevService;
    }
}
/** Validated live configuration presented through DSH settings. */
export declare const Config: s<ConfigValues, Config>;
/** One profile's public judgment service and browser Remote namespace. */
export declare class JevService extends TypertRemoteService {
    private readonly config;
    static inject: string[];
    static Config: s<JevConfigValues, Config>;
    private readonly adapter;
    private readonly features;
    private ledger?;
    private readonly active;
    private readonly controllers;
    private disposing;
    private readonly featureListeners;
    private stageNavigation?;
    constructor(ctx: Context, config: Config);
    protected [Service.init](): Promise<void>;
    private records;
    /** Register a consumer feature for this Host lifetime; the caller owns the disposer. */
    registerFeature(feature: JevFeatureDefinition): () => void;
    /** Current registrations, with unknown and newly registered ids disabled by default. */
    listFeatures(): Promise<JevFeatureView[]>;
    /** Query only the current profile, with bounded page size and optional filters. */
    listRecords(filter: JevRecordFilter): Promise<JevRecordPage>;
    /** Read one current-profile operation after the list has identified it. */
    getRecord(id: string): Promise<JevRecordDetail | null>;
    /** Bind the optional Host stage consumer while its plugin row is active. */
    registerStageNavigation(manager: StageNavigationManager): () => void;
    private stages;
    /** Read one complete authorized Session cut and its auxiliary stage results. */
    getStageNavigation(sessionId: string, signal: AbortSignal): Promise<StageNavigationSnapshot>;
    /** Start only a user-requested batch; returning does not await model calls. */
    startStageAnalysis(request: StageAnalysisRequest): Promise<StageBatchState>;
    /** Cancel auxiliary requests without cancelling the native Agent. */
    cancelStageAnalysis(batchId: string): Promise<void>;
    /** Load exact persisted input and raw Jev answer for one selected step. */
    getStageAnalysisRecord(sessionId: string, stepId: string, recordId?: string): Promise<StageAnalysisRecord | null>;
    /** Report credential presence, source, and writability without its value. */
    getCredentialStatus(connection: JevConnectionIdentity): Promise<JevCredentialStatus>;
    /** Save or replace the current profile's configured credential reference. */
    setCredential(connection: JevConnectionIdentity, value: string): Promise<JevCredentialStatus>;
    /** Run one fixed diagnostic without a business feature or user state. */
    testConnection(connection: JevConnectionIdentity, signal: AbortSignal): Promise<JevProbeResult>;
    /** Judge one dependent operation; only a human retry invokes `refresh` again. */
    judge(options: JevJudgeOptions): Promise<JevJudgeResult>;
    /** Make one logged attempt without human waiting or automatic retry. Only `ok` permits adoption. */
    judgeOnce(options: JevJudgeOnceOptions): Promise<JevJudgeOnceResult>;
    private runActive;
    private untilAbort;
    private judgeOwned;
    private cancel;
    private isEnabled;
    /** Read this profile's current enablement synchronously; absent feature ids are disabled. */
    isFeatureEnabled(featureId: string): boolean;
    /** Observe committed feature-setting changes synchronously; the consumer owns the disposer. */
    onFeatureStateChange(listener: (features: Readonly<Record<string, boolean>>) => void): () => void;
    private ask;
    private configValues;
    private connectionIdentity;
    private savedConnection;
    /** Stable non-secret connection settings used to decide whether an old stage result is current. */
    stageConnectionIdentity(): Omit<JevConnectionIdentity, 'connectionId'> & {
        connectionId?: JevConnectionId;
    };
    /** All saved references must be checked before historical input is released to a provider. */
    stageConnections(): readonly JevConnectionIdentity[];
    /** Current saved connection without authentication values. */
    judgmentConnectionIdentity(): JevConnectionIdentity;
    private tryOnce;
    /** Record interrupted input without a model call, human question, or attempt; stable message links are idempotent. */
    recordInterrupted(featureId: string, link: JevOperationLink): Promise<JevRecordDetail>;
    /** Record one rules-only candidate result with zero model attempts. */
    recordRuleObservation(featureId: string, link: JevOperationLink): Promise<JevRecordDetail>;
    /** Attach a consumer fallback reason to an already failed or cancelled operation. */
    noteFailure(operationId: string, code: string, message: string): Promise<void>;
    /** Persist one action receipt; a failed write leaves execution status unconfirmed. */
    writeReceipt(operationId: string, receipt: JevActionReceipt): Promise<JevRecordDetail>;
}
export default JevService;
//# sourceMappingURL=index.d.ts.map