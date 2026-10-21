// LocalStorage persistence, migration, undo, and JSON backup/restore.

function readInitialState() {
    try {
        const saved = localStorage.getItem(STATE_KEY);
        const envelope = saved ? JSON.parse(saved) : { current: {
            players: JSON.parse(localStorage.getItem('bm_p_v13')) || [],
            courts: JSON.parse(localStorage.getItem('bm_c_v13')) || [{id:1, type:'A', active:[], next:[], startTime:null}],
            history: JSON.parse(localStorage.getItem('bm_h_v13')) || []
        }, previous: null };
        const state = envelope.current;
        if(!state || !Array.isArray(state.players) || !Array.isArray(state.courts) || !Array.isArray(state.history) ||
            state.players.some(p => !p || typeof p.name !== 'string' || !Number.isFinite(p.games)) ||
            state.courts.some(c => !c || !Array.isArray(c.active)) ||
            state.history.some(h => !h || typeof h !== 'object')) throw new Error('Invalid saved data');
        validateImportData(state, true);
        if(envelope.previous) {
            try { validateImportData(envelope.previous, true); }
            catch(error) { envelope.previous = null; }
        }
        // Older saves did not record when waiting began. Start now and keep that
        // timestamp across reloads without replacing the existing undo snapshot.
        const now = Date.now();
        const migratedCurrent = migrateStateToQueue(state);
        const migratedPrevious = envelope.previous ? migrateStateToQueue(envelope.previous) : false;
        const initializedCurrent = initializeWaitingTimes(state.players, now);
        const initializedPrevious = envelope.previous ? initializeWaitingTimes(envelope.previous.players, now) : false;
        if(migratedCurrent || migratedPrevious || initializedCurrent || initializedPrevious) {
            try { localStorage.setItem(STATE_KEY, JSON.stringify(envelope)); }
            catch(error) { storageError = '다음 경기와 대기 정보를 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인하세요.'; }
        }
        return envelope;
    } catch(error) {
        storageBlocked = true;
        storageError = '저장 데이터를 읽지 못했습니다. 기존 데이터는 보존되어 있습니다. 설정에서 정상 백업 파일을 복구하세요.';
        return { current: {players:[], courts:[], history:[]}, previous:null };
    }
}

function migrateStateToQueue(state) {
    const before = JSON.stringify(state);
    if(!state.matchQueue) {
        state.matchQueue = state.courts.filter(c => c.next?.length).map((court, index) => ({
            id:index + 1, type:court.type, players:[...court.next]
        }));
    }
    state.courts.forEach(court => { court.next = []; });
    const playing = new Set(state.courts.flatMap(c => c.active.map(p => p.id)));
    const queued = new Set([...state.matchQueue, ...state.courts.map(court => court.pendingMatch).filter(Boolean)].flatMap(game => game.players.map(p => p.id)));
    state.players.forEach(player => {
        if(playing.has(player.id)) setPlayerStatus(player, 'playing');
        else if(queued.has(player.id)) setPlayerStatus(player, 'reserved');
        else if(['playing','reserved'].includes(player.status)) setPlayerStatus(player, 'waiting');
    });
    return before !== JSON.stringify(state);
}

function linkCourtPlayers() {
    const roster = new Map(players.map(player => [player.id, player]));
    courts.forEach(court => ['active', 'next'].forEach(area => {
        court[area] = court[area].map(player => roster.get(player.id) || player);
    }));
    courts.forEach(court => {
        if(court.pendingMatch) court.pendingMatch.players = court.pendingMatch.players.map(player => roster.get(player.id) || player);
    });
    matchQueue.forEach(game => { game.players = game.players.map(player => roster.get(player.id) || player); });
}

function serializeState() { return JSON.stringify({players, courts, matchQueue, history, members}); }

function applyState(serialized) {
    const state = JSON.parse(serialized);
    migrateStateToQueue(state);
    players = state.players; courts = state.courts; history = state.history;
    matchQueue = state.matchQueue;
    members = state.members || [];
    initializeWaitingTimes(players);
    linkCourtPlayers();
}

function save(recordUndo = true, force = false, actionLabel = '데이터 변경') {
    try {
        if(storageBlocked) throw new Error('Saved data needs recovery');
        initializeWaitingTimes(players);
        linkCourtPlayers();
        const nextState = serializeState();
        if(nextState === committedState && recordUndo && !force && !storageError) return true;
        const previous = recordUndo ? committedState : null;
        localStorage.setItem(STATE_KEY, JSON.stringify({current:JSON.parse(nextState), previous:previous ? JSON.parse(previous) : null, undoLabel:actionLabel}));
        undoState = previous;
        undoLabel = actionLabel;
        committedState = nextState;
        storageError = '';
        document.getElementById('storageError').hidden = true;
        updateUndoButton();
        return true;
    } catch(error) {
        applyState(committedState);
        if(!storageBlocked) storageError = '저장에 실패하여 방금 작업을 취소했습니다. 저장 공간과 브라우저 설정을 확인한 뒤 다시 시도하세요.';
        render();
        showToast('저장 실패: 작업이 적용되지 않았습니다.');
        return false;
    }
}

