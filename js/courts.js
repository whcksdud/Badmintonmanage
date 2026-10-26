// Court lifecycle, reservations, transfers, scores, and player swaps.

function isWaitingCourt(court) { return court?.isWaiting === true; }

function courtNumber(courtId) {
    const court = courts.find(candidate => candidate.id === courtId);
    return courts.filter(candidate => isWaitingCourt(candidate) === isWaitingCourt(court))
        .findIndex(candidate => candidate.id === courtId) + 1;
}

function courtLabel(courtId) {
    const court = courts.find(candidate => candidate.id === courtId);
    return isWaitingCourt(court) ? `대기 코트 ${courtNumber(courtId)}` : `${courtNumber(courtId)}번 코트`;
}

function courtTitle(courtId) {
    return isWaitingCourt(courts.find(court => court.id === courtId)) ? courtLabel(courtId) : `코트 ${courtNumber(courtId)}`;
}

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
    if(isWaitingCourt(courts.find(court => court.id === cId))) return;
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
    if(!court || isWaitingCourt(court)) return;
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

function renderTransferPlayers(match) {
    const names = match.map(player => escapeHTML(player.name));
    if(names.length !== 4) return `<span>${names.join(' · ')}</span>`;
    const renderTeam = team => `<span class="transfer-team">${team.map(name => `<span class="transfer-player" title="${name}">${name}</span>`).join('')}</span>`;
    return `${renderTeam(names.slice(0, 2))}<span class="transfer-versus" aria-label="대">VS</span>${renderTeam(names.slice(2))}`;
}

function openTransferNext(cId) {
    const source = courts.find(c => c.id === cId);
    if(!source || source.next.length === 0) return showToast("이동할 다음 대기 선수가 없습니다.");
    const targets = getTransferTargets(source);
    if(targets.length === 0) return showToast("변경할 다른 코트가 없습니다.");
    transferSourceCourtId = cId;
    document.getElementById('transferTitle').innerText = isWaitingCourt(source) ? '코트 배정' : '코트 변경';
    document.getElementById('transferSourceName').innerText = courtLabel(source.id);
    document.getElementById('transferSourcePlayers').innerHTML = renderTransferPlayers(source.next);
    document.getElementById('transferCourtSelect').value = String(targets[0].id);
    document.getElementById('transferCourtOptions').innerHTML = targets.map(c => `<label class="transfer-court-option">
        <input type="radio" name="transferCourt" id="transfer-court-${c.id}" value="${c.id}" onchange="document.getElementById('transferCourtSelect').value=this.value; updateTransferNextPreview()">
        <span class="transfer-court-card">
            <span class="transfer-court-heading"><strong>${courtLabel(c.id)}</strong><span class="transfer-state ${c.active.length ? 'is-playing' : ''}">${isWaitingCourt(c) ? '대기 코트' : c.active.length ? '경기 중' : '비어 있음'}</span></span>
            <span class="transfer-reservation-label">${c.next.length ? '예약 있음' : '예약 없음'}</span>
            ${c.next.length ? `<span class="transfer-players">${renderTransferPlayers(c.next)}</span>` : ''}
        </span>
    </label>`).join('');
    updateTransferNextPreview();
    document.getElementById('transferModal').style.display = 'flex';
}

function getTransferTargets(source) {
    return courts.filter(court => court.id !== source.id && (!isWaitingCourt(source) || !isWaitingCourt(court)));
}

function canEnterFromWaitingCourt(source, target) {
    return isWaitingCourt(source) && target && !isWaitingCourt(target) && target.active.length === 0 &&
        source.next.length === 4 && !source.next.some(player => isPlayerPlayingOutsideCourt(player.id, target.id));
}

function updateTransferNextPreview() {
    const source = courts.find(c => c.id === transferSourceCourtId);
    const target = courts.find(c => c.id === Number(document.getElementById('transferCourtSelect').value));
    if(!source) return closeTransferModal();
    getTransferTargets(source).forEach(c => {
        document.getElementById(`transfer-court-${c.id}`).checked = c.id === target?.id;
    });
    const action = canEnterFromWaitingCourt(source, target) ? '경기 입장' : '대기 입장';
    document.getElementById('transferConfirmButton').innerText = isWaitingCourt(source)
        ? `${action}${target?.next.length ? ' · 예약 맞바꾸기' : ''}`
        : target?.next.length ? '예약 맞바꾸기' : '코트 변경';
}

function closeTransferModal() {
    document.getElementById('transferModal').style.display = 'none';
    transferSourceCourtId = null;
}

