const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');
const { runApp } = require('./helpers/app-runtime');

function player(id, overrides = {}) {
    return { id, name: `선수${id}`, gender: 'M', tier: 3, games: 2, matchingOffset: 0,
        lastTime: 0, status: 'waiting', waitingSince: id * 100, shuttlecock: false, ...overrides };
}
function court(id = 1, type = 'A', active = [], next = []) {
    return { id, type, active, next, startTime: active.length ? 1000 : null };
}
function runtime(state, random = () => 0, saved = null) {
    const storage = new Map(saved || [['bm_state_v14', JSON.stringify({ current: { members: [], history: [], ...state }, previous: null })]]);
    const elements = new Map();
    const clock = { now: 1000000 };
    class FakeDate extends Date { static now() { return clock.now; } }
    const math = Object.create(Math);
    math.random = random;
    const element = () => ({ value: '', innerText: '', innerHTML: '', style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, focus() {}, click() {} });
    const context = vm.createContext({
        console, Blob, URL, Date: FakeDate, Math: math, navigator: {},
        document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element, addEventListener() {} },
        window: { navigator: {}, matchMedia: () => ({ matches: false }), addEventListener() {} },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        setTimeout() {}, clearTimeout() {}, setInterval() {}
    });
    runApp(context);
    return { context, storage, clock, elements, run: code => vm.runInContext(code, context),
        json: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)),
        set: (id, value) => { context.document.getElementById(id).value = value; } };
}
function selectedIds(app) { return app.json('courts[0].next.map(p => p.id)').sort((a, b) => a - b); }

test('대기 선수가 충분하면 경기 수와 반복 조합에 앞서 대기 선수를 우선한다', () => {
    const roster=Array.from({length:8},(_,i)=>player(i+1,{games:i<4?0:10,status:i<4?'playing':'waiting'}));
    const app=runtime({players:roster,courts:[court(1,'A',roster.slice(0,4))],history:[{pIds:[5,6,7,8]}]});
    app.run('matchCourt(1)');
    assert.deepEqual(selectedIds(app),[5,6,7,8]);
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[1,2,3,4]);
    assert.equal(app.run('courts[0].startTime'),1000);
});

test('대기 인원이 부족한 경우에만 경기 중인 선수를 보충하고 현재 경기는 유지한다', () => {
    const roster=Array.from({length:7},(_,i)=>player(i+1,{games:i<4?0:10,status:i<4?'playing':i===6?'resting':'waiting'}));
    const app=runtime({players:roster,courts:[court(1,'A',roster.slice(0,4))]});
    app.run('matchCourt(1)');
    const ids=selectedIds(app);
    assert.equal(ids.length,4);
    assert.ok(ids.includes(5)&&ids.includes(6));
    assert.equal(ids.filter(id=>id<=4).length,2);
    assert.ok(!ids.includes(7));
    assert.equal(app.run('players.slice(0,4).every(p=>p.status==="playing"&&p.games===0)'),true);
    app.run('cancelNext(1)');
    assert.equal(app.run('players.slice(0,4).every(p=>p.status==="playing")'),true);
});

test('혼복은 성별마다 대기 선수를 우선하고 부족한 여성만 경기 중에서 보충한다', () => {
    const roster=[player(1,{status:'playing',gender:'F'}),player(2,{status:'playing',gender:'F'}),
        player(3,{status:'playing'}),player(4,{status:'playing'}),player(5,{games:10}),player(6,{games:10}),player(7,{games:10,gender:'F'})];
    const app=runtime({players:roster,courts:[court(1,'X',roster.slice(0,4))]});
    app.run('matchCourt(1)');
    assert.ok([5,6,7].every(id=>selectedIds(app).includes(id)));
    assert.equal(app.run('courts[0].next.filter(p=>p.gender==="F").length'),2);
    assert.equal(app.run('courts[0].next.slice(0,2).filter(p=>p.gender==="F").length'),1);
});