function undoLastAction() {
    if(!undoState) return showToast('되돌릴 작업이 없습니다.');
    showConfirmModal(`${displayActionLabel(undoLabel)} 작업을 되돌리시겠습니까?\n해당 작업 전의 선수·코트·다음 경기·기록으로 복원합니다.`, () => {
        applyState(undoState);
        if(!save(false)) return;
        closePModal(); closeManualModal(); closeSwapModal(); closeScoreModal(); closeHModal(); closeStatsModal(); closeSettings(); closeMembersModal(); closeMemberShare(); closeMemberImport();
        selectedRosterPlayerId = null;
        render(); showToast('최근 작업을 되돌렸습니다.');
    });
}

function saveAction(label) { return save(true, false, label); }

function resetAll() {
    showConfirmModal("저장된 회원과 현재 선수·코트·기록을 모두 초기화하시겠습니까?\n최근 작업 되돌리기로 한 단계 복원할 수 있습니다.", () => {
        players = []; courts = [{id:1, type:'A', active:[], next:[], startTime:null}]; history = [];
        members = []; matchQueue = [];
        if(!saveAction('전체 데이터 초기화')) return;
        closeSettings(); render(); showToast('전체 데이터를 초기화했습니다. 최근 작업 되돌리기로 복원할 수 있습니다.');
    });
}

function startNewMeeting() {
    const message = '저장된 회원은 유지하고 현재 선수·경기 기록·코트 배정을 비운 뒤 참석자를 다시 선택하시겠습니까?\n회원으로 저장하지 않은 선수는 먼저 회원 명단에 저장하세요.';
    showConfirmModal(message, () => {
        // 코트 상태 비우기
        courts.forEach(c => {
            c.active = [];
            c.next = [];
            c.startTime = null;
            delete c.pendingMatch;
        });

        // 기록 배열 비우기 (메모리 주소 유지)
        history.length = 0;
        players = [];
        matchQueue = [];

        if(!saveAction('새 모임 시작')) return;
        render();
        closeSettings();
        openMembersModal();
        showToast("새 모임이 시작되었습니다.");
    });
}

