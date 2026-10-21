const test = require('node:test');
const assert = require('node:assert/strict');
const {runtime,roster,court} = require('./helpers/queue-runtime');

function setup({overlap=false, otherCourt=false}={}) {
    const people=roster(16);
    return runtime({players:people,courts:[court(1,{active:people.slice(0,4),startTime:123}),court(2,otherCourt?{active:people.slice(4,8),startTime:456}:{})],
        matchQueue:[{id:77,type:'A',players:people.slice(overlap?0:4,overlap?4:8)},{id:78,type:'A',players:people.slice(8,12)}]});
}

test('진행 코트 대기 입장은 현재 팀·시작 시각·경기 수를 유지하고 다음 경기만 옮긴다',()=>{
    const app=setup();
    const active=app.run('JSON.stringify(courts[0].active)');
    const waiting=app.run('JSON.stringify(matchQueue[0])');
    assert.equal(app.run('startQueuedGame(77,1)'),true);
    assert.equal(app.run('JSON.stringify(courts[0].active)'),active);
    assert.equal(app.run('courts[0].startTime'),123);
    assert.equal(app.run('JSON.stringify(courts[0].pendingMatch)'),waiting);
    assert.equal(app.run('history.length+players.reduce((n,p)=>n+p.games,0)'),0);
    assert.deepEqual(app.json('players.slice(0,8).map(p=>p.status)'),['playing','playing','playing','playing','reserved','reserved','reserved','reserved']);
    assert.equal(app.run('startQueuedGame(78,1)'),false);
    assert.equal(app.run('startQueuedGame(77,2)'),false);
    assert.equal(app.run('matchQueue[0].id'),78);
    assert.match(app.elements.get('courtGrid').innerHTML,/대기 입장/);
    assert.match(app.run('renderRosterSummary(players[4])'),/1번 코트 대기 입장/);
});

test('진행 코트 선택 시 대기 입장으로 전환하고 이미 배정된 코트는 선택을 막는다',()=>{
    const app=setup();
    app.set('queue-court-77','1');app.run('updateQueueDispatch(77)');
    assert.equal(app.elements.get('queue-enter-77').innerText,'대기 입장');
    assert.equal(app.elements.get('queue-enter-77').disabled,false);
    app.set('queue-court-77','2');app.run('updateQueueDispatch(77)');
    assert.equal(app.elements.get('queue-enter-77').innerText,'경기 입장');
    app.run('startQueuedGame(77,1)');
    assert.match(app.elements.get('queueList').innerHTML,/<option value="1"[^>]*disabled>1번 코트 · 대기 입장 있음/);
    assert.deepEqual(app.json('queueDispatchState(matchQueue[0],courts[0])'),{disabled:true,label:'대기 입장 있음'});
});

test('후순위 경기를 대기 입장시키면 그 경기만 이동하고 앞 경기·진행 팀·타이머를 보존한다',()=>{
    let app=setup();
    const before=app.run('serializeState()');
    const first=app.run('JSON.stringify(matchQueue[0])');
    assert.equal(app.run('startQueuedGame(78,1)'),true);
    assert.equal(app.run('JSON.stringify(matchQueue[0])'),first);
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[1,2,3,4]);
    assert.equal(app.run('courts[0].startTime'),123);
    assert.deepEqual(app.json('courts[0].pendingMatch.players.map(p=>p.id)'),[9,10,11,12]);
    assert.equal(app.run('history.length'),0);
    const pending=app.run('serializeState()');
    assert.equal(app.run('startQueuedGame(78,2)'),false,'중복 요청으로 앞 경기를 입장시키지 않는다');
    assert.equal(app.run('startQueuedGame(77,1)'),false,'기존 대기 경기를 덮어쓰지 않는다');
    assert.equal(app.run('serializeState()'),pending);
    app=runtime(undefined,app.storage);
    assert.equal(app.run('serializeState()'),pending);
    app.run('undoLastAction();executeConfirm()');
    assert.equal(app.run('serializeState()'),before);
    app.run('startQueuedGame(78,1);completeGame(1)');
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[9,10,11,12]);
    assert.equal(app.run('matchQueue[0].id'),77);
});

test('각 다음 경기의 코트 선택과 입장 버튼 상태를 독립적으로 유지한다',()=>{
    const app=setup();
    app.set('queue-court-77','2');app.set('queue-court-78','1');
    app.run('render();updateQueueDispatch(77);updateQueueDispatch(78)');
    assert.equal(app.elements.get('queue-enter-77').innerText,'경기 입장');
    assert.equal(app.elements.get('queue-enter-78').innerText,'대기 입장');
    const html=app.elements.get('queueList').innerHTML;
    assert.match(html,/<select id="queue-court-77"[\s\S]*?<option value="2" selected\s*>/);
    assert.match(html,/<select id="queue-court-78"[\s\S]*?<option value="1" selected\s*>/);
    app.set('queue-court-78','2');app.run('updateQueueDispatch(78)');
    assert.equal(app.elements.get('queue-enter-78').innerText,'경기 입장');
    assert.equal(app.elements.get('queue-enter-77').innerText,'경기 입장');
});

