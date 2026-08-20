const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
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

    vm.runInContext('doSwap(1)', context);
    assertInRuntime(context, 'courts.find(court => court.id === 2).next[0].id === 1', '다음 대기 선수 교체에 실패했습니다.');
    assertInRuntime(context, 'players.find(player => player.id === 1).status === "playing"', '중복 배정된 선수의 게임 중 상태가 유지되지 않았습니다.');
    assertInRuntime(context, 'players.find(player => player.id === 5).status === "waiting"', '교체된 기존 선수가 대기로 돌아가지 않았습니다.');
    assertInRuntime(context, 'renderChip(courts.find(court => court.id === 2), "next", 0).includes("게임중")', '다음 대기 카드에 게임 중 표시가 없습니다.');

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

console.log('선수 교체·수동 매칭·승계 상태 테스트 통과');
