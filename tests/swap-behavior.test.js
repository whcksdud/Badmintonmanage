const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
if (html.includes('>F조</option>') || html.includes('const tiers = ["F조"') || !html.includes('<option value="1" selected>E조</option>')) throw new Error('F조가 제거되지 않았거나 E조가 기본 급수로 설정되지 않았습니다.');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

if (!inlineScript) throw new Error('index.html의 인라인 스크립트를 찾을 수 없습니다.');

function createPlayers() {
    return Array.from({ length: 13 }, (_, index) => ({
        id: index + 1,
        name: `선수${String(index + 1).padStart(2, '0')}`,
        gender: index % 2 === 0 ? 'M' : 'F',
        tier: index % 6,
        games: index,
        lastTime: index,
        status: index < 4 || (index >= 8 && index < 12)
            ? 'playing'
            : index < 8 ? 'reserved' : 'waiting',
        shuttlecock: false
    }));
}

function createElement() {
    return {
        value: '',
        innerText: '',
        innerHTML: '',
        className: '',
        disabled: false,
        title: '',
        style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {},
        addEventListener() {},
        focus() {},
        click() {}
    };
}

function createRuntime(players, courts) {
    const storage = new Map([
        ['bm_p_v13', JSON.stringify(players)],
        ['bm_c_v13', JSON.stringify(courts)],
        ['bm_h_v13', '[]']
    ]);
    const elements = new Map();
    const context = {
        console,
        __elements: elements,
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, createElement());
                return elements.get(id);
            },
            createElement
        },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, value); },
            clear() { storage.clear(); }
        },
        navigator: {},
        window: {
            navigator: {},
            matchMedia() { return { matches: false }; },
            addEventListener() {},
            isSecureContext: false
        },
        setInterval() { return 0; },
        setTimeout() { return 0; },
        clearTimeout() {},
        Blob,
        URL
    };

    vm.createContext(context);
    vm.runInContext(inlineScript, context);
    return context;
}

function courtPlayers(players, ids) {
    return ids.map(id => ({ ...players.find(player => player.id === id) }));
}

function assertInRuntime(context, assertion, message) {
    const passed = vm.runInContext(assertion, context);
    if (!passed) throw new Error(message);
}

