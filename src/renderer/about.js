function initAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (!modal) {
        return;
    }

    const appNameEl = document.getElementById('aboutAppName');
    const versionEl = document.getElementById('aboutVersion');
    const authorLink = document.getElementById('aboutAuthorLink');
    const closeButtons = modal.querySelectorAll('[data-about-close]');

    async function populateAbout() {
        const info = await window.api.getAboutInfo();
        if (appNameEl) {
            appNameEl.textContent = info.name || 'Electron Web Spider';
        }
        if (versionEl) {
            versionEl.textContent = info.version || '—';
        }
        if (authorLink) {
            authorLink.textContent = info.author || 'andxbes';
            if (info.email) {
                authorLink.href = `mailto:${info.email}`;
                authorLink.title = info.email;
            }
        }
    }

    function openModal() {
        void populateAbout();
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('settings-modal-open');
        closeButtons[0]?.focus();
    }

    function closeModal() {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('settings-modal-open');
    }

    closeButtons.forEach((button) => {
        button.addEventListener('click', closeModal);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });

    window.api.onAboutShow(() => {
        openModal();
    });
}

initAboutModal();