function confirmTransferNext() {
    const source = courts.find(c => c.id === transferSourceCourtId);
    const target = courts.find(c => c.id === Number(document.getElementById('transferCourtSelect').value));
    if(!source || !target || !getTransferTargets(source).some(c => c.id === target.id) || source.next.length === 0) return closeTransferModal();
    const swap = target.next.length > 0;
    const enterNow = canEnterFromWaitingCourt(source, target);
    if(enterNow) {
        const incoming = source.next;
        source.next = target.next;
        target.next = [];
        target.active = incoming;
        target.startTime = Date.now();
        syncPlayerAssignmentStatuses([...incoming, ...source.next].map(player => player.id));
    } else {
        [source.next, target.next] = [target.next, source.next];
    }
    const action = isWaitingCourt(source)
        ? `${courtLabel(source.id)} → ${courtLabel(target.id)} ${enterNow ? '경기 입장' : '대기 입장'}${swap ? ' · 예약 맞바꾸기' : ''}`
        : `${courtLabel(source.id)} ${swap ? '↔' : '→'} ${courtLabel(target.id)} 예약 코트 변경`;
    if(!saveAction(action)) return;
    closeTransferModal(); render();
    if(isWaitingCourt(source)) {
        showToast(`${courtLabel(target.id)}에 ${enterNow ? '입장하여 경기를 시작했습니다.' : '대기 입장했습니다.'}${swap ? ' 기존 예약은 대기 코트로 이동했습니다.' : ''}`);
    } else {
        showToast(swap ? `${courtLabel(source.id)}와 ${courtLabel(target.id)}의 예약 코트를 변경했습니다.`
                       : `${courtLabel(target.id)}로 다음 대기를 이동했습니다.`);
    }
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

function setType(id, val) {
    const court = courts.find(c => c.id === id);
    if(!court || !['A','M','F','X'].includes(val)) return false;
    court.type = val;
    if(!saveAction(`${courtLabel(id)} 경기 유형 변경`)) return false;
    render();
    document.getElementById(`reserve-type-${id}`)?.focus({preventScroll:true});
    return true;
}

function addCourt(waiting = true) {
    const id = Math.max(Date.now(), ...courts.map(court => court.id + 1));
    const court = {id, type:'A', isWaiting:waiting, active:[], next:[], startTime:null};
    courts.push(court);
    if(!saveAction(`${courtLabel(id)} 추가`)) return;
    render();
    if(window.matchMedia('(max-width: 600px), (max-height: 500px) and (max-width: 950px)').matches) setMobileView('courts');
}

function openSwap(cId, area, idx) {
    const court = courts.find(candidate => candidate.id === cId);
    if(!court || !court[area] || !court[area][idx]) return;

    swapTarget = {cId, area, idx, playerId:court[area][idx].id};
    renderSwapList();
}

function renderSwapList() {
    if(!swapTarget) return;
    const list = document.getElementById('swapList'); list.innerHTML='';
    const court = courts.find(candidate => candidate.id === swapTarget.cId);
    const match = court && court[swapTarget.area];
    if(!match || !match[swapTarget.idx] || match[swapTarget.idx].id !== swapTarget.playerId) return closeSwapModal();
    const selected = match[swapTarget.idx];
    const allowPlayingPlayers = swapTarget.area === 'next';
    document.getElementById('swapHelp').innerText = `${selected.name} · ${courtLabel(court.id)} ${swapTarget.area === 'next' ? '다음 대기' : '현재 경기'}`;
    if(match.length === 4) {
        list.innerHTML = '<h4 class="picker-section-label">팀 변경 · 상대 팀 선수와 자리 바꾸기</h4>';
        match.forEach((player, index) => {
            if(Math.floor(index / 2) === Math.floor(swapTarget.idx / 2)) return;
            if(court.type === 'X' && player.gender !== selected.gender) return;
            const status = isPlayerInCourtArea(player.id, 'active') ? 'playing' : player.status;
            list.innerHTML += `<button type="button" class="player-chip waiting-chip roster-chip manual-chip swap-chip gender-card ${getGenderCardClass(player.gender)} roster-status-${status} team-change-choice" onclick="changeCourtTeam(${index}, ${player.id})" aria-label="${escapeHTML(selected.name)}와 ${escapeHTML(player.name)} 자리 바꾸기">
                ${renderRosterSummary(player, 'swap-', status)}
            </button>`;
        });
    }
    list.innerHTML += `<h4 class="picker-section-label">선수 교체</h4><p class="picker-section-description">${allowPlayingPlayers ? '대기 중인 선수와 현재 게임 중인 선수를 선택할 수 있습니다.' : '대기 중인 선수를 선택할 수 있습니다.'}</p>`;

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
        list.innerHTML += '<div class="empty-state" style="padding:24px 12px;">교체 가능한 선수가 없습니다.</div>';
    }

    candidates.forEach(p => {
        const status = isPlayerInCourtArea(p.id, 'active') ? 'playing' : p.status;
        list.innerHTML += `<button type="button" class="player-chip waiting-chip roster-chip manual-chip swap-chip gender-card ${getGenderCardClass(p.gender)} roster-status-${status}" onclick="doSwap(${p.id})">
            ${renderRosterSummary(p, 'swap-', status)}
        </button>`;
    });
    document.getElementById('swapModal').style.display='flex';
}

function changeCourtTeam(otherIndex, expectedPlayerId) {
    if(!swapTarget) return;
    const {cId, area, idx, playerId} = swapTarget;
    const court = courts.find(candidate => candidate.id === cId);
    const match = court && ['active', 'next'].includes(area) ? court[area] : null;
    if(!match || match.length !== 4 || !Number.isInteger(otherIndex) || otherIndex < 0 || otherIndex > 3 ||
        !match[idx] || match[idx].id !== playerId || match[otherIndex].id !== expectedPlayerId ||
        Math.floor(idx / 2) === Math.floor(otherIndex / 2) ||
        (court.type === 'X' && match[idx].gender !== match[otherIndex].gender)) return closeSwapModal();
    [match[idx], match[otherIndex]] = [match[otherIndex], match[idx]];
    if(!saveAction(`${courtLabel(cId)} ${area === 'next' ? '다음 대기' : '현재 경기'} 팀 변경`)) return;
    closeSwapModal(); render(); showToast('팀 구성을 변경했습니다.');
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
