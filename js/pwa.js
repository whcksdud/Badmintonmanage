// PWA installation UI.

function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallButton() {
    const button = document.getElementById('installAppButton');
    if (!button) return;

    if (isRunningStandalone()) {
        button.innerHTML = `${renderUIIcon('check')}<span>앱으로 실행 중</span>`;
        button.disabled = true;
        button.style.opacity = '0.65';
    } else {
        button.innerHTML = `${renderUIIcon('phone')}<span>앱으로 설치</span>`;
        button.disabled = false;
        button.style.opacity = '1';
    }
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
