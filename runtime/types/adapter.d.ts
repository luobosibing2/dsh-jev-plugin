import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { JevConnectionIdentity, JevNetworkRecord, JevRequest } from './types.ts';
export declare const JEV_PROVIDER = "jev-system-one";
export interface JevConnection extends JevConnectionIdentity {
    apiKey: string;
}
/** The adapter never advertises a chat model and rejects calls lacking a service-issued nonce. */
export declare class JevAdapter extends LlmAdapter {
    private readonly pending;
    issue(request: JevRequest, connection: JevConnection, canStart?: () => boolean, record?: (records: readonly JevNetworkRecord[]) => Promise<void>): {
        envelope: string;
        records: readonly JevNetworkRecord[];
        release: () => void;
    };
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private save;
    private exchange;
    private envelope;
}
//# sourceMappingURL=adapter.d.ts.map