{
    const players = createPlayers();
    const courts = [
        { id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 },
        { id: 2, type: 'A', active: courtPlayers(players, [9, 10, 11, 12]), next: courtPlayers(players, [5, 6, 7, 8]), startTime: Date.now() - 60000 }
    ];
    const context = createRuntime(players, courts);

    vm.runInContext('openSwap(2, "next", 0)', context);
    const swapHtml = context.__elements.get('swapList').innerHTML;
    if (!swapHtml.includes('onclick="doSwap(1)"')) throw new Error('게임 중 선수가 다음 대기 교체 후보에 없습니다.');
    if (!swapHtml.includes('게임중')) throw new Error('게임 중 교체 후보에 상태 표시가 없습니다.');
    if (!swapHtml.includes('gender-card gender-m') || !swapHtml.includes('gender-card gender-f')) throw new Error('교체 후보 카드의 성별 색상 표시가 없습니다.');
    if (swapHtml.includes('gender-marker')) throw new Error('교체 후보에 불필요한 성별 동그라미가 남아 있습니다.');
    if (swapHtml.includes('>남<') || swapHtml.includes('>여<')) throw new Error('교체 후보에 남·녀 글자 배지가 남아 있습니다.');

    vm.runInContext('doSwap(1)', context);
    assertInRuntime(context, 'courts.find(court => court.id === 2).next[0].id === 1', '다음 대기 선수 교체에 실패했습니다.');
    assertInRuntime(context, 'players.find(player => player.id === 1).status === "playing"', '중복 배정된 선수의 게임 중 상태가 유지되지 않았습니다.');
    assertInRuntime(context, 'players.find(player => player.id === 5).status === "waiting"', '교체된 기존 선수가 대기로 돌아가지 않았습니다.');
    assertInRuntime(context, 'renderChip(courts.find(court => court.id === 2), "next", 0).includes("next-playing-badge")', '다음 대기 카드에 게임 중 상태표시가 없습니다.');

    const teamHtml = vm.runInContext('renderMatchTeams(courts.find(court => court.id === 2), "next", "next-chip")', context);
    const teamAStart = teamHtml.indexOf('aria-label="A팀"');
    const teamBStart = teamHtml.indexOf('aria-label="B팀"');
    if (!(teamAStart >= 0 && teamBStart > teamAStart)) throw new Error('중앙선 양쪽의 두 팀이 올바른 순서로 표시되지 않았습니다.');
    if (teamHtml.includes('같은 팀')) throw new Error('팀 영역에 불필요한 같은 팀 문구가 표시됩니다.');
    if (teamHtml.includes('match-vs') || teamHtml.includes('>VS<')) throw new Error('팀 영역 사이에 불필요한 VS 표시가 남아 있습니다.');
    if (!html.includes('.match-teams::after')) throw new Error('팀 사이의 코트형 중앙 구분선 스타일이 없습니다.');
    if (html.includes('.match-team.team-a {') || html.includes('.match-team.team-b {')) throw new Error('이전 팀 배경색 스타일이 남아 있습니다.');
    if ((teamHtml.match(/class="match-player-content"/g) || []).length !== 4) throw new Error('다음 대기 네 카드의 이름·급수 중앙 정렬 영역이 누락되었습니다.');
    if (teamHtml.includes('match-status-slot')) throw new Error('이름·급수를 아래로 밀어내는 이전 상태 영역이 남아 있습니다.');
    if ((teamHtml.match(/class="next-playing-badge"/g) || []).length !== 1) throw new Error('다음 대기의 게임 중 상태표시 개수가 올바르지 않습니다.');
    if (!html.includes('.next-playing-badge { position: absolute;')) throw new Error('게임 중 상태표시가 카드 정렬 흐름에서 분리되지 않았습니다.');
    if (!html.includes('.match-team .player-chip { min-width: 0; height: 64px; min-height: 64px;')) throw new Error('코트 선수 카드의 고정 높이 스타일이 없습니다.');
    const teamAHtml = teamHtml.slice(teamAStart, teamBStart);
    const teamBHtml = teamHtml.slice(teamBStart);
    if (!teamAHtml.includes('선수01') || !teamAHtml.includes('선수06') || teamAHtml.includes('선수07')) throw new Error('앞의 두 선수가 A팀으로 묶이지 않았습니다.');
    if (!teamBHtml.includes('선수07') || !teamBHtml.includes('선수08') || teamBHtml.includes('선수06')) throw new Error('뒤의 두 선수가 B팀으로 묶이지 않았습니다.');
    const courtHtml = context.__elements.get('courtGrid').innerHTML;
    if (!courtHtml.includes('match-teams')) throw new Error('코트 화면에 팀 구분 레이아웃이 렌더링되지 않았습니다.');
    if (!teamHtml.includes('gender-card gender-m') || !teamHtml.includes('gender-card gender-f')) throw new Error('코트 선수 카드의 성별 색상 표시가 없습니다.');
    if (!html.includes('.match-player-chip.gender-card.gender-m { background: #fff;') || !html.includes('.match-player-chip.gender-card.gender-f { background: #fff;') || !html.includes('border-left: 5px solid #38bdf8') || !html.includes('border-left: 5px solid #f472b6')) throw new Error('코트 선수 카드의 성별 왼쪽 구분선 스타일이 없습니다.');
    if (teamHtml.includes('gender-marker')) throw new Error('코트 선수에 불필요한 성별 동그라미가 남아 있습니다.');
    if (teamHtml.includes('>남<') || teamHtml.includes('>여<')) throw new Error('코트 선수에 남·녀 글자 배지가 남아 있습니다.');

    const rosterHtml = context.__elements.get('waitList').innerHTML;
    if (!rosterHtml.includes('roster-summary') || !rosterHtml.includes('roster-identity') || !rosterHtml.includes('roster-meta-line') || rosterHtml.includes('roster-toggle-icon') || rosterHtml.includes('roster-more-icon')) throw new Error('대기실 선수 요약에서 불필요한 더보기 아이콘이 제거되지 않았습니다.');
    if (!/\.roster-identity\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/.test(html) || !/\.roster-meta-line\s*\{[^}]*white-space:\s*nowrap/.test(html)) throw new Error('대기실 카드의 이름·급수·경기 수가 한 줄로 유지되지 않습니다.');
    if (rosterHtml.includes('roster-chevron') || rosterHtml.includes('>⌄</span>')) throw new Error('용도가 불분명한 이전 펼침 화살표가 남아 있습니다.');
    if (!rosterHtml.includes('aria-expanded="false"') || rosterHtml.includes('roster-action-panel')) throw new Error('대기실 선수 카드가 기본 상태에서 접혀 있지 않습니다.');
    if (!rosterHtml.includes('roster-status-waiting') || !rosterHtml.includes('roster-status-reserved') || !rosterHtml.includes('roster-status-playing')) throw new Error('대기실 선수 카드에 상태별 클래스가 표시되지 않았습니다.');
    if (rosterHtml.includes('roster-state') || rosterHtml.includes('roster-top') || rosterHtml.includes('roster-bottom')) throw new Error('상태를 중복 표시하던 이전 대기실 카드 구조가 남아 있습니다.');
    if (!html.includes('.roster-chip.gender-card.gender-m { background: #fff; border-color: #e2e8f0; border-left: 5px solid #38bdf8; }') || !html.includes('.roster-chip.gender-card.gender-f { background: #fff; border-color: #e2e8f0; border-left: 5px solid #f472b6; }')) throw new Error('대기실 카드의 성별 세로 구분선 스타일이 없습니다.');
    if (!html.includes('.roster-chip.gender-card.roster-status-resting { background: var(--rest-bg); }') || !html.includes('.roster-chip.gender-card.roster-status-reserved { background: var(--reserved-bg); }') || !html.includes('.roster-chip.gender-card.roster-status-playing { background: var(--playing-bg); }')) throw new Error('대기실 카드의 휴식·예약·게임 중 조화로운 배경색 구분이 없습니다.');
    if (!rosterHtml.includes('list-section-reserved') || !rosterHtml.includes('list-section-playing') || !html.includes('.list-section-resting') || !html.includes('.list-section-reserved') || !html.includes('.list-section-playing')) throw new Error('대기실 상태 제목에 카드와 연결되는 색상 포인트가 없습니다.');
    if (!/\.wc-list\s*\{[^}]*grid-auto-rows:\s*max-content/.test(html)) throw new Error('낮은 화면에서 대기실 카드 행이 압축되지 않도록 하는 목록 스타일이 없습니다.');
    if (!/\.roster-chip\s*\{[^}]*min-height:\s*58px/.test(html)) throw new Error('해상도와 무관하게 대기실 카드의 최소 높이가 유지되지 않습니다.');
    if (html.includes('성별 / 이름') || html.includes('콕 / 급수 / 경기수')) throw new Error('새 카드 배치와 맞지 않는 이전 대기실 안내 줄이 남아 있습니다.');

    vm.runInContext('toggleRosterActions(13)', context);
    let expandedRosterHtml = context.__elements.get('waitList').innerHTML;
    if ((expandedRosterHtml.match(/class="roster-action-panel"/g) || []).length !== 1 || !expandedRosterHtml.includes('aria-expanded="true"') || expandedRosterHtml.includes('roster-close-icon')) throw new Error('선택한 선수의 빠른 동작만 아이콘 없이 펼쳐지지 않았습니다.');
    if (!expandedRosterHtml.includes('roster-action-icon-rest') || !expandedRosterHtml.includes('roster-action-icon-shuttle') || !expandedRosterHtml.includes('roster-action-icon-edit') || !expandedRosterHtml.includes('>휴식</span>') || !expandedRosterHtml.includes('>콕 냄</span>') || !expandedRosterHtml.includes('openPModal(13)')) throw new Error('펼친 대기 선수 카드의 통일된 휴식·콕·정보 수정 동작 아이콘이 누락되었습니다.');
    if (!/\.roster-action-panel\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*nowrap/.test(html) || !/\.roster-action\s*\{[^}]*flex:\s*1 1 0/.test(html)) throw new Error('대기실 빠른 동작 버튼이 한 줄로 유지되지 않습니다.');
    if (/[⏸↩✓🏸✎]/u.test(expandedRosterHtml)) throw new Error('대기실 빠른 동작에 OS마다 다르게 보이는 문자 이모지가 남아 있습니다.');
    assertInRuntime(context, 'expandedRosterPlayerId === 13', '펼친 선수 카드 상태를 유지하지 못했습니다.');

    vm.runInContext('toggleRosterActions(6)', context);
    expandedRosterHtml = context.__elements.get('waitList').innerHTML;
    if ((expandedRosterHtml.match(/class="roster-action-panel"/g) || []).length !== 1 || !expandedRosterHtml.includes('openPModal(6)') || expandedRosterHtml.includes('roster-action-icon-rest')) throw new Error('예약 선수 카드 전환 시 한 카드만 펼쳐지거나 허용된 동작만 표시되지 않았습니다.');
    vm.runInContext('toggleRosterActions(13)', context);

    vm.runInContext('toggleShuttlecock(13)', context);
    const shuttleActiveHtml = context.__elements.get('waitList').innerHTML;
    if (!shuttleActiveHtml.includes('roster-action shuttle active') || !shuttleActiveHtml.includes('aria-pressed="true"') || !shuttleActiveHtml.includes('roster-action-icon-cancel') || !shuttleActiveHtml.includes('>콕 취소</span>') || !shuttleActiveHtml.includes('has-shuttlecock') || !shuttleActiveHtml.includes('· 콕 냄 빠른 동작')) throw new Error('콕 냄 선택 상태가 펼침 동작과 카드 접근성 정보에 표시되지 않았습니다.');
    if (shuttleActiveHtml.includes('roster-shuttle-indicator') || !html.includes('.roster-chip.gender-card { border-right: 5px solid transparent; }') || !html.includes('.roster-chip.gender-card.has-shuttlecock { border-right-color: #7c3aed; }') || !html.includes('.roster-chip.gender-card.has-shuttlecock::after { display: none; }') || !html.includes('* { box-sizing: border-box;')) throw new Error('콕 냄 전후에 카드 공간을 유지하는 성별 표시형 테두리가 적용되지 않았습니다.');
    vm.runInContext('toggleShuttlecock(13)', context);

    vm.runInContext('toggleRestStatus(13)', context);
    const restingRosterHtml = context.__elements.get('waitList').innerHTML;
    if (!restingRosterHtml.includes('roster-action-icon-resume') || !restingRosterHtml.includes('>대기 복귀</span>') || !restingRosterHtml.includes('휴식 중 (1명)') || !restingRosterHtml.includes('roster-status-resting')) throw new Error('펼친 휴식 선수 카드의 상태 표시나 대기 복귀 동작이 누락되었습니다.');
    vm.runInContext('toggleRestStatus(13)', context);
    assertInRuntime(context, 'players.find(player => player.id === 13).status === "waiting"', '펼친 카드 동작으로 대기 상태에 복귀하지 못했습니다.');
    vm.runInContext('toggleRosterActions(13)', context);
    if (context.__elements.get('waitList').innerHTML.includes('roster-action-panel')) throw new Error('선수 카드를 다시 눌렀을 때 빠른 동작이 접히지 않았습니다.');

    if (!html.includes('id="deletePlayerButton"') || !html.includes('class="player-delete-button"') || !html.includes('class="player-delete-zone"')) throw new Error('선수 삭제 버튼의 분리된 위험 작업 디자인이 없습니다.');
    vm.runInContext('openPModal()', context);
    if (context.__elements.get('deletePlayerButton').hidden !== true) throw new Error('신규 선수 등록 화면에 삭제 버튼이 표시됩니다.');
    vm.runInContext('openPModal(13)', context);
    if (context.__elements.get('deletePlayerButton').hidden !== false) throw new Error('선수 정보 수정 화면에 삭제 버튼이 표시되지 않습니다.');
    vm.runInContext('closePModal()', context);

    const headerStart = courtHtml.indexOf('<div class="cc-header">');
    const gameSectionStart = courtHtml.indexOf('<div class="game-section">', headerStart);
    const nextSectionStart = courtHtml.indexOf('<div class="next-section">', gameSectionStart);
    const headerHtml = courtHtml.slice(headerStart, gameSectionStart);
    const gameSectionHtml = courtHtml.slice(gameSectionStart, nextSectionStart);
    if (!headerHtml.includes('코트 1') || !headerHtml.includes('진행 중') || !headerHtml.includes('timer-1')) throw new Error('진행 상태와 경과 시간이 코트 제목 줄에 표시되지 않았습니다.');
    if (gameSectionHtml.includes('진행 중') || gameSectionHtml.includes('timer-1')) throw new Error('진행 상태 줄이 경기 영역의 공간을 계속 차지하고 있습니다.');
    if (/class="type-select"[^>]*disabled/.test(courtHtml)) throw new Error('진행 중인 코트의 경기 유형 선택이 잠겨 있습니다.');
    vm.runInContext('setType(1, "X")', context);
    assertInRuntime(context, 'courts.find(court => court.id === 1).type === "X"', '진행 중인 코트의 경기 유형 변경에 실패했습니다.');

    vm.runInContext('completeGame(1)', context);
    assertInRuntime(context, 'players.find(player => player.id === 1).status === "reserved"', '기존 경기 종료 후 예약 상태로 전환되지 않았습니다.');
}

