const form = document.getElementById('settingsForm');
const useSitemapInput = document.getElementById('useSitemap');
const maxPagesInput = document.getElementById('maxPages');
const concurrencyInput = document.getElementById('concurrency');
const saveStatus = document.getElementById('saveStatus');
const settingsPathHint = document.getElementById('settingsPathHint');

async function initSettingsPage() {
    const loaded = await loadSettings();
    const path = await getSettingsFilePath();

    useSitemapInput.checked = loaded.useSitemap;
    maxPagesInput.value = loaded.maxPages || '';
    concurrencyInput.value = loaded.concurrency || 3;

    if (settingsPathHint && path) {
        settingsPathHint.textContent = path;
    }
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { filePath } = await saveSettings({
        useSitemap: useSitemapInput.checked,
        maxPages: maxPagesInput.value,
        concurrency: concurrencyInput.value,
    });
    if (settingsPathHint && filePath) {
        settingsPathHint.textContent = filePath;
    }
    saveStatus.classList.remove('hidden');
    setTimeout(() => saveStatus.classList.add('hidden'), 2000);
});

initSettingsPage();
