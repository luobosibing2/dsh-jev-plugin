import { type Domain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
declare const findingSchema: z.ZodObject<{
    id: z.ZodString;
    rootId: z.ZodString;
    senderId: z.ZodString;
    original: z.ZodString;
    source: z.ZodEnum<{
        "agent-message": "agent-message";
        "subagent-settled": "subagent-settled";
        "tool-report": "tool-report";
    }>;
    toolCallId: z.ZodOptional<z.ZodString>;
    messageIds: z.ZodArray<z.ZodString>;
    recipients: z.ZodArray<z.ZodObject<{
        agentId: z.ZodString;
        messageId: z.ZodString;
        state: z.ZodEnum<{
            queued: "queued";
            "model-received": "model-received";
            discarded: "discarded";
        }>;
        adopted: z.ZodLiteral<"unknown">;
    }, z.core.$strip>>;
    supersededBy: z.ZodOptional<z.ZodString>;
    at: z.ZodString;
}, z.core.$strip>;
declare const deliverySchema: z.ZodObject<{
    recipientId: z.ZodString;
    state: z.ZodEnum<{
        unconfirmed: "unconfirmed";
        queued: "queued";
        "model-received": "model-received";
        "not-delivered": "not-delivered";
    }>;
    messageId: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
    adopted: z.ZodLiteral<"unknown">;
}, z.core.$strip>;
declare const relationSchema: z.ZodObject<{
    id: z.ZodString;
    rootId: z.ZodString;
    olderId: z.ZodString;
    newerId: z.ZodString;
    state: z.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolved: "resolved";
        unresolved: "unresolved";
    }>;
    kind: z.ZodOptional<z.ZodEnum<{
        unknown: "unknown";
        replacement: "replacement";
        conflict: "conflict";
        support: "support";
        unrelated: "unrelated";
    }>>;
    basis: z.ZodOptional<z.ZodString>;
    operationId: z.ZodOptional<z.ZodString>;
    deliveries: z.ZodArray<z.ZodObject<{
        recipientId: z.ZodString;
        state: z.ZodEnum<{
            unconfirmed: "unconfirmed";
            queued: "queued";
            "model-received": "model-received";
            "not-delivered": "not-delivered";
        }>;
        messageId: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
        adopted: z.ZodLiteral<"unknown">;
    }, z.core.$strip>>;
    at: z.ZodString;
}, z.core.$strip>;
declare const backgroundSchema: z.ZodObject<{
    jobId: z.ZodString;
    rootId: z.ZodString;
    sourceCallId: z.ZodString;
    childIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type SharedBackgroundSource = z.infer<typeof backgroundSchema>;
export type SharedFinding = z.infer<typeof findingSchema>;
export type SharedRelation = z.infer<typeof relationSchema>;
export type SharedDelivery = z.infer<typeof deliverySchema>;
/** Stable source identity deduplicates repeated sharing within one root. */
export declare function findingId(rootId: string, senderId: string, original: string): string;
/** Business history is separate from the common Jev operation ledger. */
export declare function sharedFindingsSpec(profileDir: string): {
    name: string;
    version: number;
    layout: "per-record";
    tables: {
        background_sources: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            jobId: string;
            rootId: string;
            sourceCallId: string;
            childIds: string[];
        }>;
        findings: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            rootId: string;
            senderId: string;
            original: string;
            source: "agent-message" | "subagent-settled" | "tool-report";
            messageIds: string[];
            recipients: {
                agentId: string;
                messageId: string;
                state: "queued" | "model-received" | "discarded";
                adopted: "unknown";
            }[];
            at: string;
            toolCallId?: string | undefined;
            supersededBy?: string | undefined;
        }>;
        relations: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            rootId: string;
            olderId: string;
            newerId: string;
            state: "pending" | "interrupted" | "resolved" | "unresolved";
            deliveries: {
                recipientId: string;
                state: "unconfirmed" | "queued" | "model-received" | "not-delivered";
                adopted: "unknown";
                messageId?: string | undefined;
                reason?: string | undefined;
            }[];
            at: string;
            kind?: "unknown" | "replacement" | "conflict" | "support" | "unrelated" | undefined;
            basis?: string | undefined;
            operationId?: string | undefined;
        }>;
    };
};
/** Durable writes finish before a relation can cause an action. */
export declare class SharedFindingsStore {
    private readonly domain;
    private constructor();
    static open(facility: {
        open: (spec: ReturnType<typeof sharedFindingsSpec>) => Promise<Domain<ReturnType<typeof sharedFindingsSpec>>>;
    }, profileDir: string): Promise<SharedFindingsStore>;
    findings(): SharedFinding[];
    relations(): SharedRelation[];
    finding(id: string): SharedFinding | undefined;
    relation(id: string): SharedRelation | undefined;
    saveFinding(value: SharedFinding): Promise<void>;
    saveRelation(value: SharedRelation): Promise<void>;
    saveBackgroundSource(value: SharedBackgroundSource): Promise<void>;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=shared-findings-store.d.ts.map