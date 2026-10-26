const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');
const { runApp, html } = require('./helpers/app-runtime');

const player = (id, extra = {}) => ({id,name:`선수${id}`,gender:'M',tier:3,games:0,lastTime:0,status:'waiting',waitingSince:id*100,...extra});
const court = (id, extra = {}) => ({id,type:'A',active:[],next:[],startTime:null,...extra});
const roster = count => Array.from({length:count},(_,i)=>player(i+1));
function runtime(players=[], courts=[court(1)], saved=null) {
    const storage = new Map(saved || [['bm_state_v14',JSON.stringify({current:{players,courts,history:[],members:[]},previous:null})]]);
    const elements = new Map();
    const element = () => ({value:'',innerText:'',innerHTML:'',style:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},addEventListener(){},focus(){},click(){}});
    class Clock extends Date { static now(){return 10000000;} }
    const math = Object.create(Math); math.random=()=>0;
    const context = vm.createContext({console,Blob,URL,Date:Clock,Math:math,navigator:{},
        document:{getElementById(id){if(!elements.has(id)) elements.set(id,element());return elements.get(id);},createElement:element,addEventListener(){}},
        window:{navigator:{},matchMedia:()=>({matches:false}),addEventListener(){}},
        localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
        setTimeout(){},clearTimeout(){},setInterval(){}});
    runApp(context);
    return {context,storage,elements,run:code=>vm.runInContext(code,context),json:code=>JSON.parse(vm.runInContext(`JSON.stringify(${code})`,context)),set:(id,value)=>{context.document.getElementById(id).value=String(value);}};
}

test('대기 코트 추가는 기존 일반 코트와 번호를 유지하며 같은 시각 연속 추가도 구분한다',()=>{
    const app=runtime([], [court(1),court(2)]);
    app.run('addCourt(); addCourt()');
    assert.equal(app.run('courts.length'),4);
    assert.equal(app.run('courts.filter(c=>!isWaitingCourt(c)).length'),2);
    assert.equal(app.run('new Set(courts.map(c=>c.id)).size'),4);
    assert.deepEqual(app.json('courts.map(c=>courtTitle(c.id))'),['코트 1','코트 2','대기 코트 1','대기 코트 2']);
    assert.equal(app.run('courts.slice(2).every(c=>isWaitingCourt(c)&&!c.active.length&&!c.next.length&&c.startTime===null)'),true);
    assert.match(html,/id="addCourtButton"[^>]*>[\s\S]*?대기 코트 추가<\/button>/);
    const reloaded=runtime([],[],app.storage);
    assert.equal(reloaded.run('courts[2].isWaiting'),true);
    reloaded.run('undoLastAction(); executeConfirm()');
    assert.equal(reloaded.run('courts.length'),3);
});

test('대기 코트의 자동 편성은 대기 선수 우선·경기 중 보충을 유지하고 경기를 시작하지 않는다',()=>{
    const list=roster(7); list.slice(0,4).forEach(p=>p.status='playing'); list[6].status='resting';
    const app=runtime(list,[court(1,{active:list.slice(0,4),startTime:1000}),court(2,{isWaiting:true})]);
    app.run('matchCourt(2)');
    const ids=app.json('courts[1].next.map(p=>p.id)');
    assert.equal(ids.length,4);
    assert.ok(ids.includes(5)&&ids.includes(6)&&!ids.includes(7));
    assert.equal(app.run('courts[1].active.length===0&&courts[1].startTime===null&&history.length===0'),true);
    assert.equal(app.run('players.slice(0,4).every(p=>p.status==="playing"&&p.games===0)'),true);
    const before=app.run('serializeState()');
    app.run('matchCourt(1); endGame(2); completeGame(2); applyMatch(2, players.slice(0,4), "active")');
    assert.equal(app.run('serializeState()'),before,'중복 예약과 대기 코트 경기 시작을 차단한다');
});

test('대기 코트 수동 편성·선수 교체·취소는 현재 경기와 선수 대기 시각을 보존한다',()=>{
    const list=roster(8); list.slice(0,4).forEach(p=>p.status='playing');
    const app=runtime(list,[court(1,{active:list.slice(0,4),startTime:1000}),court(2,{isWaiting:true})]);
    app.run('openManualMatch(2); [1,5,6,7].forEach(toggleManualSelect); confirmManualMatch()');
    assert.equal(app.run('courts[1].next.length'),4);
    assert.equal(app.run('players[0].status'), 'playing');
    app.run('openSwap(2,"next",courts[1].next.findIndex(p=>p.id===7)); doSwap(8)');
    assert.equal(app.run('courts[1].next.some(p=>p.id===8)&&players[6].status==="waiting"'),true);
    app.run('cancelNext(2)');
    assert.equal(app.run('courts[1].next.length===0&&courts[0].startTime===1000'),true);
    assert.equal(app.run('players.slice(4).every(p=>p.waitingSince===p.id*100)'),true);
});