{
    const players = createPlayers();
    const courts = [
        { id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 },
        { id: 2, type: 'A', active: courtPlayers(players, [9, 10, 11, 12]), next: courtPlayers(players, [1, 6, 7, 8]), startTime: Date.now() - 60000 }
    ];
    const context = createRuntime(players, courts);

    vm.runInContext('syncPlayerAssignmentStatus(1); cancelNext(2)', context);
    assertInRuntime(context, 'players.find(player => player.id === 1).status === "playing"', '다음 예약 취소 시 게임 중 상태가 손실되었습니다.');
}

{
    const players = createPlayers();
    const courts = [
        { id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 },
        { id: 2, type: 'A', active: courtPlayers(players, [9, 10, 11, 12]), next: [], startTime: Date.now() - 60000 },
        { id: 3, type: 'A', active: [], next: [], startTime: null }
    ];
    const context = createRuntime(players, courts);

    vm.runInContext('openManualMatch(1)', context);
    const nextManualHtml = context.__elements.get('manualList').innerHTML;
    if (!nextManualHtml.includes('onclick="toggleManualSelect(9)"')) throw new Error('게임 중 선수가 다음 대기 수동 매칭 후보에 없습니다.');
    if (!nextManualHtml.includes('게임중')) throw new Error('수동 매칭의 게임 중 후보에 상태 표시가 없습니다.');
    if (!html.includes('.manual-chip.gender-card.gender-m { background: #fff; border: 1px solid #e2e8f0; border-left: 5px solid #38bdf8; }') || !html.includes('.manual-chip.gender-card.gender-f { background: #fff; border: 1px solid #e2e8f0; border-left: 5px solid #f472b6; }')) throw new Error('수동 매칭 선수 카드의 성별 표시가 왼쪽 구분선으로 적용되지 않았습니다.');
    if (!nextManualHtml.includes('manual-chip gender-card gender-m') || !nextManualHtml.includes('manual-chip gender-card gender-f')) throw new Error('수동 매칭 선수 카드에 성별 구분 클래스가 없습니다.');
    if (!html.includes('.manual-player-list { grid-template-columns: repeat(auto-fill, minmax(125px, 1fr)); gap: 8px; }') || !html.includes('min-height: 84px; aspect-ratio: 1.45 / 1; padding: 6px 8px') || !nextManualHtml.includes('manual-player-name') || !nextManualHtml.includes('manual-player-meta')) throw new Error('수동 매칭 선수가 세로 여백을 줄인 카드 그리드로 표시되지 않았습니다.');

    vm.runInContext('[1, 2, 9, 10].forEach(toggleManualSelect); confirmManualMatch()', context);
    assertInRuntime(context, 'courts.find(court => court.id === 1).next.length === 4', '게임 중 선수를 포함한 수동 매칭에 실패했습니다.');
    assertInRuntime(context, '[1, 2, 9, 10].every(id => players.find(player => player.id === id).status === "playing")', '수동 매칭 후 게임 중 상태가 유지되지 않았습니다.');

    vm.runInContext('openManualMatch(3)', context);
    const activeManualHtml = context.__elements.get('manualList').innerHTML;
    if (activeManualHtml.includes('onclick="toggleManualSelect(9)"')) throw new Error('빈 코트의 현재 경기에 게임 중 선수가 노출되었습니다.');
}

