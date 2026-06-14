const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHookRegistry } = require('../../src/shared/hook-registry');

describe('hook-registry', () => {
    it('runWaterfallSync chains handlers by priority', () => {
        const hooks = createHookRegistry();
        const order = [];
        hooks.register('test', () => {
            order.push('b');
            return { n: 2 };
        }, { priority: 20 });
        hooks.register('test', () => {
            order.push('a');
            return { n: 1 };
        }, { priority: 10 });

        const result = hooks.runWaterfallSync('test', {}, { n: 0 });
        assert.deepEqual(order, ['a', 'b']);
        assert.equal(result.n, 2);
    });

    it('runWaterfallSync keeps value when handler returns undefined', () => {
        const hooks = createHookRegistry();
        hooks.register('test', (_ctx, value) => ({ ...value, a: 1 }), { priority: 0 });
        hooks.register('test', () => undefined, { priority: 10 });

        const result = hooks.runWaterfallSync('test', {}, { b: 2 });
        assert.deepEqual(result, { b: 2, a: 1 });
    });

    it('runFilterSync removes items when handler returns false', () => {
        const hooks = createHookRegistry();
        hooks.register('filter', (_ctx, item) => item % 2 === 0);

        const result = hooks.runFilterSync('filter', {}, [1, 2, 3, 4]);
        assert.deepEqual(result, [2, 4]);
    });

    it('unregister removes handler', () => {
        const hooks = createHookRegistry();
        const off = hooks.register('test', () => ({ x: 1 }), { priority: 0 });
        off();
        const result = hooks.runWaterfallSync('test', {}, {});
        assert.deepEqual(result, {});
    });

    it('async runWaterfall awaits handlers', async () => {
        const hooks = createHookRegistry();
        hooks.register('test', async (_ctx, value) => {
            await Promise.resolve();
            return { ...value, ok: true };
        }, { priority: 0 });

        const result = await hooks.runWaterfall('test', {}, { ok: false });
        assert.equal(result.ok, true);
    });
});
