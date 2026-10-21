// Current court games, scores, and player/team changes.

function courtLabel(courtId) { return `${courts.findIndex(court => court.id === courtId) + 1}번 코트`; }

function delCourt(id) {
    showConfirmModal("이 코트를 삭제하시겠습니까?\n진행 선수는 대기실로, 대기 입장 경기는 다음 경기 목록 맨 앞으로 이동합니다.", () => {
        const c = courts.find(x => x.id === id);
        if (c) {
            const label = courtLabel(id);
            const affectedPlayerIds = c.active.map(p => p.id);
            if(c.pendingMatch) matchQueue.unshift(c.pendingMatch);
            courts = courts.filter(x => x.id !== id);
            syncPlayerAssignmentStatuses(affectedPlayerIds, 'waiting');
            startReadyCourtMatches();
            if(!saveAction(`${label} 삭제`)) return;
            render();
            showToast("코트가 삭제되었습니다.");
        }
    });
}

function getPlayingCourtLabel(playerId) {
    const court = courts.find(c => c.active.some(player => player.id === playerId));
    return court ? `현재 ${courtLabel(court.id)}` : '';
}

function isCourtActionLocked(cId) {
    return Date.now() < (courtActionLocks.get(cId) || 0);
}

function endGame(cId) {
    if(isCourtActionLocked(cId)) return;
    const court = courts.find(candidate => candidate.id === cId);
    if(!court || court.active.length === 0) return;
    const previousState = committedState;
    courtActionLocks.set(cId, Date.now() + 1000);
    completeGame(cId);
    if(committedState === previousState) {
        courtActionLocks.delete(cId);
        render();
        return;
    }
    setTimeout(() => {
        if(!isCourtActionLocked(cId)) {
            courtActionLocks.delete(cId);
            render();
        }
    }, 1000);
}

function closeScoreModal() {
    document.getElementById('scoreModal').style.display = 'none';
    pendingHistoryIndex = null;
}

function saveHistoryScore() {
    if(pendingHistoryIndex === null || !history[pendingHistoryIndex]) return;
    const team1Value = document.getElementById('scoreTeam1').value.trim();
    const team2Value = document.getElementById('scoreTeam2').value.trim();
    const validScore = /^\d{1,2}$/;

    if(!validScore.test(team1Value) || !validScore.test(team2Value)) {
        document.getElementById('scoreError').innerText = '두 팀 점수를 0~99 사이의 정수로 입력하세요.';
        return;
    }

    const scores = [Number(team1Value), Number(team2Value)];
    if(scores[0] === scores[1]) {
        document.getElementById('scoreError').innerText = '승패를 기록하려면 서로 다른 점수를 입력하세요.';
        return;
    }

    const historyIndex = pendingHistoryIndex;
    history[historyIndex].scores = [...scores];
    closeScoreModal();
    if(!saveAction('경기 점수 수정')) return;
    openHistory();
    showToast('경기 점수가 저장되었습니다.');
}

function completeGame(cId) {
    const court = courts.find(c => c.id === cId);
    if(!court) return;
    const now = Date.now();
    const hadActiveGame = court.active.length > 0;
    if(!hadActiveGame) return;
    const affectedPlayerIds = court.active.map(p => p.id);

    if(court.active.length > 0) {
        const activePlayers = [...court.active];
        const pIds = activePlayers.map(p => p.id);
        const pNames = activePlayers.map(p => p.name).join(', ');
        const sTime = court.startTime || (now - 10*60*1000);

        const record = {
            startTime: sTime,
            endTime: now,
            cId: cId,
            pIds: pIds,
            names: pNames,
            teamNames: [
                activePlayers.slice(0, 2).map(p => p.name),
                activePlayers.slice(2, 4).map(p => p.name)
            ]
        };
        history.unshift(record);
        if(history.length > 200) history.pop();

        activePlayers.forEach(p => {
            const target = players.find(x => x.id === p.id);
            if(target) { target.games++; target.lastTime = now; }
        });
    }

    court.active = [];
    court.startTime = null;
    syncPlayerAssignmentStatuses(affectedPlayerIds, 'waiting');
    const started = startReadyCourtMatches(now);
    if(!saveAction(`${courtLabel(cId)} 경기 종료`)) return;
    render();
    showToast(started.length ? `경기를 종료하고 ${started.map(courtLabel).join(', ')}의 대기 경기를 시작했습니다.` : court.pendingMatch ? '경기를 종료했습니다. 대기 선수의 다른 경기가 끝나면 자동으로 시작합니다.' : '경기를 종료했습니다. 준비된 다음 경기를 입장시키세요.');
}

