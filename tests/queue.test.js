const test=require('node:test');
const assert=require('node:assert/strict');
const {runtime,roster,court}=require('./helpers/queue-runtime');

test('기존 코트 예약을 순서대로 다음 경기 목록로 옮기며 진행 경기·타이머·되돌리기를 보존한다',()=>{
    const people=roster(16);
    const original={players:people,courts:[court(10,{active:people.slice(0,4),next:people.slice(4,8),startTime:123}),court(20,{active:people.slice(8,12),next:people.slice(12),startTime:456})],history:[],members:[]};
    const stored=[['bm_state_v14',JSON.stringify({current:original,previous:original,undoLabel:'기존 작업'})]];
    const app=runtime(null,stored);
    assert.deepEqual(app.json('matchQueue.map(g=>g.players.map(p=>p.id))'),[[5,6,7,8],[13,14,15,16]]);
    assert.deepEqual(app.json('courts.map(c=>[c.active.map(p=>p.id),c.next,c.startTime])'),[[[1,2,3,4],[],123],[[9,10,11,12],[],456]]);
    assert.equal(app.run('matchQueue[0].players[0]===players[4]'),true);
    assert.equal(app.run('undoLabel'),'기존 작업');
    assert.equal(app.run('JSON.parse(undoState).matchQueue.length'),2);
    const reloaded=runtime(null,app.storage);
    assert.equal(reloaded.run('matchQueue.length'),2);
    assert.equal(reloaded.run('matchQueue[0].players[0]===players[4]'),true);
});

test('불완전한 기존 예약과 현재 경기 중인 예약 선수도 잃지 않고 입장만 보류한다',()=>{
    const people=roster(8);
    const app=runtime({players:people,courts:[court(1,{active:people.slice(0,4),startTime:1}),court(2,{next:[people[0],...people.slice(4,7)]}),court(3,{next:[people[7]]})]});
    assert.equal(app.run('matchQueue.length'),2);
    assert.equal(app.run('isQueueGameReady(matchQueue[0])'),false);
    assert.equal(app.run('startQueuedGame(matchQueue[0].id,2)'),false);
    app.run('completeGame(1)');
    assert.equal(app.run('startQueuedGame(matchQueue[0].id,3)'),true);
    assert.equal(app.run('matchQueue[0].players.length'),1);
    assert.equal(app.run('players[0].status'),'playing');
});

test('코트가 없어도 자동 편성을 여러 경기 쌓고 중복 배정을 막는다',()=>{
    const app=runtime({players:roster(12),courts:[]});
    app.run('autoQueueMatch();autoQueueMatch();autoQueueMatch()');
    assert.equal(app.run('matchQueue.length'),3);
    assert.equal(app.run('new Set(matchQueue.flatMap(g=>g.players.map(p=>p.id))).size'),12);
    assert.equal(app.run('new Set(matchQueue.map(g=>g.id)).size'),3);
    assert.equal(app.run('players.every(p=>p.status==="reserved"&&p.waitingSince===100+p.id-1)'),true);
    assert.equal(app.run('autoQueueMatch()'),false);
    assert.equal(app.run('history.length'),0);
});

test('오른쪽 유형 선택은 선수·경기를 바꾸지 않고 왼쪽 자동 편성 실행에 선택한 유형을 적용한다',()=>{
    for(const type of ['A','M','F','X']) {
        const app=runtime();
        let menuOpen=true,focused=false;
        const menu=app.context.document.getElementById('autoMatchMenu');
        menu.matches=()=>menuOpen;menu.hidePopover=()=>{menuOpen=false;};
        app.context.document.getElementById('autoMatchTypeButton').focus=()=>{focused=true;};
        const before=app.run('serializeState()');
        assert.equal(app.run(`chooseAutoMatch("${type}")`),true);
        assert.equal(menuOpen,false);
        assert.equal(focused,true);
        assert.equal(app.run('serializeState()'),before);
        assert.equal(app.elements.get('autoMatchTypeLabel').innerText,app.run(`QUEUE_TYPES["${type}"]`));
        assert.equal(app.run('autoQueueMatch()'),true);
        assert.equal(app.run('matchQueue.length'),1);
        assert.equal(app.run('matchQueue[0].type'),type);
        assert.equal(app.run('queueType'),type);
        assert.equal(app.run('isQueueGameReady(matchQueue[0])'),true);
    }
    const app=runtime({players:roster(3),courts:[court()]});
    const before=app.run('serializeState()');
    assert.equal(app.run('chooseAutoMatch("M")'),true);
    assert.equal(app.run('autoQueueMatch()'),false);
    assert.equal(app.run('serializeState()'),before);
    assert.equal(app.run('chooseAutoMatch("invalid")'),false);
    assert.equal(app.run('queueType'),'M');
});

