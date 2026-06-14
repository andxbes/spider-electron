const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const pkg = require(path.join(__dirname, '../../package.json'));

describe('app-about', () => {
    it('getAboutInfo returns metadata with version from package.json', () => {
        const { getAboutInfo } = require('../../src/main/app-about');

        const info = getAboutInfo();
        assert.equal(info.name, 'Electron Web Spider');
        assert.equal(info.version, pkg.version);
        assert.equal(info.author, 'andxbes');
        assert.equal(info.email, 'andxbes@gmail.com');
    });
});
