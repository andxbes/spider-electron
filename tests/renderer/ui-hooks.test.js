const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Node test path: load renderer modules via vm-like require is awkward; test hook-registry integration only.
const { createHookRegistry } = require('../../src/shared/hook-registry');

describe('ui-hooks pattern', () => {
    let hooks;

    beforeEach(() => {
        hooks = createHookRegistry({ name: 'ui-test' });
    });

    it('TABLE_COLUMNS hook allows extending columns', () => {
        hooks.register('ui:tableColumns', (_ctx, cols) => (
            cols || [{ id: 'url', label: 'URL' }]
        ), { priority: 0 });

        hooks.register('ui:tableColumns', (_ctx, cols) => [...cols, { id: 'plugin', label: 'Plugin' }], {
            priority: 50,
            id: 'plugin-cols',
        });

        const columns = hooks.runWaterfallSync('ui:tableColumns', {}, null);
        assert.deepEqual(columns.map((c) => c.id), ['url', 'plugin']);
    });

    it('TRANSFORM_RESULT hook enriches stored rows', () => {
        hooks.register('ui:transformResult', (_ctx, row) => ({
            ...row,
            enriched: true,
        }), { priority: 0 });

        const out = hooks.runWaterfallSync('ui:transformResult', {}, { url: 'https://a.test' });
        assert.equal(out.enriched, true);
    });
});