{
    const players = createPlayers();
    const courts = [
        { id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: courtPlayers(players, [9, 6, 7, 8]), startTime: Date.now() - 60000 },
        { id: 2, type: 'A', active: courtPlayers(players, [9, 10, 11, 12]), next: [], startTime: Date.now() - 60000 }
    ];
    const context = createRuntime(players, courts);

    vm.runInContext('completeGame(1)', context);
    assertInRuntime(context, 'history.length === 1', '승계 차단 시 종료된 경기 기록이 저장되지 않았습니다.');
    assertInRuntime(context, 'courts.find(court => court.id === 1).active.length === 0', '승계 차단 시 종료된 경기가 코트에 남았습니다.');
    assertInRuntime(context, 'courts.find(court => court.id === 1).next.length === 4', '게임 중인 선수 때문에 보류된 다음 대기가 사라졌습니다.');
    if (!context.__elements.get('toast').innerText.includes('승계 불가')) throw new Error('승계 불가 안내가 표시되지 않았습니다.');

    vm.runInContext('completeGame(1)', context);
    assertInRuntime(context, 'history.length === 1', '승계 재시도 중 종료 기록이 중복 저장되었습니다.');
    assertInRuntime(context, 'courts.find(court => court.id === 1).next.length === 4', '게임 중인 상태에서 승계가 실행되었습니다.');

    vm.runInContext('completeGame(2); completeGame(1)', context);
    assertInRuntime(context, 'courts.find(court => court.id === 1).active.length === 4', '다른 코트 경기 종료 후 승계되지 않았습니다.');
    assertInRuntime(context, 'courts.find(court => court.id === 1).next.length === 0', '승계 후 다음 대기가 비워지지 않았습니다.');
    assertInRuntime(context, 'players.find(player => player.id === 9).status === "playing"', '승계된 선수의 상태가 게임 중으로 바뀌지 않았습니다.');
}

