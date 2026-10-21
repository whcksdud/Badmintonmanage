// Automatic selection prioritizes waiting players, then considers game count,
// waiting time and co-play history within each status group;
// automatic/manual team balancing also considers tiers and partner history.

const MATCH_VARIETY_WAIT_WINDOW = 15 * 60 * 1000;
const MATCH_VARIETY_CANDIDATE_LIMIT = 12;

function getMatchingGameCount(player) {
    const offset = Number(player.matchingOffset);
    return player.games + (Number.isFinite(offset) && offset >= 0 ? offset : 0);
}

function isTournamentPairAllowed(first, second, type) {
    if(type === 'X') return first.gender !== second.gender;
    if(type === 'M' || type === 'F') return first.gender === type && second.gender === type;
    return true;
}

function countTournamentPairs(selected, type) {
    return selected.reduce((count, player) => {
        const partner = getTournamentPartner(player);
        return count + Number(Boolean(partner && player.id < partner.id &&
            selected.some(candidate => candidate.id === partner.id) && isTournamentPairAllowed(player, partner, type)));
    }, 0);
}

function getTournamentTeamPlan(selected, type) {
    if(selected.length !== 4 || !countTournamentPairs(selected, type)) return null;
    const plans = [[0,1,2,3], [0,2,1,3], [0,3,1,2]].map(indexes => indexes.map(index => selected[index]));
    const candidates = plans.filter(plan => isTournamentPairAllowed(plan[0], plan[1], type) && isTournamentPairAllowed(plan[2], plan[3], type));
    const score = plan => ({
        pairs: Number(getTournamentPartner(plan[0])?.id === plan[1].id) + Number(getTournamentPartner(plan[2])?.id === plan[3].id),
        gap: Math.abs(plan[0].tier + plan[1].tier - plan[2].tier - plan[3].tier),
        repeats: getScore(plan[0].id, plan[1].id) + getScore(plan[2].id, plan[3].id)
    });
    candidates.sort((a, b) => {
        const left = score(a), right = score(b);
        return right.pairs - left.pairs || left.gap - right.gap || left.repeats - right.repeats;
    });
    return candidates[0] || null;
}

function getAutoMatchPool({includePlaying = false} = {}) {
    return players.filter(player => {
        if(isPlayerInCourtArea(player.id, 'queue')) return false;
        if(isPlayerInCourtArea(player.id, 'active')) return includePlaying && player.status === 'playing';
        return player.status === 'waiting';
    });
}

function getSelectionOptions(pool, count, waitWindow, breakLockedGroup = false) {
    if(count === 0) return [[]];
    // Fill every available slot with waiting players first. Game count, partner
    // preferences and variety are compared only within each status group.
    const waiting = pool.filter(player => player.status === 'waiting');
    if(waiting.length && waiting.length < pool.length) {
        const waitingCount = Math.min(count, waiting.length);
        const waitingOptions = getSelectionOptions(waiting, waitingCount, waitWindow, breakLockedGroup);
        const playingOptions = getSelectionOptions(pool.filter(player => player.status === 'playing'), count - waitingCount, waitWindow, breakLockedGroup);
        return waitingOptions.flatMap(waitingOption => playingOptions.map(playingOption => [...waitingOption, ...playingOption]));
    }
    const ordered = shuffleByGameCount(pool);
    if(ordered.length < count) return [];
    const cutoff = getMatchingGameCount(ordered[count - 1]);
    // All players below the cutoff must play: variety cannot override game count.
    const required = ordered.filter(player => getMatchingGameCount(player) < cutoff);
    const boundary = ordered.filter(player => getMatchingGameCount(player) === cutoff);
    const slots = count - required.length;
    const now = Date.now();
    const since = player => Number.isFinite(player.waitingSince) ? player.waitingSince : now;
    // Protect the longest waiter, and compare nearby waiting times only. Widen
    // just enough to include the original FIFO selection if the window is sparse.
    const extra = breakLockedGroup && boundary.length > slots ? since(boundary[slots]) : 0;
    const latest = Math.max(since(boundary[0]) + waitWindow, since(boundary[slots - 1]), extra);
    const candidates = boundary.filter(player => since(player) <= latest).slice(0, MATCH_VARIETY_CANDIDATE_LIMIT);
    const protectedPlayers = [...required, candidates[0]];
    const remaining = candidates.slice(1);
    const options = [];
    function choose(start, selected) {
        const needed = count - protectedPlayers.length - selected.length;
        if(needed === 0) { options.push([...protectedPlayers, ...selected]); return; }
        for(let i = start; i <= remaining.length - needed; i++) choose(i + 1, [...selected, remaining[i]]);
    }
    choose(0, []);
    return options;
}

