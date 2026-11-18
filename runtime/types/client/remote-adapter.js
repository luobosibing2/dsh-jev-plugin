/** Convert the generated Jev Remote result envelope to page commands. */
function unwrap(result) {
    if (!result.ok)
        throw result.error;
    return result.value;
}
/**
 * Adapt every Jev Remote call to the page's Promise-of-value API.
 * @param remote - generated Remote namespace, whose carrier and Host failures resolve as `RemoteResult`.
 * @returns page commands that resolve to business values or reject with the Remote failure.
 */
export function jevPageRemote(remote) {
    return {
        listFeatures: async () => unwrap(await remote.listFeatures()),
        listRecords: async (filter) => unwrap(await remote.listRecords(filter)),
        getRecord: async (id) => unwrap(await remote.getRecord(id)),
        testConnection: async (connection, signal) => unwrap(await remote.testConnection(connection, signal)),
        getCredentialStatus: async (connection) => unwrap(await remote.getCredentialStatus(connection)),
        setCredential: async (connection, value) => unwrap(await remote.setCredential(connection, value)),
    };
}
/** Adapt the Session stage commands while retaining their Host authorization. */
export function jevStageRemote(remote) {
    return {
        getStageNavigation: async (sessionId, signal) => unwrap(await remote.getStageNavigation(sessionId, signal)),
        startStageAnalysis: async (request) => unwrap(await remote.startStageAnalysis(request)),
        cancelStageAnalysis: async (batchId) => unwrap(await remote.cancelStageAnalysis(batchId)),
        getStageAnalysisRecord: async (sessionId, stepId, recordId) => unwrap(await (recordId === undefined
            ? remote.getStageAnalysisRecord(sessionId, stepId)
            : remote.getStageAnalysisRecord(sessionId, stepId, recordId))),
    };
}
//# sourceMappingURL=remote-adapter.js.map