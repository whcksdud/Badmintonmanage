// Shared dialogs, roster/court rendering, and responsive navigation.

function setFormChoice(fieldId, value, options) {
    document.getElementById(fieldId).value = String(value);
    options.forEach(option => {
        document.getElementById(`${fieldId}-${option}`).checked = String(option) === String(value);
    });
}

function setMobileView(view) {
    const showWaitingRoom = view === 'waiting';
    const mainContainer = document.getElementById('mainContainer');
    const courtsTab = document.getElementById('mobileCourtsTab');
    const waitingTab = document.getElementById('mobileWaitingTab');

    mainContainer.classList.toggle('mobile-view-courts', !showWaitingRoom);
    mainContainer.classList.toggle('mobile-view-waiting', showWaitingRoom);
    courtsTab.classList.toggle('active', !showWaitingRoom);
    waitingTab.classList.toggle('active', showWaitingRoom);
    courtsTab.setAttribute('aria-selected', String(!showWaitingRoom));
    waitingTab.setAttribute('aria-selected', String(showWaitingRoom));

    if (!showWaitingRoom && selectedRosterPlayerId !== null) closeRosterActionSheet();

    if (showWaitingRoom && waitingRoomCollapsed) {
        waitingRoomCollapsed = false;
        mainContainer.classList.remove('waiting-collapsed');
        updateWaitingToggleButton();
    }
}

function showConfirmModal(msg, callback) {
    document.getElementById('confirmMsg').innerText = msg;
    onConfirmAction = callback;
    document.getElementById('confirmModal').style.display = 'flex';
}

function executeConfirm() {
    if (onConfirmAction) {
        onConfirmAction();
        onConfirmAction = null;
    }
    closeConfirmModal();
}

function closeConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
    onConfirmAction = null;
}

function updateUndoButton() {
    const button = document.getElementById('undoButton');
    button.disabled = !undoState;
    button.title = undoState ? `${undoLabel} 되돌리기` : '되돌릴 작업이 없습니다.';
    button.setAttribute('aria-label', button.title);
}

function showToast(msg) {
    const t = document.getElementById("toast"); t.innerText = msg;
    t.className = document.getElementById('membersModal').style.display === 'flex' ? 'show members-open' : 'show';
    setTimeout(() => { t.className = t.className.replace("show", ""); }, 3000);
}

function toggleWaitingRoom() {
    waitingRoomCollapsed = !waitingRoomCollapsed;
    document.getElementById('mainContainer').classList.toggle('waiting-collapsed', waitingRoomCollapsed);
    updateWaitingToggleButton();
    if(waitingRoomCollapsed && selectedRosterPlayerId !== null) closeRosterActionSheet();
}

function setRosterFilter(status) {
    rosterFilter = status;
    selectedRosterPlayerId = null;
    collapsedStatuses.delete(status);
    renderRoster();
    document.getElementById('waitList').scrollTop = 0;
}

function resetRosterFilters() {
    document.getElementById('searchInput').value = '';
    collapsedStatuses.clear();
    setRosterFilter('all');
}

function toggleRosterSearch(forceOpen = null) {
    const search = document.getElementById('rosterSearch');
    const button = document.getElementById('waitingSearchToggle');
    const input = document.getElementById('searchInput');
    const shouldOpen = forceOpen === null ? search.hidden : forceOpen;
    search.hidden = !shouldOpen;
    button.setAttribute('aria-expanded', String(shouldOpen));
    button.title = shouldOpen ? '선수 검색 닫기' : '선수 검색 열기';
    button.setAttribute('aria-label', button.title);
    document.getElementById('waitingSearchIcon').setAttribute('href', shouldOpen ? '#icon-close' : '#icon-search');
    if(shouldOpen) input.focus();
    else {
        input.value = '';
        renderRoster();
        button.focus();
    }
}

function handleRosterSearchKey(event) {
    if(event.key !== 'Escape') return;
    toggleRosterSearch(false);
}

function updateWaitingToggleButton() {
    const button = document.getElementById('waitingToggle');
    if(!button) return;
    button.innerHTML = renderUIIcon(waitingRoomCollapsed ? 'chevron-right' : 'chevron-left');
    button.title = waitingRoomCollapsed ? '대기실 펼치기' : '대기실 접기';
    button.setAttribute('aria-label', button.title);
}

