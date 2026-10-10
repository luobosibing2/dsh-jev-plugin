/** Jev selectors at the existing skill catalog and glob tool seams. */
import { createHash } from 'node:crypto';
import s from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { isModelInvocable, escapeText } from '@deepseek-ai/dsh-skill';
import { trySaveFormattedResult } from '@deepseek-ai/dsh-tool-fs-search';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { JevError } from "./index.js";
export const Config = s.object({
    skillLimit: s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(5).volatile(),
    fileCandidates: s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(40).volatile(),
    fileLimit: s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(12).volatile(),
});
class RankingConditionsChanged extends Error {
}
function positive(value, name) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(name + ' must be a positive safe integer');
    return value;
}
function liveRoot(ctx, agent) {
    return agent !== undefined && ctx.agents.get(agent.id) === agent && ctx.agents.roots().includes(agent);
}
function textOf(message) {
    return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
}
/** Direct user and visible assistant text, selected and trimmed from newest to oldest. */
function taskContext(agent, pending = []) {
    const history = agent.session.deriveMessages();
    const all = [...history, ...pending.filter(item => !history.some(old => old.id === item.id))];
    const recent = [];
    let users = 0;
    let assistants = 0;
    for (let position = all.length - 1; position >= 0; position--) {
        const item = all[position];
        if (item.role === 'user' && item.source.kind === 'user' && users < 2) {
            const text = textOf(item);
            if (text) {
                recent.push({ position, role: 'user', text });
                users++;
            }
        }
        else if (item.role === 'assistant' && assistants < 1) {
            const text = textOf(item);
            if (text) {
                recent.push({ position, role: 'assistant', text });
                assistants++;
            }
        }
        if (users === 2 && assistants === 1)
            break;
    }
    let remaining = 2_000;
    return recent.sort((a, b) => b.position - a.position).map(item => {
        const text = remaining === 0 ? '' : item.text.slice(-remaining);
        remaining -= text.length;
        return { ...item, text };
    }).filter(item => item.text.length > 0).sort((a, b) => a.position - b.position)
        .map(({ role, text }) => ({ role, text }));
}
function fingerprint(entries) {
    return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
function latestSelectedCatalog(agent) {
    for (const message of agent.session.deriveMessages().reverse()) {
        if (message.role !== 'user')
            continue;
        if (message.source.kind === 'skill-catalog')
            return undefined;
        if (message.source.kind !== 'jev-skill-catalog')
            continue;
        if (typeof message.source.fullFingerprint === 'string' && Array.isArray(message.source.entries))
            return message.source;
    }
    return undefined;
}
/** Names from catalogs still visible to this Agent after compaction and replay. */
function injectedSkillNames(agent) {
    const names = new Set();
    for (const message of agent.session.deriveMessages()) {
        if (message.role !== 'user')
            continue;
        if (message.source.kind !== 'skill-catalog' && message.source.kind !== 'jev-skill-catalog')
            continue;
        const entries = message.source.entries;
        if (!Array.isArray(entries))
            continue;
        for (const entry of entries) {
            if (typeof entry === 'object' && entry !== null && 'name' in entry && typeof entry.name === 'string') {
                names.add(entry.name);
            }
        }
    }
    return names;
}
function validAnswers(items, response) {
    return response.answers.length === items.length && response.answers.every((answer, index) => answer.id === 'candidate-' + index && answer.kind === 'noul');
}
function ranked(items, response) {
    return items.map((item, index) => {
        const answer = response.answers[index];
        if (answer?.id !== 'candidate-' + index || answer.kind !== 'noul')
            throw new Error('Jev returned an incomplete ranking');
        return { item, index, probability: answer.probability,
            ...answer.confidence === undefined ? {} : { confidence: answer.confidence } };
    }).sort((a, b) => b.probability - a.probability || a.index - b.index);
}
function question(index, prompt) {
    return { id: 'candidate-' + index, kind: 'noul', prompt };
}
function selectedCatalog(items, fullFingerprint, total, selectedCount) {
    const entries = items.map(({ item }) => ({ name: item.name, description: item.description }));
    const lines = items.map(({ item, probability, confidence }) => '- ' + item.name + ': ' + escapeText(item.description) + ' (relevance probability ' + probability
        + (confidence === undefined ? '' : ', confidence ' + confidence) + ')');
    return createUserMessage({
        source: { kind: 'jev-skill-catalog', form: 'catalog', entries, fullFingerprint },
        content: [{ type: 'text', text: [
                    '<system-reminder>',
                    'Jev selected the top ' + selectedCount + ' of ' + total + ' model-invocable skills. These ' + items.length + ' new summaries supplement the catalogs already visible in this session. Probabilities estimate relevance, not task success.',
                    '<available_skills>', ...lines, '</available_skills>',
                    'Call the skill tool with an exact name before following its instructions. This is a partial catalog; call skill_catalog to see every currently model-invocable skill summary. A user may invoke an eligible skill directly.',
                    '</system-reminder>',
                ].join('\n') }],
    });
}
function hostCatalog(decision) {
    return decision.kind === 'reject' ? undefined : decision.messages.find(message => message.source.kind === 'skill-catalog');
}
function replaceCatalog(decision, original, replacement) {
    if (decision.kind === 'reject')
        return decision;
    const messages = original === undefined ? decision.messages : decision.messages.filter(message => message.id !== original.id);
    return { ...decision, messages: replacement === undefined ? messages : [...messages, replacement] };
}
function globValue(result) {
    if (result.isError || typeof result.value !== 'object' || result.value === null || Array.isArray(result.value))
        return undefined;
    const value = result.value;
    if (typeof value.root !== 'string' || !Array.isArray(value.paths) || !value.paths.every(path => typeof path === 'string'))
        return undefined;
    return { root: value.root, paths: value.paths };
}
function globArgs(value) {
    if (typeof value !== 'object' || value === null || !('pattern' in value) || typeof value.pattern !== 'string')
        return undefined;
    return { pattern: value.pattern,
        ...'path' in value && typeof value.path === 'string' ? { path: value.path } : {} };
}
function rankLines(scores) {
    return scores.map(({ item, probability, confidence }) => probability + (confidence === undefined ? '' : ' (confidence ' + confidence + ')') + ' ' + item);
}
function rankingText(scores, limit, recovery) {
    const shown = Math.min(scores.length, limit);
    return [...rankLines(scores.slice(0, shown)),
        'Jev evaluated ' + scores.length + ' of ' + scores.length + ' candidate paths; showing ' + shown
            + '; omitted ' + (scores.length - shown) + '. Scores estimate path relevance only.',
        ...shown === scores.length ? [] : [recovery ?? 'The complete ranked result could not be saved; narrow the glob pattern to inspect the rest.'],
    ].join('\n');
}
/** Register selectors and an ordinary complete skill-catalog recovery tool. */
export function apply(ctx, config) {
    ctx.effect(() => ctx.jev.registerFeature({
        id: 'skill-selection', name: 'Skill selection', description: 'Rank model-invocable skill summaries for the current task',
    }));
    ctx.effect(() => ctx.jev.registerFeature({
        id: 'file-ranking', name: 'File path ranking', description: 'Rank paths returned by glob',
    }));
    ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), 'jev-selection.settings');
    ctx.tools.register(defineTool({
        name: 'skill_catalog',
        description: 'Show every currently model-invocable skill name and summary. Load one with the skill tool using its exact name.',
        parameters: {},
        output: {
            schema: { type: 'object', additionalProperties: false, properties: {
                    skills: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
                                name: { type: 'string', required: true }, description: { type: 'string', required: true },
                            } } },
                } },
            render: (_args, value) => [{ type: 'text', text: value.skills.map(skill => '- ' + skill.name + ': ' + skill.description).join('\n') || 'No model-invocable skills are available.' }],
        },
        async execute(_args, exec) {
            const cwd = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal);
            const snapshot = await ctx.skills.snapshot({ cwd, signal: exec.signal, scope: exec.agent });
            if (!snapshot.complete)
                throw new Error('Skill catalog is incomplete');
            return { skills: snapshot.skills.filter(isModelInvocable).map(({ name, description }) => ({ name, description })) };
        },
    }));
    const checkedDirectories = new WeakMap();
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || !liveRoot(ctx, agent))
            return decision;
        const original = hostCatalog(decision);
        if (!(await ctx.jev.listFeatures()).some(feature => feature.id === 'skill-selection' && feature.enabled)) {
            checkedDirectories.delete(agent);
            return decision;
        }
        if (ctx.tools.get('skill', agent) === undefined)
            return decision;
        signal.throwIfAborted();
        const cwd = await ctx.workingDirectory.ensure(agent, signal);
        const snapshot = await ctx.skills.snapshot({ cwd, signal, scope: agent });
        if (!snapshot.complete)
            return decision;
        const skills = snapshot.skills.filter(isModelInvocable);
        if (skills.length === 0)
            return decision;
        const fullFingerprint = fingerprint(skills.map(({ name, description }) => ({ name, description })));
        const prior = latestSelectedCatalog(agent);
        const checked = checkedDirectories.get(agent);
        const hasNewUser = messages.some(message => message.source.kind === 'user' && textOf(message));
        const alreadyChecked = checked?.fingerprint === fullFingerprint
            && checked.replaceGeneration === agent.session.surface.replaceGeneration;
        if (!hasNewUser && (alreadyChecked || (checked === undefined
            && agent.session.surface.replaceGeneration === 0 && prior?.fullFingerprint === fullFingerprint))) {
            return replaceCatalog(decision, original);
        }
        const context = taskContext(agent, messages);
        if (context.length === 0)
            return decision;
        let current = skills;
        let currentFingerprint = fullFingerprint;
        let currentLimit = positive(config.skillLimit.get(), 'skillLimit');
        const makeRequest = () => ({ state: { context: taskContext(agent, messages) },
            questions: current.map((skill, index) => question(index, 'Would this skill help the task? Skill: ' + skill.name + '. Description: ' + skill.description)) });
        const initial = makeRequest();
        let first = true;
        const outcome = await ctx.jev.judge({
            featureId: 'skill-selection', agent, signal, link: { sessionId: agent.session.id },
            refresh: async (retrySignal) => {
                if (first) {
                    first = false;
                    return initial;
                }
                const cwd = await ctx.workingDirectory.ensure(agent, retrySignal);
                const refreshed = await ctx.skills.snapshot({ cwd, signal: retrySignal, scope: agent });
                if (!refreshed.complete)
                    throw new Error('Skill catalog is incomplete');
                current = refreshed.skills.filter(isModelInvocable);
                if (current.length === 0)
                    throw new Error('No skills remain available');
                currentFingerprint = fingerprint(current.map(({ name, description }) => ({ name, description })));
                currentLimit = positive(config.skillLimit.get(), 'skillLimit');
                return makeRequest();
            },
            interpret: response => validAnswers(current, response)
                ? { usable: true } : { usable: false, reason: 'Jev returned an incomplete skill ranking' },
        });
        if (outcome.kind !== 'ok')
            throw new JevError('CANCELLED', 'Skill selection was cancelled or could not be adopted');
        const chosen = ranked(current, outcome.response).slice(0, currentLimit);
        const existing = injectedSkillNames(agent);
        const additions = chosen.filter(({ item }) => !existing.has(item.name));
        checkedDirectories.set(agent, {
            fingerprint: currentFingerprint, replaceGeneration: agent.session.surface.replaceGeneration,
        });
        await ctx.jev.writeReceipt(outcome.operationId, {
            id: additions.length === 0 ? 'skill-catalog-no-new' : 'skill-catalog-published',
            status: 'observed', at: new Date().toISOString(),
            ...additions.length === 0 ? { reason: 'All selected skill names were already visible in session catalogs' } : {},
        });
        return replaceCatalog(decision, original, additions.length === 0
            ? undefined : selectedCatalog(additions, currentFingerprint, current.length, chosen.length));
    }, { prepend: true });
    const globRankings = new Map();
    ctx.on('tools/result', exec => { globRankings.delete(exec.token); });
    ctx.on('tools/execute', async (exec, next) => {
        if (exec.name !== 'glob')
            return next();
        const result = await next();
        const value = globValue(result);
        if (result.isError || value === undefined || value.paths.length === 0 || !liveRoot(ctx, exec.agent))
            return result;
        if (!(await ctx.jev.listFeatures()).some(feature => feature.id === 'file-ranking' && feature.enabled))
            return result;
        if (value.paths.length > positive(config.fileCandidates.get(), 'fileCandidates'))
            return result;
        const agent = exec.agent;
        if (taskContext(agent).length === 0)
            return result;
        const args = globArgs(exec.arguments);
        if (args === undefined)
            return result;
        exec.signal.throwIfAborted();
        let limit = positive(config.fileLimit.get(), 'fileLimit');
        let first = true;
        const makeRequest = () => ({ state: {
                context: taskContext(agent), pattern: args.pattern, path: args.path ?? '.',
            }, questions: value.paths.map((path, index) => question(index, 'Is this path relevant to the task? Path: ' + path)) });
        const initial = makeRequest();
        const outcome = await ctx.jev.judge({
            featureId: 'file-ranking', agent, signal: exec.signal, link: { sessionId: agent.session.id },
            refresh: () => {
                if (first) {
                    first = false;
                    return initial;
                }
                if (value.paths.length > positive(config.fileCandidates.get(), 'fileCandidates')) {
                    throw new RankingConditionsChanged('Glob results now exceed the Jev candidate setting');
                }
                limit = positive(config.fileLimit.get(), 'fileLimit');
                return makeRequest();
            },
            interpret: response => validAnswers(value.paths, response)
                ? { usable: true } : { usable: false, reason: 'Jev returned an incomplete path ranking' },
        }).catch(error => {
            if (error instanceof RankingConditionsChanged)
                return undefined;
            throw error;
        });
        if (outcome === undefined)
            return result;
        if (outcome.kind !== 'ok')
            throw new JevError('CANCELLED', 'File ranking was cancelled or could not be adopted');
        const scores = ranked(value.paths, outcome.response);
        await ctx.jev.writeReceipt(outcome.operationId, { id: 'glob-paths-ranked', status: 'observed', at: new Date().toISOString() });
        globRankings.set(exec.token, { scores, limit });
        return { ...result, value: { root: value.root, paths: scores.map(score => score.item) } };
    });
    ctx.on('tools/post-execute', async (exec, result, next) => {
        const decision = await next();
        const ranking = globRankings.get(exec.token);
        if (ranking === undefined)
            return decision;
        globRankings.delete(exec.token);
        if (result.isError || decision.kind !== 'accept' || decision.value !== undefined)
            return decision;
        const complete = rankLines(ranking.scores).join('\n');
        const spill = ranking.scores.length > ranking.limit
            ? await trySaveFormattedResult(ctx, exec, 'jev-glob-ranked.txt', complete)
            : undefined;
        const recovery = spill === undefined ? undefined : 'Full ranked result stored at: ' + spill.locator + '. ' + spill.retrievalHint;
        const storageUnavailable = spill === undefined && ranking.scores.length > ranking.limit;
        const summary = rankingText(ranking.scores, storageUnavailable ? ranking.scores.length : ranking.limit, recovery)
            + (storageUnavailable ? '\nComplete ranked list shown inline because result storage is unavailable.' : '');
        const context = createUserMessage({ source: {
                kind: 'jev-file-ranking', form: 'notice', summary: 'Jev ranked glob call ' + exec.callId,
            }, content: [{ type: 'text', text: 'Glob call ' + exec.callId + ', pattern ' + globArgs(exec.arguments)?.pattern + '\n' + summary }] });
        return { kind: 'accept', content: [{ type: 'text', text: summary }], additionalContexts: [
                ...decision.additionalContexts ?? [], ...exec.parent === undefined ? [] : [context],
            ] };
    }, { prepend: true });
}
export const inject = ['jev', 'tools', 'skills', 'settings', 'agents', 'workingDirectory'];
export const name = 'jev-selection';
//# sourceMappingURL=selection.js.map