function isPlayerInCourtArea(playerId, area) {
    return area === 'queue'
        ? [...matchQueue, ...courts.map(court => court.pendingMatch).filter(Boolean)].some(game => game.players.some(player => player.id === playerId))
        : courts.some(court => court.active.some(player => player.id === playerId));
}

function isPlayerPlayingOutsideCourt(playerId, courtId) {
    return courts.some(court => court.id !== courtId && court.active.some(player => player.id === playerId));
}

function syncPlayerAssignmentStatus(playerId, fallbackStatus = null) {
    const player = players.find(candidate => candidate.id === playerId);
    if(!player) return;

    if(isPlayerInCourtArea(playerId, 'active')) setPlayerStatus(player, 'playing');
    else if(isPlayerInCourtArea(playerId, 'queue')) setPlayerStatus(player, 'reserved');
    else if(fallbackStatus) setPlayerStatus(player, fallbackStatus);
    else if(player.status === 'playing' || player.status === 'reserved') setPlayerStatus(player, 'waiting');
}

function syncPlayerAssignmentStatuses(playerIds, fallbackStatus = null) {
    [...new Set(playerIds)].forEach(playerId => syncPlayerAssignmentStatus(playerId, fallbackStatus));
}

function addCourt() {
    let id = Date.now();
    while(courts.some(court => court.id === id)) id++;
    courts.push({id, type:'A', active:[], next:[], startTime:null});
    if(!saveAction(`${courts.length}번 코트 추가`)) return;
    render();
    if(window.matchMedia('(max-width: 600px), (max-height: 500px) and (max-width: 950px)').matches) setMobileView('courts');
}

function assignmentFor(id, area) {
    if(area === 'queue') {
        const game = matchQueue.find(game => game.id === id);
        return game ? {match:game.players, type:game.type, label:`다음 경기 ${matchQueue.indexOf(game) + 1}번`} : null;
    }
    const court = courts.find(court => court.id === id);
    if(area === 'waiting' && court?.pendingMatch) return {match:court.pendingMatch.players, type:court.pendingMatch.type, gameId:court.pendingMatch.id, label:`${courtLabel(id)} 대기 입장`};
    return area === 'active' && court ? {match:court.active, type:court.type, label:courtLabel(id)} : null;
}

function openSwap(cId, area, idx) {
    const assignment = assignmentFor(cId, area);
    if(!assignment?.match[idx]) return;
    swapTarget = {cId, area, idx, playerId:assignment.match[idx].id, gameId:assignment.gameId};
    renderSwapList();
}

function getSwapCandidates() {
    if(!swapTarget) return [];
    const assignment = assignmentFor(swapTarget.cId, swapTarget.area);
    if(!assignment?.match[swapTarget.idx] || assignment.gameId !== swapTarget.gameId) return [];
    const selected = assignment.match[swapTarget.idx];
    const pool = swapTarget.area === 'queue'
        ? manualCandidates(swapTarget.cId).filter(player => !assignment.match.some(p => p.id === player.id))
        : getAutoMatchPool({includePlaying:swapTarget.area === 'waiting'});
    return pool.filter(player => assignment.type === 'A' || (assignment.type === 'X' ? player.gender === selected.gender : player.gender === assignment.type));
}