{
    const players = createPlayers();
    players.forEach(player => { player.status = 'resting'; player.games = 9; });
    [1, 2, 3, 4].forEach(id => { players[id - 1].status = 'playing'; players[id - 1].games = id === 1 ? 0 : 5; });
    [5, 6, 7].forEach(id => { players[id - 1].status = 'waiting'; players[id - 1].games = 0; });
    const courts = [{ id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 }];
    const context = createRuntime(players, courts);

    vm.runInContext('matchCourt(1)', context);
    assertInRuntime(context, 'courts[0].next.map(player => player.id).sort((a, b) => a - b).join(",") === "1,5,6,7"', '다음 자동 예약에서 게임 중 선수를 예상 게임 수에 따라 선발하지 못했습니다.');
    assertInRuntime(context, 'players.find(player => player.id === 1).status === "playing"', '자동 예약에 포함된 게임 중 선수의 상태가 손실되었습니다.');
    assertInRuntime(context, 'courts[0].next.some(player => player.id === 1) && renderChip(courts[0], "next", courts[0].next.findIndex(player => player.id === 1)).includes("next-playing-badge")', '자동 예약 카드에 게임 중 상태표시가 없습니다.');
    if (!context.__elements.get('toast').innerText.includes('게임 중인 선수 1명 포함')) throw new Error('자동 예약 완료 안내에 게임 중 선수 수가 없습니다.');
}