function selectMatchPlayers(pool, type, courtId) {
    const recentGame = history.slice(0, 100).find(record => (courtId == null || record.cId === courtId) &&
        Number.isFinite(record.startTime) && Number.isFinite(record.endTime) && record.endTime > record.startTime);
    // One game's waiting difference, with a minute for court-change operations.
    const waitWindow = Math.max(MATCH_VARIETY_WAIT_WINDOW, recentGame ? recentGame.endTime - recentGame.startTime : 0) + 60000;
    function buildOptions(breakLockedGroup = false) {
        if(type !== 'X') return getSelectionOptions(pool, 4, waitWindow, breakLockedGroup);
        const men = getSelectionOptions(pool.filter(p => p.gender === 'M'), 2, waitWindow, breakLockedGroup);
        const women = getSelectionOptions(pool.filter(p => p.gender === 'F'), 2, waitWindow, breakLockedGroup);
        return men.flatMap(m => women.map(f => [...m, ...f]));
    }
    let options = buildOptions();
    const groups = new Map();
    const pairs = new Map();
    const groupKey = ids => [...ids].sort((a, b) => a - b).join(',');
    const pairKey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
    const records = [
        ...history.slice(0, 100).map(record => record.pIds),
        ...courts.map(court => court.active.map(p => p.id)),
        ...matchQueue.map(game => game.players.map(p => p.id)),
        ...courts.filter(court => court.pendingMatch).map(court => court.pendingMatch.players.map(p => p.id))
    ];
    records.forEach(ids => {
        if(!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4) return;
        const key = groupKey(ids);
        groups.set(key, (groups.get(key) || 0) + 1);
        for(let i = 0; i < 4; i++) for(let j = i + 1; j < 4; j++) {
            const pair = pairKey(ids[i], ids[j]);
            pairs.set(pair, (pairs.get(pair) || 0) + 1);
        }
    });
    // Break a locked cohort even when it is currently the younger wait group:
    // otherwise it can be excluded here and forced to play intact next round.
    if(options.length === 1) {
        const cutoff = gender => Math.max(...options[0].filter(p => type !== 'X' || p.gender === gender).map(getMatchingGameCount));
        const cutoffs = { M: cutoff('M'), F: cutoff('F') };
        const eligible = new Map(pool.filter(p => getMatchingGameCount(p) <= cutoffs[p.gender]).map(p => [p.id, p]));
        const hasLockedGroup = [...groups].some(([key, repeats]) => {
            const ids = key.split(',').map(Number);
            return repeats >= 2 && ids.every(id => eligible.has(id)) &&
                (type !== 'X' || ids.filter(id => eligible.get(id).gender === 'M').length === 2);
        });
        if(hasLockedGroup) options = buildOptions(true);
    }
    let best = [];
    let bestCost = null;
    const now = Date.now();
    options.forEach(option => {
        const ids = option.map(p => p.id);
        let together = 0;
        for(let i = 0; i < 4; i++) for(let j = i + 1; j < 4; j++) together += pairs.get(pairKey(ids[i], ids[j])) || 0;
        // Pair preference only breaks ties inside the existing game-count and
        // waiting eligibility window. It cannot pull in an ineligible partner.
        const cost = [-countTournamentPairs(option, type), groups.get(groupKey(ids)) || 0, together,
            option.reduce((sum, player) => sum + (Number.isFinite(player.waitingSince) ? player.waitingSince : now), 0)];
        const firstDifference = bestCost ? cost.findIndex((value, index) => value !== bestCost[index]) : -1;
        const better = !bestCost || (firstDifference >= 0 && cost[firstDifference] < bestCost[firstDifference]);
        if(better) { best = option; bestCost = cost; }
    });
    return best;
}

function balanceMatchTeams(selectedPlayers, type) {
    selectedPlayers = [...selectedPlayers];
    selectedPlayers.sort((a,b) => b.tier - a.tier);

    const ms = selectedPlayers.filter(p=>p.gender==='M');
    const fs = selectedPlayers.filter(p=>p.gender==='F');
    let bestTeam = [];

    const tournamentPlan = getTournamentTeamPlan(selectedPlayers, type);
    if(tournamentPlan) {
        bestTeam = tournamentPlan;
    } else if(ms.length === 2 && fs.length === 2) {
         const gap1 = Math.abs((ms[0].tier + fs[0].tier) - (ms[1].tier + fs[1].tier));
         const gap2 = Math.abs((ms[0].tier + fs[1].tier) - (ms[1].tier + fs[0].tier));
         const s1 = getScore(ms[0].id, fs[0].id) + getScore(ms[1].id, fs[1].id);
         const s2 = getScore(ms[0].id, fs[1].id) + getScore(ms[1].id, fs[0].id);
         // Balance first; use partner history only when both gaps are equal.
         const preferFirst = gap1 < gap2 || (gap1 === gap2 && s1 <= s2);
         bestTeam = preferFirst ? [ms[0], fs[0], ms[1], fs[1]] : [ms[0], fs[1], ms[1], fs[0]];
    } else {
         const sA = getScore(selectedPlayers[0].id, selectedPlayers[3].id) + getScore(selectedPlayers[1].id, selectedPlayers[2].id);
         const sB = getScore(selectedPlayers[0].id, selectedPlayers[2].id) + getScore(selectedPlayers[1].id, selectedPlayers[3].id);
         const sC = getScore(selectedPlayers[0].id, selectedPlayers[1].id) + getScore(selectedPlayers[2].id, selectedPlayers[3].id) + 5;
         bestTeam = (sA <= sB) ? [selectedPlayers[0], selectedPlayers[3], selectedPlayers[1], selectedPlayers[2]]
                               : [selectedPlayers[0], selectedPlayers[2], selectedPlayers[1], selectedPlayers[3]];
         if(sC < Math.min(sA, sB)) bestTeam = [...selectedPlayers];
    }

    return bestTeam;
}

function shuffleByGameCount(list, getGameCount = getMatchingGameCount) {
    const now = Date.now();
    const waitingSince = player => Number.isFinite(player.waitingSince) ? player.waitingSince : now;
    const groups = {};
    list.forEach(player => {
        const gameCount = getGameCount(player);
        if(!groups[gameCount]) groups[gameCount] = [];
        groups[gameCount].push(player);
    });
    let result = [];
    Object.keys(groups).sort((a,b)=>a-b).forEach(g => {
        const group = groups[g];
        // Shuffle before the stable wait-time sort so exact ties stay random.
        for (let i = group.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [group[i], group[j]] = [group[j], group[i]]; }
        group.sort((a, b) => waitingSince(a) - waitingSince(b));
        result.push(...group);
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
    return Math.floor(activePlayers.reduce((sum, player) => sum + getMatchingGameCount(player), 0) / activePlayers.length);
}