test('대기 인원이 없어도 다음 예약이 가능하고 이미 예약된 선수는 다시 선발하지 않는다', () => {
    const roster=Array.from({length:8},(_,i)=>player(i+1,{status:'playing'}));
    const app=runtime({players:roster,courts:[court(1,'A',roster.slice(0,4)),court(2,'A',roster.slice(4))]});
    app.run('matchCourt(1); matchCourt(2)');
    assert.equal(app.run('courts.every(c=>c.next.length===4)'),true);
    assert.equal(app.run('new Set(courts.flatMap(c=>c.next.map(p=>p.id))).size'),8);
    assert.equal(app.run('players.every(p=>p.status==="playing")'),true);
});

test('다른 코트 경기 중 선수가 포함된 자동 예약은 그 경기 종료 전에는 시작하지 않는다', () => {
    const roster=Array.from({length:6},(_,i)=>player(i+1,{status:i<4?'playing':'waiting'}));
    const app=runtime({players:roster,courts:[court(1,'A',roster.slice(0,4)),court(2)]});
    app.run('matchCourt(2)');
    const reserved=app.json('courts[1].next.map(p=>p.id)');
    app.run('completeGame(2)');
    assert.equal(app.run('courts[1].active.length'),0);
    assert.deepEqual(app.json('courts[1].next.map(p=>p.id)'),reserved);
    app.run('completeGame(1); completeGame(2)');
    assert.deepEqual(app.json('courts[1].active.map(p=>p.id)'),reserved);
    assert.equal(app.run('courts[1].next.length'),0);
    assert.equal(app.run('history.length'),1);
});

test('예약 버튼 안 유형 목록은 한 코트씩 열리고 외부 클릭·Escape·재클릭으로 닫힌다', () => {
    const roster=Array.from({length:12},(_,i)=>player(i+1));
    const app=runtime({players:roster,courts:[court(1),court(2),court(3,'A',[],roster.slice(0,4))]});
    const before=app.run('serializeState()');
    assert.equal(app.run('toggleReserveTypeMenu(1)'),true);
    assert.equal(app.elements.get('reserve-type-menu-1').hidden,false);
    app.run('handleReserveTypeOutside({target:{closest:()=>({})}})');
    assert.equal(app.run('openReserveTypeCourtId'),1);
    app.run('toggleReserveTypeMenu(2)');
    assert.equal(app.elements.get('reserve-type-menu-1').hidden,true);
    assert.equal(app.elements.get('reserve-type-menu-2').hidden,false);
    assert.equal(app.run('toggleReserveTypeMenu(3)'),false,'예약이 있는 코트의 유형 목록은 열지 않습니다.');
    app.run('handleReserveTypeEscape({key:"Escape"})');
    assert.equal(app.run('openReserveTypeCourtId'),null);
    assert.equal(app.elements.get('reserve-type-menu-2').hidden,true);
    app.run('toggleReserveTypeMenu(1); handleReserveTypeOutside({target:{closest:()=>null}})');
    assert.equal(app.elements.get('reserve-type-menu-1').hidden,true);
    app.run('toggleReserveTypeMenu(1)');
    assert.equal(app.run('toggleReserveTypeMenu(1)'),false);
    assert.equal(app.run('serializeState()'),before);
});

