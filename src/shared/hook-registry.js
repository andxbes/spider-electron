/**
 * Lightweight hook registry for extensible pipelines (crawl, UI).
 * Handlers run by ascending priority; waterfall hooks pass mutable value through the chain.
 */

function createHookRegistry(options = {}) {
    const { name = 'hooks' } = options;
    /** @type {Map<string, Array<{ handler: Function, priority: number, id: unknown }>>} */
    const buckets = new Map();

    function getBucket(hookName) {
        if (!buckets.has(hookName)) {
            buckets.set(hookName, []);
        }
        return buckets.get(hookName);
    }

    function sortBucket(bucket) {
        bucket.sort((a, b) => a.priority - b.priority || 0);
    }

    /**
     * @param {string} hookName
     * @param {Function} handler
     * @param {{ priority?: number, id?: unknown }} [opts]
     * @returns {() => void} unregister
     */
    function register(hookName, handler, opts = {}) {
        const priority = opts.priority ?? 10;
        const id = opts.id ?? handler;
        const bucket = getBucket(hookName);
        const entry = { handler, priority, id };
        bucket.push(entry);
        sortBucket(bucket);
        return () => {
            const idx = bucket.indexOf(entry);
            if (idx >= 0) {
                bucket.splice(idx, 1);
            }
        };
    }

    function unregister(hookName, id) {
        const bucket = buckets.get(hookName);
        if (!bucket) {
            return false;
        }
        const idx = bucket.findIndex((entry) => entry.id === id);
        if (idx < 0) {
            return false;
        }
        bucket.splice(idx, 1);
        return true;
    }

    function list(hookName) {
        return [...getBucket(hookName)];
    }

    async function runWaterfall(hookName, ctx, initialValue) {
        let value = initialValue;
        for (const { handler } of getBucket(hookName)) {
            const next = await handler(ctx, value);
            if (next !== undefined) {
                value = next;
            }
        }
        return value;
    }

    function runWaterfallSync(hookName, ctx, initialValue) {
        let value = initialValue;
        for (const { handler } of getBucket(hookName)) {
            const next = handler(ctx, value);
            if (next !== undefined) {
                value = next;
            }
        }
        return value;
    }

    /** @returns {Promise<void>} */
    async function runTap(hookName, ctx, ...args) {
        for (const { handler } of getBucket(hookName)) {
            await handler(ctx, ...args);
        }
    }

    function runTapSync(hookName, ctx, ...args) {
        for (const { handler } of getBucket(hookName)) {
            handler(ctx, ...args);
        }
    }

    /**
     * Filter hook: handler returns false to drop item.
     * @template T
     * @param {string} hookName
     * @param {object} ctx
     * @param {T[]} items
     * @returns {T[]}
     */
    function runFilterSync(hookName, ctx, items) {
        return items.filter((item) => {
            for (const { handler } of getBucket(hookName)) {
                if (handler(ctx, item) === false) {
                    return false;
                }
            }
            return true;
        });
    }

    function clear(hookName) {
        if (hookName) {
            buckets.delete(hookName);
            return;
        }
        buckets.clear();
    }

    return {
        name,
        register,
        unregister,
        list,
        runWaterfall,
        runWaterfallSync,
        runTap,
        runTapSync,
        runFilterSync,
        clear,
    };
}

const hookRegistryModule = { createHookRegistry };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = hookRegistryModule;
}

(function initHookRegistryBrowser(root) {
    root.HookRegistryModule = hookRegistryModule;
})(typeof globalThis !== 'undefined' ? globalThis : window);