test('직접 편성은 이전 자동 편성 유형과 무관하게 성별 제한 없이 선수를 선택한다',()=>{
    for(const type of ['A','M','F','X']) {
        const app=runtime();app.run(`queueType="${type}";openManualMatch();[1,3,5,2].forEach(toggleManualSelect)`);
        assert.deepEqual(app.json('[...manualSelected]'),[1,3,5,2]);
        assert.equal(app.run('confirmManualMatch()'),true);
        assert.deepEqual(app.json('matchQueue[0].players.map(p=>p.id).sort((a,b)=>a-b)'),[1,2,3,5]);
        assert.equal(app.run('matchQueue[0].type'),'A');
        assert.equal(app.run('isQueueGameReady(matchQueue[0])'),true);
        assert.equal(app.run('queueType'),type,'직접 편성은 자동 편성의 최근 유형을 바꾸지 않습니다.');
        app.run('openManualMatch(matchQueue[0].id);toggleManualSelect(5);toggleManualSelect(4);confirmManualMatch()');
        assert.deepEqual(app.json('matchQueue[0].players.map(p=>p.id).sort((a,b)=>a-b)'),[1,2,3,4]);
    }
});

test('모두 경기 중이어도 자동 편성하며 휴식·다른 다음 경기 선수를 중복 선발하지 않는다',()=>{
    const people=roster(12);people.slice(8).forEach(p=>p.status='resting');
    const app=runtime({players:people,courts:[court(1,{active:people.slice(0,4),startTime:100}),court(2,{active:people.slice(4,8),startTime:200})]});
    const active=app.run('JSON.stringify(courts)');
    assert.equal(app.run('autoQueueMatch()'),true);
    assert.equal(app.run('autoQueueMatch()'),true);
    assert.equal(app.run('autoQueueMatch()'),false);
    assert.deepEqual(app.json('matchQueue.flatMap(g=>g.players.map(p=>p.id)).sort((a,b)=>a-b)'),[1,2,3,4,5,6,7,8]);
    assert.equal(app.run('JSON.stringify(courts)'),active);
    assert.equal(app.run('players.slice(0,8).every(p=>p.status==="playing"&&p.games===0)'),true);
    assert.equal(app.run('getAutoMatchPool().length'),0,'진행 경기의 교체 후보는 경기 중 선수를 포함하지 않습니다.');
    assert.equal(app.run('matchQueue.every(g=>!isQueueGameReady(g))'),true);
});

test('경기 중 선수를 자동 편성한 상태도 저장 실패·재접속·되돌리기에 일관되게 복원된다',()=>{
    const people=roster(6);
    let app=runtime({players:people,courts:[court(1,{active:people.slice(0,4),startTime:100}),court(2)]});
    const before=app.run('serializeState()'),write=app.context.localStorage.setItem;
    app.context.localStorage.setItem=()=>{throw new Error('quota');};
    assert.equal(app.run('autoQueueMatch()'),false);
    assert.equal(app.run('serializeState()'),before);
    app.context.localStorage.setItem=write;
    assert.equal(app.run('autoQueueMatch()'),true);
    const queued=app.run('serializeState()');
    app=runtime(null,app.storage);
    assert.equal(app.run('serializeState()'),queued);
    assert.equal(app.run('isQueueGameReady(matchQueue[0])'),false);
    assert.equal(app.run('matchQueue[0].players.every(p=>players.includes(p))'),true);
    app.run('undoLastAction();executeConfirm()');
    assert.equal(app.run('serializeState()'),before);
});

