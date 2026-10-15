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

test('자동 선발은 매칭 경기 수를 먼저, 동률에서 대기 시작 시각을 비교한다', () => {
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

test('혼복 선발은 남녀 각각 오래 기다린 두 명을 선택한다', () => {
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
    bulk.set('bulkNames', '신규1\n신규2\n신규3');
    bulk.set('bulkGen', 'M');
    bulk.set('bulkTier', '3');
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
