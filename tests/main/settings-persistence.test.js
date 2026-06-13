const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

describe('settings-persistence', () => {
    let tempDir;
    let settingsModule;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spider-settings-'));
        const originalRequire = Module.prototype.require;
        Module.prototype.require = function patched(id) {
            if (id === 'electron') {
                return { app: { getPath: () => tempDir } };
            }
            return originalRequire.apply(this, arguments);
        };
        delete require.cache[require.resolve('../../src/main/settings-persistence')];
        settingsModule = require('../../src/main/settings-persistence');
    });

    afterEach(async () => {
        Module.prototype.require = Module.prototype.constructor.prototype.require;
        delete require.cache[require.resolve('../../src/main/settings-persistence')];
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('normalizeSettings clamps concurrency and maxPages', () => {
        const normalized = settingsModule.normalizeSettings({
            useSitemap: 1,
            maxPages: -5,
            concurrency: 999,
        });
        assert.equal(normalized.useSitemap, true);
        assert.equal(normalized.maxPages, 0);
        assert.equal(normalized.concurrency, 50);
    });

    it('saveSettings and loadSettings round-trip', async () => {
        await settingsModule.saveSettings({ useSitemap: true, maxPages: 10, concurrency: 2 });
        const loaded = await settingsModule.loadSettings();
        assert.deepEqual(loaded, {
            useSitemap: true,
            maxPages: 10,
            concurrency: 2,
        });
    });

    it('loadSettings returns defaults when file missing', async () => {
        const loaded = await settingsModule.loadSettings();
        assert.deepEqual(loaded, settingsModule.DEFAULT_SETTINGS);
    });
});
