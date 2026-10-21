// Shared match preparation, court entry, and one waiting match per court.
const QUEUE_TYPES = {A:'자율', M:'남복', F:'여복', X:'혼복'};
let manualCandidateOrder = [];
let queueCourtMenuGameId = null;

function nextQueueId() {
    const used = new Set([...matchQueue, ...courts.map(court => court.pendingMatch).filter(Boolean)].map(game => game.id));
    let id = Date.now();
    while(used.has(id)) id++;
    return id;
}

function queueGameLabel(id) { return `다음 경기 ${matchQueue.findIndex(game => game.id === id) + 1}번`; }

function queueBlockReason(game, {allowPlaying = false} = {}) {
    if(game.players.length < 4) return `${4 - game.players.length}명 더 선택`;
    if(game.players.some(p => !players.some(player => player.id === p.id))) return '선수 정보 확인';
    if(!allowPlaying && game.players.some(p => isPlayerInCourtArea(p.id, 'active'))) return '경기 종료 대기';
    if(game.players.some(p => p.status === 'resting')) return '휴식 중인 선수 있음';
    if(!matchesQueueType(game.players, game.type, true)) return '팀 구성 확인';
    return '';
}

function matchesQueueType(selected, type, requireTeams = false) {
    if(!QUEUE_TYPES[type] || selected.length > 4 || new Set(selected.map(player => player.id)).size !== selected.length) return false;
    if(type === 'M' || type === 'F') return selected.every(player => player.gender === type);
    if(type === 'X') {
        const men = selected.filter(player => player.gender === 'M').length;
        if(men > 2 || selected.length - men > 2) return false;
        if(requireTeams && selected.length === 4) return selected[0].gender !== selected[1].gender && selected[2].gender !== selected[3].gender;
    }
    return true;
}

function isQueueGameReady(game) {
    return !queueBlockReason(game);
}