test('대기 코트에서 실제 코트로만 배정하고 현재 경기·팀 순서·타이머를 유지한 뒤 종료 시 승계한다',()=>{
    const list=roster(8); list.slice(0,4).forEach(p=>p.status='playing'); list.slice(4).forEach(p=>p.status='reserved');
    const app=runtime(list,[court(1,{active:list.slice(0,4),startTime:1000}),court(2,{isWaiting:true,next:list.slice(4)}),court(3,{isWaiting:true})]);
    app.run('openTransferNext(2)');
    assert.ok(!app.elements.get('transferCourtOptions').innerHTML.includes('transfer-court-3'));
    assert.equal(app.elements.get('transferConfirmButton').innerText,'대기 입장');
    app.set('transferCourtSelect',1); app.run('confirmTransferNext()');
    assert.deepEqual(app.json('courts[0].next.map(p=>p.id)'),[5,6,7,8]);
    assert.equal(app.run('courts[1].next.length===0&&courts[0].startTime===1000&&history.length===0'),true);
    app.run('completeGame(1)');
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[5,6,7,8]);
    assert.equal(app.run('history.length===1&&players.slice(0,4).every(p=>p.games===1)'),true);
});

test('빈 실제 코트에 배정한 경기 중 선수는 원래 경기 종료 전에는 입장하지 않는다',()=>{
    const list=roster(6); list.slice(0,4).forEach(p=>p.status='playing');
    const app=runtime(list,[court(1,{active:list.slice(0,4),startTime:1000}),court(2),court(3,{isWaiting:true})]);
    app.run('matchCourt(3); openTransferNext(3)');
    app.set('transferCourtSelect',2); app.run('confirmTransferNext(); completeGame(2)');
    assert.equal(app.run('courts[1].active.length===0&&courts[1].next.length===4'),true);
    app.run('completeGame(1); completeGame(2)');
    assert.equal(app.run('courts[1].active.length===4&&courts[1].next.length===0'),true);
});

test('빈 코트에 기존 예약이 있으면 바로 입장하고 기존 예약을 대기 코트로 옮겨 보존한다',()=>{
    const list=roster(8);list.forEach(p=>p.status='reserved');
    const app=runtime(list,[court(1,{next:list.slice(0,4)}),court(2,{isWaiting:true,next:list.slice(4)})]);
    app.run('openTransferNext(2)');
    assert.equal(app.elements.get('transferConfirmButton').innerText,'경기 입장 · 예약 맞바꾸기');
    app.run('confirmTransferNext()');
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[5,6,7,8]);
    assert.deepEqual(app.json('courts.map(c=>c.next.map(p=>p.id))'),[[],[1,2,3,4]]);
    const reloaded=runtime([],[],app.storage);
    assert.equal(reloaded.run('courts[1].isWaiting&&players.slice(0,4).every(p=>p.status==="reserved")&&players.slice(4).every(p=>p.status==="playing")'),true);
    reloaded.run('undoLastAction(); executeConfirm()');
    assert.deepEqual(reloaded.json('courts.map(c=>c.next.map(p=>p.id))'),[[1,2,3,4],[5,6,7,8]]);
});

test('대기 코트 추가·배정 저장 실패와 삭제는 원래 선수·코트 상태를 보존한다',()=>{
    const list=roster(4); list.forEach(p=>p.status='reserved');
    const app=runtime(list,[court(1),court(2,{isWaiting:true,next:list})]);
    const before=app.run('serializeState()');
    app.context.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
    app.run('addCourt()'); assert.equal(app.run('serializeState()'),before);
    app.run('addCourt(false)'); assert.equal(app.run('serializeState()'),before);
    app.run('openTransferNext(2); confirmTransferNext()'); assert.equal(app.run('serializeState()'),before);
    app.context.localStorage.setItem=(key,value)=>app.storage.set(key,value);
    app.run('delCourt(2); executeConfirm()');
    assert.equal(app.run('courts.length===1&&players.every(p=>p.status==="waiting")'),true);
});

test('백업은 대기 코트 구분을 유지하고 경기·타이머가 있는 잘못된 대기 코트를 거절한다',()=>{
    const app=runtime();
    const base={players:roster(4),courts:[court(1,{isWaiting:true})],history:[]};
    app.context.backup=base;
    app.run('importValidatedData(backup)');
    assert.equal(app.run('courts[0].isWaiting'),true);
    for(const extra of [{isWaiting:'true'},{active:base.players},{startTime:1000}]) {
        app.context.backup={...base,courts:[court(1,{isWaiting:true,...extra})]};
        assert.throws(()=>app.run('validateImportData(backup)'));
    }
    assert.equal(runtime([],[],app.storage).run('courts[0].isWaiting'),true);
});

