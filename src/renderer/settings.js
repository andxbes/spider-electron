const form = document.getElementById('settingsForm');
const useSitemapInput = document.getElementById('useSitemap');
const maxPagesInput = document.getElementById('maxPages');
const saveStatus = document.getElementById('saveStatus');
const settingsPathHint = document.getElementById('settingsPathHint');

async function initSettingsPage() {
    const loaded = await loadSettings();
    const path = await getSettingsFilePath();

    useSitemapInput.checked = loaded.useSitemap;
    maxPagesInput.value = loaded.maxPages || '';

    if (settingsPathHint && path) {
        settingsPathHint.textContent = path;
    }
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = await loadSettings();
    const { filePath } = await saveSettings({
        useSitemap: useSitemapInput.checked,
        maxPages: maxPagesInput.value,
        lastStartUrl: current.lastStartUrl || '',
    });
    if (settingsPathHint && filePath) {
        settingsPathHint.textContent = filePath;
    }
    saveStatus.classList.remove('hidden');
    setTimeout(() => saveStatus.classList.add('hidden'), 2000);
});

initSettingsPage();
