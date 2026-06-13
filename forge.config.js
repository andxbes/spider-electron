/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const path = require('node:path');

const makers = [
  {
    name: '@electron-forge/maker-zip',
    platforms: ['darwin', 'linux', 'win32'],
  },
];

// Squirrel (Setup.exe) — лише на Windows; з Linux потрібні Mono+Wine
if (process.platform === 'win32') {
  makers.unshift({
    name: '@electron-forge/maker-squirrel',
    config: {
      name: 'spider_electron',
    },
  });
}

// DMG — лише на macOS
if (process.platform === 'darwin') {
  makers.push({
    name: '@electron-forge/maker-dmg',
    config: {
      format: 'ULFO',
    },
  });
}

module.exports = {
  packagerConfig: {
    asar: true,
    npmRebuild: false,
    icon: path.join(__dirname, 'assets', 'icon'),
    extraResource: [
      path.join(__dirname, 'assets', 'icon.png'),
    ],
    ignore: [
      /^\/\.git(\/|$)/,
      /^\/\.cursor(\/|$)/,
      /^\/docs(\/|$)/,
    ],
  },
  makers,
};
