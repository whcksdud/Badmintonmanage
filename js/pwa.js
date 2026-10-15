// PWA installation UI.

function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallButton() {
    const button = document.getElementById('installAppButton');
    if (!button) return;

    const standalone = isRunningStandalone();
    button.innerHTML = `<span class="settings-icon">${renderUIIcon(standalone ? 'check' : 'phone')}</span>
        <span class="settings-copy"><strong>${standalone ? '앱으로 실행 중' : '앱으로 설치'}</strong><small>${standalone ? '홈 화면의 앱을 사용하고 있습니다.' : '홈 화면에서 바로 실행할 수 있습니다.'}</small></span>
        ${standalone ? '' : renderUIIcon('chevron-right', 'settings-chevron')}`;
    button.disabled = standalone;
}

async function installApp() {
    if (isRunningStandalone()) {
        showToast('이미 앱으로 실행 중입니다.');
        return;
    }

    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        updateInstallButton();
        return;
    }

    closeSettings();
    document.getElementById('installModal').style.display = 'flex';
}

function closeInstallModal() {
    document.getElementById('installModal').style.display = 'none';
}