test('수동 편성은 빈 경기·2명 초안을 저장하고 재접속 후 이어서 완성한다',()=>{
    let app=runtime();
    app.run('openManualMatch();[1,2].forEach(toggleManualSelect);confirmManualMatch()');
    assert.equal(app.run('matchQueue[0].players.length'),2);
    assert.equal(app.run('courts.every(c=>!c.active.length&&c.startTime===null)'),true);
    app=runtime(null,app.storage);
    app.run('openManualMatch(matchQueue[0].id);[3,4].forEach(toggleManualSelect);confirmManualMatch()');
    assert.equal(app.run('isQueueGameReady(matchQueue[0])'),true);
    app.run('openManualMatch();confirmManualMatch()');
    assert.equal(app.run('matchQueue[1].players.length'),0);
    assert.equal(app.run('manualQueueId'),null);
});

test('뒤의 경기를 선택한 빈 코트에 입장시키고 남은 경기와 중복 요청을 구분한다',()=>{
    const app=runtime();app.run('autoQueueMatch();autoQueueMatch()');
    const second=app.run('matchQueue[1].id');
    const first=app.run('matchQueue[0].id');
    app.context.second=second;
    const players=app.json('matchQueue[1].players.map(p=>p.id)');
    assert.equal(app.run('startQueuedGame(second,2)'),true);
    assert.deepEqual(app.json('courts[1].active.map(p=>p.id)'),players);
    assert.equal(app.run('courts[1].startTime'),app.clock.now);
    assert.equal(app.run('matchQueue[0].id'),first);
    assert.equal(app.run('startQueuedGame(second,1)'),false,'같은 입장 요청을 반복해도 다음 경기가 입장하지 않습니다.');
    assert.equal(app.run('startQueuedGame(matchQueue[0].id,2)'),true,'사용 중인 코트에는 대기 입장합니다.');
    assert.equal(app.run('courts[1].pendingMatch.players.length'),4);
    assert.deepEqual(app.json('courts[1].active.map(p=>p.id)'),players);
    assert.equal(app.run('matchQueue.length'),0);
});

test('맨 앞 경기가 미완성이어도 뒤의 완성 경기를 직접 골라 입장시킬 수 있다',()=>{
    const app=runtime();app.run('openManualMatch();confirmManualMatch();autoQueueMatch()');
    assert.equal(app.run('startQueuedGame(matchQueue[0].id,1)'),false);
    assert.equal(app.run('startQueuedGame(matchQueue[1].id,1)'),true);
    assert.equal(app.run('matchQueue.length'),1);
    assert.equal(app.run('matchQueue[0].players.length'),0);
});

test('경기 종료는 기록과 출전 수를 저장하고 코트를 비우며 다음 경기와 다음 입장은 유지한다',()=>{
    const app=runtime();app.run('autoQueueMatch();autoQueueMatch();startQueuedGame(matchQueue[0].id,2)');
    const queue=app.run('JSON.stringify(matchQueue)');
    app.clock.now+=60000;app.run('endGame(2);endGame(2)');
    assert.equal(app.run('history.length'),1);
    assert.equal(app.run('courts[1].active.length'),0);
    assert.equal(app.run('courts[1].startTime'),null);
    assert.equal(app.run('JSON.stringify(matchQueue)'),queue);
    assert.equal(app.run('history[0].pIds.every(id=>players.find(p=>p.id===id).games===1&&players.find(p=>p.id===id).waitingSince===Date.now())'),true);
    assert.equal(app.run('history[0].teamNames.flat().length'),4);
});