{
    const players = createPlayers();
    players.forEach(player => { player.status = 'resting'; player.games = 9; });
    [1, 2, 3, 4].forEach(id => { players[id - 1].status = 'playing'; players[id - 1].games = id === 1 ? 0 : 5; });
    [5, 6, 8].forEach(id => { players[id - 1].status = 'waiting'; players[id - 1].games = 0; });
    const courts = [{ id: 1, type: 'X', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 }];
    const context = createRuntime(players, courts);

    vm.runInContext('matchCourt(1)', context);
    assertInRuntime(context, 'courts[0].next.map(player => player.id).sort((a, b) => a - b).join(",") === "1,5,6,8"', '혼복 다음 예약에서 게임 중 선수를 성별 조건에 맞게 선발하지 못했습니다.');
    assertInRuntime(context, 'courts[0].next.filter(player => player.gender === "M").length === 2 && courts[0].next.filter(player => player.gender === "F").length === 2', '게임 중 선수를 고려한 혼복 성별 구성이 잘못되었습니다.');
}

{
    const players = createPlayers();
    players.forEach(player => { player.status = 'resting'; player.games = 9; });
    [1, 2, 3, 4].forEach(id => { players[id - 1].status = 'playing'; players[id - 1].games = 0; });
    [5, 6, 7, 8].forEach(id => { players[id - 1].status = 'waiting'; players[id - 1].games = 1; });
    const courts = [{ id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 }];
    const context = createRuntime(players, courts);

    vm.runInContext('matchCourt(1)', context);
    assertInRuntime(context, 'courts[0].next.every(player => [5, 6, 7, 8].includes(player.id))', '예상 게임 수가 같은데 게임 중 선수가 대기 선수보다 먼저 선발되었습니다.');
}