function positionAutoMatchMenu() {
    const rect = document.getElementById('autoMatchTypeButton').getBoundingClientRect();
    const menu = document.getElementById('autoMatchMenu');
    const width = Math.min(Math.max(160, rect.width), window.innerWidth - 24);
    menu.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 200))}px`;
    menu.style.width = `${width}px`;
}

function closeAutoMatchMenu() {
    const menu = document.getElementById('autoMatchMenu');
    if(menu.matches?.(':popover-open')) menu.hidePopover();
}

function chooseAutoMatch(type) {
    if(!QUEUE_TYPES[type]) return false;
    closeAutoMatchMenu();
    queueType = type;
    renderAutoMatchType();
    document.getElementById('autoMatchTypeButton').focus({preventScroll:true});
    return true;
}

function renderAutoMatchType() {
    document.getElementById('autoMatchTypeLabel').innerText = QUEUE_TYPES[queueType];
    document.getElementById('autoMatchTypeButton').setAttribute('aria-label', `자동 편성 경기 유형: ${QUEUE_TYPES[queueType]}`);
    Object.keys(QUEUE_TYPES).forEach(type => document.getElementById(`auto-type-${type}`).setAttribute('aria-pressed', String(type === queueType)));
}

function autoQueueMatch(type = queueType) {
    if(!QUEUE_TYPES[type]) return false;
    const pool = getAutoMatchPool({includePlaying:true}).filter(player => !['M','F'].includes(type) || player.gender === type);
    if(pool.length < 4 || (type === 'X' && (pool.filter(p => p.gender === 'M').length < 2 || pool.filter(p => p.gender === 'F').length < 2))) {
        showToast(`${QUEUE_TYPES[type]} 편성에 필요한 선수가 부족합니다. 대기·경기 중 선수의 인원과 성별을 확인하세요.`);
        return false;
    }
    const selected = selectMatchPlayers(pool, type, null);
    const game = {id:nextQueueId(), type, players:balanceMatchTeams(selected, type)};
    matchQueue.push(game);
    syncPlayerAssignmentStatuses(game.players.map(p => p.id));
    if(!saveAction('다음 경기 자동 편성')) return false;
    const hasPlayingPlayers = game.players.some(player => isPlayerInCourtArea(player.id, 'active'));
    render(); showToast(hasPlayingPlayers ? '다음 경기를 추가했습니다. 경기 중인 선수의 현재 경기 종료 후 입장할 수 있습니다.' : '다음 경기를 마지막 순서에 추가했습니다.');
    return true;
}

function openManualMatch(queueId = null) {
    const game = matchQueue.find(game => game.id === queueId);
    if(queueId !== null && !game) return;
    closeAutoMatchMenu();
    manualQueueId = queueId;
    manualSelected = new Set(game ? game.players.map(p => p.id) : []);
    // Keep each player's position steady while the picker is open.
    manualCandidateOrder = shuffleByGameCount(manualCandidates()).map(player => player.id);
    renderManualList();
    document.getElementById('manualModal').style.display = 'flex';
}

function manualCandidates(queueId = manualQueueId) {
    const current = matchQueue.find(game => game.id === queueId);
    return players.filter(player => current?.players.some(p => p.id === player.id) ||
        (!isPlayerInCourtArea(player.id, 'queue') && ['waiting','playing'].includes(player.status)));
}

function renderManualList() {
    const current = matchQueue.find(game => game.id === manualQueueId);
    const order = new Map(manualCandidateOrder.map((id, index) => [id, index]));
    const candidates = manualCandidates().sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    const allowedIds = new Set(candidates.map(p => p.id));
    manualSelected.forEach(id => { if(!allowedIds.has(id)) manualSelected.delete(id); });
    document.getElementById('manualTitle').innerText = current ? `${queueGameLabel(current.id)} 편성 수정` : '다음 경기 직접 편성';
    const remaining = 4 - manualSelected.size;
    document.getElementById('manualHelp').innerText = `${manualSelected.size}/4명 선택 · ${remaining ? `나머지 ${remaining}명은 나중에 추가할 수 있습니다.` : '선택 완료. 저장하면 두 팀으로 편성합니다.'}\n경기 중인 선수도 선택할 수 있으며, 현재 경기 종료 후 입장합니다.`;
    const button = document.getElementById('manualConfirmButton');
    button.disabled = false;
    button.innerText = `${current ? '변경 저장' : '경기 추가'} (${manualSelected.size}/4)`;
    document.getElementById('manualList').innerHTML = candidates.length ? candidates.map(player => {
        const selected = manualSelected.has(player.id);
        const unavailable = !selected && remaining === 0;
        return `<button id="manual-player-${player.id}" type="button" class="player-chip waiting-chip roster-chip manual-chip gender-card ${getGenderCardClass(player.gender)} roster-status-${player.status} ${selected ? 'selected' : ''}" aria-pressed="${selected}" ${unavailable ? 'disabled title="선택한 선수를 해제한 뒤 다른 선수를 선택하세요."' : ''} onclick="toggleManualSelect(${player.id})">${renderRosterSummary(player, 'manual-')}</button>`;
    }).join('') : '<div class="empty-state">편성 가능한 선수가 없습니다. 빈 경기로 저장할 수 있습니다.</div>';
}

function toggleManualSelect(id) {
    if(manualSelected.has(id)) manualSelected.delete(id);
    else {
        const player = manualCandidates().find(player => player.id === id);
        if(!player) return showToast('현재 선택할 수 없는 선수입니다.');
        if(manualSelected.size === 4) return showToast('4명까지만 선택할 수 있습니다.');
        manualSelected.add(id);
    }
    renderManualList();
    document.getElementById(`manual-player-${id}`)?.focus({preventScroll:true});
}

function confirmManualMatch() {
    const game = matchQueue.find(game => game.id === manualQueueId);
    if(manualQueueId !== null && !game) { closeManualModal(); return showToast('편성 중인 경기가 삭제되었습니다.'); }
    const ids = new Set(manualCandidates().map(p => p.id));
    const selected = [...manualSelected].map(id => players.find(p => p.id === id));
    if(selected.some(p => !p || !ids.has(p.id)) || !matchesQueueType(selected, 'A')) return showToast('선수 상태를 확인한 뒤 다시 선택하세요.');
    // Opening and saving an unchanged selection must not shuffle existing teams.
    if(game && selected.length === game.players.length && game.players.every(p => manualSelected.has(p.id))) {
        closeManualModal();
        return true;
    }
    const previousIds = game ? game.players.map(p => p.id) : [];
    const target = game || {id:nextQueueId(), players:[]};
    target.type = 'A';
    target.players = selected.length === 4 ? balanceMatchTeams(selected, 'A') : selected;
    if(!game) matchQueue.push(target);
    syncPlayerAssignmentStatuses([...previousIds, ...selected.map(p => p.id)], 'waiting');
    if(!saveAction(game ? '다음 경기 편성 변경' : '다음 경기 직접 편성')) return false;
    closeManualModal(); render(); showToast(selected.length === 4 ? '다음 경기 편성을 저장했습니다.' : '다음 경기를 저장했습니다. 빈 자리의 선수 추가를 눌러 이어서 선택하세요.');
    return true;
}

function closeManualModal() {
    document.getElementById('manualModal').style.display = 'none';
    manualQueueId = null;
    manualSelected.clear();
    manualCandidateOrder = [];
}

function setQueueGameType(id, type) {
    const game = matchQueue.find(game => game.id === id);
    if(!game || !QUEUE_TYPES[type]) return false;
    if(!matchesQueueType(game.players, type)) { showToast('현재 선수 구성과 맞지 않는 경기 유형입니다.'); render(); return false; }
    game.type = type;
    if(game.players.length === 4) game.players = balanceMatchTeams(game.players, type);
    if(!saveAction(`${queueGameLabel(id)} 유형 변경`)) return false;
    render(); return true;
}

function moveQueueGame(id, direction) {
    const index = matchQueue.findIndex(game => game.id === id);
    const target = index + direction;
    if(index < 0 || ![-1,1].includes(direction) || target < 0 || target >= matchQueue.length) return false;
    [matchQueue[index], matchQueue[target]] = [matchQueue[target], matchQueue[index]];
    if(!saveAction('다음 경기 순서 변경')) return false;
    render(); return true;
}

function removeQueueGame(id) {
    const game = matchQueue.find(game => game.id === id);
    if(!game) return false;
    matchQueue = matchQueue.filter(game => game.id !== id);
    syncPlayerAssignmentStatuses(game.players.map(p => p.id), 'waiting');
    if(!saveAction('다음 경기 삭제')) return false;
    render(); showToast('편성을 취소했습니다. 되돌리기로 복원할 수 있습니다.');
    return true;
}

function startQueuedGame(id, courtId) {
    const gameIndex = matchQueue.findIndex(game => game.id === id);
    const game = matchQueue[gameIndex];
    const court = courts.find(court => court.id === courtId);
    if(!game || !court) return false;
    if(court.pendingMatch) { showToast('이 코트에는 이미 대기 입장한 경기가 있습니다.'); return false; }
    const waitForCourt = court.active.length > 0;
    const reason = queueBlockReason(game, {allowPlaying:waitForCourt});
    if(reason) { showToast(`${queueGameLabel(id)}: ${reason}`); return false; }
    if(waitForCourt) court.pendingMatch = game;
    else {
        court.active = [...game.players];
        court.type = game.type;
        court.startTime = Date.now();
    }
    matchQueue.splice(gameIndex, 1);
    syncPlayerAssignmentStatuses(game.players.map(p => p.id));
    if(!saveAction(`${courtLabel(courtId)} ${waitForCourt ? '대기 입장' : '다음 경기 입장'}`)) return false;
    render(); showToast(waitForCourt ? `${courtLabel(courtId)}에 대기 입장했습니다. 현재 경기 종료 후 시작합니다.` : `${courtLabel(courtId)}에서 경기를 시작했습니다.`);
    return true;
}

function startReadyCourtMatches(now = Date.now()) {
    const started = [];
    courts.forEach(court => {
        const game = court.pendingMatch;
        if(court.active.length || !game || !isQueueGameReady(game)) return;
        court.active = [...game.players];
        court.type = game.type;
        court.startTime = now;
        delete court.pendingMatch;
        syncPlayerAssignmentStatuses(court.active.map(p => p.id));
        started.push(court.id);
    });
    return started;
}

function returnCourtWaitingMatch(courtId, expectedGameId) {
    const court = courts.find(court => court.id === courtId);
    if(!court?.pendingMatch || court.pendingMatch.id !== expectedGameId) return false;
    matchQueue.unshift(court.pendingMatch);
    delete court.pendingMatch;
    if(!saveAction(`${courtLabel(courtId)} 대기 입장 취소`)) return false;
    render(); showToast('대기 입장을 취소하고 다음 경기 목록 맨 앞으로 옮겼습니다.');
    return true;
}

function queueDispatchState(game, court) {
    if(!court) return {disabled:true, label:courts.length ? '입장 가능한 코트 없음' : '코트 추가 필요'};
    if(court.pendingMatch) return {disabled:true, label:'대기 입장 있음'};
    const reason = queueBlockReason(game, {allowPlaying:court.active.length > 0});
    if(reason) return {disabled:true, label:reason};
    return {disabled:false, label:court.active.length ? '대기 입장' : '경기 입장'};
}

function queueCourtStatus(court) {
    return court.pendingMatch ? {key:'pending', label:'대기 입장 있음'} : court.active.length ? {key:'playing', label:'경기 중'} : {key:'empty', label:'비어 있음'};
}

function renderQueueCourtChoice(court) {
    if(!court) return `<span class="court-choice-name">${courts.length ? '선택 가능한 코트 없음' : '코트 없음'}</span>${renderUIIcon('chevron-right', 'court-choice-chevron')}`;
    const status = queueCourtStatus(court);
    return `<span class="court-choice-name">${courtLabel(court.id)}</span><span class="court-choice-status court-choice-${status.key}">${status.label}</span>${renderUIIcon('chevron-right', 'court-choice-chevron')}`;
}

function closeQueueCourtMenu() {
    const menu = document.getElementById('queueCourtMenu');
    if(menu.matches?.(':popover-open')) menu.hidePopover();
    queueCourtMenuGameId = null;
    matchQueue.forEach(game => document.getElementById(`queue-court-trigger-${game.id}`)?.setAttribute('aria-expanded', 'false'));
}

function handleQueueCourtMenuToggle(event) {
    if(event.newState === 'closed' && !event.currentTarget.matches(':popover-open')) closeQueueCourtMenu();
}

function prepareQueueCourtMenu(id) {
    if(!matchQueue.some(game => game.id === id) || !courts.some(court => !court.pendingMatch)) return false;
    const trigger = document.getElementById(`queue-court-trigger-${id}`);
    const selectedId = Number(document.getElementById(`queue-court-${id}`).value);
    const menu = document.getElementById('queueCourtMenu');
    queueCourtMenuGameId = id;
    matchQueue.forEach(game => document.getElementById(`queue-court-trigger-${game.id}`)?.setAttribute('aria-expanded', String(game.id === id)));
    menu.setAttribute('aria-label', `${queueGameLabel(id)} 입장할 코트`);
    menu.innerHTML = courts.map(court => {
        const status = queueCourtStatus(court);
        const selected = court.id === selectedId;
        return `<button type="button" class="court-choice-option" role="option" aria-selected="${selected}" ${court.pendingMatch ? 'disabled aria-disabled="true"' : selected ? 'autofocus' : ''} onclick="chooseQueueCourt(${id}, ${court.id})"><span class="court-choice-name">${courtLabel(court.id)}</span><span class="court-choice-status court-choice-${status.key}">${status.label}</span>${renderUIIcon('checkmark', 'court-choice-check')}</button>`;
    }).join('');
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
    const below = Math.max(0, window.innerHeight - rect.bottom - 20);
    const above = Math.max(0, rect.top - 20);
    const height = Math.min(courts.length * 60 + 12, 320);
    const opensAbove = below < height && above > below;
    const maxHeight = Math.min(320, opensAbove ? above : below);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${maxHeight}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    menu.style.top = `${opensAbove ? rect.top - 8 - Math.min(height, maxHeight) : rect.bottom + 8}px`;
    return true;
}

function chooseQueueCourt(gameId, courtId) {
    const court = courts.find(court => court.id === courtId);
    if(queueCourtMenuGameId !== gameId || !matchQueue.some(game => game.id === gameId) || !court || court.pendingMatch) return false;
    document.getElementById(`queue-court-${gameId}`).value = String(courtId);
    updateQueueDispatch(gameId);
    closeQueueCourtMenu();
    document.getElementById(`queue-court-trigger-${gameId}`).focus({preventScroll:true});
    return true;
}

function handleQueueCourtMenuKey(event) {
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll('[role="option"]:not(:disabled)')];
    if(!options.length) return;
    event.preventDefault();
    const current = options.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : current < 0 ? (event.key === 'ArrowUp' ? options.length - 1 : 0) : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
}

function updateQueueDispatch(id) {
    const game = matchQueue.find(game => game.id === id);
    if(!game) return;
    const courtId = Number(document.getElementById(`queue-court-${id}`).value);
    const state = queueDispatchState(game, courts.find(court => court.id === courtId));
    const button = document.getElementById(`queue-enter-${id}`);
    button.innerText = state.label;
    button.disabled = state.disabled;
    const court = courts.find(court => court.id === courtId);
    const trigger = document.getElementById(`queue-court-trigger-${id}`);
    trigger.innerHTML = renderQueueCourtChoice(court);
    trigger.setAttribute('aria-label', `${queueGameLabel(id)} 입장할 코트: ${court ? `${courtLabel(court.id)} · ${queueCourtStatus(court).label}` : '코트 없음'}`);
}

function renderQueue() {
    closeQueueCourtMenu();
    renderAutoMatchType();
    const availableCourts = courts.filter(court => !court.pendingMatch);
    document.getElementById('queueList').innerHTML = matchQueue.length ? matchQueue.map((game,index) => {
        const selectedCourtId = Number(document.getElementById(`queue-court-${game.id}`)?.value);
        const selectedCourt = availableCourts.find(court => court.id === selectedCourtId) || availableCourts.find(court => !court.active.length) || availableCourts[0];
        const dispatch = queueDispatchState(game, selectedCourt);
        const blockers = game.players.filter(p => isPlayerInCourtArea(p.id, 'active'));
        const pseudoCourt = {id:game.id, type:game.type, queue:game.players};
        const slot = idx => game.players[idx] ? renderChip(pseudoCourt, 'queue', idx) : `<button type="button" class="queue-empty-slot" onclick="openManualMatch(${game.id})" aria-label="다음 경기 ${index+1}번 선수 추가">+ 선수 추가</button>`;
        const teams = game.players.length === 4 ? renderMatchTeams(pseudoCourt, 'queue') : `<div class="match-teams"><div class="match-team"><div class="match-team-players">${slot(0)}${slot(1)}</div></div><span class="match-versus" aria-hidden="true">VS</span><div class="match-team"><div class="match-team-players">${slot(2)}${slot(3)}</div></div></div>`;
        return `<article class="queue-card" aria-label="다음 경기 ${index+1}번">
            <div class="queue-card-heading"><strong><span class="queue-order">${index+1}</span>번 경기</strong><button type="button" class="court-delete" onclick="removeQueueGame(${game.id})" aria-label="다음 경기 ${index+1}번 삭제" title="다음 경기 삭제">${renderUIIcon('trash')}</button></div>
            ${teams}${blockers.length ? `<p class="court-wait-note">${blockers.map(p => escapeHTML(p.name)).join(', ')} 선수의 현재 경기 종료 후 입장할 수 있습니다.</p>` : ''}
            <div class="queue-dispatch"><div class="queue-court-picker"><select id="queue-court-${game.id}" hidden aria-hidden="true" tabindex="-1">${courts.length ? courts.map(court => `<option value="${court.id}" ${court.id === selectedCourt?.id ? 'selected' : ''} ${court.pendingMatch ? 'disabled' : ''}>${courtLabel(court.id)} · ${queueCourtStatus(court).label}</option>`).join('') : '<option value="">코트 없음</option>'}</select><button id="queue-court-trigger-${game.id}" type="button" class="court-choice-trigger" popovertarget="queueCourtMenu" aria-haspopup="listbox" aria-expanded="false" aria-label="다음 경기 ${index+1}번 입장할 코트: ${selectedCourt ? `${courtLabel(selectedCourt.id)} · ${queueCourtStatus(selectedCourt).label}` : '코트 없음'}" onclick="prepareQueueCourtMenu(${game.id})" ${availableCourts.length ? '' : 'disabled'}>${renderQueueCourtChoice(selectedCourt)}</button></div><button id="queue-enter-${game.id}" type="button" class="btn btn-primary" onclick="startQueuedGame(${game.id}, Number(document.getElementById('queue-court-${game.id}').value))" ${dispatch.disabled ? 'disabled' : ''}>${dispatch.label}</button></div>
        </article>`;
    }).join('') : '<div class="empty-state queue-empty"><strong>다음 경기를 준비하세요</strong><p>자동 편성하거나 직접 선수를 선택하세요.<br>코트를 고르면 바로 시작하거나 대기 입장합니다.</p></div>';
}
