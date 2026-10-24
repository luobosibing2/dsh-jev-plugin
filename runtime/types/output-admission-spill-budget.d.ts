/** Native Spill budgets captured for one tool execution and invalidated by policy changes. */
import { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
/** Check execution stability and, when supplied, complete model-visible content. */
export interface SpillBudgetGuard {
    /**
     * Keep only content within this execution's stable native budget.
     * @param exec - original tool execution whose pre-execute snapshot was captured.
     * @param receiver - current tool event receiver, including its public listener filter.
     * @param content - complete proposed content, or omitted for a stability check only.
     * @returns false for oversized content, an unknown budget, or an invalidated execution.
     */
    allows(exec: ToolExecution, receiver: object, content?: readonly ContentBlock[]): boolean;
}
/**
 * Observe native policy identity without activating it or requiring the optional package to load.
 * @param ctx - admission plugin context; all observers belong to its fiber.
 * @returns an execution-scoped guard; unknown or changing policy state keeps the original result.
 */
export declare function createSpillBudgetGuard(ctx: Context): SpillBudgetGuard;
//# sourceMappingURL=output-admission-spill-budget.d.ts.map