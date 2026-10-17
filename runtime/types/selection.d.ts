import type { Context, Volatile } from '@deepseek-ai/cordis';
import s from '@deepseek-ai/schemastery';
import type { SelectionConfigValues } from './selection-types.ts';
/** Live skill-selection and glob-ranking settings for the current profile. */
export interface Config {
    skillLimit: Volatile<number>;
    skillMinProbability: Volatile<number>;
    fileCandidates: Volatile<number>;
    fileLimit: Volatile<number>;
}
export declare const Config: s<SelectionConfigValues, Config>;
interface CatalogEntry {
    name: string;
    description: string;
}
interface SelectedCatalogSource {
    kind: 'jev-skill-catalog';
    form: 'catalog';
    /** Exactly the entries rendered in this model-visible message. */
    entries: CatalogEntry[];
    /** Identity of the complete model-invocable directory at publication. */
    fullFingerprint: string;
    /** Effective settings for this judgment; absent in catalogs recorded before probability filtering. */
    selection?: Pick<SelectionConfigValues, 'skillMinProbability' | 'skillLimit'>;
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'jev-skill-catalog': SelectedCatalogSource;
        'jev-file-ranking': {
            kind: 'jev-file-ranking';
            form: 'notice';
            summary: string;
        };
    }
}
/** Register selectors and an ordinary complete skill-catalog recovery tool. */
export declare function apply(ctx: Context, config: Config): void;
export declare const inject: string[];
export declare const name = "jev-selection";
export {};
//# sourceMappingURL=selection.d.ts.map