function exportData() {
    const data = { players, courts, matchQueue, history, members, version: 'v17' };
    const blob = new Blob([JSON.stringify(data)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    const date = new Date().toISOString().slice(0,10); a.download = `BM_Backup_${date}.json`;
    a.click(); showToast("백업 파일 다운로드");
}

function triggerImport() { document.getElementById('fileInput').click(); }

function validateImportData(data, allowLegacyAssignments = false) {
    const fail = () => { throw new Error('회원·선수·코트·경기 기록의 형식이나 배정 관계가 올바르지 않습니다.'); };
    const idOK = value => Number.isSafeInteger(value) && value >= 0;
    const countOK = value => Number.isSafeInteger(value) && value >= 0;
    const timeOK = value => value == null || (Number.isFinite(value) && value >= 0);
    if(!data || !Array.isArray(data.players) || !Array.isArray(data.courts) || (data.history !== undefined && !Array.isArray(data.history))) fail();
    if(data.members !== undefined && !Array.isArray(data.members)) fail();
    if(data.matchQueue !== undefined && !Array.isArray(data.matchQueue)) fail();
    const memberIds = new Set();
    (data.members || []).forEach(member => {
        if(!member || !idOK(member.id) || memberIds.has(member.id) || typeof member.name !== 'string' || !member.name.trim() ||
            !['M','F'].includes(member.gender) || !Number.isInteger(member.tier) || member.tier < 1 || member.tier > 5) fail();
        memberIds.add(member.id);
    });
    const attendingMembers = new Set();
    const ids = new Set();
    data.players.forEach(p => {
        if(!p || !idOK(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() ||
            !['M','F'].includes(p.gender) || !Number.isInteger(p.tier) || p.tier < 0 || p.tier > 5 ||
            !countOK(p.games) || !['waiting','resting','playing','reserved'].includes(p.status) ||
            (p.matchingOffset !== undefined && !countOK(p.matchingOffset)) || !timeOK(p.lastTime) ||
            !timeOK(p.waitingSince) ||
            (p.isGuest !== undefined && typeof p.isGuest !== 'boolean') ||
            (p.shuttlecock !== undefined && typeof p.shuttlecock !== 'boolean')) fail();
        ids.add(p.id);
        if(p.memberId !== undefined) {
            if(!memberIds.has(p.memberId) || attendingMembers.has(p.memberId)) fail();
            attendingMembers.add(p.memberId);
        }
    });
    const playerById = new Map(data.players.map(player => [player.id, player]));
    data.players.forEach(player => {
        if(player.tournamentPartnerId === undefined) return;
        const partner = playerById.get(player.tournamentPartnerId);
        if(!idOK(player.tournamentPartnerId) || !partner || partner.id === player.id || partner.tournamentPartnerId !== player.id) fail();
    });
    const courtIds = new Set();
    const assignments = {active:new Set(), next:new Set()};
    const queueIds = new Set();
    const validatePreparedGame = (game, requireFull = false) => {
        if(!game || !idOK(game.id) || queueIds.has(game.id) || !['A','M','F','X'].includes(game.type) ||
            !Array.isArray(game.players) || game.players.length > 4 || (requireFull && game.players.length !== 4)) fail();
        queueIds.add(game.id);
        game.players.forEach(player => {
            if(!player || !ids.has(player.id) || assignments.next.has(player.id)) fail();
            assignments.next.add(player.id);
        });
    };
    data.courts.forEach(c => {
        if(!c || !idOK(c.id) || courtIds.has(c.id) || !['A','M','F','X'].includes(c.type) || !timeOK(c.startTime)) fail();
        courtIds.add(c.id);
        ['active','next'].forEach(area => {
            const match = area === 'next' && c[area] === undefined ? [] : c[area];
            if(!Array.isArray(match) || (allowLegacyAssignments ? match.length > 4 : ![0,4].includes(match.length))) fail();
            if(area === 'next' && data.matchQueue !== undefined && match.length) fail();
            match.forEach(p => {
                if(!p || !ids.has(p.id) || assignments[area].has(p.id)) fail();
                assignments[area].add(p.id);
            });
        });
        if(c.pendingMatch !== undefined) validatePreparedGame(c.pendingMatch, true);
    });
    (data.matchQueue || []).forEach(game => validatePreparedGame(game));
    (data.history || []).forEach(h => {
        if(!h || typeof h !== 'object' || Array.isArray(h) || !timeOK(h.startTime) || !timeOK(h.endTime) || (h.cId !== undefined && !idOK(h.cId))) fail();
        if(h.pIds !== undefined && (!Array.isArray(h.pIds) || h.pIds.length !== 4 || h.pIds.some(id => !idOK(id)) || new Set(h.pIds).size !== 4)) fail();
        if(h.names !== undefined && typeof h.names !== 'string') fail();
        if(h.teamNames !== undefined && (!Array.isArray(h.teamNames) || h.teamNames.length !== 2 || h.teamNames.some(team => !Array.isArray(team) || team.length !== 2 || team.some(name => typeof name !== 'string')))) fail();
        if(!h.pIds && !h.teamNames && !h.names) fail();
        if(h.scores !== undefined && (!Array.isArray(h.scores) || h.scores.length !== 2 || h.scores.some(score => !countOK(score) || score > 99) || h.scores[0] === h.scores[1])) fail();
    });
    return data;
}

function importValidatedData(data) {
    try {
        validateImportData(data);
        // Preserve the exact pre-import state separately from one-step undo.
        if(storageBlocked) {
            const original = [STATE_KEY, 'bm_p_v13', 'bm_c_v13', 'bm_h_v13'].map(key => [key, localStorage.getItem(key)]);
            localStorage.setItem('bm_unreadable_v14', JSON.stringify(original));
        } else {
            localStorage.setItem(IMPORT_BACKUP_KEY, committedState);
        }
    } catch(error) {
        showToast('복구하지 않았습니다. 파일 형식과 저장 공간을 확인하세요.');
        return false;
    }
    const wasBlocked = storageBlocked;
    storageBlocked = false;
    applyState(JSON.stringify({players:data.players, courts:data.courts, matchQueue:data.matchQueue, history:data.history || [], members:data.members === undefined ? members : data.members}));
    players.forEach(p => { p.tier = Math.max(1, p.tier); });
    syncPlayerAssignmentStatuses(players.map(p => p.id));
    if(!save(!wasBlocked, true, '파일에서 데이터 복구')) { storageBlocked = wasBlocked; return false; }
    render(); showToast(wasBlocked ? '정상 백업으로 데이터를 복구했습니다.' : '데이터 복구 완료! 설정에서 복구 전 데이터로 돌아갈 수 있습니다.');
    return true;
}

function restoreBeforeImport() {
    let data;
    try {
        const saved = localStorage.getItem(IMPORT_BACKUP_KEY);
        if(!saved) return showToast('파일 복구 전 백업이 없습니다.');
        data = validateImportData(JSON.parse(saved));
    } catch(error) { return showToast('복구 전 백업을 읽지 못했습니다.'); }
    showConfirmModal('파일 복구 직전의 선수·코트·기록으로 돌아가시겠습니까?', () => {
        if(storageBlocked) { if(importValidatedData(data)) closeSettings(); return; }
        applyState(JSON.stringify(data));
        if(!saveAction('파일 복구 전 데이터 복원')) return;
        closeSettings(); render(); showToast('파일 복구 전 데이터를 복원했습니다.');
    });
}

function importData(input) {
    const file = input.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            importValidatedData(data);
        } catch(err) { showToast("파일 형식이 올바르지 않습니다."); }
    };
    reader.readAsText(file); input.value = '';
}
