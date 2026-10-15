// Automatic/manual selection and partner-history team balancing.

function getMatchingGameCount(player) {
    const offset = Number(player.matchingOffset);
    return player.games + (Number.isFinite(offset) && offset >= 0 ? offset : 0);
}

function getAutoMatchPool() {
    return players.filter(player => {
        if(isPlayerInCourtArea(player.id, 'next')) return false;
        if(isPlayerInCourtArea(player.id, 'active')) return false;
        return player.status === 'waiting';
    });
}

function matchCourt(cId) {
    const court = courts.find(c => c.id === cId);
    if(!court) return;
    if(court.next.length > 0) return showToast("이미 다음 경기가 예약되어 있습니다.");

    const isNextReservation = court.active.length > 0;
    const pool = getAutoMatchPool();
    const type = court.type;

    let genderPool = [];
    if(type === 'M') genderPool = pool.filter(p => p.gender === 'M');
    else if(type === 'F') genderPool = pool.filter(p => p.gender === 'F');
    else if(type === 'X') {
        const m = pool.filter(p => p.gender === 'M');
        const f = pool.filter(p => p.gender === 'F');
        if(m.length < 2 || f.length < 2) {
            const restingCount = players.filter(p => p.status === 'resting').length;
            const poolLabel = isNextReservation ? '후보' : '대기';
            return showToast(`혼복 인원이 부족합니다. (${poolLabel} 남 ${m.length}명, 여 ${f.length}명 · 휴식 ${restingCount}명)`);
        }
        genderPool = pool;
    } else {
        genderPool = pool;
    }

    if(type !== 'X' && genderPool.length < 4) {
        const restingCount = players.filter(p => p.status === 'resting' && (type === 'A' || p.gender === type)).length;
        const poolLabel = isNextReservation ? '후보' : '대기';
        return showToast(`매칭 인원이 부족합니다. (${poolLabel} ${genderPool.length}명 · 휴식 ${restingCount}명)`);
    }

    let selected = [];
    if(type === 'X') {
        const m = pool.filter(p => p.gender === 'M');
        const f = pool.filter(p => p.gender === 'F');
        const sm = shuffleByGameCount(m);
        const sf = shuffleByGameCount(f);
        selected = [...sm.slice(0,2), ...sf.slice(0,2)];
    } else {
        const shuffled = shuffleByGameCount(genderPool);
        selected = shuffled.slice(0, 4);
    }

    applyMatch(cId, selected, 'next');
}

function openManualMatch(cId) {
    const court = courts.find(c => c.id === cId);
    if(!court) return;
    if(court.next.length > 0) return showToast("예약이 꽉 찼습니다.");
    manualTargetCId = cId;
    manualTargetArea = 'next';
    manualSelected.clear();
    renderManualList();
    document.getElementById('manualModal').style.display = 'flex';
}

function renderManualList() {
    const list = document.getElementById('manualList'); list.innerHTML = '';
    const allowPlayingPlayers = manualTargetArea === 'next';
    document.getElementById('manualHelp').innerText = '4명을 선택해 다음 경기에 배정하세요.';

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
    const confirmButton = document.getElementById('manualConfirmButton');
    confirmButton.disabled = manualSelected.size !== 4;
    confirmButton.innerText = manualSelected.size === 4 ? '선수 배정 (4/4)' : `선수 선택 (${manualSelected.size}/4)`;

    if(candidates.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:24px 12px;">선택 가능한 선수가 없습니다.</div>';
    }

    candidates.forEach(p => {
        const isSel = manualSelected.has(p.id);
        const isPlaying = isPlayerInCourtArea(p.id, 'active');
        const status = isPlaying ? 'playing' : p.status;
        list.innerHTML += `
        <button id="manual-player-${p.id}" type="button" class="player-chip waiting-chip roster-chip manual-chip gender-card ${getGenderCardClass(p.gender)} roster-status-${status} ${isSel?'selected':''}" aria-pressed="${isSel}" onclick="toggleManualSelect(${p.id})">
            ${renderRosterSummary(p, 'manual-', status)}
        </button>`;
    });
}

function toggleManualSelect(pId) {
    if(manualSelected.has(pId)) manualSelected.delete(pId);
    else {
        const player = players.find(candidate => candidate.id === pId);
        const isPlaying = player && isPlayerInCourtArea(pId, 'active');
        const isAlreadyReserved = player && isPlayerInCourtArea(pId, 'next');
        const isEligible = player && !isAlreadyReserved && (isPlaying ? manualTargetArea === 'next' : player.status === 'waiting');
        if(!isEligible) return showToast("현재 선택할 수 없는 선수입니다.");
        if(manualSelected.size >= 4) return showToast("4명까지만 선택 가능합니다.");
        manualSelected.add(pId);
    }
    renderManualList();
    document.getElementById(`manual-player-${pId}`)?.focus({preventScroll:true});
}

