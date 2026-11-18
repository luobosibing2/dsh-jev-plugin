/** Execution supervision over the public Agent, tool and native goal hooks. */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import s from '@deepseek-ai/schemastery';
import type { SupervisionConfigValues } from './supervision-types.ts';
/** Positive profile counts; feature switches live in the common Jev service. */
export interface Config {
    driftInterval: Volatile<number>;
    noProgressRounds: Volatile<number>;
    evidenceChars: Volatile<number>;
    maxSupplementRounds: Volatile<number>;
}
export declare const Config: s<SupervisionConfigValues, Config>;
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'jev-supervision': {
            kind: 'jev-supervision';
            form: 'notice';
            summary: string;
            requestId: string;
            action: string;
            operationId: string;
        };
    }
}
/** Install three independently enabled consumers; native goals retain exclusive continuation ownership. */
export declare function apply(ctx: Context, config: Config): void;
export declare const name = "jev-supervision";
export declare const inject: string[];
//# sourceMappingURL=supervision.d.ts.map