test('오른쪽에서 유형만 바꾸면 편성을 유지하고 왼쪽 예약은 선택한 유형으로 실행한다', () => {
    const roster=Array.from({length:12},(_,i)=>player(i+1,{gender:i>=8?'F':'M',status:i<4?'playing':'waiting'}));
    const app=runtime({players:roster,courts:[court(1,'A',roster.slice(0,4)),court(2)]});
    const before=app.json('[players,courts.map(c=>[c.active,c.next,c.startTime]),history]');
    app.run('toggleReserveTypeMenu(1)');
    assert.equal(app.run('setType(1,"F")'),true);
    assert.equal(app.run('openReserveTypeCourtId'),null);
    assert.deepEqual(app.json('[players,courts.map(c=>[c.active,c.next,c.startTime]),history]'),before);
    assert.ok(app.elements.get('courtGrid').innerHTML.includes('aria-label="코트 1 예약 경기 유형 · 여복"'));
    const changed=app.run('serializeState()');
    assert.equal(app.run('setType(99,"X")'),false);
    assert.equal(app.run('setType(1,"invalid")'),false);
    assert.equal(app.run('serializeState()'),changed);
    app.context.localStorage.setItem=()=>{throw new Error('quota');};
    assert.equal(app.run('setType(1,"M")'),false);
    assert.equal(app.run('courts[0].type'),'F');
    assert.equal(app.run('serializeState()'),changed);
    app.context.localStorage.setItem=(key,value)=>app.storage.set(key,value);
    app.run('matchCourt(1)');
    assert.deepEqual(selectedIds(app),[9,10,11,12]);
    assert.equal(app.run('courts[0].next.every(p=>p.gender==="F")'),true);
    assert.equal(app.run('courts[1].next.length'),0);
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[1,2,3,4]);
    assert.equal(app.run('courts[0].startTime'),1000);
    assert.ok(!app.elements.get('courtGrid').innerHTML.includes('id="reserve-type-1"'));
    app.run('undoLastAction(); executeConfirm()');
    assert.equal(app.run('courts[0].next.length'),0);
    assert.equal(app.run('courts[0].type'),'F');
});

test('조합 이력이 없으면 자동 선발은 경기 수와 대기 시작 시각 순서를 따른다', () => {
    const roster = [
        player(1, { games: 1, matchingOffset: 2, waitingSince: 0 }),
        player(2, { waitingSince: 200 }), player(3, { waitingSince: 100 }),
        player(4, { waitingSince: 150 }), player(5, { waitingSince: 250 }), player(6, { waitingSince: 300 })
    ];
    for (const random of [() => 0, () => .999]) {
        const app = runtime({ players: roster, courts: [court()] }, random);
        app.run('matchCourt(1)');
        assert.deepEqual(selectedIds(app), [2,3,4,5]);
        assert.equal(app.run('players[0].status'), 'waiting', '대기가 길어도 매칭 경기 수가 더 많으면 후순위입니다.');
        assert.equal(app.run('players[2].waitingSince'), 100, '예약은 대기 시작 시각을 보존합니다.');
    }
});

test('조합 이력이 없으면 혼복 선발은 남녀 각각 오래 기다린 두 명을 선택한다', () => {
    const roster = [300,100,200,400,350,150,250,450].map((waitingSince, i) => player(i+1, { gender: i < 4 ? 'M' : 'F', waitingSince }));
    const app = runtime({ players: roster, courts: [court(1, 'X')] });
    app.run('matchCourt(1)');
    assert.deepEqual(selectedIds(app), [2,3,6,7]);
    assert.equal(app.run('courts[0].next.slice(0,2).filter(p=>p.gender==="M").length'), 1);
    assert.equal(app.run('courts[0].next.slice(2).filter(p=>p.gender==="M").length'), 1);
});

test('매칭 경기 수와 대기 시작 시각이 모두 같으면 무작위 선발을 유지한다', () => {
    const roster = Array.from({ length: 6 }, (_, i) => player(i+1, { waitingSince: 100 }));
    const selections = [() => 0, () => .999].map(random => {
        const app = runtime({ players: roster, courts: [court()] }, random);
        app.run('matchCourt(1)');
        return selectedIds(app);
    });
    assert.notDeepEqual(selections[0], selections[1], '완전 동률을 명단 순서로 고정하지 않습니다.');
});

