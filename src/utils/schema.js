/**
 * Zod → JSON Schema converter (lightweight, no extra dependency).
 */

export function zodToJsonSchema(zodSchema) {
    if (!zodSchema || !zodSchema._def) {
        return { type: 'object', properties: {} };
    }

    return convertZodType(zodSchema);
}

function convertZodType(schema) {
    const def = schema._def;
    const typeName = def.typeName;

    switch (typeName) {
        case 'ZodObject': {
            const properties = {};
            const required = [];
            const shape = def.shape?.() || def.shape || {};

            for (const [key, value] of Object.entries(shape)) {
                properties[key] = convertZodType(value);
                // Check if field is required (not optional)
                if (value._def?.typeName !== 'ZodOptional') {
                    required.push(key);
                }
            }

            const result = { type: 'object', properties };
            if (required.length > 0) result.required = required;
            return result;
        }

        case 'ZodString':
            return withDescription({ type: 'string' }, def);

        case 'ZodNumber':
            return withDescription({ type: 'number' }, def);

        case 'ZodBoolean':
            return withDescription({ type: 'boolean' }, def);

        case 'ZodEnum':
            return withDescription({ type: 'string', enum: def.values }, def);

        case 'ZodArray':
            return withDescription({
                type: 'array',
                items: convertZodType(def.type),
            }, def);

        case 'ZodOptional':
            return convertZodType(def.innerType);

        case 'ZodDefault':
            return convertZodType(def.innerType);

        default:
            return { type: 'string' };
    }
}

function withDescription(obj, def) {
    if (def.description) {
        obj.description = def.description;
    }
    return obj;
}