test('편성 수정은 경기 중인 선수도 선택하며 다른 다음 경기 선수는 중복 편성하지 않는다',()=>{
    const app=runtime();app.run('autoQueueMatch();autoQueueMatch();startQueuedGame(matchQueue[0].id,1);openManualMatch()');
    assert.equal(app.run('manualCandidates().length'),8);
    app.run('toggleManualSelect(courts[0].active[0].id);toggleManualSelect(matchQueue[0].players[0].id)');
    assert.deepEqual(app.json('[...manualSelected]'),[app.run('courts[0].active[0].id')]);
    app.run('closeManualModal();openManualMatch(matchQueue[0].id);manualSelected.delete(matchQueue[0].players[0].id);confirmManualMatch()');
    assert.equal(app.run('matchQueue[0].players.length'),3);
    assert.equal(app.run('getAutoMatchPool().length'),5);
    app.run('removeQueueGame(matchQueue[0].id)');
    assert.equal(app.run('getAutoMatchPool().length'),8);
    assert.equal(app.run('courts[0].active.every(p=>p.status==="playing")'),true);
});

test('여러 코트의 경기 중 선수를 미리 편성하고 모두 종료한 뒤에만 입장한다',()=>{
    const people=roster();
    const app=runtime({players:people,courts:[court(1,{active:people.slice(0,4),startTime:100}),court(2,{active:people.slice(4,8),startTime:200}),court(3)]});
    const before=app.run('JSON.stringify(courts)');
    app.run('openManualMatch();[1,5,9,10].forEach(toggleManualSelect);confirmManualMatch()');
    assert.equal(app.run('JSON.stringify(courts)'),before);
    assert.deepEqual(app.json('[1,5,9,10].map(id=>players.find(p=>p.id===id).status)'),['playing','playing','reserved','reserved']);
    assert.equal(app.run('players.every(p=>p.games===0)'),true);
    assert.equal(app.run('queueBlockReason(matchQueue[0])'),'경기 종료 대기');
    assert.equal(app.run('startQueuedGame(matchQueue[0].id,3)'),false);
    app.run('completeGame(1)');
    assert.equal(app.run('players[0].status'),'reserved');
    assert.equal(app.run('players[0].waitingSince'),app.clock.now);
    assert.equal(app.run('startQueuedGame(matchQueue[0].id,1)'),false);
    app.clock.now+=60000;app.run('completeGame(2)');
    assert.equal(app.run('isQueueGameReady(matchQueue[0])'),true);
    assert.equal(app.run('startQueuedGame(matchQueue[0].id,3)'),true);
    assert.deepEqual(app.json('courts[2].active.map(p=>p.id).sort((a,b)=>a-b)'),[1,5,9,10]);
    assert.equal(app.run('history.length'),2);
    assert.deepEqual(app.json('[1,5,9,10].map(id=>players.find(p=>p.id===id).games)'),[1,1,0,0]);
});

test('경기 중 선수가 포함된 편성도 재접속·백업·삭제·되돌리기에서 배정을 보존한다',()=>{
    const people=roster(8);
    let app=runtime({players:people,courts:[court(1,{active:people.slice(0,4),startTime:100}),court(2)]});
    app.run('openManualMatch();[1,2,5,6].forEach(toggleManualSelect);confirmManualMatch()');
    const before=app.run('serializeState()');
    app=runtime(null,app.storage);
    assert.equal(app.run('serializeState()'),before);
    assert.equal(app.run('matchQueue[0].players.find(p=>p.id===1)===courts[0].active[0]'),true);
    app.context.backup=JSON.parse(before);
    assert.equal(app.run('importValidatedData(backup)'),true);
    app.run('removeQueueGame(matchQueue[0].id)');
    assert.equal(app.run('players[0].status'),'playing');
    assert.equal(app.run('players[4].status'),'waiting');
    app.run('undoLastAction();executeConfirm()');
    assert.equal(app.run('serializeState()'),before);
    assert.equal(app.run('startQueuedGame(matchQueue[0].id,2)'),false);
});