test('예약 취소·재접속·백업 복구 후에도 대기 우선순위가 이어진다', () => {
    const roster = [500,100,400,200,300].map((waitingSince, i) => player(i+1, { waitingSince }));
    let app = runtime({ players: roster, courts: [court()] });
    app.run('matchCourt(1); cancelNext(1)');
    assert.deepEqual(app.json('players.map(p=>p.waitingSince)'), [500,100,400,200,300]);
    app = runtime(null, () => .999, app.storage);
    app.context.backup = app.json('JSON.parse(serializeState())');
    assert.equal(app.run('importValidatedData(backup)'), true);
    app.run('matchCourt(1)');
    assert.deepEqual(selectedIds(app), [2,3,4,5]);
});

function arrivalState() {
    const roster = Array.from({ length: 9 }, (_, i) => player(i+1, {
        games: i < 4 ? 6 : i < 8 ? 5 : 100,
        status: i < 4 ? 'playing' : i < 8 ? 'reserved' : 'resting', waitingSince: i < 4 || i === 8 ? null : 100
    }));
    roster[0].games = 1;
    roster[0].matchingOffset = 5;
    return { players: roster, courts: [court(1, 'A', roster.slice(0,4), roster.slice(4,8))],
        members: [{ id: 501, name: '불러올회원1', gender: 'M', tier: 3 }, { id: 502, name: '불러올회원2', gender: 'F', tier: 3 }] };
}

test('신규 참가자는 활동 선수의 보정 포함 평균 5.5를 버림한 5로 시작한다', () => {
    const app = runtime(arrivalState());
    const before = app.json('players.map(p=>[p.games,p.matchingOffset])');
    assert.equal(app.run('getInitialMatchingGames()'), 5, '대기·예약·진행 선수는 포함하고 휴식 선수는 제외합니다.');
    app.run('openPModal()');
    app.set('pName', '신규');
    app.run('savePlayer()');
    assert.equal(app.run('players.at(-1).games'), 0);
    assert.equal(app.run('getMatchingGameCount(players.at(-1))'), 5);
    assert.equal(app.run('players.at(-1).waitingSince'), app.clock.now);
    assert.deepEqual(app.json('players.slice(0,-1).map(p=>[p.games,p.matchingOffset])'), before);
});

test('일괄 등록과 회원 불러오기도 같은 평균 기준을 적용한다', () => {
    const bulk = runtime(arrivalState());
    bulk.set('memberNames', '신규1\n신규2\n신규3');
    bulk.set('memberGender', 'M');
    bulk.set('memberTier', '3');
    bulk.run('saveBulkPlayers()');
    assert.deepEqual(bulk.json('players.slice(-3).map(p=>[p.games,getMatchingGameCount(p)])'), [[0,5],[0,5],[0,5]]);
    const members = runtime(arrivalState());
    members.run('selectedMemberIds.add(501); selectedMemberIds.add(502); loadSelectedMembers()');
    assert.deepEqual(members.json('players.slice(-2).map(p=>[p.games,getMatchingGameCount(p)])'), [[0,5],[0,5]]);
});

test('직접 입력한 실제 경기 수는 평균보다 부족한 만큼만 보정한다', () => {
    for (const [games, expectedOffset] of [[3,2], [8,0]]) {
        const app = runtime(arrivalState());
        app.run('openPModal()');
        app.set('pName', '경기수입력');
        app.set('pGames', String(games));
        app.run('savePlayer()');
        assert.equal(app.run('players.at(-1).games'), games);
        assert.equal(app.run('players.at(-1).matchingOffset'), expectedOffset);
    }
    for (const roster of [[], [player(1, { status: 'resting', waitingSince: null, games: 100 })]]) {
        const app = runtime({ players: roster, courts: [court()] });
        assert.equal(app.run('getInitialMatchingGames()'), 0);
    }
});

