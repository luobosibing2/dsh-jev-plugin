/** Public Jev judgment, operation, and safe Remote data types. */
/** Resolve the explicitly selected protocol; custom URLs do not change its identity. */
export function resolveConnectionIdentity(values, id) {
    const connectionId = id ?? (values.judgmentModel === 'luna' ? `luna-${values.lunaApi}` : 'jev');
    const baseUrl = connectionId === 'jev' ? values.baseUrl
        : connectionId === 'luna-openrouter' ? values.lunaOpenRouterBaseUrl : values.lunaOpenAIBaseUrl;
    let safeUrl = '';
    try {
        const url = new URL(baseUrl.trim());
        if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.search && !url.hash)
            safeUrl = url.toString();
    }
    catch { /* An unconfigured address has no dispatchable URL. */ }
    return { connectionId, baseUrl: safeUrl,
        model: connectionId === 'jev' ? values.model.trim() : connectionId === 'luna-openrouter' ? 'openai/gpt-6-luna-decisions' : 'gpt-6-luna',
        credentialRef: (connectionId === 'jev' ? values.credentialRef
            : connectionId === 'luna-openrouter' ? values.lunaOpenRouterCredentialRef : values.lunaOpenAICredentialRef).trim(),
        timeoutMs: values.timeoutMs };
}
//# sourceMappingURL=types.js.map