test('편성 수정은 경기 유형과 성별에 관계없이 선택하며 휴식·다음 경기 중복 제한을 지킨다',()=>{
    const people=roster(12);
    const app=runtime({players:people,courts:[court(1,{active:people.slice(0,4),startTime:100}),court(2)],matchQueue:[{id:77,type:'M',players:[]}]});
    app.run('setPlayerStatus(players[10],"resting");openManualMatch(77);[1,2,5,11].forEach(toggleManualSelect);confirmManualMatch()');
    assert.deepEqual(app.json('matchQueue[0].players.map(p=>p.id)'),[1,2,5]);
    assert.equal(app.run('matchQueue[0].type'),'A');
    app.run('openManualMatch();toggleManualSelect(1)');
    assert.equal(app.run('manualSelected.size'),0);
    app.run('closeManualModal();openManualMatch(matchQueue[0].id);[3,7].forEach(toggleManualSelect);confirmManualMatch()');
    assert.equal(app.run('matchQueue[0].players.length'),4);
    assert.equal(app.run('players[0].status'), 'playing');
    assert.equal(app.run('getAutoMatchPool().some(p=>[1,3].includes(p.id))'),false);
    const before=app.run('serializeState()');
    app.run('queueType="A";openManualMatch();toggleManualSelect(4)');
    assert.deepEqual(app.json('[...manualSelected]'),[4]);
    app.context.localStorage.setItem=()=>{throw new Error('quota');};
    app.run('confirmManualMatch()');
    assert.equal(app.run('serializeState()'),before);
    assert.equal(app.elements.get('manualModal').style.display,'flex');
});

test('남복·여복·혼복 편성을 다른 성별 선수로 수정하고 재접속·되돌리기·입장을 지원한다',()=>{
    for(const [type,originalIds,removed,added] of [['M',[1,3,5,7],7,2],['F',[2,4,6,8],8,1],['X',[1,2,3,4],4,5]]) {
        const people=roster();
        let app=runtime({players:people,courts:[court()],matchQueue:[{id:77,type,players:originalIds.map(id=>people[id-1])}]});
        const before=app.run('serializeState()');
        const expected=[...originalIds.filter(id=>id!==removed),added].sort((a,b)=>a-b);
        const edit=`openManualMatch(77);toggleManualSelect(${removed});toggleManualSelect(${added});confirmManualMatch()`;
        assert.equal(app.run(edit),true);
        assert.equal(app.run('matchQueue[0].type'),'A');
        assert.deepEqual(app.json('matchQueue[0].players.map(p=>p.id).sort((a,b)=>a-b)'),expected);
        assert.equal(app.run('isQueueGameReady(matchQueue[0])'),true);
        app=runtime(null,app.storage);
        assert.equal(app.run('matchQueue[0].type'),'A');
        assert.equal(app.run('isQueueGameReady(matchQueue[0])'),true);
        app.run('undoLastAction();executeConfirm()');
        assert.equal(app.run('serializeState()'),before);
        app.run(edit);
        assert.equal(app.run('startQueuedGame(77,1)'),true);
        assert.equal(app.run('courts[0].type'),'A');
        assert.deepEqual(app.json('courts[0].active.map(p=>p.id).sort((a,b)=>a-b)'),expected);
    }
});

test('다른 성별로 편성 수정 중 저장에 실패하면 원래 유형과 선수를 복원하고 다시 저장한다',()=>{
    const people=roster();
    const app=runtime({players:people,courts:[court()],matchQueue:[{id:77,type:'M',players:[1,3,5,7].map(id=>people[id-1])}]});
    const before=app.run('serializeState()'),write=app.context.localStorage.setItem;
    app.run('openManualMatch(77);toggleManualSelect(7);toggleManualSelect(2)');
    app.context.localStorage.setItem=()=>{throw new Error('quota');};
    assert.equal(app.run('confirmManualMatch()'),false);
    assert.equal(app.run('serializeState()'),before);
    assert.equal(app.elements.get('manualModal').style.display,'flex');
    assert.equal(app.run('manualSelected.has(2)'),true);
    app.context.localStorage.setItem=write;
    assert.equal(app.run('confirmManualMatch()'),true);
    assert.equal(app.run('matchQueue[0].type'),'A');
    assert.equal(app.run('isQueueGameReady(matchQueue[0])'),true);
});

