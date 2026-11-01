/** Lazy assembly of generated Remote definitions using caller-supplied Zod; no runtime imports. */
/**
 * Retain one generated definition per endpoint without constructing parsers or projections.
 * The class instance builds its shared descriptor/method index on first access;
 * input schemas and JSON Schema projections are cached only when requested.
 * @param spec - compiler-produced method facts and Zod factories.
 * @param zod - the generated artifact's Zod runtime for named-input parsers.
 * @returns a lazy, mountable info instance with no registration or transport effects.
 */
export function createTypertRemoteInfo(spec, zod) {
    return new RemoteInfo(spec, zod);
}
class RemoteInfo {
    spec;
    zod;
    index;
    constructor(spec, zod) {
        this.spec = spec;
        this.zod = zod;
    }
    get package() { return this.spec.package; }
    get descriptors() { return this.resolve().descriptors; }
    get methods() { return this.resolve().methods; }
    resolve() {
        if (this.index !== undefined)
            return this.index;
        const zod = this.zod;
        const descriptors = [];
        const methods = Object.create(null);
        for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
            const separator = endpoint.indexOf('/');
            const namespace = endpoint.slice(0, separator);
            const method = endpoint.slice(separator + 1);
            const parameters = definition.parameters.map(parameter => ({ ...parameter, wire: parameter.wire ?? parameter.name }));
            const descriptor = {
                ...definition,
                id: `${this.spec.package}#${endpoint}`,
                namespace,
                method,
                parameters,
                result: definition.result.description === undefined ? definition.result : new ResultValue(definition.result),
            };
            if (definition.invocation.kind === 'direct') {
                const inputs = [];
                const direct = Object.assign(descriptor, {
                    input(options) {
                        const strict = options?.strict === true;
                        return inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, zod);
                    },
                    invoke(remote, input, signal) {
                        const named = input;
                        const values = parameters.map(parameter => named[parameter.wire]);
                        if (definition.cancellation !== undefined)
                            values.push(signal);
                        // Namespace access retains the Gateway's mount checks and scoped receiver policy.
                        const receiver = Reflect.get(remote, namespace);
                        const call = Reflect.get(receiver, method);
                        return call.apply(receiver, values);
                    },
                });
                // The generated namespace return type is selected by this same descriptor's mode.
                methods[endpoint] = direct;
            }
            descriptors.push(descriptor);
        }
        return this.index = { descriptors, methods };
    }
}
/**
 * Narrow a Registry descriptor to its generated direct-method capabilities.
 * @param descriptor - a live descriptor, including possible source fallback or Context-only receivers.
 * @returns whether generated named input and direct invocation are available.
 */
export function isTypertRemoteMethod(descriptor) {
    return descriptor.invocation.kind === 'direct' && descriptor.result.mode === 'strict'
        && 'input' in descriptor && typeof descriptor.input === 'function'
        && 'invoke' in descriptor && typeof descriptor.invoke === 'function';
}
function optional(parameter) {
    return parameter.source === 'json' && parameter.acceptsUndefined === true;
}
class NamedInput {
    parameters;
    strict;
    zod;
    schema;
    projection;
    constructor(parameters, strict, zod) {
        this.parameters = parameters;
        this.strict = strict;
        this.zod = zod;
    }
    codec(parameter) {
        return this.strict ? parameter.strictCodec : parameter.codec;
    }
    create = () => this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map((parameter) => {
        const value = this.codec(parameter).create();
        return [parameter.wire, optional(parameter) ? value.optional() : value.nonoptional()];
    })));
    get jsonSchema() { return this.project().jsonSchema; }
    get jsonSchemaError() { return this.project().jsonSchemaError; }
    project() {
        if (this.projection !== undefined)
            return this.projection;
        const unavailable = this.parameters.find(parameter => this.codec(parameter).jsonSchema === undefined);
        if (unavailable !== undefined) {
            return this.projection = { jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}` };
        }
        return this.projection = {
            jsonSchema: {
                type: 'object',
                properties: Object.fromEntries(this.parameters.map(parameter => [parameter.wire, {
                        ...this.codec(parameter).jsonSchema,
                        ...(parameter.description === undefined ? {} : { description: parameter.description }),
                    }])),
                required: this.parameters.filter(parameter => !optional(parameter)).map(parameter => parameter.wire),
                additionalProperties: false,
            },
        };
    }
}
class ResultValue {
    spec;
    projection;
    constructor(spec) {
        this.spec = spec;
    }
    get mode() { return this.spec.mode; }
    get typeSymbol() { return this.spec.typeSymbol; }
    get create() { return this.spec.create; }
    get decode() { return this.spec.decode; }
    get encode() { return this.spec.encode; }
    get description() { return this.spec.description; }
    get jsonSchemaError() { return this.spec.jsonSchemaError; }
    get jsonSchema() {
        if (this.projection === undefined) {
            const schema = this.spec.jsonSchema;
            this.projection = { value: schema === undefined ? undefined : { ...schema, description: this.spec.description } };
        }
        return this.projection.value;
    }
}
//# sourceMappingURL=remote-info.js.map