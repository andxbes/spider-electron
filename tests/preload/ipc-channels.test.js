const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readChannelList(source, pattern) {
    const text = fs.readFileSync(path.join(__dirname, '../../src/preload/preload.js'), 'utf8');
    const match = text.match(pattern);
    assert.ok(match, `pattern not found: ${pattern}`);
    return match[1]
        .split(',')
        .map((item) => item.trim().replace(/['"]/g, ''))
        .filter(Boolean);
}

describe('preload IPC whitelist', () => {
    it('send channels include spider control', () => {
        const channels = readChannelList('preload', /validSendChannels = \[([\s\S]*?)\]/);
        assert.ok(channels.includes('start-spider'));
        assert.ok(channels.includes('spider-stop'));
    });

    it('invoke channels include settings and session', () => {
        const channels = readChannelList('preload', /validInvokeChannels = \[([\s\S]*?)\]/);
        for (const expected of [
            'settings:get',
            'settings:save',
            'spider-pause',
            'spider-resume',
            'session:save',
            'session:load',
        ]) {
            assert.ok(channels.includes(expected), `missing ${expected}`);
        }
    });

    it('receive channels include spider events', () => {
        const channels = readChannelList('preload', /validReceiveChannels = \[([\s\S]*?)\]/);
        for (const expected of [
            'spider-result',
            'spider-results-batch',
            'spider-end',
            'spider-progress',
            'spider-referrers-update',
        ]) {
            assert.ok(channels.includes(expected), `missing ${expected}`);
        }
    });
});