test('저장 실패 시 추가·순서 변경·삭제·입장·종료를 선수와 큐까지 함께 복원한다',()=>{
    for(const operation of ['autoQueueMatch()','moveQueueGame(matchQueue[1].id,-1)','removeQueueGame(matchQueue[0].id)','startQueuedGame(matchQueue[0].id,2)','completeGame(1)']) {
        const app=runtime({players:roster(16),courts:[court(),court(2)]});
        app.run('autoQueueMatch();startQueuedGame(matchQueue[0].id,1);autoQueueMatch();autoQueueMatch()');
        const before=app.run('serializeState()'),undo=app.run('undoState');
        app.context.localStorage.setItem=()=>{throw new Error('quota');};
        app.run(operation);
        assert.equal(app.run('serializeState()'),before,operation);
        assert.equal(app.run('undoState'),undo,operation);
    }
});

test('수동 편성 저장 실패는 입력 창을 유지하고 다시 저장할 수 있다',()=>{
    const app=runtime();app.run('openManualMatch();[1,2].forEach(toggleManualSelect)');
    const write=app.context.localStorage.setItem;app.context.localStorage.setItem=()=>{throw new Error('quota');};
    app.run('confirmManualMatch()');
    assert.equal(app.run('matchQueue.length'),0);
    assert.equal(app.elements.get('manualModal').style.display,'flex');
    app.context.localStorage.setItem=write;assert.equal(app.run('confirmManualMatch()'),true);
    assert.equal(app.run('matchQueue[0].players.length'),2);
});

test('다음 경기·현재 경기·대기 시간은 백업 복구와 재접속 후 되돌리기로 함께 복원된다',()=>{
    let app=runtime();app.run('autoQueueMatch();autoQueueMatch()');
    const before=app.run('serializeState()');app.run('startQueuedGame(matchQueue[0].id,2)');
    app=runtime(null,app.storage);app.run('undoLastAction();executeConfirm()');
    assert.equal(app.run('serializeState()'),before);
    app.context.backup=JSON.parse(before);app.run('removeQueueGame(matchQueue[0].id)');
    assert.equal(app.run('importValidatedData(backup)'),true);
    assert.equal(app.run('matchQueue.length'),2);
    app.run('restoreBeforeImport();executeConfirm()');
    assert.equal(app.run('matchQueue.length'),1);
});

test('잘못된 큐 백업은 중복·누락 선수·ID·길이·이중 예약을 검증해 기존 데이터를 보존한다',()=>{
    const app=runtime();app.run('autoQueueMatch()');const before=app.run('serializeState()');
    const variants=[
        d=>d.matchQueue.push({...d.matchQueue[0]}),
        d=>d.matchQueue.push({...d.matchQueue[0],id:42}),
        d=>d.matchQueue[0].players.push(d.players[6]),
        d=>d.matchQueue[0].players[0]={id:999},
        d=>d.matchQueue[0].id=-1,
        d=>d.matchQueue[0].type='invalid',
        d=>d.courts[0].next=d.players.slice(4,8)
    ];
    for(const alter of variants){const backup=JSON.parse(before);alter(backup);app.context.backup=backup;assert.equal(app.run('importValidatedData(backup)'),false);assert.equal(app.run('serializeState()'),before);}
});

test('새 모임·초기화는 다음 경기를 비우고 저장 회원 보존과 되돌리기를 지원한다',()=>{
    const app=runtime();app.run('members=[{id:30,name:"회원",gender:"M",tier:3}];autoQueueMatch();startNewMeeting();executeConfirm()');
    assert.equal(app.run('matchQueue.length+players.length+history.length'),0);
    assert.equal(app.run('members.length'),1);
    app.run('undoLastAction();executeConfirm()');assert.equal(app.run('matchQueue.length'),1);
    app.run('resetAll();executeConfirm()');assert.equal(app.run('matchQueue.length+members.length'),0);
    app.run('undoLastAction();executeConfirm()');assert.equal(app.run('matchQueue.length'),1);
});