function preparePicker(app, id, rect={left:300,right:500,top:300,bottom:344,width:200}) {
    app.context.window.innerWidth=1200;app.context.window.innerHeight=884;
    app.context.document.getElementById(`queue-court-trigger-${id}`).getBoundingClientRect=()=>rect;
    return app.run(`prepareQueueCourtMenu(${id})`);
}

test('코트 메뉴에서 선택한 후순위 경기만 갱신하고 실제 입장 전까지 선수·저장 상태를 유지한다',()=>{
    const app=setup();app.set('queue-court-77','2');app.set('queue-court-78','2');
    const before=app.run('serializeState()');
    assert.equal(preparePicker(app,78),true);
    assert.equal(app.run('chooseQueueCourt(78,1)'),true);
    assert.equal(app.elements.get('queue-court-77').value,'2');
    assert.equal(app.elements.get('queue-court-78').value,'1');
    assert.equal(app.elements.get('queue-enter-78').innerText,'대기 입장');
    assert.match(app.elements.get('queue-court-trigger-78').innerHTML,/1번 코트/);
    assert.equal(app.run('serializeState()'),before);
    assert.equal(app.run('startQueuedGame(78,Number(document.getElementById("queue-court-78").value))'),true);
    assert.equal(app.run('courts[0].pendingMatch.id'),78);
    assert.equal(app.run('matchQueue[0].id'),77);
    assert.equal(preparePicker(app,77),true);
    assert.match(app.elements.get('queueCourtMenu').innerHTML,/disabled aria-disabled="true"/);
    assert.equal(app.run('chooseQueueCourt(77,1)'),false);
    assert.equal(app.elements.get('queue-court-77').value,'2');
    app.run('removeQueueGame(77)');
    assert.equal(app.run('chooseQueueCourt(77,2)'),false,'삭제된 경기의 메뉴는 다른 경기에 적용되지 않는다');
});

test('화면 아래 코트 메뉴는 위로 열리고 작은 화면에서도 좌우 경계 안에 배치한다',()=>{
    const app=setup();
    app.context.window.innerWidth=320;app.context.window.innerHeight=700;
    app.context.document.getElementById('queue-court-trigger-78').getBoundingClientRect=()=>({left:180,right:308,top:600,bottom:644,width:128});
    app.set('queue-court-78','2');
    assert.equal(app.run('prepareQueueCourtMenu(78)'),true);
    const style=app.elements.get('queueCourtMenu').style;
    assert.ok(parseFloat(style.left)>=12);
    assert.ok(parseFloat(style.left)+parseFloat(style.width)<=308);
    assert.ok(parseFloat(style.top)>=12&&parseFloat(style.top)<600);
    assert.ok(parseFloat(style.maxHeight)<=320);
});

test('코트 목록은 방향키·Home·End로 이동하고 선택 전에는 배정 상태를 바꾸지 않는다',()=>{
    const app=setup();const before=app.run('serializeState()');
    let focused=null,prevented=false;
    const options=[0,1,2].map(index=>({focus(){focused=index;}}));
    app.context.document.activeElement=options[1];
    app.context.keyEvent={key:'ArrowDown',currentTarget:{querySelectorAll:()=>options},preventDefault(){prevented=true;}};
    app.run('handleQueueCourtMenuKey(keyEvent)');assert.equal(focused,2);assert.equal(prevented,true);
    app.context.document.activeElement=options[0];app.context.keyEvent.key='ArrowUp';
    app.run('handleQueueCourtMenuKey(keyEvent)');assert.equal(focused,2);
    app.context.keyEvent.key='Home';app.run('handleQueueCourtMenuKey(keyEvent)');assert.equal(focused,0);
    app.context.keyEvent.key='End';app.run('handleQueueCourtMenuKey(keyEvent)');assert.equal(focused,2);
    assert.equal(app.run('serializeState()'),before);
});

test('후순위 경기가 미완성일 때는 해당 번호를 안내하고 다른 경기와 코트는 유지한다',()=>{
    const app=setup();
    app.run('matchQueue[1].players.pop();saveAction("인원 변경")');
    const before=app.run('serializeState()');
    assert.equal(app.run('startQueuedGame(78,1)'),false);
    assert.equal(app.elements.get('toast').innerText,'다음 경기 2번: 1명 더 선택');
    assert.equal(app.run('serializeState()'),before);
});

