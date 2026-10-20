// Match history and overall/player statistics.

function getHistoryTeams(record) {
    if(Array.isArray(record.teamNames) && record.teamNames.length === 2 && record.teamNames.every(team => Array.isArray(team))) {
        return record.teamNames;
    }

    const legacyNames = typeof record.names === 'string' ? record.names.split(', ') : [];
    return legacyNames.length === 4
        ? [legacyNames.slice(0, 2), legacyNames.slice(2, 4)]
        : null;
}

function findStatsPlayer(playerId) {
    return players.find(player => String(player.id) === String(playerId));
}

function getHistoryParticipantName(record, participantIndex, playerId) {
    const currentPlayer = findStatsPlayer(playerId);
    if(currentPlayer) return currentPlayer.name;

    const recordedNames = getHistoryTeams(record)?.flat() || [];
    return recordedNames[participantIndex] || '삭제된 선수';
}

function getPlayerStatistics(playerId) {
    const playerKey = String(playerId);
    const relationships = new Map();
    let recordedGames = 0;

    history.forEach(record => {
        if(!Array.isArray(record.pIds) || record.pIds.length < 4) return;
        const participantIds = record.pIds.slice(0, 4);
        const playerIndex = participantIds.findIndex(id => String(id) === playerKey);
        if(playerIndex < 0) return;

        recordedGames++;
        const playerTeamIndex = Math.floor(playerIndex / 2);

        participantIds.forEach((otherPlayerId, participantIndex) => {
            if(participantIndex === playerIndex || otherPlayerId === null || otherPlayerId === undefined) return;
            const relationshipKey = String(otherPlayerId);
            if(relationshipKey === playerKey) return;

            if(!relationships.has(relationshipKey)) {
                relationships.set(relationshipKey, {
                    playerId: otherPlayerId,
                    name: getHistoryParticipantName(record, participantIndex, otherPlayerId),
                    sameTeam: 0,
                    opponent: 0
                });
            }

            const relationship = relationships.get(relationshipKey);
            if(Math.floor(participantIndex / 2) === playerTeamIndex) relationship.sameTeam++;
            else relationship.opponent++;
        });
    });

    const relations = [...relationships.values()].map(relationship => {
        const currentPlayer = findStatsPlayer(relationship.playerId);
        return {
            ...relationship,
            name: currentPlayer?.name || relationship.name,
            currentPlayer: currentPlayer || null,
            together: relationship.sameTeam + relationship.opponent
        };
    }).sort((a, b) =>
        b.together - a.together ||
        b.sameTeam - a.sameTeam ||
        a.name.localeCompare(b.name, 'ko')
    );

    return {
        player: findStatsPlayer(playerId) || null,
        recordedGames,
        relations,
        uniquePartners: relations.filter(relationship => relationship.sameTeam > 0).length,
        uniqueOpponents: relations.filter(relationship => relationship.opponent > 0).length
    };
}

