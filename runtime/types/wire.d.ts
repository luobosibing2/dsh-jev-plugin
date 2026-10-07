/** System One request serialization and complete response validation. */
import type { JevConnectionId, JevNetworkRecord, JevRequest, JevResponse, JevUsage, Json } from './types.ts';
/** Reject invalid questions before a ledger write or model call. */
export declare function validateRequest(request: JevRequest): void;
/** Encode the typed public request into the provider's System One HTTP body. */
export declare function wireBody(model: string, request: JevRequest): Json;
/** Parse every answer, including optional probabilities and service signals, or reject the whole request. */
export declare function parseWireResponse(raw: unknown, request: JevRequest): {
    response: JevResponse;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
    raw: Json;
};
/** A provider rejection is a failed attempt, never a business answer. */
export declare class DecisionResponseError extends TypeError {
    readonly code: 'REFUSAL' | 'INVALID_RESPONSE';
    constructor(code: 'REFUSAL' | 'INVALID_RESPONSE', message: string);
}
/** Encode complete business input for the explicitly selected Decisions protocol. */
export declare function protocolBody(connectionId: JevConnectionId, model: string, request: JevRequest): Json;
/** Read known counts independently of answer validation so refusals retain usage. */
export declare function knownUsage(raw: unknown): JevUsage | undefined;
/** Decode the provider's original response directly into the existing business answers. */
export declare function parseProtocolResponse(raw: unknown, request: JevRequest, connectionId?: JevConnectionId): {
    response: JevResponse;
    usage?: JevUsage;
    raw: Json;
};
/** Reconstruct one complete attempt from its actual network responses in original question order. */
export declare function replayNetworkResponses(request: JevRequest, records: readonly JevNetworkRecord[], connectionId: JevConnectionId): JevResponse;
/** Sum only observed counts; completeness requires every expected request and both counts. */
export declare function aggregateUsage(records: readonly JevNetworkRecord[], complete: boolean): {
    usage?: JevUsage;
    usageComplete: boolean;
};
//# sourceMappingURL=wire.d.ts.map