test('후순위 대기 입장의 저장 실패도 앞 경기와 진행 상태를 복원하고 재시도를 허용한다',()=>{
    const app=setup();const before=app.run('serializeState()');
    app.run('localStorage.setItem=()=>{throw new Error("quota")}');
    assert.equal(app.run('startQueuedGame(78,1)'),false);
    assert.equal(app.run('serializeState()'),before);
    app.context.localStorage.setItem=(key,value)=>app.storage.set(key,value);
    assert.equal(app.run('startQueuedGame(78,1)'),true);
    assert.equal(app.run('matchQueue[0].id'),77);
    assert.equal(app.run('courts[0].pendingMatch.id'),78);
});

test('현재 경기 종료와 대기 경기 시작을 함께 저장하고 실제 종료 선수만 출전 수를 올린다',()=>{
    const app=setup();app.run('startQueuedGame(77,1)');
    const before=app.run('serializeState()');
    app.clock.now+=9000;app.run('endGame(1)');
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[5,6,7,8]);
    assert.equal(app.run('courts[0].pendingMatch'),undefined);
    assert.equal(app.run('courts[0].startTime'),app.clock.now);
    assert.deepEqual(app.json('history[0].pIds'),[1,2,3,4]);
    assert.deepEqual(app.json('players.slice(0,8).map(p=>p.games)'),[1,1,1,1,0,0,0,0]);
    app.run('endGame(1)');assert.equal(app.run('history.length'),1,'연속 입력으로 새 경기를 종료하지 않는다');
    app.run('undoLastAction();executeConfirm()');assert.equal(app.run('serializeState()'),before);
});

test('현재 경기 선수로 대기 입장해도 종료 뒤 같은 선수가 새 타이머로 시작한다',()=>{
    const app=setup({overlap:true});
    assert.equal(app.run('startQueuedGame(77,1)'),true);
    assert.equal(app.run('players.slice(0,4).every(p=>p.status==="playing")'),true);
    app.clock.now+=1000;app.run('completeGame(1)');
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[1,2,3,4]);
    assert.equal(app.run('players.slice(0,4).every(p=>p.status==="playing"&&p.games===1&&p.waitingSince===null)'),true);
    assert.equal(app.run('courts[0].startTime'),app.clock.now);
});

test('다른 코트에서 경기 중인 대기 선수는 중복 출전하지 않고 마지막 경기 종료 후 자동 시작한다',()=>{
    const app=setup({otherCourt:true});
    assert.equal(app.run('startQueuedGame(77,1)'),true);
    app.run('completeGame(1)');
    assert.equal(app.run('courts[0].active.length'),0);
    assert.equal(app.run('courts[0].pendingMatch.id'),77);
    assert.equal(app.run('players.slice(4,8).every(p=>p.status==="playing")'),true);
    assert.match(app.elements.get('courtGrid').innerHTML,/선수들의 현재 경기 종료 후 자동/);
    app.clock.now+=3000;app.run('completeGame(2)');
    assert.deepEqual(app.json('courts.map(c=>c.active.map(p=>p.id))'),[[5,6,7,8],[]]);
    assert.equal(app.run('courts[0].startTime'),app.clock.now);
    assert.equal(app.run('history.length'),2);
});

test('대기 입장 선수를 자동·수동·교체 후보와 삭제에서 보호한다',()=>{
    const app=setup();app.run('startQueuedGame(77,1)');
    assert.equal(app.run('getAutoMatchPool({includePlaying:true}).some(p=>p.id>=5&&p.id<=8)'),false);
    assert.equal(app.run('manualCandidates().some(p=>p.id>=5&&p.id<=8)'),false);
    app.run('openSwap(1,"active",0)');
    assert.equal(app.run('getSwapCandidates().some(p=>p.id>=5&&p.id<=8)'),false);
    app.run('openPModal(5);deletePlayer()');
    assert.equal(app.run('players.some(p=>p.id===5)'),true);
});

test('대기 입장 취소와 코트 삭제는 팀 순서를 보존해 다음 경기 맨 앞으로 돌린다',()=>{
    for(const action of ['returnCourtWaitingMatch(1,77)','delCourt(1);executeConfirm()']) {
        const app=setup();app.run('startQueuedGame(77,1)');
        assert.equal(app.run('returnCourtWaitingMatch(1,76)'),false);
        app.run(action);
        assert.deepEqual(app.json('matchQueue.map(g=>g.id)'),[77,78]);
        assert.deepEqual(app.json('matchQueue[0].players.map(p=>p.id)'),[5,6,7,8]);
        assert.equal(app.run('players.slice(4,8).every(p=>p.status==="reserved")'),true);
        assert.equal(app.run('courts.some(c=>c.pendingMatch)'),false);
    }
});