test('다음 경기 편성 선수 삭제는 막고 다음 경기를 지운 후에는 삭제·되돌리기가 가능하다',()=>{
    const app=runtime();app.run('autoQueueMatch();openPModal(matchQueue[0].players[0].id);deletePlayer()');
    assert.equal(app.run('players.length'),12);
    app.run('removeQueueGame(matchQueue[0].id);deletePlayer();executeConfirm()');
    assert.equal(app.run('players.length'),11);
    app.run('undoLastAction();executeConfirm()');assert.equal(app.run('players.length'),12);
});

test('다음 경기의 선수 이름과 위치를 안전하게 표시하고 코트별 예약 조작을 노출하지 않는다',()=>{
    const people=roster();people[0].name='<img src=x onerror=alert(1)>';
    const app=runtime({players:people,courts:[court()]});app.run('autoQueueMatch()');
    const html=app.elements.get('queueList').innerHTML;
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(app.run('renderRosterSummary(players[0]).includes("다음 경기 1번")'));
    assert.ok(!app.elements.get('courtGrid').innerHTML.includes('next-section'));
});

test('경기 종료 저장 실패는 연속 입력 잠금을 해제하여 즉시 다시 시도할 수 있다',()=>{
    const app=runtime();app.run('autoQueueMatch();startQueuedGame(matchQueue[0].id,1)');
    const before=app.run('serializeState()'),write=app.context.localStorage.setItem;
    app.context.localStorage.setItem=()=>{throw new Error('quota');};app.run('endGame(1)');
    assert.equal(app.run('serializeState()'),before);
    assert.equal(app.run('isCourtActionLocked(1)'),false);
    app.context.localStorage.setItem=write;app.run('endGame(1)');
    assert.equal(app.run('history.length'),1);
});

test('손상된 저장 원본을 덮어쓰지 않고 정상 큐 백업으로 복구한다',()=>{
    const app=runtime(null,[['bm_state_v14','{broken']]);
    assert.equal(app.run('storageBlocked'),true);
    app.run('openManualMatch();confirmManualMatch()');
    assert.equal(app.storage.get('bm_state_v14'),'{broken');
    const people=roster(4);
    app.context.backup={players:people,courts:[court()],matchQueue:[{id:1,type:'A',players:people}],history:[]};
    assert.equal(app.run('importValidatedData(backup)'),true);
    assert.equal(app.run('storageBlocked'),false);
    assert.equal(app.run('matchQueue[0].players.length'),4);
    assert.ok(app.storage.get('bm_unreadable_v14').includes('{broken'));
});

test('직접 편성 중에는 대기 시각이 같은 선수의 목록도 뒤섞이지 않는다',()=>{
    const people=roster();people.forEach(p=>p.waitingSince=100);
    const app=runtime({players:people,courts:[court()]});
    const order=()=>[...app.elements.get('manualList').innerHTML.matchAll(/id="manual-player-(\d+)"/g)].map(m=>m[1]);
    app.run('Math.random=()=>0;openManualMatch()');
    const before=order();
    app.run('Math.random=()=>.99;toggleManualSelect(1);toggleManualSelect(2);toggleManualSelect(1)');
    assert.deepEqual(order(),before);
    assert.deepEqual(app.json('[...manualSelected]'),[2]);
});

test('기존 혼복 편성 수정도 성별 제한 없이 선택하고 4명 인원 제한만 표시한다',()=>{
    const app=runtime({players:roster(),courts:[court()],matchQueue:[{id:1,type:'X',players:[]}]});
    app.run('openManualMatch(1);toggleManualSelect(1);toggleManualSelect(3)');
    assert.match(app.elements.get('manualHelp').innerText,/2\/4명 선택/);
    assert.equal(app.elements.get('manualConfirmButton').innerText,'변경 저장 (2/4)');
    const html=app.elements.get('manualList').innerHTML;
    assert.doesNotMatch(html, /id="manual-player-5"[^>]*disabled/);
    assert.doesNotMatch(html, /id="manual-player-1"[^>]*disabled/);
    assert.doesNotMatch(html, /id="manual-player-2"[^>]*disabled/);
    app.run('toggleManualSelect(5);toggleManualSelect(2)');
    assert.equal(app.elements.get('manualConfirmButton').innerText,'변경 저장 (4/4)');
    assert.match(app.elements.get('manualList').innerHTML,/id="manual-player-6"[^>]*disabled/);
    assert.doesNotMatch(app.elements.get('manualList').innerHTML,/id="manual-player-5"[^>]*disabled/);
    assert.equal(app.run('confirmManualMatch()'),true);
    assert.equal(app.run('matchQueue[0].type'),'A');
    assert.equal(app.run('isQueueGameReady(matchQueue[0])'),true);
});

