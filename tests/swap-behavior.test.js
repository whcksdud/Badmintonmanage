const fs = require('fs');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const { html, styles, appSource, runApp } = require('./helpers/app-runtime');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
if (html.includes('>F조</option>') || appSource.includes('const tiers = ["F조"') || !html.includes('<option value="1" selected>E조</option>')) throw new Error('F조가 제거되지 않았거나 E조가 기본 급수로 설정되지 않았습니다.');
if (!serviceWorker.includes('app-v26') || !serviceWorker.includes('runtime-v26') || !appSource.includes("navigator.serviceWorker.addEventListener('controllerchange'")) throw new Error('배포 후 최신 화면을 적용하는 서비스 워커 캐시 갱신 처리가 없습니다.');

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

function createRuntime(players, courts, extraStorage = {}) {
    const storage = new Map([
        ['bm_p_v13', JSON.stringify(players)],
        ['bm_c_v13', JSON.stringify(courts)],
        ['bm_h_v13', '[]'],
        ...Object.entries(extraStorage)
    ]);
    const elements = new Map();
    const context = {
        console,
        __elements: elements,
        __storage: storage,
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, createElement());
                return elements.get(id);
            },
            createElement,
            addEventListener() {}
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
    runApp(context);
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
    if (!swapHtml.includes('게임 중') || !swapHtml.includes('1번 코트 경기 중') || !swapHtml.includes('2번 코트 경기 중') || !swapHtml.includes('roster-location')) throw new Error('선수 교체 카드에 게임 중 상태와 현재 코트를 표시해야 합니다.');
    if (!swapHtml.includes('gender-card gender-m') || !swapHtml.includes('gender-card gender-f')) throw new Error('교체 후보 카드의 성별 색상 표시가 없습니다.');
    if (!swapHtml.includes('roster-chip manual-chip swap-chip') || !swapHtml.includes('roster-summary') || !swapHtml.includes('roster-details') || !swapHtml.includes('roster-metrics')) throw new Error('선수 교체 카드가 대기실과 같은 정보 구성을 사용해야 합니다.');
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
    if (!styles.includes('.match-teams::after')) throw new Error('팀 사이의 코트형 중앙 구분선 스타일이 없습니다.');
    if (styles.includes('.match-team.team-a {') || styles.includes('.match-team.team-b {')) throw new Error('이전 팀 배경색 스타일이 남아 있습니다.');
    if ((teamHtml.match(/class="match-player-content"/g) || []).length !== 4) throw new Error('다음 대기 네 카드의 이름·급수 중앙 정렬 영역이 누락되었습니다.');
    if (teamHtml.includes('match-status-slot')) throw new Error('이름·급수를 아래로 밀어내는 이전 상태 영역이 남아 있습니다.');
    if ((teamHtml.match(/class="next-playing-badge"/g) || []).length !== 1) throw new Error('다음 대기의 게임 중 상태표시 개수가 올바르지 않습니다.');
    if (!styles.includes('.next-playing-badge { position: absolute;')) throw new Error('게임 중 상태표시가 카드 정렬 흐름에서 분리되지 않았습니다.');
    if (!styles.includes('.match-team .player-chip { min-width: 0; height: 64px; min-height: 64px;')) throw new Error('코트 선수 카드의 고정 높이 스타일이 없습니다.');
    const teamAHtml = teamHtml.slice(teamAStart, teamBStart);
    const teamBHtml = teamHtml.slice(teamBStart);
    if (!teamAHtml.includes('선수01') || !teamAHtml.includes('선수06') || teamAHtml.includes('선수07')) throw new Error('앞의 두 선수가 A팀으로 묶이지 않았습니다.');
    if (!teamBHtml.includes('선수07') || !teamBHtml.includes('선수08') || teamBHtml.includes('선수06')) throw new Error('뒤의 두 선수가 B팀으로 묶이지 않았습니다.');
    const courtHtml = context.__elements.get('courtGrid').innerHTML;
    if (!courtHtml.includes('match-teams')) throw new Error('코트 화면에 팀 구분 레이아웃이 렌더링되지 않았습니다.');
    if (!teamHtml.includes('gender-card gender-m') || !teamHtml.includes('gender-card gender-f')) throw new Error('코트 선수 카드의 성별 색상 표시가 없습니다.');
    if (!styles.includes('.match-player-chip.gender-card.gender-m { background: #fff;') || !styles.includes('.match-player-chip.gender-card.gender-f { background: #fff;') || !styles.includes('border-left: 5px solid #38bdf8') || !styles.includes('border-left: 5px solid #f472b6')) throw new Error('코트 선수 카드의 성별 왼쪽 구분선 스타일이 없습니다.');
    if (teamHtml.includes('gender-marker')) throw new Error('코트 선수에 불필요한 성별 동그라미가 남아 있습니다.');
    if (teamHtml.includes('>남<') || teamHtml.includes('>여<')) throw new Error('코트 선수에 남·녀 글자 배지가 남아 있습니다.');

    const rosterHtml = context.__elements.get('waitList').innerHTML;
    const rosterSearchInput = context.__elements.get('searchInput');
    rosterSearchInput.value = '선수13';
    vm.runInContext('renderRoster()', context);
    if (!context.__elements.get('waitList').innerHTML.includes('선수13') || context.__elements.get('waitList').innerHTML.includes('선수01')) throw new Error('이름 검색 결과가 일치하지 않습니다.');
    vm.runInContext('handleRosterSearchKey({key:"Escape"})', context);
    if (rosterSearchInput.value !== '') throw new Error('Escape로 검색어가 초기화되지 않습니다.');
    if (!rosterHtml.includes('roster-identity') || !rosterHtml.includes('roster-details') || !rosterHtml.includes('roster-metrics')) throw new Error('이름·상세 정보·대기 현황이 구분되지 않았습니다.');
    const stateBeforeFiltering = vm.runInContext('serializeState()', context);
    vm.runInContext('setRosterFilter("waiting")', context);
    if (context.__elements.get('waitList').innerHTML.includes('roster-status-playing')) throw new Error('대기 필터에 경기 중 선수가 표시됩니다.');
    assertInRuntime(context, 'Number(document.getElementById("rosterCount-playing").innerText) === players.filter(p => p.status === "playing").length', '필터를 바꿔도 전체 상태별 인원을 유지해야 합니다.');
    vm.runInContext('toggleRosterActionSheet(13); setRosterFilter("reserved")', context);
    assertInRuntime(context, 'selectedRosterPlayerId === null && document.getElementById("rosterActionSheet").hidden', '필터 변경 시 숨겨지는 선수의 관리창이 닫혀야 합니다.');
    rosterSearchInput.value = '없는선수';
    vm.runInContext('renderRoster()', context);
    if (!context.__elements.get('waitList').innerHTML.includes('검색 결과가 없습니다')) throw new Error('검색 결과가 없을 때 안내가 필요합니다.');
    vm.runInContext('resetRosterFilters()', context);
    if (vm.runInContext('serializeState()', context) !== stateBeforeFiltering) throw new Error('필터와 검색이 저장 데이터를 변경하면 안 됩니다.');
    if (rosterHtml.includes('roster-chevron') || rosterHtml.includes('>⌄</span>')) throw new Error('용도가 불분명한 이전 펼침 화살표가 남아 있습니다.');
    if (!rosterHtml.includes('aria-expanded="false"')) throw new Error('대기실 카드의 기본 선택 상태가 닫힘이 아닙니다.');
    const rosterActionSheet = context.__elements.get('rosterActionSheet');
    if (rosterActionSheet.hidden !== true || rosterActionSheet.innerHTML !== '') throw new Error('선수 선택 전부터 하단 관리 시트가 표시됩니다.');
    if (!html.includes('<section id="rosterActionSheet" class="roster-action-sheet"') || !html.includes('onclick="event.stopPropagation()" hidden></section>') || html.includes('id="rosterActionDock"')) throw new Error('독립된 선수 관리 하단 시트가 없거나 이전 관리 바가 남아 있습니다.');
    if (!rosterHtml.includes('roster-status-waiting') || !rosterHtml.includes('roster-status-reserved') || !rosterHtml.includes('roster-status-playing')) throw new Error('대기실 선수 카드에 상태별 클래스가 표시되지 않았습니다.');
    if (rosterHtml.includes('roster-state') || rosterHtml.includes('roster-top') || rosterHtml.includes('roster-bottom')) throw new Error('상태를 중복 표시하던 이전 대기실 카드 구조가 남아 있습니다.');
    if (!styles.includes('.roster-chip.gender-card.gender-m { background: #fff; border-color: #e2e8f0; border-left: 5px solid #38bdf8; }') || !styles.includes('.roster-chip.gender-card.gender-f { background: #fff; border-color: #e2e8f0; border-left: 5px solid #f472b6; }')) throw new Error('대기실 카드의 성별 세로 구분선 스타일이 없습니다.');
    if (!styles.includes('.roster-chip.gender-card.roster-status-resting { background: var(--rest-bg); }') || !styles.includes('.roster-chip.gender-card.roster-status-reserved { background: var(--reserved-bg); }') || !styles.includes('.roster-chip.gender-card.roster-status-playing { background: var(--playing-bg); }')) throw new Error('대기실 카드의 휴식·예약·게임 중 조화로운 배경색 구분이 없습니다.');
    if (!rosterHtml.includes('list-section-reserved') || !rosterHtml.includes('list-section-playing') || !styles.includes('.list-section-resting') || !styles.includes('.list-section-reserved') || !styles.includes('.list-section-playing')) throw new Error('대기실 상태 제목에 카드와 연결되는 색상 포인트가 없습니다.');
    if (!/\.wc-list\s*\{[^}]*grid-auto-rows:\s*max-content/.test(styles)) throw new Error('낮은 화면에서 대기실 카드 행이 압축되지 않도록 하는 목록 스타일이 없습니다.');
    if (!/#waitList\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/.test(styles) || !/@media \(max-width: 768px\)[\s\S]*?#waitList\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(styles) || !/#waitList \.list-section, #waitList \.empty-state\s*\{[^}]*grid-column:\s*1 \/ -1/.test(styles) || /\.roster-chip\.action-selected\s*\{[^}]*grid-column/.test(styles)) throw new Error('대기실 카드가 사이드바 1열·전체 화면 2열로 표시되거나 선택 카드 크기가 유지되지 않습니다.');
    if (!/\.roster-chip\s*\{[^}]*min-height:\s*58px/.test(styles)) throw new Error('해상도와 무관하게 대기실 카드의 최소 높이가 유지되지 않습니다.');
    if (html.includes('성별 / 이름') || html.includes('콕 / 급수 / 경기수')) throw new Error('새 카드 배치와 맞지 않는 이전 대기실 안내 줄이 남아 있습니다.');

    vm.runInContext('toggleRosterActionSheet(13)', context);
    let selectedRosterHtml = context.__elements.get('waitList').innerHTML;
    let rosterActionSheetHtml = rosterActionSheet.innerHTML;
    if (!selectedRosterHtml.includes('aria-expanded="true"') || !selectedRosterHtml.includes('action-selected') || !selectedRosterHtml.includes('roster-identity')) throw new Error('선택된 선수 카드가 정보와 고정 크기를 유지하지 못했습니다.');
    if (selectedRosterHtml.includes('roster-action-icon') || selectedRosterHtml.includes('roster-action-sheet') || selectedRosterHtml.includes('openPModal(13)')) throw new Error('이전 카드 내부 관리 버튼 로직이 남아 있습니다.');
    if (rosterActionSheet.hidden !== false || !rosterActionSheetHtml.includes('roster-sheet-heading') || !rosterActionSheetHtml.includes('roster-sheet-action-buttons') || !rosterActionSheetHtml.includes('roster-sheet-close')) throw new Error('독립된 선수 관리 하단 시트가 열리지 않았습니다.');
    if (!rosterActionSheetHtml.includes('roster-action-icon-rest') || !rosterActionSheetHtml.includes('roster-action-icon-shuttle') || !rosterActionSheetHtml.includes('roster-action-icon-edit') || !rosterActionSheetHtml.includes('>휴식</span>') || !rosterActionSheetHtml.includes('>콕 냄</span>') || !rosterActionSheetHtml.includes('openPModal(13)')) throw new Error('하단 시트의 휴식·콕·수정 동작이 누락되었습니다.');
    if (!styles.includes('.roster-action-sheet[hidden] { display: none; }') || html.indexOf('id="rosterActionSheet"') > html.indexOf('id="courtArea"')) throw new Error('선수 관리 영역은 대기실 안에 있어야 합니다.');
    if (!/\.roster-sheet-close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/.test(styles) || !/#toast\s*\{[^}]*pointer-events:\s*none/.test(styles) || !styles.includes('#toast.roster-sheet-open, #toast.roster-sheet-open.show')) throw new Error('하단 시트 닫기 터치 영역이나 알림 겹침 방지 처리가 없습니다.');
    if (['roster-inline-actions', 'roster-inline-action-buttons', 'roster-inline-close', 'roster-mobile-sheet-heading', 'roster-mobile-sheet-close'].some(token => html.includes(token))) throw new Error('제거해야 할 이전 카드 내부 관리 UI가 남아 있습니다.');
    if (/[⏸↩✓🏸✎]/u.test(rosterActionSheetHtml)) throw new Error('하단 시트 관리 버튼에 OS마다 다르게 보이는 문자 이모지가 남아 있습니다.');
    assertInRuntime(context, 'selectedRosterPlayerId === 13', '하단 시트의 선택 선수 상태를 유지하지 못했습니다.');
    vm.runInContext(`handleRosterActionSheetOutsideClick({ target: { closest() { return null; } } })`, context);
    if (rosterActionSheet.hidden !== true || rosterActionSheet.innerHTML !== '') throw new Error('하단 시트 바깥 화면을 눌렀을 때 관리 시트가 닫히지 않았습니다.');
    vm.runInContext('toggleRosterActionSheet(13)', context);
    vm.runInContext(`handleRosterActionSheetOutsideClick({ target: { closest(selector) { return selector === '.roster-chip' ? {} : null; } } })`, context);
    assertInRuntime(context, 'selectedRosterPlayerId === 13', '선수 카드 클릭까지 바깥 클릭으로 처리되어 하단 시트가 닫힙니다.');

    vm.runInContext('toggleRosterActionSheet(6)', context);
    selectedRosterHtml = context.__elements.get('waitList').innerHTML;
    rosterActionSheetHtml = rosterActionSheet.innerHTML;
    if (!selectedRosterHtml.includes('aria-expanded="true"') || !selectedRosterHtml.includes('action-selected') || !rosterActionSheetHtml.includes('openPModal(6)') || rosterActionSheetHtml.includes('roster-action-icon-rest')) throw new Error('예약 선수의 하단 시트에 허용된 동작만 표시되지 않았습니다.');
    vm.runInContext('toggleRosterActionSheet(13)', context);

    vm.runInContext('toggleShuttlecock(13)', context);
    const shuttleActiveHtml = context.__elements.get('waitList').innerHTML;
    const shuttleActiveSheetHtml = rosterActionSheet.innerHTML;
    if (!shuttleActiveSheetHtml.includes('roster-action shuttle active') || !shuttleActiveSheetHtml.includes('aria-pressed="true"') || !shuttleActiveSheetHtml.includes('roster-action-icon-cancel') || !shuttleActiveSheetHtml.includes('>콕 취소</span>') || !shuttleActiveHtml.includes('has-shuttlecock') || !shuttleActiveHtml.includes('· 콕 냄 선수 관리')) throw new Error('콕 냄 선택 상태가 하단 시트와 카드 접근성 정보에 표시되지 않았습니다.');
    if (!shuttleActiveHtml.includes('roster-shuttle') || !shuttleActiveHtml.includes('콕 냄</span>')) throw new Error('콕 제출 여부가 글자로 표시되지 않았습니다.');
    vm.runInContext('toggleShuttlecock(13)', context);

    vm.runInContext('toggleRestStatus(13)', context);
    const restingRosterHtml = context.__elements.get('waitList').innerHTML;
    const restingRosterActionSheetHtml = rosterActionSheet.innerHTML;
    if (!restingRosterActionSheetHtml.includes('roster-action-icon-resume') || !restingRosterActionSheetHtml.includes('>복귀</span>') || !restingRosterHtml.includes('휴식 중 (1명)') || !restingRosterHtml.includes('roster-status-resting')) throw new Error('휴식 선수 카드의 상태 표시나 하단 시트 복귀 동작이 누락되었습니다.');
    vm.runInContext('toggleRestStatus(13)', context);
    assertInRuntime(context, 'players.find(player => player.id === 13).status === "waiting"', '펼친 카드 동작으로 대기 상태에 복귀하지 못했습니다.');
    vm.runInContext('toggleRosterActionSheet(13)', context);
    if (rosterActionSheet.hidden !== true || rosterActionSheet.innerHTML !== '' || context.__elements.get('waitList').innerHTML.includes('action-selected')) throw new Error('선수 카드를 다시 눌렀을 때 하단 관리 시트가 닫히지 않았습니다.');

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
    if (!headerHtml.includes('코트 1') || !headerHtml.includes('경기 중') || !headerHtml.includes('timer-1')) throw new Error('진행 상태와 경과 시간이 코트 제목 줄에 표시되지 않았습니다.');
    if (gameSectionHtml.includes('경기 중') || gameSectionHtml.includes('timer-1')) throw new Error('진행 상태 줄이 경기 영역의 공간을 계속 차지하고 있습니다.');
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
    if (!nextManualHtml.includes('게임 중')) throw new Error('수동 매칭의 게임 중 후보에 상태 표시가 없습니다.');
    if (!nextManualHtml.includes('roster-chip manual-chip') || !nextManualHtml.includes('roster-status-playing')) throw new Error('수동 매칭 선수 카드가 대기실과 같은 성별·상태 스타일을 사용해야 합니다.');
    if (!nextManualHtml.includes('manual-chip gender-card gender-m') || !nextManualHtml.includes('manual-chip gender-card gender-f')) throw new Error('수동 매칭 선수 카드에 성별 구분 클래스가 없습니다.');
    if (!nextManualHtml.includes('roster-summary') || !nextManualHtml.includes('roster-details') || !nextManualHtml.includes('roster-metrics') || !nextManualHtml.includes('aria-pressed="false"')) throw new Error('수동 매칭 카드에 대기실과 같은 정보 구성과 선택 상태가 필요합니다.');

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
    assertInRuntime(context, 'courts[0].next.length === 0', '대기 인원이 부족한데 게임 중 선수를 자동 예약했습니다.');
    assertInRuntime(context, 'players.find(player => player.id === 1).status === "playing"', '자동 예약 실패 후 게임 중 상태가 손실되었습니다.');
    assertInRuntime(context, '[5, 6, 7].every(id => players.find(player => player.id === id).status === "waiting")', '자동 예약 실패 후 대기 선수 상태가 변경되었습니다.');
    if (!context.__elements.get('toast').innerText.includes('인원이 부족')) throw new Error('다음 자동 예약의 인원 부족 안내가 없습니다.');
}

{
    const players = createPlayers();
    players.forEach(player => { player.status = 'resting'; player.games = 9; });
    [1, 2, 3, 4].forEach(id => { players[id - 1].status = 'playing'; players[id - 1].games = id === 1 ? 0 : 5; });
    [5, 6, 8].forEach(id => { players[id - 1].status = 'waiting'; players[id - 1].games = 0; });
    const courts = [{ id: 1, type: 'X', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 }];
    const context = createRuntime(players, courts);

    vm.runInContext('matchCourt(1)', context);
    assertInRuntime(context, 'courts[0].next.length === 0', '혼복 대기 인원이 부족한데 게임 중 선수를 자동 예약했습니다.');
    if (!context.__elements.get('toast').innerText.includes('혼복 인원이 부족')) throw new Error('혼복 자동 예약의 인원 부족 안내가 없습니다.');
    vm.runInContext('players.find(player => player.id === 7).status = "waiting"; matchCourt(1)', context);
    assertInRuntime(context, 'courts[0].next.map(player => player.id).sort((a, b) => a - b).join(",") === "5,6,7,8"', '혼복 자동 예약에서 대기 중인 남녀 2명씩을 선발하지 못했습니다.');
    assertInRuntime(context, 'courts[0].next.slice(0, 2).filter(player => player.gender === "M").length === 1 && courts[0].next.slice(2).filter(player => player.gender === "M").length === 1', '혼복의 각 팀에 남녀 한 명씩 배정되지 않았습니다.');
}

{
    const players = createPlayers();
    players.forEach(player => { player.status = 'resting'; player.games = 9; });
    [1, 2, 3, 4].forEach(id => { players[id - 1].status = 'playing'; players[id - 1].games = 0; });
    [5, 6, 7, 8].forEach(id => { players[id - 1].status = 'waiting'; players[id - 1].games = 1; });
    const courts = [{ id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() - 60000 }];
    const context = createRuntime(players, courts);

    vm.runInContext('matchCourt(1)', context);
    assertInRuntime(context, 'courts[0].next.length === 4 && courts[0].next.every(player => [5, 6, 7, 8].includes(player.id))', '게임 수가 더 적은 게임 중 선수가 자동 예약에 포함되었습니다.');
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

{
    const players = createPlayers();
    players.forEach(player => { player.status = 'waiting'; player.games = player.id; });
    const courts = [
        { id: 1, type: 'A', active: courtPlayers(players, [1, 2, 3, 4]), next: [], startTime: Date.now() },
        { id: 2, type: 'A', active: courtPlayers(players, [5, 6, 7, 8]), next: [], startTime: Date.now() },
        { id: 3, type: 'A', active: [], next: courtPlayers(players, [9]), startTime: null }
    ];
    const context = createRuntime(players, courts);
    vm.runInContext('matchCourt(1)', context);
    assertInRuntime(context, 'courts[0].next.map(player => player.id).sort((a, b) => a - b).join(",") === "10,11,12,13"', '선수 상태가 대기로 남아 있어도 다른 코트의 진행·예약 배정은 자동 예약에서 제외해야 합니다.');
}

{
    const players = createPlayers().slice(0, 4);
    players.forEach((player, index) => { player.gender = 'M'; player.tier = 5 - index; player.status = 'waiting'; });
    const context = createRuntime(players, [{ id: 1, type: 'M', active: [], next: [], startTime: null }]);

    vm.runInContext('applyMatch(1, [...players], "next")', context);
    assertInRuntime(context, 'courts[0].next.map(player => player.id).join(",") === "1,4,2,3"', '이력이 없으면 정석 밸런스 조합을 선택해야 합니다.');

    vm.runInContext('history = [{ pIds: [1, 4, 2, 3] }]; applyMatch(1, [...players], "next")', context);
    assertInRuntime(context, 'courts[0].next.map(player => player.id).join(",") === "1,3,2,4"', '파트너 중복이 적은 차선 조합을 선택하지 못했습니다.');

    vm.runInContext(`
        history = [
            ...Array.from({ length: 5 }, () => ({ pIds: [1, 4, 90, 91] })),
            ...Array.from({ length: 5 }, () => ({ pIds: [1, 3, 90, 91] }))
        ];
        applyMatch(1, [...players], 'next');
    `, context);
    assertInRuntime(context, 'courts[0].next.map(player => player.id).join(",") === "1,4,2,3"', '페널티 5를 포함한 비용이 같으면 정석 조합을 우선해야 합니다.');

    vm.runInContext('history.push({ pIds: [1, 4, 2, 3] }, { pIds: [1, 3, 2, 4] }); applyMatch(1, [...players], "next")', context);
    assertInRuntime(context, 'courts[0].next.map(player => player.id).join(",") === "1,2,3,4"', '페널티를 더해도 중복 비용이 가장 낮은 세 번째 조합을 선택하지 못했습니다.');

    vm.runInContext(`
        history = [
            ...Array.from({ length: 99 }, () => ({ pIds: [90, 91, 92, 93] })),
            { pIds: [1, 4, 2, 3] },
            ...Array.from({ length: 100 }, () => ({ pIds: [1, 3, 2, 4] }))
        ];
        applyMatch(1, [...players], 'next');
    `, context);
    assertInRuntime(context, 'getScore(1, 4) === 1 && getScore(1, 3) === 0', '100번째 경기는 포함하고 101번째부터는 파트너 계산에서 제외해야 합니다.');
    assertInRuntime(context, 'courts[0].next.map(player => player.id).join(",") === "1,3,2,4"', '100경기 이전의 기록이 팀 편성에 영향을 주었습니다.');
    assertInRuntime(context, 'history.length === 200 && JSON.parse(localStorage.getItem("bm_state_v14")).current.history.length === 200', '매칭 이력 범위를 제한하면서 보관 기록을 삭제했습니다.');
}

{
    const players = createPlayers().slice(0, 10);
    players.forEach((player, index) => {
        player.status = index === 0 || index === 9 ? 'resting' : index < 5 ? 'waiting' : 'playing';
        player.games = index === 0 ? 1 : index === 9 ? 100 : index < 5 ? 5 : 6;
        player.gender = 'M';
    });
    const courts = [
        { id: 1, type: 'M', active: courtPlayers(players, [6, 7, 8, 9]), next: [], startTime: Date.now() },
        { id: 2, type: 'M', active: [], next: [], startTime: null }
    ];
    const context = createRuntime(players, courts);
    assertInRuntime(context, 'getMatchingGameCount(players[0]) === 1', '보정값 없는 기존 데이터는 실제 경기 수로 매칭해야 합니다.');
    vm.runInContext('toggleRestStatus(1)', context);
    assertInRuntime(context, 'players[0].games === 1 && players[0].matchingOffset === 4 && getMatchingGameCount(players[0]) === 5', '휴식 복귀 시 실제 경기 수를 보존하고 활동 선수 평균 5.5를 버림한 5까지 보정해야 합니다.');
    assertInRuntime(context, 'history.length === 0 && players[9].games === 100', '휴식 보정이 경기 기록이나 다른 휴식 선수에게 영향을 주었습니다.');

    vm.runInContext('completeGame(1); openManualMatch(2); [1, 6, 7, 8].forEach(toggleManualSelect); confirmManualMatch(); completeGame(2); completeGame(2)', context);
    assertInRuntime(context, 'players[0].games === 2 && getMatchingGameCount(players[0]) === 6', '복귀 후 한 경기를 마치면 실제 2경기·매칭용 6경기가 되어야 합니다.');
    assertInRuntime(context, 'getPlayerStatistics(1).recordedGames === 1', '통계에 휴식 보정값이 경기 기록으로 포함되었습니다.');
    vm.runInContext('matchCourt(2)', context);
    assertInRuntime(context, 'courts[1].next.map(player => player.id).sort((a, b) => a - b).join(",") === "2,3,4,5"', '복귀 후 경기를 마친 선수가 실제 경기 수가 적다는 이유로 연속 자동 선발되었습니다.');

    const savedPlayers = vm.runInContext('JSON.parse(localStorage.getItem("bm_state_v14")).current.players', context);
    const savedCourts = vm.runInContext('JSON.parse(localStorage.getItem("bm_state_v14")).current.courts', context);
    const reloaded = createRuntime([], [], Object.fromEntries(context.__storage));
    assertInRuntime(reloaded, 'players[0].games === 2 && getMatchingGameCount(players[0]) === 6', '재접속 후 휴식 보정값이 손실되었습니다.');

    // Import the same JSON shape used by exportData, without browser file access.
    reloaded.__backup = JSON.stringify({ players: savedPlayers, courts: savedCourts, history: [] });
    vm.runInContext(`
        FileReader = class { readAsText() { this.onload({ target: { result: __backup } }); } };
        players[0].matchingOffset = 0;
        importData({ files: [{}], value: 'backup.json' });
    `, reloaded);
    assertInRuntime(reloaded, 'players[0].games === 2 && getMatchingGameCount(players[0]) === 6', 'JSON 복구 후 휴식 보정값이 손실되었습니다.');

    vm.runInContext('saveRosterAsMembers(); startNewMeeting(); executeConfirm()', reloaded);
    assertInRuntime(reloaded, 'players.length === 0 && history.length === 0 && courts.every(court => court.active.length === 0 && court.next.length === 0 && court.startTime === null)', '새 모임 시작 시 당일 선수·경기 기록·코트 배정을 비워야 합니다.');
    assertInRuntime(reloaded, 'members.length > 0 && document.getElementById("membersModal").style.display === "flex"', '새 모임 시작 시 저장된 회원에서 참석자를 다시 선택해야 합니다.');
    vm.runInContext('selectVisibleMembers(); loadSelectedMembers()', reloaded);
    assertInRuntime(reloaded, 'players.length === members.length && players.every(player => player.games === 0 && getMatchingGameCount(player) === 0 && player.status === "waiting")', '새 모임 참석자의 실제 경기 수와 휴식 보정값이 함께 초기화되지 않았습니다.');
}

{
    const players = createPlayers().slice(0, 5);
    players.forEach(player => { player.status = 'waiting'; player.games = 5; });
    players[0].status = 'resting';
    players[0].games = 1;
    players[1].games = 1;
    players[1].matchingOffset = 4;
    const context = createRuntime(players, [{ id: 1, type: 'X', active: [], next: [], startTime: null }]);
    vm.runInContext('openPModal(1); document.getElementById("pStatus").value = "waiting"; savePlayer()', context);
    assertInRuntime(context, 'document.getElementById("pStatusField").hidden && players[0].status === "resting" && getMatchingGameCount(players[0]) === 1', '선수 정보 수정에서는 상태 선택을 숨기고 기존 휴식 상태와 보정값을 유지해야 합니다.');
    vm.runInContext('toggleRestStatus(1)', context);
    assertInRuntime(context, 'players[0].games === 1 && getMatchingGameCount(players[0]) === 5', '복귀 버튼을 누르면 다른 선수의 보정값을 포함한 기준을 적용해야 합니다.');
    vm.runInContext('toggleRestStatus(1); toggleRestStatus(1)', context);
    assertInRuntime(context, 'players[0].matchingOffset === 4', '경기 없이 휴식·복귀를 반복하면 보정값이 중복 가산되지 않아야 합니다.');
    vm.runInContext('toggleRestStatus(1); players.slice(1).forEach(player => { player.games = 9; player.matchingOffset = 0; }); toggleRestStatus(1)', context);
    assertInRuntime(context, 'players[0].games === 1 && players[0].matchingOffset === 8 && getMatchingGameCount(players[0]) === 9', '두 번째 긴 휴식 후에는 기존 보정값에 부족분만 추가해야 합니다.');

    vm.runInContext('players[0].games = 10; toggleRestStatus(1); toggleRestStatus(1)', context);
    assertInRuntime(context, 'getMatchingGameCount(players[0]) === 18', '이미 기준보다 많이 경기한 선수의 매칭용 경기 수를 낮추면 안 됩니다.');

    vm.runInContext('players.forEach(player => player.status = "resting"); toggleRestStatus(1)', context);
    assertInRuntime(context, 'getMatchingGameCount(players[0]) === 18', '다른 활동 선수가 없으면 기존 보정값을 유지해야 합니다.');
}

{
    const players = createPlayers().slice(0, 6);
    players.forEach(player => { player.status = 'waiting'; player.games = 5; });
    players[0].games = 1;
    players[0].matchingOffset = 5;
    const context = createRuntime(players, [{ id: 1, type: 'X', active: [], next: [], startTime: null }]);
    vm.runInContext('matchCourt(1)', context);
    assertInRuntime(context, 'courts[0].next.length === 4 && !courts[0].next.some(player => player.id === 1) && courts[0].next.filter(player => player.gender === "M").length === 2', '혼복의 성별별 선발에도 휴식 보정을 적용해야 합니다.');
}

{
    const roster = createPlayers().slice(0, 8);
    const courts = [{id:1, type:'A', active:courtPlayers(roster, [1,2,3,4]), next:courtPlayers(roster, [5,6,7,8]), startTime:1000}];
    const context = createRuntime(roster, courts);
    vm.runInContext('openPModal(1); document.getElementById("pName").value = "수정된 이름"; document.getElementById("pTier").value = "5"; savePlayer()', context);
    assertInRuntime(context, 'courts[0].active[0] === players[0] && courts[0].active[0].name === "수정된 이름" && courts[0].active[0].tier === 5', '재접속으로 분리된 코트의 선수 정보가 명단 수정에 따라 갱신되지 않았습니다.');
    vm.runInContext('openPModal(1); deletePlayer(); executeConfirm()', context);
    assertInRuntime(context, 'players.length === 8 && courts[0].active.length === 4', '진행 중인 선수를 삭제할 수 없어야 합니다.');
    vm.runInContext('openPModal(5); deletePlayer(); executeConfirm()', context);
    assertInRuntime(context, 'players.length === 8 && courts[0].next.length === 4', '예약된 선수를 삭제할 수 없어야 합니다.');

    vm.runInContext('completeGame(1)', context);
    assertInRuntime(context, 'history.length === 1 && courts[0].active[0].id === 5 && players[0].games === 1', '되돌리기 전 종료와 승계가 실행되지 않았습니다.');
    const reloaded = createRuntime([], [], Object.fromEntries(context.__storage));
    vm.runInContext('undoLastAction(); executeConfirm()', reloaded);
    assertInRuntime(reloaded, 'history.length === 0 && players[0].games === 0 && courts[0].startTime === 1000 && courts[0].active.map(p=>p.id).join(",") === "1,2,3,4" && courts[0].next.map(p=>p.id).join(",") === "5,6,7,8"', '새로고침 후 되돌리기가 경기 수·기록·진행·예약·시작 시각을 모두 복원하지 못했습니다.');
    assertInRuntime(reloaded, 'courts[0].active[0] === players[0] && undoState === null', '되돌린 후 선수 참조나 한 단계 제한이 올바르지 않습니다.');
    vm.runInContext('cancelNext(1); openPModal(5); deletePlayer(); executeConfirm()', reloaded);
    assertInRuntime(reloaded, '!players.some(p=>p.id===5)', '예약 해제 후 선수 삭제에 실패했습니다.');
    vm.runInContext('undoLastAction(); executeConfirm()', reloaded);
    assertInRuntime(reloaded, 'players.some(p=>p.id===5) && courts[0].next.length===0', '선수 삭제를 한 단계 되돌리지 못했습니다.');
}

{
    const roster = [{id:1,name:'기존',gender:'M',tier:3,games:6,matchingOffset:0,status:'waiting',lastTime:0,shuttlecock:false}];
    const context = createRuntime(roster, []);
    vm.runInContext('openPModal(); document.getElementById("pName").value = "신규"; savePlayer()', context);
    assertInRuntime(context, 'players[1].games === 0 && getMatchingGameCount(players[1]) === 6 && getPlayerStatistics(players[1].id).recordedGames === 0', '신규 선수의 실제 경기 수와 활동 선수 평균의 초기 매칭 보정이 분리되지 않았습니다.');
    vm.runInContext('openPModal(players[1].id)', context);
    if(!context.__elements.get('playerMatchingInfo').innerText.includes('실제 0경기 · 매칭 기준 6경기')) throw new Error('선수 상세에 실제 경기 수와 매칭 기준이 표시되지 않았습니다.');
    vm.runInContext('document.getElementById("pGames").value = "-1"; savePlayer()', context);
    assertInRuntime(context, 'players[1].games === 0', '음수 경기 수 입력이 허용되었습니다.');

    const bulk = createRuntime(roster, []);
    vm.runInContext('document.getElementById("bulkNames").value = "일괄1\\n일괄2"; document.getElementById("bulkGen").value = "F"; document.getElementById("bulkTier").value = "3"; saveBulkPlayers()', bulk);
    assertInRuntime(bulk, 'players.length === 3 && players.slice(1).every(p=>p.games===0 && getMatchingGameCount(p)===6)', '일괄 등록의 초기 보정은 같은 활동 선수 평균을 사용하고 실제 경기는 0이어야 합니다.');
}

{
    const roster = createPlayers().slice(0,4);
    const context = createRuntime(roster, [{id:1,type:'A',active:courtPlayers(roster,[1,2,3,4]),next:[],startTime:1000}]);
    vm.runInContext('toggleShuttlecock(1)', context);
    const saved = context.__storage.get('bm_state_v14');
    const originalWrite = context.localStorage.setItem;
    context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    vm.runInContext('completeGame(1)', context);
    assertInRuntime(context, 'history.length===0 && courts[0].active.length===4 && players[0].games===0', '저장 실패 시 종료 작업이 메모리에서 취소되지 않았습니다.');
    if(context.__storage.get('bm_state_v14') !== saved || context.__elements.get('storageError').hidden) throw new Error('저장 실패 시 저장 데이터가 변경되거나 지속 오류 안내가 없습니다.');
    if(!context.__elements.get('toast').innerText.includes('저장 실패')) throw new Error('저장 실패 후 성공으로 안내했습니다.');
    context.localStorage.setItem = originalWrite;
    vm.runInContext('completeGame(1)', context);
    assertInRuntime(context, 'history.length===1 && courts[0].active.length===0 && players[0].games===1', '저장 공간 복구 후 작업 재시도에 실패했습니다.');
}

{
    const roster = [{id:1,name:'원본',gender:'M',tier:3,games:6,status:'waiting',lastTime:0}];
    const context = createRuntime(roster, []);
    const savedBeforeInvalidImport = context.__storage.get('bm_state_v14');
    const malformed = [
        {players:{},courts:[]},
        {players:[{...roster[0],name:8}],courts:[]},
        {players:[{...roster[0],games:-1}],courts:[]},
        {players:[roster[0],roster[0]],courts:[]},
        {players:roster,courts:[{id:1,type:'A',active:[{id:99}],next:[],startTime:null}]},
        {players:roster,courts:[],history:[{pIds:[1,2,3,4],scores:[21,-1]}]},
        {players:roster,courts:[],history:[null]}
    ];
    for(const data of malformed) {
        context.__import = data;
        vm.runInContext('importValidatedData(__import)', context);
        assertInRuntime(context, 'players.length===1 && players[0].name==="원본" && history.length===0', '잘못된 백업이 현재 데이터를 덮어썼습니다.');
        if(context.__storage.get('bm_state_v14') !== savedBeforeInvalidImport || context.__storage.has('bm_before_import_v14')) throw new Error('검증 실패 후 저장소가 변경되었습니다.');
    }
    const valid = {players:[{...roster[0],name:'복구본',matchingOffset:2}],courts:[],history:[]};
    context.__import = valid;
    const originalWrite = context.localStorage.setItem;
    context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    vm.runInContext('importValidatedData(__import)', context);
    assertInRuntime(context, 'players[0].name === "원본"', '복구 전 안전 백업 실패 후에도 파일 복구가 실행되었습니다.');
    context.localStorage.setItem = originalWrite;
    vm.runInContext('importValidatedData(__import); toggleShuttlecock(1)', context);
    const reloaded = createRuntime([], [], Object.fromEntries(context.__storage));
    assertInRuntime(reloaded, 'players[0].name === "복구본" && getMatchingGameCount(players[0])===8', '새 저장 형식이나 백업 보정값을 읽지 못했습니다.');
    vm.runInContext('restoreBeforeImport(); executeConfirm()', reloaded);
    assertInRuntime(reloaded, 'players[0].name === "원본" && players[0].games===6', '복구 뒤 다른 작업과 재접속을 해도 복구 전 원본으로 돌아갈 수 있어야 합니다.');
}

{
    const context = createRuntime([], [], {'bm_state_v14':'{broken json'});
    if(context.__elements.get('storageError').hidden) throw new Error('손상된 저장 데이터 안내가 없습니다.');
    vm.runInContext('addCourt()', context);
    assertInRuntime(context, 'courts.length===0 && storageBlocked', '손상된 원본을 빈 상태로 덮어쓰면 안 됩니다.');
    if(context.__storage.get('bm_state_v14') !== '{broken json') throw new Error('손상된 저장 원본이 사라졌습니다.');
    vm.runInContext('importValidatedData({players:[],courts:[],history:[]})', context);
    assertInRuntime(context, '!storageBlocked && storageError === ""', '정상 백업으로 손상 상태를 복구하지 못했습니다.');
}

{
    const roster = createPlayers();
    const context = createRuntime(roster, [
        {id:1,type:'A',active:courtPlayers(roster,[1,2,3,4]),next:[],startTime:1000},
        {id:2,type:'A',active:courtPlayers(roster,[9,10,11,12]),next:courtPlayers(roster,[5,6,7,8]),startTime:1000},
        {id:3,type:'A',active:[],next:[],startTime:null}
    ]);
    vm.runInContext('openManualMatch(1)', context);
    let list = context.__elements.get('manualList').innerHTML;
    if(!list.includes('toggleManualSelect(9)') || !list.includes('toggleManualSelect(13)') || !list.includes('2번 코트 경기 중')) throw new Error('수동 매칭에 대기·게임 중 선수가 함께 표시되지 않았습니다.');
    vm.runInContext('toggleManualSelect(9)', context);
    vm.runInContext('[1,2,3].forEach(toggleManualSelect)', context);
    if(context.__elements.get('manualConfirmButton').disabled) throw new Error('선택한 네 명으로 배정할 수 없습니다.');
    vm.runInContext('toggleManualSelect(9)', context);
    if(!context.__elements.get('manualConfirmButton').disabled) throw new Error('선택 해제 후 3명으로 확정할 수 있습니다.');

    vm.runInContext('closeManualModal(); openSwap(2,"next",0)', context);
    list = context.__elements.get('swapList').innerHTML;
    if(!list.includes('doSwap(1)') || !list.includes('doSwap(13)') || !list.includes('1번 코트 경기 중')) throw new Error('다음 예약 교체에 대기·게임 중 선수가 함께 표시되지 않았습니다.');
    vm.runInContext('openSwap(1,"active",0)', context);
    list = context.__elements.get('swapList').innerHTML;
    if(list.includes('doSwap(1)') || !list.includes('doSwap(13)')) throw new Error('진행 중 경기의 교체에는 대기 선수만 표시해야 합니다.');

    vm.runInContext('closeSwapModal(); courts[1].next[0] = players[0]; render()', context);
    let courtHtml = context.__elements.get('courtGrid').innerHTML;
    if(!courtHtml.includes('비어 있음') || !courtHtml.includes('경기 종료 · 다음 경기 대기') || !courtHtml.includes('선수01 (현재 1번 코트) 경기 종료 후 시작할 수 있습니다.')) throw new Error('코트 상태 또는 다음 경기 대기 사유가 표시되지 않았습니다.');
    vm.runInContext('completeGame(2)', context);
    courtHtml = context.__elements.get('courtGrid').innerHTML;
    if(!/onclick="endGame\(2\)" disabled>다른 코트 종료 대기/.test(courtHtml)) throw new Error('다른 코트의 종료를 기다리는 시작 버튼이 비활성화되지 않았습니다.');
    const reloaded = createRuntime([], [], Object.fromEntries(context.__storage));
    if(!reloaded.__elements.get('undoButton').title.includes('2번 코트 경기 종료')) throw new Error('재접속 후 되돌리기 버튼의 작업 설명이 유지되지 않았습니다.');
    vm.runInContext('undoLastAction()', reloaded);
    if(!reloaded.__elements.get('confirmMsg').innerText.includes('2번 코트 경기 종료')) throw new Error('되돌리기 확인에 작업 대상이 없습니다.');
    vm.runInContext('completeGame(1)', context);
    courtHtml = context.__elements.get('courtGrid').innerHTML;
    if(!courtHtml.includes('시작 가능') || /onclick="endGame\(2\)" disabled/.test(courtHtml)) throw new Error('다른 코트 경기 종료 후 시작 상태가 갱신되지 않았습니다.');

    vm.runInContext('players[0].matchingOffset=4; toggleRosterActionSheet(1)', context);
    if(!context.__elements.get('rosterActionSheet').innerHTML.includes('실제 1경기 · 매칭 기준 5경기')) throw new Error('선수 선택 영역에 매칭 기준이 표시되지 않았습니다.');
}

{
    const roster = createPlayers().slice(0,12);
    const context = createRuntime(roster, [
        {id:1,type:'A',active:courtPlayers(roster,[1,2,3,4]),next:courtPlayers(roster,[5,6,7,8]),startTime:1000},
        {id:2,type:'A',active:courtPlayers(roster,[9,10,11,12]),next:[],startTime:1000}
    ]);
    vm.runInContext('let testNow = 2000; Date.now = () => testNow; endGame(1); endGame(1)', context);
    assertInRuntime(context, 'history.length===1 && courts[0].active[0].id===5 && players[4].games===4', '종료 연속 입력으로 새로 승계한 경기까지 종료되었습니다.');
    if(!/onclick="endGame\(1\)" disabled/.test(context.__elements.get('courtGrid').innerHTML)) throw new Error('승계 직후 종료 버튼이 잠기지 않았습니다.');
    vm.runInContext('endGame(2)', context);
    assertInRuntime(context, 'history.length===2 && courts[1].active.length===0', '한 코트의 연속 입력 방지가 다른 코트 조작까지 차단했습니다.');
    vm.runInContext('testNow=2999; endGame(1)', context);
    assertInRuntime(context, 'history.length===2 && courts[0].active.length===4', '1초가 지나기 전에 종료가 허용되었습니다.');
    vm.runInContext('testNow=3000; endGame(1)', context);
    assertInRuntime(context, 'history.length===3 && courts[0].active.length===0 && players[4].games===5', '잠금 해제 후 정상 종료가 차단되었습니다.');
}

{
    const roster = createPlayers().slice(0,4);
    roster.forEach(player=>{player.status='waiting';player.games=0;});
    const context = createRuntime(roster, [{id:1,type:'A',active:[],next:[],startTime:null}]);
    vm.runInContext('let testNow=10000; Date.now=()=>testNow; openManualMatch(1); [1,2,3,4].forEach(toggleManualSelect); confirmManualMatch()', context);
    assertInRuntime(context, 'courts[0].active.length===0 && courts[0].next.length===4 && courts[0].startTime===null && history.length===0 && players.every(p=>p.games===0 && p.status==="reserved")', '수동 배정만으로 경기나 타이머가 시작되었습니다.');
    const write = context.localStorage.setItem;
    context.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
    vm.runInContext('endGame(1)', context);
    assertInRuntime(context, '!isCourtActionLocked(1) && courts[0].active.length===0 && courts[0].next.length===4', '저장 실패 후 시작을 바로 재시도할 수 없습니다.');
    context.localStorage.setItem=write;
    vm.runInContext('endGame(1); endGame(1)', context);
    assertInRuntime(context, 'courts[0].active.length===4 && courts[0].startTime===10000 && history.length===0', '시작 버튼 연속 입력으로 방금 시작한 경기가 종료되었습니다.');
    vm.runInContext('testNow=11000; endGame(1)', context);
    assertInRuntime(context, 'history.length===1 && players.every(p=>p.games===1)', '별도 시작 후 정상 종료가 잘못 처리되었습니다.');
}

{
    const roster=createPlayers().slice(0,8);
    roster.slice(4).forEach(p=>p.status='waiting');
    const context=createRuntime(roster,[
        {id:1,type:'A',active:courtPlayers(roster,[1,2,3,4]),next:[],startTime:1000},
        {id:2,type:'A',active:[],next:[],startTime:null}
    ]);
    vm.runInContext('openManualMatch(2); [1,2,5,6].forEach(toggleManualSelect); confirmManualMatch(); endGame(2)',context);
    assertInRuntime(context,'courts[1].active.length===0 && courts[1].next.length===4 && history.length===0','빈 코트에 수동 예약한 다른 코트 경기 중 선수가 즉시 시작되었습니다.');
    vm.runInContext('endGame(1); endGame(2)',context);
    assertInRuntime(context,'courts[1].active.length===4 && courts[1].next.length===0 && history.length===1','다른 코트 종료 후 수동 예약의 시작이 차단되었습니다.');
}

function transferRuntime(withReservation = true) {
    const roster = Array.from({length:16}, (_, i) => ({
        ...createPlayers()[i % 13], id:i+1, name:`선수${i+1}`,
        waitingSince:i*100, status:i<4 || (i>=8 && i<12) ? 'playing' : 'reserved'
    }));
    if(!withReservation) roster.slice(12).forEach(p => p.status='waiting');
    return createRuntime(roster, [
        {id:1,type:'A',active:courtPlayers(roster,[1,2,3,4]),next:courtPlayers(roster,[5,6,7,8]),startTime:1000},
        {id:2,type:'A',active:courtPlayers(roster,[9,10,11,12]),next:withReservation?courtPlayers(roster,[13,14,15,16]):[],startTime:2000}
    ]);
}

test('두 예약의 코트 변경은 팀 순서와 진행 경기·타이머·선수 상태를 유지하고 재접속·되돌리기를 지원한다', () => {
    const context = transferRuntime();
    const run = code => vm.runInContext(code,context);
    const before = run('serializeState()');
    const untouched = run('JSON.stringify({players,history,active:courts.map(c=>[c.active,c.startTime,c.type])})');
    run('openTransferNext(1)');
    assert.ok(context.__elements.get('transferCourtSelect').innerHTML.includes('예약 있음'));
    assert.match(html, /id="transferConfirmButton"[^>]*>코트 변경<\/button>/);
    run('confirmTransferNext(); confirmTransferNext()');
    assert.equal(run('courts[0].next.map(p=>p.id).join(",")'),'13,14,15,16');
    assert.equal(run('courts[1].next.map(p=>p.id).join(",")'),'5,6,7,8');
    assert.equal(run('JSON.stringify({players,history,active:courts.map(c=>[c.active,c.startTime,c.type])})'),untouched);
    assert.ok(context.__elements.get('toast').innerText.includes('예약 코트를 변경했습니다'));
    const reloaded = createRuntime([],[],Object.fromEntries(context.__storage));
    assert.equal(vm.runInContext('serializeState()',reloaded),run('serializeState()'));
    vm.runInContext('undoLastAction(); onConfirmAction()',reloaded);
    assert.equal(vm.runInContext('serializeState()',reloaded),before);
});

test('대상에 예약이 없으면 기존 이동 동작을 유지한다', () => {
    const context = transferRuntime(false);
    vm.runInContext('openTransferNext(1); confirmTransferNext()',context);
    assertInRuntime(context,'courts[0].next.length===0 && courts[1].next.map(p=>p.id).join(",")==="5,6,7,8"','빈 다음 대기로 이동하지 못했습니다.');
    assert.ok(context.__elements.get('transferHelp').innerText.includes('2번 코트로 옮깁니다'));
});

test('대상 코트 선택에 따라 예약을 옮길 코트 안내가 바뀐다', () => {
    const context = transferRuntime();
    vm.runInContext('courts.push({id:3,type:"A",active:[],next:[],startTime:null}); openTransferNext(1)',context);
    context.__elements.get('transferCourtSelect').value='3';
    vm.runInContext('updateTransferNextPreview()',context);
    assert.ok(context.__elements.get('transferHelp').innerText.includes('3번 코트로 옮깁니다'));
    context.__elements.get('transferCourtSelect').value='2';
    vm.runInContext('updateTransferNextPreview()',context);
    assert.ok(context.__elements.get('transferHelp').innerText.includes('2번 코트의 예약은 1번 코트로'));
});

test('코트 변경 저장 실패는 양쪽 예약을 모두 복구한다', () => {
    const context = transferRuntime();
    const before = vm.runInContext('serializeState()',context);
    vm.runInContext('openTransferNext(1)',context);
    context.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
    vm.runInContext('confirmTransferNext()',context);
    assert.equal(vm.runInContext('serializeState()',context),before);
    assert.ok(context.__elements.get('toast').innerText.includes('저장 실패'));
});

test('출발 예약·대상 코트가 사라지거나 자기 코트를 선택하면 배정을 변경하지 않는다', () => {
    for(const change of ['courts[0].next=[]','courts.pop()','document.getElementById("transferCourtSelect").value="1"']) {
        const context=transferRuntime();
        vm.runInContext('openTransferNext(1); '+change,context);
        const before=vm.runInContext('serializeState()',context);
        vm.runInContext('confirmTransferNext()',context);
        assert.equal(vm.runInContext('serializeState()',context),before);
    }
});

test('코트를 변경한 예약에 다른 코트 경기 중 선수가 있으면 시작을 보류한다', () => {
    const context=transferRuntime();
    vm.runInContext('courts[1].next[0]=players[8]; syncPlayerAssignmentStatuses(players.map(p=>p.id)); saveAction("테스트 배정"); openTransferNext(1); confirmTransferNext(); completeGame(1)',context);
    assertInRuntime(context,'courts[0].active.length===0 && courts[0].next[0].id===9 && courts[1].active[0].id===9','코트 변경 후 다른 코트 경기 중 선수의 중복 출전을 허용했습니다.');
    assert.ok(context.__elements.get('toast').innerText.includes('승계 불가'));
    vm.runInContext('completeGame(2); completeGame(1)',context);
    assertInRuntime(context,'courts[0].active.map(p=>p.id).join(",")==="9,14,15,16" && courts[0].next.length===0','다른 코트 경기 종료 후 코트를 변경한 예약을 시작하지 못했습니다.');
});

console.log('매칭·데이터 보호·코트 상태·연속 입력 방지·수동 배정 후 시작 테스트 통과');