function confirmManualMatch() {
    if(manualSelected.size !== 4) return showToast("4명을 선택해야 합니다.");
    const court = courts.find(c => c.id === manualTargetCId);
    if(!court) return closeManualModal();
    const targetArea = 'next';
    if(targetArea !== manualTargetArea || court.next.length > 0) {
        closeManualModal();
        return showToast("코트 상태가 변경되어 다시 선택해야 합니다.");
    }

    const selectedPlayers = Array.from(manualSelected).map(id => players.find(p => p.id === id));
    const hasInvalidPlayer = selectedPlayers.some(player => {
        if(!player || isPlayerInCourtArea(player.id, 'next')) return true;
        const isPlaying = isPlayerInCourtArea(player.id, 'active');
        return isPlaying ? targetArea !== 'next' : player.status !== 'waiting';
    });
    if(hasInvalidPlayer) {
        renderManualList();
        return showToast("선수 상태가 변경되어 다시 선택해야 합니다.");
    }

    applyMatch(manualTargetCId, selectedPlayers, manualTargetArea);
    closeManualModal();
}

function closeManualModal() {
    document.getElementById('manualModal').style.display='none';
    manualTargetCId = null;
    manualTargetArea = null;
    manualSelected.clear();
}

function applyMatch(cId, selectedPlayers, targetArea) {
    const court = courts.find(c => c.id === cId);
    selectedPlayers.sort((a,b) => b.tier - a.tier);

    const ms = selectedPlayers.filter(p=>p.gender==='M');
    const fs = selectedPlayers.filter(p=>p.gender==='F');
    let bestTeam = [];

    if(ms.length === 2 && fs.length === 2) {
         const s1 = getScore(ms[0].id, fs[0].id) + getScore(ms[1].id, fs[1].id);
         const s2 = getScore(ms[0].id, fs[1].id) + getScore(ms[1].id, fs[0].id);
         bestTeam = (s1 <= s2) ? [ms[0], fs[0], ms[1], fs[1]] : [ms[0], fs[1], ms[1], fs[0]];
    } else {
         const sA = getScore(selectedPlayers[0].id, selectedPlayers[3].id) + getScore(selectedPlayers[1].id, selectedPlayers[2].id);
         const sB = getScore(selectedPlayers[0].id, selectedPlayers[2].id) + getScore(selectedPlayers[1].id, selectedPlayers[3].id);
         const sC = getScore(selectedPlayers[0].id, selectedPlayers[1].id) + getScore(selectedPlayers[2].id, selectedPlayers[3].id) + 5;
         bestTeam = (sA <= sB) ? [selectedPlayers[0], selectedPlayers[3], selectedPlayers[1], selectedPlayers[2]]
                               : [selectedPlayers[0], selectedPlayers[2], selectedPlayers[1], selectedPlayers[3]];
         if(sC < Math.min(sA, sB)) bestTeam = [...selectedPlayers];
    }

    court[targetArea] = bestTeam;
    syncPlayerAssignmentStatuses(bestTeam.map(p => p.id));

    if(targetArea === 'active') court.startTime = Date.now();
    if(!saveAction(`${courtLabel(cId)} ${targetArea === 'active' ? '수동 경기 시작' : '다음 경기 예약'}`)) return;
    render();
}

function shuffleByGameCount(list, getGameCount = getMatchingGameCount) {
    const groups = {};
    list.forEach(player => {
        const gameCount = getGameCount(player);
        if(!groups[gameCount]) groups[gameCount] = [];
        groups[gameCount].push(player);
    });
    let result = [];
    Object.keys(groups).sort((a,b)=>a-b).forEach(g => {
        const group = groups[g];
        for (let i = group.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [group[i], group[j]] = [group[j], group[i]]; }
        result = [...result, ...group];
    });
    return result;
}

function getScore(id1, id2) {
    let count = 0;
    history.slice(0, 100).forEach(h => {
        if(!h.pIds) return;
        const t1 = [h.pIds[0], h.pIds[1]]; const t2 = [h.pIds[2], h.pIds[3]];
        if((t1.includes(id1) && t1.includes(id2)) || (t2.includes(id1) && t2.includes(id2))) count++;
    });
    return count;
}

function getInitialMatchingGames() {
    const activePlayers = players.filter(player => player.status !== 'resting');
    if(activePlayers.length === 0) return 0;
    return Math.max(0, Math.floor(activePlayers.reduce((sum, player) => sum + getMatchingGameCount(player), 0) / activePlayers.length) - 1);
}