test('선택을 바꾸지 않고 편성 수정을 저장하면 기존 팀과 되돌릴 작업을 보존한다',()=>{
    const app=runtime();app.run('autoQueueMatch();autoQueueMatch()');
    const before=app.run('serializeState()'),undo=app.run('undoState'),label=app.run('undoLabel');
    app.run('openManualMatch(matchQueue[0].id);balanceMatchTeams=()=>{throw new Error("unexpected team shuffle")};confirmManualMatch()');
    assert.equal(app.run('serializeState()'),before);
    assert.equal(app.run('undoState'),undo);
    assert.equal(app.run('undoLabel'),label);
    assert.equal(app.elements.get('manualModal').style.display,'none');
});

test('입장 코트 선택은 같은 경기를 다시 표시해도 유지하고 진행 코트는 대기 입장으로 표시한다',()=>{
    const app=runtime();app.run('autoQueueMatch()');
    const selectId=`queue-court-${app.run('matchQueue[0].id')}`;
    app.set(selectId,'2');app.run('render()');
    assert.match(app.elements.get('queueList').innerHTML, /value="2" selected\s*>2번 코트/);
    app.run('courts[1].active=players.slice(4,8);render()');
    const select=app.elements.get('queueList').innerHTML.match(/<select id="queue-court-[\s\S]*?<\/select>/)[0];
    assert.match(select,/value="2" selected\s*>2번 코트 · 경기 중/);
    assert.match(select,/value="1"/);
    assert.match(app.elements.get('queueList').innerHTML,/>대기 입장<\/button>/);
});

test('다음 경기는 인원 부족·경기 중·휴식을 구분하고 대기 입장 안내 문구는 표시하지 않는다',()=>{
    const app=runtime();app.run('openManualMatch();toggleManualSelect(1);confirmManualMatch()');
    assert.equal(app.run('queueBlockReason(matchQueue[0])'),'3명 더 선택');
    app.run('openManualMatch(matchQueue[0].id);[2,3,4].forEach(toggleManualSelect);confirmManualMatch();courts[0].active=[players[0]]');
    assert.equal(app.run('queueBlockReason(matchQueue[0])'),'경기 종료 대기');
    app.run('courts[0].active=[];players[0].status="resting"');
    assert.equal(app.run('queueBlockReason(matchQueue[0])'),'휴식 중인 선수 있음');
    app.run('players[0].status="reserved";courts.forEach((c,i)=>c.active=players.slice(4+i*4,8+i*4));render()');
    assert.equal(app.run('isQueueGameReady(matchQueue[0])'),true);
    assert.doesNotMatch(app.elements.get('queueList').innerHTML,/대기 입장 가능/);
    assert.equal(app.run('queueDispatchState(matchQueue[0],courts[0]).label'),'대기 입장');
});

test('이전 작업의 명칭도 다음 경기로 표시하고 되돌릴 데이터는 유지한다',()=>{
    const app=runtime();app.run('autoQueueMatch();undoLabel="공통 큐 자동 편성";render();undoLastAction()');
    assert.equal(app.elements.get('undoButton').title,'다음 경기 자동 편성 되돌리기');
    assert.match(app.elements.get('confirmMsg').innerText,/^다음 경기 자동 편성 작업/);
    assert.ok(app.run('undoState'));
    assert.equal(app.run('undoLabel'),'공통 큐 자동 편성');
});
