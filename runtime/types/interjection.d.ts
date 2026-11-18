import type { Context } from '@deepseek-ai/cordis';
import s from '@deepseek-ai/schemastery';
/** Bounded recorded context; a larger current message cannot be classified without a human retry. */
export interface Config {
    contextChars: number;
    messageChars: number;
}
export declare const Config: s<Config>;
type Notice = {
    action: 'mode';
    enabled: boolean;
    running: boolean;
} | {
    action: 'route';
    messageId: string;
    phase: Phase;
    operationId?: string;
};
type Phase = 'pending' | 'correction' | 'steer' | 'interrupt-steer' | 'queued' | 'interrupt-requested' | 'response-settled' | 'cancelled' | 'interrupted' | 'delivered';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'jev-interjection': {
            kind: 'jev-interjection';
            form: 'notice';
            summary: string;
        } & Notice;
    }
}
/** Install admission tracking, classification fences, and recorded delivery outcomes. */
export declare function apply(ctx: Context, config: Config): void;
export declare const name = "jev-interjection-routing";
export declare const inject: string[];
export {};
//# sourceMappingURL=interjection.d.ts.map