for (const type of ['X', 'A']) for (const manual of [false, true]) {
    test(`${type === 'X' ? '혼복' : '자율'} 코트 ${manual ? '수동' : '자동'} 편성은 A남·E여 대 E남·A여로 균형을 맞춘다`, () => {
        const roster = [player(1,{tier:5}),player(2,{tier:1}),player(3,{tier:5,gender:'F'}),player(4,{tier:1,gender:'F'})];
        const app = runtime({ players: roster, courts: [court(1,type)] });
        if (manual) app.run('openManualMatch(1); [1,2,3,4].forEach(toggleManualSelect); confirmManualMatch()');
        else app.run('matchCourt(1)');
        assert.deepEqual(app.json('[courts[0].next.slice(0,2),courts[0].next.slice(2)].map(team=>team.reduce((sum,p)=>sum+p.tier,0))'), [6,6]);
        assert.equal(app.run('courts[0].next.slice(0,2).filter(p=>p.gender==="M").length'), 1);
        assert.equal(app.run('courts[0].next.slice(2).filter(p=>p.gender==="M").length'), 1);
    });
}

test('혼복은 파트너 이력이 많아도 전력 차이가 작은 조합을 우선한다', () => {
    const roster = [player(1,{tier:5}),player(2,{tier:1}),player(3,{tier:5,gender:'F'}),player(4,{tier:1,gender:'F'})];
    const app = runtime({ players: roster, courts: [court(1,'X')] });
    app.run('history=Array.from({length:100},()=>({pIds:[1,4,2,3]})); applyMatch(1,[...players],"next")');
    assert.deepEqual(app.json('courts[0].next.map(p=>p.id)'), [1,4,2,3]);
});

test('혼복 전력 차이가 같으면 파트너 중복이 적은 조합을 선택한다', () => {
    const roster = [player(1,{tier:5}),player(2,{tier:1}),player(3,{tier:3,gender:'F'}),player(4,{tier:3,gender:'F'})];
    const app = runtime({ players: roster, courts: [court(1,'X')] });
    app.run('history=[{pIds:[1,3,2,4]}]; applyMatch(1,[...players],"next")');
    assert.deepEqual(app.json('courts[0].next.map(p=>p.id)'), [1,4,2,3]);
    app.run('history=[{pIds:[1,4,2,3]}]; applyMatch(1,[...players],"next")');
    assert.deepEqual(app.json('courts[0].next.map(p=>p.id)'), [1,3,2,4]);
});

test('혼복의 급수 625가지 조합에서 남녀 조건을 지키며 가능한 최소 전력 차이를 만든다', () => {
    const roster = [player(1),player(2),player(3,{gender:'F'}),player(4,{gender:'F'})];
    const app = runtime({ players: roster, courts: [court(1,'X')] });
    for (let m1=1;m1<=5;m1++) for (let m2=1;m2<=5;m2++) for (let f1=1;f1<=5;f1++) for (let f2=1;f2<=5;f2++) {
        app.context.tierValues = [m1,m2,f1,f2];
        app.run('players.forEach((p,i)=>p.tier=tierValues[i]); applyMatch(1,[...players],"next")');
        const teams = app.json('[courts[0].next.slice(0,2),courts[0].next.slice(2)]');
        assert.ok(teams.every(team => team.filter(p=>p.gender==='M').length === 1));
        const gap = Math.abs(teams[0].reduce((sum,p)=>sum+p.tier,0)-teams[1].reduce((sum,p)=>sum+p.tier,0));
        assert.equal(gap, Math.min(Math.abs(m1+f1-m2-f2),Math.abs(m1+f2-m2-f1)));
    }
});

function rotatingGroupsState() {
    const roster = Array.from({ length: 12 }, (_, i) => player(i+1, {
        tier: 1, games: i < 4 ? 6 : i < 8 ? 4 : 5, matchingOffset: i < 4 ? 0 : 1,
        status: i < 4 ? 'reserved' : i < 8 ? 'playing' : 'waiting',
        waitingSince: i < 4 ? 997000 : i < 8 ? null : 999000
    }));
    const cohorts = [roster.slice(8), roster.slice(0,4), roster.slice(4,8)];
    const history = Array.from({ length: 12 }, (_, i) => ({
        cId: 1, startTime: 99000-i*1000, endTime: 999000-i*1000,
        pIds: cohorts[i%3].map(p=>p.id)
    }));
    return { players: roster, courts: [court(1,'A',roster.slice(4,8),roster.slice(0,4))], history };
}