{
    const players = createPlayers();
    players.forEach(player => { player.status = 'resting'; player.games = 0; });
    [1, 2, 3, 4].forEach(id => { players[id - 1].status = 'playing'; });
    [5, 6, 7].forEach(id => { players[id - 1].status = 'waiting'; });
    const courts = [
        { id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 },
        { id: 2, type: 'A', active: [], next: [], startTime: null }
    ];
    const context = createRuntime(players, courts);

    vm.runInContext('matchCourt(2)', context);
    assertInRuntime(context, 'courts[1].next.length === 0', '빈 코트의 첫 경기에 게임 중인 선수가 자동 배정되었습니다.');
    if (!context.__elements.get('toast').innerText.includes('인원이 부족')) throw new Error('빈 코트 자동 매칭의 인원 부족 안내가 없습니다.');
}

{
    const players = createPlayers();
    players.forEach(player => { player.status = 'resting'; player.games = 9; });
    [1, 2, 3, 4].forEach(id => { players[id - 1].status = 'playing'; players[id - 1].games = id === 1 ? 0 : 5; });
    [5, 6, 7].forEach(id => { players[id - 1].status = 'waiting'; players[id - 1].games = 0; });
    const courts = [
        { id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 },
        { id: 2, type: 'A', active: [], next: courtPlayers(players, [1]), startTime: null }
    ];
    const context = createRuntime(players, courts);

    vm.runInContext('matchCourt(1)', context);
    assertInRuntime(context, '!courts[0].next.some(player => player.id === 1)', '이미 다른 다음 경기에 예약된 게임 중 선수가 중복 배정되었습니다.');
}

console.log('선수 교체·수동 매칭·자동 예약·승계 상태 테스트 통과');
