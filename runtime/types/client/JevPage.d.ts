/** Jev bundle settings, feature catalogue, and bounded decision-record browser. */
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SupervisionConfigValues } from '../supervision-types.ts';
import type { SelectionConfigValues } from '../selection-types.ts';
import type { OutputAdmissionConfigValues } from '../output-admission-types.ts';
import type { StageNavigationConfigValues } from '../stage-types.ts';
import type { JevConfigValues, JevConnectionIdentity, JevCredentialStatus, JevFeatureView, JevProbeResult, JevRecordDetail, JevRecordFilter, JevRecordPage } from '../types.ts';
export type { JevConfigValues } from '../types.ts';
/** Browser calls provided by the Jev Remote namespace. */
export interface JevPageRemote {
    listFeatures(): Promise<JevFeatureView[]>;
    listRecords(filter: JevRecordFilter): Promise<JevRecordPage>;
    getRecord(id: string): Promise<JevRecordDetail | null>;
    testConnection(connection: JevConnectionIdentity, signal: AbortSignal): Promise<JevProbeResult>;
    getCredentialStatus(connection: JevConnectionIdentity): Promise<JevCredentialStatus>;
    setCredential(connection: JevConnectionIdentity, value: string): Promise<JevCredentialStatus>;
}
/** Data and commands injected by the bundle registration. */
export interface JevPageFace {
    form: ConfigForm<JevConfigValues>;
    selectionForm?: ConfigForm<SelectionConfigValues>;
    outputAdmissionForm?: ConfigForm<OutputAdmissionConfigValues>;
    supervisionForm?: ConfigForm<SupervisionConfigValues>;
    stageNavigationForm?: ConfigForm<StageNavigationConfigValues>;
    jev: JevPageRemote;
    notifySuccess: (message: string) => void;
}
/** Props assembled by the bundle slot and locale renderer. */
export type JevPageProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'jev.plugin'> & InjectFace<JevPageFace>;
/** Render one plugin-owned page inside the Host Plugins bundle detail. */
export declare function JevPage(props: JevPageProps): import("react/jsx-runtime").JSX.Element | null;
//# sourceMappingURL=JevPage.d.ts.map