test('12명이 종료·승계·다음 예약을 반복해도 같은 세 조로 고정되지 않는다', () => {
    for (const interval of [2000, 15*60000, 25*60000]) for (const random of [() => .1, () => .5, () => .9]) {
        const app = runtime(rotatingGroupsState(), random);
        const groups = new Set();
        const companions = new Map(Array.from({ length: 12 }, (_, i) => [i+1,new Set()]));
        for(let round=0; round<18; round++) {
            app.clock.now += interval;
            app.run('completeGame(1); matchCourt(1)');
            const ids = selectedIds(app);
            groups.add(ids.join(','));
            ids.forEach(id => ids.filter(other=>other!==id).forEach(other=>companions.get(id).add(other)));
            assert.equal(ids.length,4);
            assert.equal(new Set(ids).size,4);
            assert.ok(app.run('Math.max(...players.map(getMatchingGameCount))-Math.min(...players.map(getMatchingGameCount))') <= 1);
        }
        assert.ok(groups.size >= 8, `${interval}ms 간격에서 ${groups.size}개 조만 순환합니다.`);
        assert.ok([...companions.values()].every(set=>set.size>=5), '모든 선수가 기존 조 밖의 선수들과도 경기해야 합니다.');
    }
});

test('조합 다양성을 높여도 적은 경기 수와 가장 오래 기다린 선수는 보호한다', () => {
    const roster = Array.from({ length: 8 }, (_, i) => player(i+1, { games: i === 0 ? 1 : 2,
        waitingSince: i === 0 ? 999999 : (i-1)*100 }));
    const app = runtime({ players: roster, courts: [court()], history: [{ pIds:[1,2,3,4] }] });
    app.run('matchCourt(1)');
    assert.ok(selectedIds(app).includes(1), '대기 시간이 짧아도 경기 수가 더 적으면 먼저 선발합니다.');
    assert.ok(selectedIds(app).includes(2), '경기 수 경계에서 가장 오래 기다린 선수를 제외하면 안 됩니다.');
    assert.notDeepEqual(selectedIds(app), [1,2,3,4], '선택 가능한 동률 후보가 있으면 반복 조를 바꿉니다.');
});

test('대기 차이가 한 경기 범위를 넘으면 반복 조여도 오래 기다린 선수들을 먼저 선발한다', () => {
    const roster = Array.from({ length: 8 }, (_, i) => player(i+1, { waitingSince: i < 4 ? 0 : 2000000 }));
    const app = runtime({ players: roster, courts: [court()], history: [{ pIds:[1,2,3,4],cId:1,startTime:1000,endTime:901000 }] });
    app.clock.now = 2000000;
    app.run('matchCourt(1)');
    assert.deepEqual(selectedIds(app), [1,2,3,4]);
});

test('혼복 선발도 남녀 2명씩 유지하면서 반복된 네 명을 섞는다', () => {
    const roster = Array.from({ length: 8 }, (_, i) => player(i+1, { gender:i<4?'M':'F',waitingSince:i%4<2?100:200 }));
    const app = runtime({ players: roster, courts:[court(1,'X')], history:[{pIds:[1,2,5,6]},{pIds:[3,4,7,8]}] });
    app.run('matchCourt(1)');
    assert.equal(app.run('courts[0].next.filter(p=>p.gender==="M").length'),2);
    assert.equal(app.run('courts[0].next.filter(p=>p.gender==="F").length'),2);
    assert.notDeepEqual(selectedIds(app),[1,2,5,6]);
    assert.notDeepEqual(selectedIds(app),[3,4,7,8]);
});
