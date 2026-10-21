const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {runtime,roster,court}=require('./helpers/queue-runtime');
const {html,appSource}=require('./helpers/app-runtime');

test('진행 경기와 큐의 팀 변경은 자리·타이머·출전 상태를 보존하고 되돌릴 수 있다',()=>{
    for(const area of ['active','queue']) {
        const app=runtime();app.run('autoQueueMatch()');
        if(area==='active')app.run('startQueuedGame(matchQueue[0].id,1)');
        const id=area==='active'?1:app.run('matchQueue[0].id');
        app.context.targetId=id;app.context.area=area;
        const before=app.run('serializeState()');
        const other=app.run('assignmentFor(targetId,area).match[2].id');app.context.other=other;
        app.run('openSwap(targetId,area,0);changeCourtTeam(2,other)');
        assert.equal(app.run('assignmentFor(targetId,area).match[0].id'),other);
        assert.equal(app.run('history.length'),0);
        const loaded=runtime(null,app.storage);loaded.run('undoLastAction();executeConfirm()');
        assert.equal(loaded.run('serializeState()'),before);
    }
});

test('혼복 팀 변경과 교체는 성별을 지키고 오래된 선택을 적용하지 않는다',()=>{
    const app=runtime();app.run('autoQueueMatch("X")');
    const before=app.run('serializeState()');
    app.run('openSwap(matchQueue[0].id,"queue",0);changeCourtTeam(3,matchQueue[0].players[3].id)');
    assert.equal(app.run('serializeState()'),before);
    app.run('openSwap(matchQueue[0].id,"queue",0);doSwap(6)');
    assert.equal(app.run('serializeState()'),before);
    app.run('openSwap(matchQueue[0].id,"queue",0);doSwap(5)');
    assert.equal(app.run('matchQueue[0].players[0].id'),5);
    app.run('openSwap(matchQueue[0].id,"queue",0);removeQueueGame(matchQueue[0].id);doSwap(7)');
    assert.equal(app.run('matchQueue.length'),0);
});

test('진행 선수 교체는 실제 종료 선수로 경기 기록을 남긴다',()=>{
    const app=runtime();app.run('autoQueueMatch();startQueuedGame(matchQueue[0].id,1);openSwap(1,"active",0);doSwap(5)');
    assert.equal(app.run('players[0].status'),'waiting');
    assert.equal(app.run('players[4].status'),'playing');
    app.run('completeGame(1)');
    assert.equal(app.run('history[0].pIds.includes(5)&&!history[0].pIds.includes(1)'),true);
    assert.equal(app.run('players[4].games'),1);
});

test('다음 경기 선수는 경기 중 선수로 교체하지만 진행 경기에는 중복 입장시키지 않는다',()=>{
    const people=roster(12);
    const app=runtime({players:people,courts:[court(1,{active:people.slice(0,4),startTime:100}),court(2)]});
    app.run('autoQueueMatch("X")');
    const active=app.run('JSON.stringify(courts[0])');
    app.run('openSwap(matchQueue[0].id,"queue",0)');
    assert.equal(app.run('getSwapCandidates().some(p=>p.id===1)'),true);
    const before=app.run('serializeState()');
    app.run('doSwap(2)');assert.equal(app.run('serializeState()'),before,'혼복은 같은 성별로만 교체합니다.');
    app.run('doSwap(1)');
    assert.equal(app.run('matchQueue[0].players[0].id'),1);
    assert.equal(app.run('JSON.stringify(courts[0])'),active);
    assert.equal(app.run('players[0].status'),'playing');
    assert.equal(app.run('isQueueGameReady(matchQueue[0])'),false);
    app.run('openSwap(1,"active",0)');
    assert.equal(app.run('getSwapCandidates().some(p=>p.id===2)'),false);
    const overlapping=app.run('serializeState()');
    app.run('doSwap(2)');assert.equal(app.run('serializeState()'),overlapping);
    app.run('openManualMatch();toggleManualSelect(3);confirmManualMatch();openSwap(matchQueue[0].id,"queue",0)');
    assert.equal(app.run('getSwapCandidates().some(p=>p.id===3)'),false);
    app.run('doSwap(3)');assert.equal(app.run('matchQueue[0].players[0].id'),1);
});

test('팀 변경·선수 교체 저장 실패는 배정과 대기 시각을 함께 복원한다',()=>{
    for(const operation of ['changeCourtTeam(2,matchQueue[0].players[2].id)','doSwap(5)']) {
        const app=runtime();app.run('autoQueueMatch();openSwap(matchQueue[0].id,"queue",0)');
        const before=app.run('serializeState()');app.context.localStorage.setItem=()=>{throw new Error('quota');};
        app.run(operation);assert.equal(app.run('serializeState()'),before);
    }
});

test('회원 관리 시트와 새 서비스 워커 파일은 기존 앱 동작을 유지한다',()=>{
    const app=runtime();app.run('toggleRosterActionSheet(1)');
    assert.equal(app.elements.get('rosterActionSheet').hidden,false);
    assert.equal((app.elements.get('rosterActionSheet').innerHTML.match(/<button/g)||[]).length,4);
    app.run('closeRosterActionSheet(true)');assert.equal(app.run('selectedRosterPlayerId'),null);
    const sw=fs.readFileSync('service-worker.js','utf8');
    assert.ok(sw.includes("'./js/queue.js'"));
    assert.ok(appSource.includes("navigator.serviceWorker.addEventListener('controllerchange'"));
    assert.ok(html.includes('id="mobileQueueTab"'));
});
