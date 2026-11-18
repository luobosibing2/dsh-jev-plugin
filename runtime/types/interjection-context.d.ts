import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
type Material = {
    id: string;
    text: string;
    excerpt: boolean;
};
type ToolMaterial = {
    callId: string;
    name: string;
    arguments: string;
    excerpt: boolean;
    status: 'running' | 'completed' | 'failed';
};
/** The live execution phase; no model infers these values. */
export type RoutingActivity = 'model-response' | 'model-retry-wait' | 'tool-execution' | 'other';
/** Bounded, replayable task facts; transient request ownership is kept by the caller. */
export interface RoutingContextState {
    budget: number;
    turn: number;
    step: number;
    latestUserId: string;
    users: Material[];
    previous: Material[];
    assistant: Material | null;
    tool: ToolMaterial | null;
    missingUserText: boolean;
    omittedUsers: boolean;
}
/**
 * Define the Host-only input-material projection for one configured context budget.
 * @param limit - maximum characters retained per current-material category.
 * @returns a pure projection whose checkpoint rejects a changed budget.
 */
export declare function routingContextProjection(limit: number): ProjectionDefinition<'jev-interjection-context', RoutingContextState>;
/**
 * Select original facts within one shared text budget, prioritizing user requirements.
 * @param state - prepared Host projection at the current Session cursor.
 * @param proposed - direct input already claimed for the imminent step.
 * @param goal - current native Goal identity and text, when present.
 * @param activity - observed live execution phase.
 * @returns bounded classification materials without summaries or generated text.
 */
export declare function selectRoutingContext(state: RoutingContextState, proposed: readonly UserMessage[], goal: {
    id: string;
    objective: string;
} | undefined, activity: RoutingActivity): {
    taskMessages: Material[];
    goal: Material | null;
    recentAssistant: Material | null;
    recentTool: ToolMaterial | null;
    previousTask: Material[];
    activity: RoutingActivity;
    contextTruncated: boolean;
    taskTextMissing: boolean;
};
export {};
//# sourceMappingURL=interjection-context.d.ts.map