test('대기 코트는 편성·배정만 표시하고 경기 시작·종료·타이머를 제공하지 않는다',()=>{
    const list=roster(4);list.forEach(p=>p.status='reserved');
    const app=runtime(list,[court(1,{isWaiting:true,next:list})]);
    const view=app.elements.get('courtGrid').innerHTML;
    assert.ok(view.includes('대기 코트 1')&&view.includes('코트 배정')&&view.includes('편성 취소'));
    assert.ok(!view.includes('endGame(')&&!view.includes('id="timer-'));
    assert.ok(app.run('renderRosterSummary(players[0])').includes('대기 코트 1 편성'));
});

test('일반 코트 추가 버튼은 대기 코트와 번호를 따로 매기고 재접속·되돌리기를 지원한다',()=>{
    const app=runtime();
    app.run('addCourt(); addCourt(false); addCourt()');
    assert.deepEqual(app.json('courts.map(c=>courtTitle(c.id))'),['코트 1','대기 코트 1','코트 2','대기 코트 2']);
    assert.equal(app.run('courts[2].isWaiting'),false);
    assert.ok(app.elements.get('courtGrid').innerHTML.includes('코트 2 자율 자동 매칭'));
    assert.match(html,/id="addRegularCourtButton"[^>]*onclick="[^"]*addCourt\(false\)[^"]*"[^>]*>[\s\S]*?일반 코트 추가<\/button>/);
    const reloaded=runtime([],[],app.storage);
    assert.equal(reloaded.run('courts[2].isWaiting'),false);
    reloaded.run('undoLastAction(); executeConfirm()');
    assert.deepEqual(reloaded.json('courts.map(c=>courtTitle(c.id))'),['코트 1','대기 코트 1','코트 2']);
});

test('대기 코트에서 빈 일반 코트로 입장하면 한 번의 저장으로 경기와 타이머를 시작하고 되돌릴 수 있다',()=>{
    const list=roster(4);list.forEach(p=>p.status='reserved');
    const app=runtime(list,[court(1),court(2,{isWaiting:true,next:list})]);
    const before=app.run('serializeState()');
    app.run('openTransferNext(2)');
    assert.equal(app.elements.get('transferConfirmButton').innerText,'경기 입장');
    app.run('confirmTransferNext(); confirmTransferNext()');
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[1,2,3,4]);
    assert.equal(app.run('courts[0].startTime'),10000000);
    assert.equal(app.run('courts[0].next.length===0&&courts[1].next.length===0&&history.length===0'),true);
    assert.equal(app.run('players.every(p=>p.status==="playing"&&p.games===0&&p.waitingSince===null)'),true);
    const reloaded=runtime([],[],app.storage);
    assert.equal(reloaded.run('courts[0].active[0]===players[0]&&courts[0].startTime===10000000'),true);
    reloaded.run('undoLastAction(); executeConfirm()');
    assert.equal(reloaded.run('serializeState()'),before);
});

test('배정할 코트 선택을 바꾸면 경기 입장·대기 입장 버튼이 코트와 선수의 현재 상태를 따른다',()=>{
    const list=roster(8);list.slice(0,4).forEach(p=>p.status='playing');list.slice(4).forEach(p=>p.status='reserved');
    const app=runtime(list,[court(1,{active:list.slice(0,4),startTime:1000}),court(2),court(3,{isWaiting:true,next:list.slice(4)})]);
    app.run('openTransferNext(3)');
    assert.equal(app.elements.get('transferConfirmButton').innerText,'대기 입장');
    app.set('transferCourtSelect',2);app.run('updateTransferNextPreview()');
    assert.equal(app.elements.get('transferConfirmButton').innerText,'경기 입장');
    app.run('courts[2].next[0]=players[0]; updateTransferNextPreview()');
    assert.equal(app.elements.get('transferConfirmButton').innerText,'대기 입장');
});

test('배정 창을 연 뒤 대상이 경기 중으로 바뀌면 현재 경기를 덮어쓰지 않고 대기 입장한다',()=>{
    const list=roster(8);list.slice(4).forEach(p=>p.status='reserved');
    const app=runtime(list,[court(1),court(2,{isWaiting:true,next:list.slice(4)})]);
    app.run('openTransferNext(2); courts[0].active=players.slice(0,4); courts[0].startTime=5000; syncPlayerAssignmentStatuses([1,2,3,4]); saveAction("다른 경기 시작"); confirmTransferNext()');
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[1,2,3,4]);
    assert.deepEqual(app.json('courts[0].next.map(p=>p.id)'),[5,6,7,8]);
    assert.equal(app.run('courts[0].startTime'),5000);
});
