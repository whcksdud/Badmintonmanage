// Shared application state and startup. Load after all feature scripts.

const STATE_KEY = 'bm_state_v14';
const IMPORT_BACKUP_KEY = 'bm_before_import_v14';
let storageError = '';
let storageBlocked = false;
const initialEnvelope = readInitialState();
let players = initialEnvelope.current.players;
let courts = initialEnvelope.current.courts;
let matchQueue = initialEnvelope.current.matchQueue || [];
let history = initialEnvelope.current.history;
let members = initialEnvelope.current.members || [];
const tiers = ["E조", "E조", "D조", "C조", "B조", "A조"];
players.forEach(player => {
    const savedTier = Number(player.tier);
    player.tier = Number.isFinite(savedTier) ? Math.min(5, Math.max(1, savedTier)) : 1;
});
linkCourtPlayers();
let committedState = serializeState();
let undoState = initialEnvelope.previous ? JSON.stringify(initialEnvelope.previous) : null;
let undoLabel = typeof initialEnvelope.undoLabel === 'string' ? initialEnvelope.undoLabel : '최근 데이터 변경';

let editPId = null;
let swapTarget = null;
let manualQueueId = null;
let queueType = 'A';
let manualSelected = new Set();
const courtActionLocks = new Map();
const collapsedStatuses = new Set();
let rosterFilter = 'all';
let pendingHistoryIndex = null;
let statsPlayerId = null;
let statsView = 'overall';
let selectedRosterPlayerId = null;
let waitingRoomCollapsed = false;
let deferredInstallPrompt = null;
let editMemberId = null;
let memberRegistrationMode = 'member';
const selectedMemberIds = new Set();

window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButton();
    showToast('앱 설치가 완료되었습니다.');
});

let onConfirmAction = null;

setInterval(() => {
    players.forEach(player => {
        if(!isWaitingForGame(player)) return;
        const el = document.getElementById(`waiting-time-${player.id}`);
        if(el) el.innerText = formatWaitingTime(player);
        const swapEl = document.getElementById(`swap-waiting-time-${player.id}`);
        if(swapEl) swapEl.innerText = formatWaitingTime(player);
        const manualEl = document.getElementById(`manual-waiting-time-${player.id}`);
        if(manualEl) manualEl.innerText = formatWaitingTime(player);
    });
    courts.forEach(c => {
        const el = document.getElementById(`timer-${c.id}`);
        if(c.active.length > 0 && c.startTime) {
            if(el) {
                el.innerText = formatElapsedTime(c.startTime);
                el.style.display = 'flex';
            }
        } else {
            if(el) el.style.display = 'none';
        }
    });
}, 1000);

document.addEventListener('click', handleRosterActionSheetOutsideClick);
window.addEventListener('resize', closeQueueCourtMenu);

render();
updateInstallButton();
handleMemberShareFragment();
window.addEventListener('hashchange', handleMemberShareFragment);

if ('serviceWorker' in navigator && window.isSecureContext) {
    const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
    let reloadingForServiceWorkerUpdate = false;
    if (hadServiceWorkerController) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if(reloadingForServiceWorkerUpdate) return;
            reloadingForServiceWorkerUpdate = true;
            window.location.reload();
        });
    }
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js', { scope: './' })
            .then(registration => registration.update())
            .catch(error => console.error('서비스 워커 등록 실패:', error));
    });
}
