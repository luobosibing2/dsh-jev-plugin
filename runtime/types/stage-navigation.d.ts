import type { Context, Volatile } from '@deepseek-ai/cordis';
import s from '@deepseek-ai/schemastery';
import { StageStore } from './stage-store.ts';
import type { StageAnalysisRecord, StageAnalysisRequest, StageBatchState, StageNavigationConfigValues, StageNavigationSnapshot } from './stage-types.ts';
export declare const name = "jev-stage-navigation";
export declare const inject: string[];
export declare const FEATURE = "stage-navigation";
/** Profile settings govern bounded context, complete-request capacity, and batch parallelism. */
export type { StageNavigationConfigValues } from './stage-types.ts';
export interface Config {
    previousSteps: Volatile<number>;
    previousChars: Volatile<number>;
    maxRequestChars: Volatile<number>;
    concurrency: Volatile<number>;
}
export declare const Config: s<StageNavigationConfigValues, Config>;
/** Optional Host manager bound to the common Jev Remote namespace. */
export declare class StageNavigationManager {
    private readonly ctx;
    private readonly config;
    private readonly store;
    private readonly batches;
    private readonly bySession;
    private readonly starting;
    private readonly preparations;
    private stopping;
    constructor(ctx: Context, config: Config, store: StageStore);
    private settings;
    private preparation;
    private identity;
    /** Probe the native history API's durable address checks before reading the same immutable cut. */
    private source;
    /** Read history and status without starting Jev or the native Agent. */
    read(sessionId: string, signal: AbortSignal): Promise<StageNavigationSnapshot>;
    /** Return the selected record only after the same native history check. */
    detail(sessionId: string, stepId: string, requestedRecordId?: string): Promise<StageAnalysisRecord | null>;
    /** Freeze one explicit user-selected scope; duplicate clicks share its active batch. */
    start(request: StageAnalysisRequest): Promise<StageBatchState>;
    private prepare;
    private currentFingerprint;
    private classify;
    private run;
    cancel(batchId: string): Promise<void>;
    /** Disablement and unload stop only this consumer's auxiliary work. */
    stop(): Promise<void>;
    cancelRunning(): void;
}
/** Register a disabled-by-default Jev feature and its optional Host history provider. */
export declare function apply(ctx: Context, config: Config): Promise<void>;
//# sourceMappingURL=stage-navigation.d.ts.map