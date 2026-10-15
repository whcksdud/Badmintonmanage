const vm = require('node:vm');
const assert = require('node:assert/strict');
const { runApp } = require('./helpers/app-runtime');
const roster = Array.from({length:4}, (_, i) => ({id:i + 1, name:`선수${i + 1}`, gender:'M', tier:3, games:0, status:'waiting', lastTime:0}));
const state = {players:roster, courts:[{id:1, type:'A', active:[], next:[], startTime:null}], history:[], members:[]};

function runtime(storage = new Map([['bm_state_v14', JSON.stringify({current:state, previous:state, undoLabel:'기존 작업'})]]), now = 100000) {
    const elements = new Map();
    const intervals = [];
    const clock = {now};
    class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
    const element = () => ({value:'', style:{}, classList:{toggle(){}, add(){}, remove(){}}, setAttribute(){}, addEventListener(){}, focus(){}, click(){}});
    const context = vm.createContext({
        console, Blob, URL, Date:FakeDate, navigator:{},
        document:{getElementById(id) { if(!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement:element, addEventListener(){}},
        window:{navigator:{}, matchMedia:() => ({matches:false}), addEventListener(){}},
        localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value)},
        setTimeout(){}, clearTimeout(){}, setInterval(callback){ intervals.push(callback); }
    });
    runApp(context);
    return {context, storage, clock, elements, run:code => vm.runInContext(code, context), tick:() => intervals.forEach(fn => fn())};
}

let app = runtime();
assert.equal(app.run('players.every(p => p.waitingSince === 100000 && p.lastTime === 0)'), true, '이전 데이터는 현재부터 계산하고 기존 정렬 기준을 바꾸지 않습니다.');
assert.equal(JSON.parse(app.storage.get('bm_state_v14')).current.players[0].waitingSince, 100000);
assert.equal(app.run('undoLabel'), '기존 작업');
assert.equal(app.run('JSON.parse(undoState).players[0].waitingSince'), 100000, '마이그레이션 시 기존 되돌리기를 유지합니다.');
app = runtime(app.storage, 165000);
assert.equal(app.run('formatWaitingTime(players[0])'), '대기 1분', '재접속 시 대기 시간을 유지하고 초는 표시하지 않습니다.');
const beforeTick = app.storage.get('bm_state_v14');
app.tick();
assert.equal(app.elements.get('waiting-time-1').innerText, '대기 1분');
assert.equal(app.storage.get('bm_state_v14'), beforeTick, '표시 갱신은 저장이나 되돌리기를 변경하지 않습니다.');
app.run('setPlayerAvailability(players[0], "waiting"); saveAction("정보 수정")');
assert.equal(app.run('players[0].waitingSince'), 100000, '대기 중 정보 수정은 시간을 초기화하지 않습니다.');

app.run('toggleRestStatus(1)');
assert.equal(app.run('players[0].waitingSince'), null);
assert.equal(app.elements.get('waitList').innerHTML.includes('id="waiting-time-1"'), false, '휴식 중에는 표시하지 않습니다.');
app.clock.now = 220000;
app.run('toggleRestStatus(1)');
assert.equal(app.run('players[0].waitingSince'), 220000);
app.clock.now = 240000;
app.run('openManualMatch(1); [1,2,3,4].forEach(toggleManualSelect); confirmManualMatch()');
assert.equal(app.run('players.every(p => p.status === "reserved") && players[0].waitingSince === 220000 && players[1].waitingSince === 100000'), true, '예약해도 원래 대기 시간을 유지합니다.');
assert.equal(app.elements.get('waitList').innerHTML.includes('id="waiting-time-1"'), true, '예약됨에도 대기 시간을 표시합니다.');
app.clock.now = 280000;
app.tick();
assert.equal(app.elements.get('waiting-time-1').innerText, '대기 1분');
app.run('cancelNext(1)');
assert.equal(app.run('players[0].status === "waiting" && players[0].waitingSince === 220000'), true, '예약 취소도 대기 시간을 초기화하지 않습니다.');
app.run('openManualMatch(1); [1,2,3,4].forEach(toggleManualSelect); confirmManualMatch(); completeGame(1)');
assert.equal(app.run('players.every(p => p.status === "playing" && p.waitingSince === null)'), true);
assert.equal(app.elements.get('waitList').innerHTML.includes('id="waiting-time-1"'), false, '게임 중에는 표시하지 않습니다.');
app.clock.now = 380000;
app.run('completeGame(1)');
assert.equal(app.run('players.every(p => p.status === "waiting" && p.waitingSince === 380000 && p.games === 1)'), true, '경기 종료 후 새로 계산합니다.');
app.clock.now = 400000;
app.run('toggleRestStatus(1); undoLastAction(); executeConfirm()');
assert.equal(app.run('players[0].waitingSince'), 380000, '되돌리기는 원래 대기 시작 시각을 복구합니다.');