function formatTime(timestamp) {
    const d = new Date(timestamp);
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function formatElapsedTime(startTime) {
    const diff = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    const min = Math.floor(diff / 60);
    const sec = diff % 60;
    return `${min.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
}

function openSettings() { document.getElementById('settingsModal').style.display='flex'; }

function closeSettings() { document.getElementById('settingsModal').style.display='none'; }

function openInfoModal() { document.getElementById('infoModal').style.display='flex'; }

function closeInfoModal() { document.getElementById('infoModal').style.display='none'; }

function renderRosterActionSheet() {
    const sheet = document.getElementById('rosterActionSheet');
    const player = players.find(candidate => String(candidate.id) === String(selectedRosterPlayerId));
    const waitingCourt = document.getElementById('waitingCourt');

    if(!player) {
        selectedRosterPlayerId = null;
        sheet.innerHTML = '';
        sheet.hidden = true;
        waitingCourt.classList.remove('has-roster-selection');
        document.getElementById('toast').classList.remove('roster-sheet-open');
        return;
    }

    const safePlayerName = escapeHTML(player.name);
    const canToggleRest = player.status === 'waiting' || player.status === 'resting';
    const shuttleActionLabel = player.shuttlecock ? '콕 냄 표시 취소' : '콕 냄 표시';
    sheet.innerHTML = `
        <div class="roster-sheet-heading">
            <span>선택</span>
            <strong id="rosterActionSheetTitle" title="${safePlayerName}">${safePlayerName}</strong>
            <span>${tiers[player.tier]} · ${player.games}경기</span>
            <button type="button" class="roster-sheet-close" onclick="closeRosterActionSheet(true)" aria-label="선수 관리 닫기" title="선수 관리 닫기">${renderUIIcon('close')}</button>
        </div>
        <p class="roster-matching-summary">실제 ${player.games}경기 · 매칭 기준 ${getMatchingGameCount(player)}경기</p>
        <div class="roster-sheet-action-buttons" role="group" aria-label="${safePlayerName} 선수 관리 동작">
            ${canToggleRest ? `<button type="button" class="roster-action ${player.status === 'resting' ? 'resume' : 'rest'}" onclick="toggleRestStatus(${player.id})" title="${player.status === 'resting' ? '대기로 복귀' : '휴식'}">${renderRosterActionIcon(player.status === 'resting' ? 'resume' : 'rest')}<span>${player.status === 'resting' ? '복귀' : '휴식'}</span></button>` : ''}
            <button type="button" class="roster-action shuttle ${player.shuttlecock ? 'active' : ''}" onclick="toggleShuttlecock(${player.id})" aria-pressed="${player.shuttlecock}" aria-label="${shuttleActionLabel}">${renderRosterActionIcon(player.shuttlecock ? 'cancel' : 'shuttle')}<span>${player.shuttlecock ? '콕 취소' : '콕 냄'}</span></button>
            <button type="button" class="roster-action edit" onclick="openPModal(${player.id})" title="정보 수정">${renderRosterActionIcon('edit')}<span>수정</span></button>
        </div>`;
    sheet.hidden = false;
    waitingCourt.classList.add('has-roster-selection');
    document.getElementById('toast').classList.add('roster-sheet-open');
}

function renderRosterSummary(player, timerPrefix = '', status = player.status) {
    const safePlayerName = escapeHTML(player.name);
    const statusLabels = {waiting:'대기 중', reserved:'예약됨', playing:'게임 중', resting:'휴식 중'};
    const locations = courts.flatMap(court => [
        court.active.some(p => p.id === player.id) ? `${courtLabel(court.id)} 경기 중` : '',
        court.next.some(p => p.id === player.id) ? `${courtLabel(court.id)} 예약` : ''
    ]).filter(Boolean).join(' · ');
    return `<span class="roster-summary">
        <span class="roster-identity">
            <span class="p-name" title="${safePlayerName}">${safePlayerName}</span>
            <span class="roster-details"><span>${player.gender === 'M' ? '남' : '여'} · ${tiers[player.tier]}</span><span>${player.games}경기</span>${player.shuttlecock ? `<span class="roster-shuttle">${renderUIIcon('shuttle')}콕 냄</span>` : ''}</span>
        </span>
        <span class="roster-metrics">
            ${status === 'waiting' || status === 'reserved' ? `<span id="${timerPrefix}waiting-time-${player.id}" class="roster-wait-time">${formatWaitingTime(player)}</span>` : `<span class="roster-status-label">${statusLabels[status]}</span>`}
            ${locations ? `<span class="roster-location">${locations}</span>` : ''}
        </span>
    </span>`;
}

function renderRoster() {
    const keyword = document.getElementById('searchInput').value.trim().toLowerCase();
    const counts = {all:players.length, waiting:0, reserved:0, playing:0, resting:0};
    players.forEach(p => counts[p.status]++);
    Object.keys(counts).forEach(status => {
        document.getElementById(`rosterCount-${status}`).innerText = counts[status];
        document.getElementById(`rosterFilter-${status}`).setAttribute('aria-pressed', String(rosterFilter === status));
    });

    const renderWaitList = () => {
        const container = document.getElementById('waitList');
        if(!container) return;
        container.innerHTML = '';

        let list = players.filter(p => p.name.toLowerCase().includes(keyword) && (rosterFilter === 'all' || p.status === rosterFilter));
        if(!list.some(p => String(p.id) === String(selectedRosterPlayerId) && !collapsedStatuses.has(p.status))) selectedRosterPlayerId = null;
        if(!list.length) {
            container.innerHTML = players.length
                ? `<div class="empty-state roster-empty"><strong>${keyword ? '검색 결과가 없습니다' : '해당 상태의 선수가 없습니다'}</strong><span>다른 상태를 선택하거나 검색어를 바꿔보세요.</span><button type="button" class="btn btn-outline" onclick="resetRosterFilters()">전체 선수 보기</button></div>`
                : `<div class="empty-state roster-empty"><strong>오늘 함께할 선수를 불러오세요</strong><span>회원 명단에서 참석자를 선택하면<br>이곳에서 대기와 경기 현황을 볼 수 있어요.</span><button type="button" class="btn btn-primary" onclick="openMembersModal()">참석자 선택</button></div>`;
            return;
        }

        list.sort((a,b) => {
            const statusScore = { 'waiting': 0, 'reserved': 1, 'playing': 2, 'resting': 3 };
            if(statusScore[a.status] !== statusScore[b.status]) return statusScore[a.status] - statusScore[b.status];
            if(a.games !== b.games) return a.games - b.games;
            return a.lastTime - b.lastTime;
        });

        const statusLabels = {
            waiting: '대기 중',
            resting: '휴식 중',
            reserved: '예약됨',
            playing: '게임 중'
        };
        const statusCounts = list.reduce((counts, player) => {
            counts[player.status] = (counts[player.status] || 0) + 1;
            return counts;
        }, {});

        let previousStatus = null;
        list.forEach(p => {
            if(p.status !== previousStatus) {
                const isCollapsed = collapsedStatuses.has(p.status);
                const statusLabel = statusLabels[p.status] || p.status;
                container.innerHTML += `<div class="list-section list-section-${p.status}"><span>${statusLabel} (${statusCounts[p.status]}명)</span><button type="button" class="btn-text" onclick="toggleStatusList('${p.status}')" aria-expanded="${!isCollapsed}" aria-label="${statusLabel} 목록 ${isCollapsed ? '펼치기' : '접기'}">${isCollapsed ? '펼치기' : '접기'}</button></div>`;
            }
            previousStatus = p.status;
            if(collapsedStatuses.has(p.status)) return;
            const safePlayerName = escapeHTML(p.name);
            const isSelected = String(selectedRosterPlayerId) === String(p.id);

            container.innerHTML += `
            <div id="roster-player-${p.id}" class="player-chip waiting-chip roster-chip gender-card ${getGenderCardClass(p.gender)} roster-status-${p.status} ${p.shuttlecock ? 'has-shuttlecock' : ''} ${isSelected ? 'action-selected' : ''}" role="button" tabindex="0" aria-expanded="${isSelected}" aria-controls="rosterActionSheet" aria-label="${safePlayerName} · ${p.gender === 'M' ? '남' : '여'} · ${tiers[p.tier]} · ${p.games}경기 · ${statusLabels[p.status]}${p.shuttlecock ? ' · 콕 냄' : ''} 선수 관리 ${isSelected ? '닫기' : '열기'}" onclick="toggleRosterActionSheet(${p.id})" onkeydown="handleRosterCardKey(event, ${p.id})">
                ${renderRosterSummary(p)}
            </div>`;
        });
    };
    renderWaitList();
    renderRosterActionSheet();
}

function render() {
    if(document.getElementById('membersModal').style.display === 'flex') renderMembers();
    document.getElementById('storageError').innerText = storageError;
    document.getElementById('storageError').hidden = !storageError;
    updateUndoButton();
    document.getElementById('mobileCourtCount').innerText = courts.length;
    document.getElementById('mobileRosterCount').innerText = players.length;
    renderRoster();

    const cg = document.getElementById('courtGrid'); cg.innerHTML = '';
    courts.forEach((c, idx) => {
        const hasActive = c.active.length > 0;
        const hasNext = c.next.length > 0;
        const actionLocked = isCourtActionLocked(c.id);
        const blockers = c.next.filter(player => isPlayerPlayingOutsideCourt(player.id, c.id));
        const stateLabel = hasActive ? '경기 중' : !hasNext ? '비어 있음' : blockers.length ? '다른 코트 종료 대기' : '시작 가능';
        const stateColor = hasActive ? '#2563eb' : blockers.length ? '#d97706' : hasNext ? '#16a34a' : '#94a3b8';
        const typeSel = `<select class="type-select" onchange="setType(${c.id}, this.value)" aria-label="코트 ${idx + 1} 경기 유형">
            <option value="A" ${c.type=='A'?'selected':''}>자율</option>
            <option value="M" ${c.type=='M'?'selected':''}>남복</option>
            <option value="F" ${c.type=='F'?'selected':''}>여복</option>
            <option value="X" ${c.type=='X'?'selected':''}>혼복</option>
        </select>`;

        let activeHTML = hasActive ? renderMatchTeams(c, 'active') : `<div class="empty-state"><span class="empty-state-content">${renderUIIcon('shuttle')}<span>${hasNext ? '예약 선수 입장 대기' : '선수를 배정해 주세요'}</span></span></div>`;

        let nextHTML = '';
        if(hasNext) {
            nextHTML = `${renderMatchTeams(c, 'next', 'next-chip')}
                        ${blockers.length ? `<p class="court-wait-note">${blockers.map(player => `${escapeHTML(player.name)} (${getPlayingCourtLabel(player.id)})`).join(', ')} 경기 종료 후 시작할 수 있습니다.</p>` : ''}
                        <div style="display:flex; gap:6px; margin-top:8px;">
                            <button class="btn btn-outline" style="flex:1; font-size:0.8rem;" onclick="openTransferNext(${c.id})">코트 변경</button>
                            <button class="btn btn-outline" style="flex:1; font-size:0.8rem;" onclick="cancelNext(${c.id})">예약 취소</button>
                        </div>`;
        } else {
             nextHTML = `
             <div style="display:flex; gap:5px;">
                 <button class="btn btn-reserve" style="flex:2" onclick="matchCourt(${c.id})">${hasActive ? '다음 예약' : `${renderUIIcon('bolt')}<span>자동 매칭</span>`}</button>
                 <button class="btn btn-outline" style="flex:1" onclick="openManualMatch(${c.id})">수동</button>
             </div>`;
        }

        let mainBtnHTML = '';
        if (hasActive) {
            mainBtnHTML = `<button class="btn btn-danger" style="width:100%" onclick="endGame(${c.id})" ${actionLocked ? 'disabled' : ''}>경기 종료${hasNext ? blockers.length ? ' · 다음 경기 대기' : ' · 다음 경기 시작' : ''}</button>`;
        } else if (hasNext) {
            mainBtnHTML = `<button class="btn btn-primary" style="width:100%" onclick="endGame(${c.id})" ${blockers.length || actionLocked ? 'disabled' : ''}>${blockers.length ? '다른 코트 종료 대기' : '경기 시작 · 선수 입장'}</button>`;
        }

        cg.innerHTML += `
        <div class="court-card">
            <div class="cc-header">
                <div class="court-heading">
                    <span class="court-title">코트 ${idx+1}</span>
                    <span class="court-live-state">${stateLabel} <span class="status-dot" style="background:${stateColor}" aria-hidden="true"></span></span>
                    <span id="timer-${c.id}" class="timer-badge" style="display:${hasActive && c.startTime ? 'inline-flex' : 'none'}">${hasActive && c.startTime ? formatElapsedTime(c.startTime) : '00:00'}</span>
                </div>
                <div class="cc-actions">
                    ${typeSel} <button type="button" class="court-delete" onclick="delCourt(${c.id})" aria-label="코트 ${idx+1} 삭제" title="코트 삭제">${renderUIIcon('trash')}</button>
                </div>
            </div>
            <div class="game-section">
                ${activeHTML}
            </div>
            <div class="next-section">
                <div class="section-label">다음 대기 <span class="status-dot" style="background:${hasNext?'#f59e0b':'#cbd5e1'}" aria-hidden="true"></span></div>
                ${nextHTML}
            </div>
            ${mainBtnHTML ? `<div class="btn-group">${mainBtnHTML}</div>` : ''}
        </div>`;
    });
}

function renderMatchTeams(court, area, chipClass = '') {
    const match = court[area];
    if(!Array.isArray(match)) return '';
    if(match.length !== 4) {
        return `<div class="player-grid">${match.map((player, index) => renderChip(court, area, index, chipClass)).join('')}</div>`;
    }

    const renderTeamPlayers = indexes => indexes.map(index => renderChip(court, area, index, chipClass)).join('');
    return `<div class="match-teams">
        <div class="match-team team-a" role="group" aria-label="A팀">
            <div class="match-team-players">${renderTeamPlayers([0, 1])}</div>
        </div>
        <span class="match-versus" aria-hidden="true">VS</span>
        <div class="match-team team-b" role="group" aria-label="B팀">
            <div class="match-team-players">${renderTeamPlayers([2, 3])}</div>
        </div>
    </div>`;
}

function renderChip(court, area, idx, cls='') {
    const p = court[area][idx];
    const safePlayerName = escapeHTML(p.name);
    const isPlayingReservation = area === 'next' && isPlayerInCourtArea(p.id, 'active');
    const playingBadge = isPlayingReservation
        ? '<span class="next-playing-badge">게임 중</span>'
        : '';
    return `<button type="button" class="player-chip match-player-chip gender-card ${getGenderCardClass(p.gender)} ${cls}" aria-label="${safePlayerName} · ${idx < 2 ? 'A' : 'B'}팀 · 선수 변경" onclick="openSwap(${court.id}, '${area}', ${idx})">
        ${renderGenderAccessibility(p.gender)}
        ${playingBadge}
        <div class="match-player-content">
            <span class="p-name" title="${safePlayerName}">${safePlayerName}</span>
            <span class="p-info">${tiers[p.tier]}</span>
        </div>
    </button>`;
}

function getGenderCardClass(gender) {
    return gender === 'M' ? 'gender-m' : 'gender-f';
}

function renderGenderAccessibility(gender) {
    return `<span class="sr-only">성별: ${gender === 'M' ? '남성' : '여성'}</span>`;
}

function renderRosterActionIcon(action) {
    return renderUIIcon(action, `roster-action-icon roster-action-icon-${action}`);
}

function toggleRosterActionSheet(id) {
    selectedRosterPlayerId = String(selectedRosterPlayerId) === String(id) ? null : id;
    renderRoster();
    document.getElementById(`roster-player-${id}`)?.focus({preventScroll:true});
}

function closeRosterActionSheet(returnFocus = false) {
    const playerId = selectedRosterPlayerId;
    selectedRosterPlayerId = null;
    renderRoster();
    if(returnFocus) document.getElementById(`roster-player-${playerId}`)?.focus({preventScroll:true});
}

function handleRosterActionSheetOutsideClick(event) {
    if(selectedRosterPlayerId === null) return;
    if(event.target?.closest?.('.roster-chip')) return;
    closeRosterActionSheet();
}

function handleRosterCardKey(event, id) {
    if(event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    toggleRosterActionSheet(id);
}

function toggleStatusList(status) {
    if(collapsedStatuses.has(status)) collapsedStatuses.delete(status);
    else collapsedStatuses.add(status);
    renderRoster();
}

function escapeHTML(value) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

function renderUIIcon(name, className = '') {
    const classes = ['ui-icon', className].filter(Boolean).join(' ');
    return `<svg class="${classes}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;
}