function getOverallStatistics() {
    const participantCounts = new Map();
    const partnerPairs = new Map();
    const opponentPairs = new Map();
    let recordedGames = 0;
    let totalAppearances = 0;

    const addPair = (pairMap, firstParticipant, secondParticipant) => {
        if(!firstParticipant || !secondParticipant || firstParticipant.key === secondParticipant.key) return;
        const orderedParticipants = [firstParticipant, secondParticipant]
            .sort((a, b) => a.key.localeCompare(b.key));
        const pairKey = JSON.stringify(orderedParticipants.map(participant => participant.key));
        const existingPair = pairMap.get(pairKey) || { names: [], count: 0 };
        existingPair.names = orderedParticipants.map(participant => participant.name);
        existingPair.count++;
        pairMap.set(pairKey, existingPair);
    };

    history.forEach(record => {
        const teams = getHistoryTeams(record);
        if(!teams || teams.length !== 2 || teams.some(team => team.length < 2)) return;

        const recordedNames = [...teams[0].slice(0, 2), ...teams[1].slice(0, 2)];
        const participantIds = Array.isArray(record.pIds) ? record.pIds.slice(0, 4) : [];
        const participants = recordedNames.map((recordedName, participantIndex) => {
            const playerId = participantIds[participantIndex];
            const currentPlayer = playerId === null || playerId === undefined
                ? null
                : findStatsPlayer(playerId);
            const name = String(currentPlayer?.name || recordedName || '삭제된 선수');
            return {
                key: playerId === null || playerId === undefined ? `name:${name}` : `id:${String(playerId)}`,
                name
            };
        });

        if(participants.length !== 4) return;
        recordedGames++;
        totalAppearances += participants.length;

        participants.forEach(participant => {
            const existingParticipant = participantCounts.get(participant.key) || { ...participant, games: 0 };
            existingParticipant.name = participant.name;
            existingParticipant.games++;
            participantCounts.set(participant.key, existingParticipant);
        });

        addPair(partnerPairs, participants[0], participants[1]);
        addPair(partnerPairs, participants[2], participants[3]);
        [participants[0], participants[1]].forEach(firstParticipant => {
            [participants[2], participants[3]].forEach(secondParticipant => {
                addPair(opponentPairs, firstParticipant, secondParticipant);
            });
        });
    });

    const sortPairs = pairMap => [...pairMap.values()].sort((a, b) =>
        b.count - a.count ||
        a.names.join(' · ').localeCompare(b.names.join(' · '), 'ko')
    );
    const rankings = [...participantCounts.values()].sort((a, b) =>
        b.games - a.games || a.name.localeCompare(b.name, 'ko')
    );

    return {
        recordedGames,
        participantCount: participantCounts.size,
        totalAppearances,
        averageAppearances: participantCounts.size > 0 ? totalAppearances / participantCounts.size : 0,
        rankings: rankings.slice(0, 3),
        playerAppearances: [...players].map(player => ({
            name: player.name,
            gender: player.gender,
            games: participantCounts.get(`id:${String(player.id)}`)?.games || 0
        })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, 'ko')),
        topPartners: sortPairs(partnerPairs).slice(0, 3),
        topOpponents: sortPairs(opponentPairs).slice(0, 3)
    };
}

function renderOverallStats() {
    const container = document.getElementById('statsOverall');
    const statistics = getOverallStatistics();
    const allPlayerRows = statistics.playerAppearances.map(participant => `
        <div class="stats-all-player-item gender-card ${getGenderCardClass(participant.gender)}">
            <span class="stats-all-player-name">${escapeHTML(participant.name)}</span>
            <strong class="stats-all-player-count">${participant.games}경기</strong>
        </div>
    `).join('');
    const renderPairRows = (pairs, emptyMessage) => pairs.length > 0
        ? pairs.map(pair => `
            <div class="stats-pair-row">
                <span class="stats-pair-names" title="${pair.names.map(escapeHTML).join(' · ')}">${pair.names.map(escapeHTML).join(' · ')}</span>
                <strong class="stats-pair-count">${pair.count}회</strong>
            </div>
        `).join('')
        : `<p class="stats-pair-empty">${emptyMessage}</p>`;

    container.innerHTML = `
        <div class="stats-summary stats-overall-summary">
            <div class="stats-summary-card"><strong>${statistics.recordedGames}</strong><span>기록 경기</span></div>
            <div class="stats-summary-card"><strong>${statistics.playerAppearances.length}</strong><span>등록 선수</span></div>
            <div class="stats-summary-card"><strong>${statistics.totalAppearances}</strong><span>총 출전</span></div>
            <div class="stats-summary-card"><strong>${statistics.averageAppearances.toFixed(1)}</strong><span>평균 출전</span></div>
        </div>
        ${statistics.recordedGames > 0 ? `
            <div class="stats-overall-content">
                <section class="stats-overall-card stats-overall-ranking">
                    <h4>전체 선수 ${statistics.playerAppearances.length}명</h4>
                    <div class="stats-all-player-list">${allPlayerRows}</div>
                </section>
                <section class="stats-overall-card">
                    <h4>같은 팀 TOP 3</h4>
                    <div class="stats-pair-list">${renderPairRows(statistics.topPartners, '같은 팀 기록이 없습니다.')}</div>
                </section>
                <section class="stats-overall-card">
                    <h4>상대 TOP 3</h4>
                    <div class="stats-pair-list">${renderPairRows(statistics.topOpponents, '상대 팀 기록이 없습니다.')}</div>
                </section>
            </div>
        ` : '<div class="stats-empty">아직 완료된 경기 기록이 없습니다.<br>경기가 종료되면 전체 통계가 자동으로 쌓입니다.</div>'}
    `;
}