const backup = app.run('serializeState()');
app.clock.now = 440000;
app.context.backup = JSON.parse(backup);
assert.equal(app.run('importValidatedData(backup)'), true);
assert.equal(app.run('players[0].waitingSince'), 380000);
app.context.invalid = JSON.parse(backup);
for(const invalidTime of [-1, 'yesterday', {}]) {
    app.context.invalid.players[0].waitingSince = invalidTime;
    const before = app.run('serializeState()');
    assert.equal(app.run('importValidatedData(invalid)'), false);
    assert.equal(app.run('serializeState()'), before);
}
app.context.legacy = JSON.parse(backup);
app.context.legacy.players.forEach(p => { delete p.waitingSince; });
assert.equal(app.run('importValidatedData(legacy)'), true);
assert.equal(app.run('players[0].waitingSince'), 440000);

const originalWrite = app.context.localStorage.setItem;
app.context.localStorage.setItem = () => { throw new Error('quota'); };
app.run('toggleRestStatus(1)');
assert.equal(app.run('players[0].status === "waiting" && players[0].waitingSince === 440000'), true, '저장 실패 시 상태와 대기 시각을 함께 되돌립니다.');
app.context.localStorage.setItem = originalWrite;
app.run('saveRosterAsMembers(); startNewMeeting(); executeConfirm()');
app.clock.now = 500000;
app.run('selectVisibleMembers(); loadSelectedMembers()');
assert.equal(app.run('players.length === 4 && players.every(p => p.waitingSince === 500000)'), true, '새 모임에서 참석자를 불러오면 시간을 새로 시작합니다.');
app.clock.now = 490000;
assert.equal(app.run('formatWaitingTime(players[0])'), '대기 0분', '기기 시계가 뒤로 바뀌어도 음수를 표시하지 않습니다.');

const swapApp = runtime();
swapApp.run('players.push({id:5, name:"교체후보", gender:"F", tier:1, games:0, status:"waiting", lastTime:0}); saveAction("교체 후보 등록"); openManualMatch(1); [1,2,3,4].forEach(toggleManualSelect); confirmManualMatch(); openSwap(1, "next", 0)');
assert.equal(swapApp.elements.get('swapList').innerHTML.includes('id="swap-waiting-time-5"'), true, '선수 교체 목록에 대기 시간을 표시합니다.');
swapApp.clock.now = 280000;
swapApp.tick();
assert.equal(swapApp.elements.get('swap-waiting-time-5').innerText, '대기 3분', '교체 창을 열어둔 상태에서도 분 단위로 갱신합니다.');
swapApp.run('doSwap(5)');
assert.equal(swapApp.run('players[4].status === "reserved" && players[4].waitingSince === 100000 && players[0].waitingSince === 100000'), true, '예약 선수 교체 시 두 선수 모두 대기 시간을 이어갑니다.');
swapApp.run('completeGame(1); openSwap(1, "active", 0)');
assert.equal(swapApp.elements.get('swapList').innerHTML.includes('id="swap-waiting-time-1"'), true);
assert.equal(swapApp.elements.get('swapList').innerHTML.includes('id="swap-waiting-time-5"'), false, '경기 중인 선수의 대기 시간을 표시하지 않습니다.');

const manualApp = runtime();
manualApp.run('openManualMatch(1)');
assert.equal(manualApp.elements.get('manualList').innerHTML.includes('id="manual-waiting-time-1"'), true, '수동 매칭 후보에 대기 시간을 표시합니다.');
manualApp.clock.now = 280000;
manualApp.tick();
assert.equal(manualApp.elements.get('manual-waiting-time-1').innerText, '대기 3분');
manualApp.run('toggleManualSelect(1)');
assert.equal(manualApp.elements.get('manualList').innerHTML.includes('대기 3분'), true, '선택 후 다시 그릴 때 대기 시간이 유지됩니다.');
manualApp.run('[2,3,4].forEach(toggleManualSelect); confirmManualMatch()');
assert.equal(manualApp.run('players.every(p => p.status === "reserved" && p.waitingSince === 100000)'), true);
manualApp.run('completeGame(1); openManualMatch(1)');
assert.equal(manualApp.elements.get('manualList').innerHTML.includes('manual-waiting-time-'), false, '게임 중인 수동 매칭 후보는 대기 시간을 표시하지 않습니다.');
assert.equal(manualApp.elements.get('manualList').innerHTML.includes('1번 코트 경기 중'), true);

console.log('분 단위 대기 시간·예약 유지·재접속·휴식·경기 종료·되돌리기·백업·저장 실패·새 모임·선수 교체·수동 매칭 테스트 통과');