function renderSwapList() {
    if(!swapTarget) return;
    const assignment = assignmentFor(swapTarget.cId, swapTarget.area);
    if(!assignment || assignment.match[swapTarget.idx]?.id !== swapTarget.playerId || assignment.gameId !== swapTarget.gameId) return closeSwapModal();
    const {match, type, label} = assignment;
    const selected = match[swapTarget.idx];
    const list = document.getElementById('swapList');
    document.getElementById('swapHelp').innerText = `${selected.name} · ${label}`;
    list.innerHTML = '<h4 class="picker-section-label">팀 변경 · 상대 팀 선수와 자리 바꾸기</h4>';
    match.forEach((player,index) => {
        if(Math.floor(index / 2) === Math.floor(swapTarget.idx / 2) || (type === 'X' && player.gender !== selected.gender)) return;
        list.innerHTML += `<button type="button" class="player-chip roster-chip manual-chip swap-chip gender-card ${getGenderCardClass(player.gender)}" onclick="changeCourtTeam(${index}, ${player.id})">${renderRosterSummary(player, 'swap-')}</button>`;
    });
    list.innerHTML += `<h4 class="picker-section-label">선수 교체</h4><p class="picker-section-description">${swapTarget.area !== 'active' ? '다른 다음 경기나 대기 입장에 편성되지 않은 대기·경기 중 선수로 교체합니다.' : '편성되지 않은 대기 선수로 교체합니다.'}</p>`;
    const candidates = getSwapCandidates();
    if(!candidates.length) list.innerHTML += '<div class="empty-state">교체 가능한 선수가 없습니다.</div>';
    shuffleByGameCount(candidates).forEach(player => {
        list.innerHTML += `<button type="button" class="player-chip roster-chip manual-chip swap-chip gender-card ${getGenderCardClass(player.gender)}" onclick="doSwap(${player.id})">${renderRosterSummary(player, 'swap-')}</button>`;
    });
    document.getElementById('swapModal').style.display = 'flex';
}

function changeCourtTeam(otherIndex, expectedPlayerId) {
    if(!swapTarget) return;
    const assignment = assignmentFor(swapTarget.cId, swapTarget.area);
    const {idx, playerId} = swapTarget;
    if(!assignment || assignment.gameId !== swapTarget.gameId || !Number.isInteger(otherIndex) || !assignment.match[otherIndex] ||
        assignment.match[idx]?.id !== playerId || assignment.match[otherIndex].id !== expectedPlayerId ||
        Math.floor(idx / 2) === Math.floor(otherIndex / 2) ||
        (assignment.type === 'X' && assignment.match[idx].gender !== assignment.match[otherIndex].gender)) return closeSwapModal();
    [assignment.match[idx], assignment.match[otherIndex]] = [assignment.match[otherIndex], assignment.match[idx]];
    if(!saveAction(`${assignment.label} 팀 변경`)) return;
    closeSwapModal(); render(); showToast('팀 구성을 변경했습니다.');
}

function doSwap(pId) {
    if(!swapTarget) return;
    const assignment = assignmentFor(swapTarget.cId, swapTarget.area);
    const replacement = getSwapCandidates().find(player => player.id === pId);
    if(!assignment || assignment.match[swapTarget.idx]?.id !== swapTarget.playerId || assignment.gameId !== swapTarget.gameId) return closeSwapModal();
    const old = assignment.match[swapTarget.idx];
    if(!replacement || (assignment.type === 'X' ? replacement.gender !== old.gender : assignment.type !== 'A' && replacement.gender !== assignment.type)) return showToast('현재 교체할 수 없는 선수입니다.');
    assignment.match[swapTarget.idx] = replacement;
    syncPlayerAssignmentStatuses([old.id, replacement.id], 'waiting');
    startReadyCourtMatches();
    if(!saveAction(`${assignment.label} 선수 교체`)) return;
    closeSwapModal(); render(); showToast('선수를 교체했습니다.');
}

function closeSwapModal() {
    document.getElementById('swapModal').style.display='none';
    swapTarget = null;
}
