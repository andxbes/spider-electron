function getSettingsFormElements(form) {
    return {
        useSitemapInput: form.querySelector('#useSitemap'),
        respectRobotsTxtInput: form.querySelector('#respectRobotsTxt'),
        maxPagesInput: form.querySelector('#maxPages'),
        concurrencyInput: form.querySelector('#concurrency'),
        authTypeInput: form.querySelector('#authType'),
        authBasicFields: form.querySelector('#authBasicFields'),
        authBearerFields: form.querySelector('#authBearerFields'),
        authUsernameInput: form.querySelector('#authUsername'),
        authPasswordInput: form.querySelector('#authPassword'),
        authTokenInput: form.querySelector('#authToken'),
        saveStatus: form.querySelector('#saveStatus'),
        settingsPathHint: form.querySelector('#settingsPathHint'),
    };
}

function syncAuthFieldsVisibility(elements) {
    const authType = elements.authTypeInput?.value || 'none';
    if (elements.authBasicFields) {
        elements.authBasicFields.classList.toggle('hidden', authType !== 'basic');
    }
    if (elements.authBearerFields) {
        elements.authBearerFields.classList.toggle('hidden', authType !== 'bearer');
    }
}

async function populateSettingsForm(form) {
    const elements = getSettingsFormElements(form);
    const loaded = await loadSettings();
    const path = await getSettingsFilePath();

    elements.useSitemapInput.checked = loaded.useSitemap;
    if (elements.respectRobotsTxtInput) {
        elements.respectRobotsTxtInput.checked = loaded.respectRobotsTxt !== false;
    }
    elements.maxPagesInput.value = loaded.maxPages || '';
    elements.concurrencyInput.value = loaded.concurrency || 3;
    if (elements.authTypeInput) {
        elements.authTypeInput.value = loaded.authType || 'none';
    }
    if (elements.authUsernameInput) {
        elements.authUsernameInput.value = loaded.authUsername || '';
    }
    if (elements.authPasswordInput) {
        elements.authPasswordInput.value = loaded.authPassword || '';
    }
    if (elements.authTokenInput) {
        elements.authTokenInput.value = loaded.authToken || '';
    }
    syncAuthFieldsVisibility(elements);

    if (elements.settingsPathHint && path) {
        elements.settingsPathHint.textContent = path;
    }
}

function bindSettingsForm(form) {
    const elements = getSettingsFormElements(form);

    elements.authTypeInput?.addEventListener('change', () => {
        syncAuthFieldsVisibility(elements);
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const { filePath } = await saveSettings({
            useSitemap: elements.useSitemapInput.checked,
            respectRobotsTxt: elements.respectRobotsTxtInput?.checked !== false,
            maxPages: elements.maxPagesInput.value,
            concurrency: elements.concurrencyInput.value,
            authType: elements.authTypeInput?.value || 'none',
            authUsername: elements.authUsernameInput?.value || '',
            authPassword: elements.authPasswordInput?.value || '',
            authToken: elements.authTokenInput?.value || '',
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
