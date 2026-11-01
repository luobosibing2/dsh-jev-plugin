import type { JevRequest } from './types.ts';
import type { StageStep, StageTurn } from './stage-types.ts';
export declare const STAGE_RULE_VERSION = "whole-step-v1";
export declare const STAGE_REDACTION_VERSION = "credential-patterns-v3";
export interface StageInputLimits {
    previousSteps: number;
    previousChars: number;
    maxRequestChars: number;
}
export type StageInputResult = {
    kind: 'ready';
    request: JevRequest;
    fingerprint: string;
} | {
    kind: 'unavailable';
    code: 'IN_PROGRESS' | 'NO_MATERIAL' | 'MATERIAL_TOO_LARGE';
    fingerprint: string;
};
/** Preserve the entire recorded target; an over-limit request is never shortened. */
export declare function buildStageInput(turns: readonly StageTurn[], target: StageStep, limits: StageInputLimits, connectionIdentity: string, secrets?: readonly string[]): StageInputResult;
//# sourceMappingURL=stage-input.d.ts.map