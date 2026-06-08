function getSettingsFormElements(form) {
    return {
        useSitemapInput: form.querySelector('#useSitemap'),
        maxPagesInput: form.querySelector('#maxPages'),
        concurrencyInput: form.querySelector('#concurrency'),
        saveStatus: form.querySelector('#saveStatus'),
        settingsPathHint: form.querySelector('#settingsPathHint'),
    };
}

async function populateSettingsForm(form) {
    const elements = getSettingsFormElements(form);
    const loaded = await loadSettings();
    const path = await getSettingsFilePath();

    elements.useSitemapInput.checked = loaded.useSitemap;
    elements.maxPagesInput.value = loaded.maxPages || '';
    elements.concurrencyInput.value = loaded.concurrency || 3;

    if (elements.settingsPathHint && path) {
        elements.settingsPathHint.textContent = path;
    }
}

function bindSettingsForm(form) {
    const elements = getSettingsFormElements(form);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const { filePath } = await saveSettings({
            useSitemap: elements.useSitemapInput.checked,
            maxPages: elements.maxPagesInput.value,
            concurrency: elements.concurrencyInput.value,
        });
        if (elements.settingsPathHint && filePath) {
            elements.settingsPathHint.textContent = filePath;
        }
        if (elements.saveStatus) {
            elements.saveStatus.classList.remove('hidden');
            setTimeout(() => elements.saveStatus.classList.add('hidden'), 2000);
        }
    });

    return {
        refresh: () => populateSettingsForm(form),
    };
}

function initSettingsPage() {
    const form = document.getElementById('settingsForm');
    if (!form || document.getElementById('settingsModal')) {
        return;
    }
    const controller = bindSettingsForm(form);
    controller.refresh();
}

function initSettingsModal() {
    const modal = document.getElementById('settingsModal');
    const openButton = document.getElementById('openSettingsButton');
    const form = document.getElementById('settingsForm');
    if (!modal || !openButton || !form) {
        return;
    }

    const controller = bindSettingsForm(form);
    const closeButtons = modal.querySelectorAll('[data-settings-close]');

    function openModal() {
        controller.refresh();
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('settings-modal-open');
        const firstField = form.querySelector('input, button');
        firstField?.focus();
    }

    function closeModal() {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('settings-modal-open');
        openButton.focus();
    }

    openButton.addEventListener('click', openModal);
    closeButtons.forEach((button) => {
        button.addEventListener('click', closeModal);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });
}

initSettingsPage();
initSettingsModal();
