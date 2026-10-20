// Player registration, availability, waiting time, and identity.

function deletePlayer() {
    const playerId = editPId;
    if(isPlayerInCourtArea(playerId, 'active') || isPlayerInCourtArea(playerId, 'next')) return showToast('배정된 선수는 교체하거나 예약을 해제한 뒤 삭제하세요.');
    showConfirmModal("선수를 삭제하시겠습니까?\n최근 작업 되돌리기로 한 단계 복원할 수 있습니다.", () => {
        if(isPlayerInCourtArea(playerId, 'active') || isPlayerInCourtArea(playerId, 'next')) return showToast('선수가 코트에 배정되어 삭제할 수 없습니다.');
        const name = players.find(player => player.id === playerId)?.name || '선수';
        players = players.filter(x => x.id !== playerId);
        if(!saveAction(`${name} 선수 삭제`)) return;
        closePModal();
        render();
        showToast("선수가 삭제되었습니다.");
    });
}

function setPlayerAvailability(player, status) {
    if(player.status === 'resting' && status === 'waiting') {
        const activePlayers = players.filter(candidate => candidate.id !== player.id && candidate.status !== 'resting');
        if(activePlayers.length > 0) {
            const baseline = Math.floor(activePlayers.reduce((sum, candidate) => sum + getMatchingGameCount(candidate), 0) / activePlayers.length);
            // Preserve actual games and any existing rest adjustment.
            player.matchingOffset = Math.max(getMatchingGameCount(player), baseline) - player.games;
        }
    }
    setPlayerStatus(player, status);
}

function isWaitingForGame(player) {
    return player.status === 'waiting' || player.status === 'reserved';
}

function isGuestPlayer(player) {
    if(typeof player.isGuest === 'boolean') return player.isGuest;
    // Older registrations have no marker; keep saved members distinguishable.
    return player.memberId === undefined && !members.some(member => sameMemberProfile(player, member));
}

function formatWaitingTime(player) {
    const elapsed = Number.isFinite(player.waitingSince) ? Date.now() - player.waitingSince : 0;
    return `대기 ${Math.max(0, Math.floor(elapsed / 60000))}분`;
}

function initializeWaitingTimes(roster, now = Date.now()) {
    let changed = false;
    roster.forEach(player => {
        if(isWaitingForGame(player) && !Number.isFinite(player.waitingSince)) {
            player.waitingSince = now;
            changed = true;
        }
    });
    return changed;
}

function setPlayerStatus(player, status) {
    if(status === 'waiting' || status === 'reserved') {
        if(!isWaitingForGame(player) || !Number.isFinite(player.waitingSince)) player.waitingSince = Date.now();
    } else {
        player.waitingSince = null;
    }
    player.status = status;
}

function nextPersonId() {
    const used = new Set([...players.map(p => p.id), ...members.map(m => m.id), ...history.flatMap(h => h.pIds || [])]);
    let id = Date.now();
    while(used.has(id)) id++;
    return id;
}

function openPModal(id=null) {
    editPId = id; const p = players.find(x=>x.id===id);
    document.getElementById('pModalTitle').innerText = id ? "선수 정보 수정" : "선수 등록";
    document.getElementById('pName').value = id ? p.name : "";
    setFormChoice('pGen', id ? p.gender : 'M', ['M', 'F']);
    setFormChoice('pTier', id ? p.tier : 1, [5, 4, 3, 2, 1]);
    document.getElementById('pGames').value = id ? p.games : 0;
    document.getElementById('playerMatchingInfo').innerText = id
        ? `실제 ${p.games}경기 · 매칭 기준 ${getMatchingGameCount(p)}경기 (보정 +${getMatchingGameCount(p) - p.games})`
        : `신규 선수는 실제 0경기로 시작합니다. 현재 매칭 기준은 ${getInitialMatchingGames()}경기입니다.`;
    document.getElementById('pStatusField').hidden = id !== null;
    document.getElementById('pStatus').value = 'waiting';
    document.getElementById('deletePlayerButton').hidden = !id;
    document.getElementById('pModal').style.display = 'flex';
    document.getElementById('pName').focus();
}

function closePModal() { document.getElementById('pModal').style.display='none'; }

function saveBulkPlayers() {
    const text = document.getElementById('memberNames').value.trim();
    if(!text) return showToast("이름을 입력하세요.");

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    if(lines.length === 0) return;

    const tier = Number(document.getElementById('memberTier').value);
    const gen = document.getElementById('memberGender').value;
    if(!['M', 'F'].includes(gen) || !Number.isInteger(tier) || tier < 1 || tier > 5) return showToast('성별과 급수를 확인하세요.');
    const matchingOffset = getInitialMatchingGames();

    let count = 0;
    lines.forEach((name, idx) => {
        players.push({
            id: nextPersonId(),
            name: name,
            gender: gen,
            tier: tier,
            games: 0,
            matchingOffset,
            lastTime: 0,
            status: 'waiting',
            isGuest: true,
            shuttlecock: false
        });
        count++;
    });

    if(!saveAction(`게스트 ${count}명 등록`)) return;
    closeMemberEditor(); render(); setMobileView('waiting'); showToast(`게스트 ${count}명 등록 완료`);
}

function savePlayer() {
    const name = document.getElementById('pName').value.trim(); if(!name) return showToast("이름 필수");
    const tier = parseInt(document.getElementById('pTier').value);
    const gen = document.getElementById('pGen').value;
    const games = Number(document.getElementById('pGames').value);
    if(!Number.isSafeInteger(games) || games < 0) return showToast('실제 경기 수는 0 이상의 정수로 입력하세요.');
    const status = document.getElementById('pStatus').value;
    if(editPId) {
        const p=players.find(x=>x.id===editPId);
        p.name=name; p.tier=tier; p.gender=gen; p.games=games;
        const member = members.find(m => m.id === p.memberId);
        if(member) Object.assign(member, {name, gender:gen, tier});
    }
    else { players.push({id:nextPersonId(), name, gender:gen, tier, games, matchingOffset:Math.max(0, getInitialMatchingGames() - games), lastTime:0, status, shuttlecock:false}); }
    if(!saveAction(`${name} 선수 ${editPId ? '정보 수정' : '등록'}`)) return;
    closePModal(); render();
    if(editPId === null) setMobileView('waiting');
    showToast("저장됨");
}

function toggleShuttlecock(id) {
    const p = players.find(x => x.id === id);
    if (p) { p.shuttlecock = !p.shuttlecock; if(!saveAction(`${p.name} 선수 콕 ${p.shuttlecock ? '제출 표시' : '제출 취소'}`)) return; render(); }
}

function toggleRestStatus(id) {
    const p = players.find(x => x.id === id);
    if(!p || (p.status !== 'waiting' && p.status !== 'resting')) return;
    setPlayerAvailability(p, p.status === 'resting' ? 'waiting' : 'resting');
    if(!saveAction(`${p.name} 선수 ${p.status === 'resting' ? '휴식 전환' : '대기 복귀'}`)) return;
    render();
    showToast(`${p.name} 선수가 ${p.status === 'resting' ? '휴식 상태로 변경되었습니다.' : '대기실로 복귀했습니다.'}`);
}
