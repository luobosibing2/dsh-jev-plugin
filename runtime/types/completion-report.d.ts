/** Current-turn report review, separate from tool-evidence and native Goal supervision. */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { JevRequest, JevResponse } from './types.ts';
/** The one selected issue; quotation text comes only from this request's generated options. */
export interface CompletionVerdict {
    value: string;
    reason: string;
    issueKey: string;
}
/** Read only native records from the latest turn, including a cleared Todo list.
 * @param agent - live ordinary root Agent.
 * @param requestId - original direct-user identity captured at turn admission.
 * @param supplements - already used or durably reserved supplemental rounds.
 * @param maximum - current profile's supplemental round limit.
 * @param budget - character limit saved with the actual input.
 * @returns no input for a turn that has never written Todo, otherwise complete report material.
 */
export declare function completionReport(agent: Agent, requestId: string, supplements: number, maximum: number, budget: number): JevRequest | undefined;
/** Refuse incomplete originals or oversized complete material without transport or truncation.
 * @param request - exact saved input and its reference options.
 * @param budget - live character limit for serialized material and both questions.
 */
export declare function completionPreflight(request: JevRequest, budget: number): void;
/** Validate both bounded answers; valid unknown is a business conclusion.
 * @param response - normalized provider answer.
 * @param request - actual input defining all permitted references.
 * @returns the assessment and its exact selected quotation, or no verdict for invalid answers.
 */
export declare function completionVerdict(response: JevResponse, request: JevRequest): CompletionVerdict | undefined;
//# sourceMappingURL=completion-report.d.ts.map