function setStatsView(view) {
    if(view !== 'overall' && view !== 'player') return;
    statsView = view;
    const showOverall = view === 'overall';
    const overallTab = document.getElementById('statsOverallTab');
    const playerTab = document.getElementById('statsPlayerTab');

    overallTab.classList.toggle('active', showOverall);
    playerTab.classList.toggle('active', !showOverall);
    overallTab.setAttribute('aria-selected', String(showOverall));
    playerTab.setAttribute('aria-selected', String(!showOverall));
    overallTab.tabIndex = showOverall ? 0 : -1;
    playerTab.tabIndex = showOverall ? -1 : 0;
    document.getElementById('statsOverallPanel').hidden = !showOverall;
    document.getElementById('statsPlayerPanel').hidden = showOverall;

    if(showOverall) renderOverallStats();
    else {
        renderStatsPlayerList();
        renderStatsDetail();
    }
}

function handleStatsTabKey(event) {
    if(!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextView = event.key === 'ArrowLeft' || event.key === 'Home' ? 'overall' : 'player';
    setStatsView(nextView);
    document.getElementById(nextView === 'overall' ? 'statsOverallTab' : 'statsPlayerTab').focus();
}

function openStatsModal(playerId = null) {
    const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const requestedPlayer = playerId === null ? null : findStatsPlayer(playerId);
    const currentPlayer = statsPlayerId === null ? null : findStatsPlayer(statsPlayerId);
    statsPlayerId = requestedPlayer?.id ?? currentPlayer?.id ?? sortedPlayers[0]?.id ?? null;
    if(playerId !== null) statsView = 'player';

    setStatsView(statsView);
    document.getElementById('statsModal').style.display = 'flex';
}

function closeStatsModal() {
    document.getElementById('statsModal').style.display = 'none';
}

function selectStatsPlayer(playerId) {
    const player = findStatsPlayer(playerId);
    if(!player) return;
    statsPlayerId = player.id;
    renderStatsPlayerList();
    renderStatsDetail();
}

function renderStatsPlayerList() {
    const list = document.getElementById('statsPlayerList');
    const filteredPlayers = [...players]
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    if(filteredPlayers.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:18px 8px;">등록된 선수가 없습니다.</div>';
        return;
    }

    list.innerHTML = filteredPlayers.map(player => `
        <button type="button" class="stats-player-option gender-card ${getGenderCardClass(player.gender)} ${String(player.id) === String(statsPlayerId) ? 'active' : ''}" onclick="selectStatsPlayer(${player.id})" aria-pressed="${String(player.id) === String(statsPlayerId)}">
            ${renderGenderAccessibility(player.gender)}
            <span class="stats-player-option-main">
                <span class="stats-player-option-name">${escapeHTML(player.name)}</span>
                <span class="stats-player-option-meta">${tiers[player.tier] || '급수 미지정'} · ${player.games}경기</span>
            </span>
        </button>
    `).join('');
}

function renderStatsDetail() {
    const detail = document.getElementById('statsDetail');
    const statistics = statsPlayerId === null ? null : getPlayerStatistics(statsPlayerId);
    const player = statistics?.player;

    if(!player) {
        detail.innerHTML = '<div class="stats-empty">선수를 등록하면 개인별 경기 관계 통계를 볼 수 있습니다.</div>';
        return;
    }

    const relationRows = statistics.relations.map(relationship => {
        const currentPlayer = relationship.currentPlayer;
        const genderAccessibility = currentPlayer
            ? renderGenderAccessibility(currentPlayer.gender)
            : '<span class="badge" style="background:#94a3b8;">기록</span>';
        const genderCardClass = currentPlayer
            ? `gender-card ${getGenderCardClass(currentPlayer.gender)}`
            : '';
        const content = `
            <span class="stats-relation-player">${genderAccessibility}<span class="stats-relation-name">${escapeHTML(relationship.name)}</span></span>
            <span class="stats-relation-count stats-relation-total">${relationship.together}</span>
            <span class="stats-relation-count">${relationship.sameTeam}</span>
            <span class="stats-relation-count">${relationship.opponent}</span>`;

        const deletedPlayerTitle = currentPlayer ? '' : ' title="현재 명단에서 삭제된 선수"';
        return `<div class="stats-relation-row ${genderCardClass}"${deletedPlayerTitle}>${content}</div>`;
    }).join('');

    detail.innerHTML = `
        <div class="stats-profile gender-card ${getGenderCardClass(player.gender)}">
            ${renderGenderAccessibility(player.gender)}
            <div class="stats-profile-main">
                <span class="stats-profile-name">${escapeHTML(player.name)}</span>
                <span class="stats-profile-meta">${tiers[player.tier] || '급수 미지정'} · ${player.games}경기</span>
            </div>
        </div>
        <div class="stats-summary">
            <div class="stats-summary-card"><strong>${statistics.recordedGames}</strong><span>기록 경기</span></div>
            <div class="stats-summary-card"><strong>${statistics.relations.length}</strong><span>함께한 선수</span></div>
            <div class="stats-summary-card"><strong>${statistics.uniquePartners}</strong><span>같은 팀 선수</span></div>
            <div class="stats-summary-card"><strong>${statistics.uniqueOpponents}</strong><span>상대한 선수</span></div>
        </div>
        <div class="stats-section-heading">
            <strong>선수별 경기 관계</strong>
        </div>
        ${statistics.relations.length > 0 ? `
            <div class="stats-relation-head"><span>선수</span><span>전체</span><span>같은 팀</span><span>상대</span></div>
            <div class="stats-relation-list">${relationRows}</div>
        ` : '<div class="stats-empty">아직 이 선수가 포함된 경기 기록이 없습니다.<br>경기가 종료되면 통계가 자동으로 쌓입니다.</div>'}
    `;
}

function editHistoryScore(historyIndex) {
    const record = history[historyIndex];
    const teams = record && getHistoryTeams(record);
    if(!record || !teams) return showToast('이 기록은 팀 정보를 확인할 수 없습니다.');

    const currentScores = Array.isArray(record.scores) ? record.scores : [];
    pendingHistoryIndex = historyIndex;
    document.getElementById('scoreModalTitle').innerText = currentScores.length === 2 ? '경기 점수 수정' : '경기 점수 입력';
    document.getElementById('scoreModalNote').innerText = '저장하면 기록 목록의 승패와 점수 차가 갱신됩니다.';
    document.getElementById('scoreTeam1Names').innerText = teams[0].join(' · ');
    document.getElementById('scoreTeam2Names').innerText = teams[1].join(' · ');
    document.getElementById('scoreTeam1').value = currentScores[0] ?? '';
    document.getElementById('scoreTeam2').value = currentScores[1] ?? '';
    document.getElementById('scoreError').innerText = '';
    document.getElementById('scoreModal').style.display = 'flex';
    setTimeout(() => document.getElementById('scoreTeam1').focus(), 0);
}

function openHistory() {
    const hList = document.getElementById('historyList'); hList.innerHTML='';
    const courtMap = {}; courts.forEach((c, i) => courtMap[c.id] = i + 1);
    document.getElementById('historySummary').innerText = `총 ${history.length}경기 · 최신순`;

    if(history.length === 0) {
        hList.innerHTML = `<div class="history-empty">${renderUIIcon('history')}<strong>아직 완료된 경기가 없어요</strong><span>경기를 종료하면 이곳에 기록됩니다.</span></div>`;
    }

    history.forEach((h, historyIndex) => {
        const validTime = Number.isFinite(h.startTime) && Number.isFinite(h.endTime) && h.endTime >= h.startTime;
        const endDate = validTime ? new Date(h.endTime) : null;
        const timeLabel = validTime ? `${endDate.getMonth() + 1}.${endDate.getDate()} · ${formatTime(h.startTime)}–${formatTime(h.endTime)}` : '시간 미기록';
        const durationMin = validTime ? Math.floor((h.endTime - h.startTime) / 60000) : null;
        const durationLabel = durationMin === null ? '' : durationMin === 0 ? '1분 미만' : `${durationMin}분`;
        const courtNum = courtMap[h.cId] ? `코트 ${courtMap[h.cId]}` : '삭제된 코트';
        const teams = getHistoryTeams(h);
        const scores = Array.isArray(h.scores) ? h.scores.map(Number) : [];
        const hasScore = Boolean(teams) && scores.length === 2 && scores.every(score => Number.isInteger(score) && score >= 0);
        let resultHTML = '';
        const isDraw = hasScore && scores[0] === scores[1];
        const winnerIndex = !hasScore || isDraw ? -1 : scores[0] > scores[1] ? 0 : 1;
        const scoreNote = !hasScore ? '점수 미입력' : isDraw ? '무승부' : '';

        if(teams) {
            const renderTeam = teamIndex => {
                const won = teamIndex === winnerIndex;
                return `<div class="history-team ${won ? 'winner' : ''}" role="group" aria-label="${teamIndex === 0 ? 'A' : 'B'}팀">
                    <div class="history-team-label">${teamIndex === 0 ? 'A' : 'B'}팀${hasScore ? `<span class="history-result-badge ${isDraw ? 'draw' : won ? 'win' : 'loss'}">${isDraw ? '무' : won ? '승' : '패'}</span>` : ''}</div>
                    <div class="history-team-names">${teams[teamIndex].map(name => `<span>${escapeHTML(name)}</span>`).join('')}</div>
                </div>`;
            };
            resultHTML = `<div class="history-result">
                ${renderTeam(0)}
                <div class="history-scoreboard" aria-label="${hasScore ? `${scores[0]} 대 ${scores[1]}` : '점수 미입력'}">
                    <div class="history-scores">${hasScore ? `<strong class="${winnerIndex === 0 ? 'winning-score' : ''}">${scores[0]}</strong><span>:</span><strong class="${winnerIndex === 1 ? 'winning-score' : ''}">${scores[1]}</strong>` : '<span class="history-versus">VS</span>'}</div>
                    ${scoreNote ? `<span class="history-score-note">${scoreNote}</span>` : ''}
                </div>
                ${renderTeam(1)}
            </div>`;
        } else {
            resultHTML = `<div class="history-legacy-names">${escapeHTML(h.names || '선수 정보 없음')}</div>`;
        }

        hList.innerHTML += `<article class="history-item" aria-label="${courtNum} 경기 기록">
            <div class="history-item-heading">
                <span class="history-court">${courtNum}</span>
                <span class="history-time">${timeLabel}</span>
                ${durationLabel ? `<span class="history-duration">${durationLabel}</span>` : ''}
            </div>
            ${resultHTML}
            <div class="history-item-footer">
                <span>${teams ? hasScore ? '경기 결과' : '점수를 입력하면 승패가 표시됩니다.' : '팀 정보 미기록'}</span>
                ${teams ? `<button type="button" class="history-score-button ${hasScore ? '' : 'needs-score'}" onclick="editHistoryScore(${historyIndex})">${renderUIIcon(hasScore ? 'edit' : 'add')}<span>${hasScore ? '점수 수정' : '점수 입력'}</span></button>` : ''}
            </div>
        </article>`;
    });
    document.getElementById('hModal').style.display='flex';
}

function closeHModal() { document.getElementById('hModal').style.display='none'; }
