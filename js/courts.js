// Court lifecycle, reservations, transfers, scores, and player swaps.

function courtLabel(courtId) { return `${courts.findIndex(court => court.id === courtId) + 1}번 코트`; }

function delCourt(id) {
    showConfirmModal("이 코트를 삭제하시겠습니까?\n(배정된 선수들은 대기실로 이동합니다)", () => {
        const c = courts.find(x => x.id === id);
        if (c) {
            const label = courtLabel(id);
            const affectedPlayerIds = [...c.active, ...c.next].map(p => p.id);
            courts = courts.filter(x => x.id !== id);
            syncPlayerAssignmentStatuses(affectedPlayerIds, 'waiting');
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
    if(!court || (court.active.length === 0 && court.next.length === 0)) return;
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
    const successionBlockers = court.next.filter(player => isPlayerPlayingOutsideCourt(player.id, cId));
    const affectedPlayerIds = [...court.active, ...court.next].map(p => p.id);

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

    if(court.next.length > 0 && successionBlockers.length === 0) {
        court.active = [...court.next];
        court.next = [];
        court.startTime = Date.now();
    } else {
        court.active = [];
        court.startTime = null;
    }
    syncPlayerAssignmentStatuses(affectedPlayerIds, 'waiting');
    if(!saveAction(`${courtLabel(cId)} ${hadActiveGame ? '경기 종료' : '경기 시작'}`)) return;
    render();

    if(successionBlockers.length > 0) {
        const blockerNames = successionBlockers.map(player => player.name).join(', ');
        const prefix = hadActiveGame ? '게임 종료 · 승계 불가' : '게임 시작 불가';
        showToast(`${prefix}: ${blockerNames} 선수가 아직 다른 코트에서 게임 중입니다.`);
    }
}

function cancelNext(cId) {
    const court = courts.find(c => c.id === cId);
    if(!court) return;
    const affectedPlayerIds = court.next.map(p => p.id);
    court.next = [];
    syncPlayerAssignmentStatuses(affectedPlayerIds, 'waiting');
    if(!saveAction(`${courtLabel(cId)} 다음 예약 취소`)) return;
    render();
}

function openTransferNext(cId) {
    const source = courts.find(c => c.id === cId);
    if(!source || source.next.length === 0) return showToast("이동할 다음 대기 선수가 없습니다.");
    const targets = courts.filter(c => c.id !== cId && c.next.length === 0);
    if(targets.length === 0) return showToast("다음 대기가 비어 있는 다른 코트가 없습니다.");
    transferSourceCourtId = cId;
    document.getElementById('transferCourtSelect').innerHTML = targets.map(c => `<option value="${c.id}">${courts.indexOf(c) + 1}번 코트${c.active.length ? ' (게임 중)' : ' (비어 있음)'}</option>`).join('');
    document.getElementById('transferModal').style.display = 'flex';
}

function closeTransferModal() {
    document.getElementById('transferModal').style.display = 'none';
    transferSourceCourtId = null;
}

function confirmTransferNext() {
    const source = courts.find(c => c.id === transferSourceCourtId);
    const target = courts.find(c => c.id === Number(document.getElementById('transferCourtSelect').value));
    if(!source || !target || source.next.length === 0) return closeTransferModal();
    if(target.next.length > 0) return showToast("대상 코트에 이미 다음 대기가 있습니다.");
    target.next = source.next;
    source.next = [];
    if(!saveAction(`${courtLabel(source.id)} → ${courtLabel(target.id)} 예약 이동`)) return;
    closeTransferModal(); render();
    showToast(`${courts.indexOf(target) + 1}번 코트로 다음 대기를 이동했습니다.`);
}

function isPlayerInCourtArea(playerId, area) {
    return courts.some(court => court[area].some(player => player.id === playerId));
}

function isPlayerPlayingOutsideCourt(playerId, courtId) {
    return courts.some(court => court.id !== courtId && court.active.some(player => player.id === playerId));
}

function syncPlayerAssignmentStatus(playerId, fallbackStatus = null) {
    const player = players.find(candidate => candidate.id === playerId);
    if(!player) return;

    if(isPlayerInCourtArea(playerId, 'active')) setPlayerStatus(player, 'playing');
    else if(isPlayerInCourtArea(playerId, 'next')) setPlayerStatus(player, 'reserved');
    else if(fallbackStatus) setPlayerStatus(player, fallbackStatus);
    else if(player.status === 'playing' || player.status === 'reserved') setPlayerStatus(player, 'waiting');
}

function syncPlayerAssignmentStatuses(playerIds, fallbackStatus = null) {
    [...new Set(playerIds)].forEach(playerId => syncPlayerAssignmentStatus(playerId, fallbackStatus));
}

function setType(id, val) { courts.find(c=>c.id===id).type = val; if(!saveAction(`${courtLabel(id)} 경기 유형 변경`)) return; render(); }

function addCourt() {
    courts.push({id:Date.now(), type:'A', active:[], next:[], startTime:null});
    if(!saveAction(`${courts.length}번 코트 추가`)) return;
    render();
    if(window.matchMedia('(max-width: 600px), (max-height: 500px) and (max-width: 950px)').matches) setMobileView('courts');
}

function openSwap(cId, area, idx) {
    const court = courts.find(candidate => candidate.id === cId);
    if(!court || !court[area] || !court[area][idx]) return;

    swapTarget = {cId, area, idx};
    renderSwapList();
}

function renderSwapList() {
    if(!swapTarget) return;
    const list = document.getElementById('swapList'); list.innerHTML='';
    const allowPlayingPlayers = swapTarget.area === 'next';
    document.getElementById('swapHelp').innerText = allowPlayingPlayers
        ? '대기 중인 선수와 현재 게임 중인 선수를 선택할 수 있습니다.'
        : '대기 중인 선수를 선택할 수 있습니다.';

    const candidates = players.filter(player => {
        const isPlaying = isPlayerInCourtArea(player.id, 'active');
        const isAlreadyReserved = isPlayerInCourtArea(player.id, 'next');
        if(isAlreadyReserved) return false;
        if(isPlaying) return allowPlayingPlayers;
        return player.status === 'waiting';
    }).sort((a, b) => {
        const playingOrder = Number(isPlayerInCourtArea(a.id, 'active')) - Number(isPlayerInCourtArea(b.id, 'active'));
        return playingOrder || a.games - b.games || a.lastTime - b.lastTime;
    });

    if(candidates.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:24px 12px;">교체 가능한 선수가 없습니다.</div>';
    }

    candidates.forEach(p => {
        const status = isPlayerInCourtArea(p.id, 'active') ? 'playing' : p.status;
        list.innerHTML += `<button type="button" class="player-chip waiting-chip roster-chip manual-chip swap-chip gender-card ${getGenderCardClass(p.gender)} roster-status-${status}" onclick="doSwap(${p.id})">
            ${renderRosterSummary(p, 'swap-', status)}
        </button>`;
    });
    document.getElementById('swapModal').style.display='flex';
}

function doSwap(pId) {
    if(!swapTarget) return;
    const c = courts.find(x=>x.id===swapTarget.cId);
    const replacement = players.find(x=>x.id===pId);
    if(!c || !replacement || !c[swapTarget.area] || !c[swapTarget.area][swapTarget.idx]) return closeSwapModal();

    const replacementIsPlaying = isPlayerInCourtArea(pId, 'active');
    if(swapTarget.area !== 'next' && replacementIsPlaying) return showToast('게임 중인 선수는 다음 대기에만 넣을 수 있습니다.');
    if(isPlayerInCourtArea(pId, 'next')) return showToast('이미 다음 대기에 배정된 선수입니다.');

    const oldP = c[swapTarget.area][swapTarget.idx];
    c[swapTarget.area][swapTarget.idx] = replacement;
    syncPlayerAssignmentStatus(oldP.id, 'waiting');
    syncPlayerAssignmentStatus(pId);
    if(!saveAction(`${courtLabel(c.id)} ${oldP.name} → ${replacement.name} 선수 교체`)) return;
    closeSwapModal(); render();
    showToast(replacementIsPlaying ? '교체 완료 · 현재 게임 중인 선수입니다.' : '교체 완료');
}

function closeSwapModal() {
    document.getElementById('swapModal').style.display='none';
    swapTarget = null;
}