test('대기 경기 교체는 진행 경기를 유지하고 다른 코트의 선수를 해제하면 대기 경기를 시작한다',()=>{
    const people=roster(16);
    const app=runtime({players:people,courts:[court(1,{pendingMatch:{id:77,type:'A',players:people.slice(0,4)}}),court(2,{active:[people[0],...people.slice(4,7)],startTime:123})],matchQueue:[]});
    app.run('openSwap(2,"active",0);doSwap(8)');
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[1,2,3,4]);
    assert.deepEqual(app.json('courts[1].active.map(p=>p.id)'),[8,5,6,7]);
    assert.equal(app.run('history.length'),0);
    assert.equal(app.run('courts[1].startTime'),123);
});

test('대기 경기 수정 대상이 취소·재배정된 경우 이전 창의 조작은 적용하지 않는다',()=>{
    const app=setup();app.run('startQueuedGame(77,1);openSwap(1,"waiting",0)');
    app.run('returnCourtWaitingMatch(1,77);startQueuedGame(77,2)');
    const before=app.run('serializeState()');
    app.run('doSwap(13)');assert.equal(app.run('serializeState()'),before);
});

test('저장 실패는 대기 입장·자동 시작·취소·코트 삭제 전체를 복원하고 재시도를 허용한다',()=>{
    for(const action of ['startQueuedGame(77,1)','endGame(1)','returnCourtWaitingMatch(1,77)','delCourt(1);executeConfirm()']) {
        const app=setup();
        if(action!=='startQueuedGame(77,1)') app.run('startQueuedGame(77,1)');
        const before=app.run('serializeState()');
        app.run('localStorage.setItem=()=>{throw new Error("quota")}');
        app.run(action);
        assert.equal(app.run('serializeState()'),before,action);
        app.context.localStorage.setItem=(key,value)=>app.storage.set(key,value);
        app.run(action);
        assert.notEqual(app.run('serializeState()'),before,`${action} 재시도`);
    }
});

test('대기 입장·재접속·복구·되돌리기는 같은 선수 참조와 원래 타이머를 보존한다',()=>{
    let app=setup();const before=app.run('serializeState()');app.run('startQueuedGame(77,1)');
    const pending=app.run('serializeState()');
    app=runtime(undefined,app.storage);
    assert.equal(app.run('serializeState()'),pending);
    assert.equal(app.run('courts[0].pendingMatch.players[0]===players[4]'),true);
    app.run('undoLastAction();executeConfirm()');assert.equal(app.run('serializeState()'),before);
    app.context.backup=JSON.parse(pending);assert.equal(app.run('importValidatedData(backup)'),true);
    assert.equal(app.run('serializeState()'),pending);
    assert.equal(app.run('courts[0].pendingMatch.players[0]===players[4]'),true);
    app.run('startNewMeeting();executeConfirm()');
    assert.equal(app.run('courts.some(c=>c.pendingMatch)'),false);
    app.run('undoLastAction();executeConfirm()');assert.equal(app.run('serializeState()'),pending);
});

test('백업은 대기 경기 형식·선수·다음 경기 ID 중복을 검사하고 현재 경기와의 중복은 허용한다',()=>{
    const app=setup({overlap:true});app.run('startQueuedGame(77,1)');
    const valid=app.json('JSON.parse(serializeState())');
    app.context.backup=valid;assert.doesNotThrow(()=>app.run('validateImportData(backup)'));
    for(const mutate of [
        d=>d.courts[0].pendingMatch=null,
        d=>d.courts[0].pendingMatch.players.pop(),
        d=>d.courts[0].pendingMatch.players[0]={id:999},
        d=>d.courts[0].pendingMatch.players[0]=d.courts[0].pendingMatch.players[1],
        d=>d.courts[0].pendingMatch.type='bad',
        d=>d.courts[0].pendingMatch.id=-1,
        d=>d.matchQueue[0].id=77,
        d=>d.matchQueue[0].players[0]=d.courts[0].pendingMatch.players[0],
        d=>d.courts[1].pendingMatch={...d.courts[0].pendingMatch,id:79},
    ]) {
        const bad=structuredClone(valid);mutate(bad);app.context.backup=bad;
        assert.throws(()=>app.run('validateImportData(backup)'));
    }
});

test('같은 시각에 대기 입장 후 새 경기를 만들어도 ID가 겹치지 않는다',()=>{
    const app=setup();app.run('matchQueue[0].id=Date.now();saveAction("fixture");startQueuedGame(matchQueue[0].id,1);openManualMatch();confirmManualMatch()');
    assert.equal(app.run('new Set([...matchQueue.map(g=>g.id),courts[0].pendingMatch.id]).size'),3);
});
