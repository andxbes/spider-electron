function getSettingsFormElements(form) {
    return {
        useSitemapInput: form.querySelector('#useSitemap'),
        sitemapUrlsInput: form.querySelector('#sitemapUrls'),
        respectRobotsTxtInput: form.querySelector('#respectRobotsTxt'),
        maxPagesInput: form.querySelector('#maxPages'),
        concurrencyInput: form.querySelector('#concurrency'),
        userAgentPresetInput: form.querySelector('#userAgentPreset'),
        userAgentCustomFields: form.querySelector('#userAgentCustomFields'),
        userAgentCustomInput: form.querySelector('#userAgentCustom'),
        userAgentPreview: form.querySelector('#userAgentPreview'),
        requestDelayMsInput: form.querySelector('#requestDelayMs'),
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

let settingsFormController = null;

function syncSessionSitemapUrlsFromForm(elements) {
    if (elements.sitemapUrlsInput) {
        setSessionSitemapUrlsText(elements.sitemapUrlsInput.value);
    }
}

function populateUserAgentPresetSelect(selectEl, selectedId) {
    if (!selectEl || !USER_AGENT_PRESETS) {
        return;
    }
    selectEl.replaceChildren();
    for (const preset of USER_AGENT_PRESETS) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.label;
        selectEl.appendChild(option);
    }
    const presetId = isValidUserAgentPresetId(selectedId)
        ? selectedId
        : DEFAULT_USER_AGENT_PRESET_ID;
    selectEl.value = presetId;
}

function getUserAgentSettingsFromElements(elements) {
    return {
        userAgentPreset: elements.userAgentPresetInput?.value || DEFAULT_USER_AGENT_PRESET_ID,
        userAgentCustom: elements.userAgentCustomInput?.value || '',
    };
}

function syncUserAgentFields(elements) {
    const isCustom = elements.userAgentPresetInput?.value === CUSTOM_USER_AGENT_PRESET_ID;
    if (elements.userAgentCustomFields) {
        elements.userAgentCustomFields.classList.toggle('hidden', !isCustom);
    }
    if (elements.userAgentPreview && typeof resolveUserAgent === 'function') {
        elements.userAgentPreview.textContent = resolveUserAgent(
            getUserAgentSettingsFromElements(elements)
        );
    }
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

    populateUserAgentPresetSelect(elements.userAgentPresetInput, loaded.userAgentPreset);
    if (elements.userAgentCustomInput) {
        elements.userAgentCustomInput.value = loaded.userAgentCustom || '';
    }

    elements.useSitemapInput.checked = loaded.useSitemap;
    if (elements.sitemapUrlsInput) {
        elements.sitemapUrlsInput.value = getSessionSitemapUrlsText();
    }
    if (elements.respectRobotsTxtInput) {
        elements.respectRobotsTxtInput.checked = loaded.respectRobotsTxt !== false;
    }
    elements.maxPagesInput.value = loaded.maxPages || '';
    elements.concurrencyInput.value = loaded.concurrency || 3;
    if (elements.requestDelayMsInput) {
        elements.requestDelayMsInput.value = loaded.requestDelayMs ?? 500;
    }
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
    syncUserAgentFields(elements);
    syncAuthFieldsVisibility(elements);

    if (elements.settingsPathHint && path) {
        elements.settingsPathHint.textContent = path;
    }
}

function bindSettingsForm(form) {
    const elements = getSettingsFormElements(form);

    elements.userAgentPresetInput?.addEventListener('change', () => {
        syncUserAgentFields(elements);
    });
    elements.userAgentCustomInput?.addEventListener('input', () => {
        syncUserAgentFields(elements);
    });

    elements.authTypeInput?.addEventListener('change', () => {
        syncAuthFieldsVisibility(elements);
    });

    elements.sitemapUrlsInput?.addEventListener('input', () => {
        syncSessionSitemapUrlsFromForm(elements);
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        syncSessionSitemapUrlsFromForm(elements);
        const userAgentSettings = getUserAgentSettingsFromElements(elements);
        const { filePath } = await saveSettings({
            useSitemap: elements.useSitemapInput.checked,
            respectRobotsTxt: elements.respectRobotsTxtInput?.checked !== false,
            maxPages: elements.maxPagesInput.value,
            concurrency: elements.concurrencyInput.value,
            requestDelayMs: elements.requestDelayMsInput?.value ?? 500,
            ...userAgentSettings,
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
        syncSessionSitemap: () => syncSessionSitemapUrlsFromForm(elements),
    };
}

function initSettingsPage() {
    const form = document.getElementById('settingsForm');
    if (!form || document.getElementById('settingsModal')) {
        return;
    }
    const controller = bindSettingsForm(form);
    settingsFormController = controller;
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
    settingsFormController = controller;
    const closeButtons = modal.querySelectorAll('[data-settings-close]');

    function openModal() {
        controller.refresh();
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('settings-modal-open');
        const firstField = form.querySelector('input, button, select, textarea');
        firstField?.focus();
    }

    function closeModal() {
        controller.syncSessionSitemap();
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

/** Refresh settings form after dump restore (sitemap + persisted fields). */
function refreshOpenSettingsForms() {
    settingsFormController?.refresh();
}

initSettingsPage();
initSettingsModal();
