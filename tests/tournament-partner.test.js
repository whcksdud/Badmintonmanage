const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runApp } = require('./helpers/app-runtime');

const player = (id, extra = {}) => ({id, name:`선수${id}`, gender:'M', tier:3, games:0, lastTime:0, status:'waiting', waitingSince:id*100, ...extra});
const court = (id=1, extra={}) => ({id,type:'A',active:[],next:[],startTime:null,...extra});
function runtime(roster, courts=[court()], saved=null) {
    const storage = new Map(saved || [['bm_state_v14',JSON.stringify({current:{players:roster,courts,history:[],members:[]},previous:null})]]);
    const elements = new Map();
    const element = () => ({value:'',innerText:'',innerHTML:'',hidden:false,style:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},addEventListener(){},focus(){},click(){}});
    const math = Object.create(Math); math.random=()=>0;
    class Clock extends Date { static now(){return 10000000;} }
    const context=vm.createContext({console,Blob,URL,Date:Clock,Math:math,navigator:{},
        document:{getElementById(id){if(!elements.has(id)) elements.set(id,element());return elements.get(id);},createElement:element,addEventListener(){}},
        window:{navigator:{},matchMedia:()=>({matches:false}),addEventListener(){}},
        localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
        setTimeout(){},clearTimeout(){},setInterval(){}});
    runApp(context);
    return {context,storage,elements,run:code=>vm.runInContext(code,context),json:code=>JSON.parse(vm.runInContext(`JSON.stringify(${code})`,context)),set:(id,value)=>{context.document.getElementById(id).value=value;}};
}
const roster = (count=6) => Array.from({length:count},(_,i)=>player(i+1));
function setPartner(app, id, other) { app.run(`openPModal(${id})`); app.set('pPartner', other===null?'':String(other)); app.run('savePlayer()'); }
function sameTeam(app,a,b) { const ids=app.json('matchQueue.at(-1).players.map(p=>p.id)'); return ids.includes(a)&&ids.includes(b)&&Math.floor(ids.indexOf(a)/2)===Math.floor(ids.indexOf(b)/2); }

test('파트너 지정·변경·해제는 양쪽에 반영되고 이미 지정된 상대와 자기 자신은 거절한다',()=>{
    const app=runtime(roster());
    setPartner(app,1,2);
    assert.equal(app.run('getTournamentPartner(players[0]).id'),2);
    app.run('openPModal(2)'); assert.equal(app.elements.get('pPartner').value,'1');
    setPartner(app,1,3);
    assert.equal(app.run('players[1].tournamentPartnerId'),undefined);
    assert.equal(app.run('players[2].tournamentPartnerId'),1);
    const before=app.run('serializeState()');
    setPartner(app,4,3); assert.equal(app.run('serializeState()'),before);
    setPartner(app,1,1); assert.equal(app.run('serializeState()'),before);
    setPartner(app,1,null);
    assert.equal(app.run('players.every(p=>p.tournamentPartnerId===undefined)'),true);
});

test('파트너 목록은 이름을 이스케이프하고 중복 지정 후보를 비활성화한다',()=>{
    const app=runtime([player(1),player(2,{name:'<img src=x onerror=alert(1)>'}),player(3),player(4)]);
    setPartner(app,3,4); app.run('openPModal(1)');
    const options=app.elements.get('pPartner').innerHTML;
    assert.ok(options.includes('&lt;img'));
    assert.ok(!options.includes('<img'));
    assert.match(options,/<option value="3" disabled>/);
    assert.ok(!options.includes('<option value="1"'));
    app.run('openPModal()'); assert.equal(app.elements.get('pPartnerField').hidden,true);
});

test('자동 선발은 출전 가능한 동순위 후보 안에서 지정 파트너를 함께 선택한다',()=>{
    const app=runtime(roster(5)); setPartner(app,1,5);
    app.run('autoQueueMatch(courts[0].type)');
    assert.equal(sameTeam(app,1,5),true);
    assert.equal(app.run('matchQueue.at(-1).players.length'),4);
});

test('파트너 때문에 적은 경기 수의 선수나 허용 대기 범위 밖의 선수를 건너뛰지 않는다',()=>{
    for(const condition of [{games:1},{waitingSince:2000000}]) {
        const app=runtime(roster(5).map(p=>({...p,waitingSince:0,...(p.id===5?condition:{})})));
        setPartner(app,1,5); app.run('autoQueueMatch(courts[0].type)');
        assert.deepEqual(app.json('matchQueue.at(-1).players.map(p=>p.id).sort((a,b)=>a-b)'),[1,2,3,4]);
    }
    const app=runtime(roster(6).map(p=>({...p,games:p.id===1?0:1})));
    setPartner(app,5,6);app.run('autoQueueMatch(courts[0].type)');
    assert.equal(app.run('matchQueue.at(-1).players.some(p=>p.id===1)'),true);
});

test('휴식·경기 중·다른 예약의 파트너를 기다리거나 자동 후보에 끌어오지 않는다',()=>{
    for(const status of ['resting','playing','reserved']) {
        const list=roster(8);list[4].status=status;
        const extra=status==='resting'?[]:[court(2,{[status==='playing'?'active':'next']:list.slice(4,8),startTime:status==='playing'?1:null})];
        if(status!=='resting') list.slice(4).forEach(p=>p.status=status);
        const app=runtime(list,[court(),...extra]);setPartner(app,1,5);app.run('autoQueueMatch(courts[0].type)');
        assert.equal(app.run('matchQueue.at(-1).players.some(p=>p.id===1)'),true);
        assert.equal(app.run('matchQueue.at(-1).players.some(p=>p.id===5)'),false);
    }
});

test('자율·남복·여복의 지정 파트너는 급수 차이와 과거 파트너 이력보다 우선한다',()=>{
    for(const type of ['A','M','F']) {
        const app=runtime(roster(4).map(p=>({...p,gender:type==='F'?'F':'M',tier:p.id<=2?5:1})),[court(1,{type})]);
        setPartner(app,1,2);
        app.run('history=Array.from({length:20},()=>({pIds:[1,2,3,4]})); autoQueueMatch(courts[0].type)');
        assert.equal(sameTeam(app,1,2),true);
    }
});

test('혼복 지정은 남녀 팀을 유지하고 동성 파트너 지정은 혼복 편성을 방해하지 않는다',()=>{
    for(const pair of [[1,3],[1,2]]) {
        const app=runtime(roster(4).map(p=>({...p,gender:p.id<=2?'M':'F'})),[court(1,{type:'X'})]);
        setPartner(app,...pair);app.run('autoQueueMatch(courts[0].type)');
        const teams=app.json('[matchQueue.at(-1).players.slice(0,2),matchQueue.at(-1).players.slice(2)].map(team=>team.map(p=>p.gender).sort().join(""))');
        assert.deepEqual(teams,['FM','FM']);
        assert.equal(sameTeam(app,...pair),pair[1]===3);
    }
});

test('자율의 동성 지정 파트너와 두 쌍의 지정 파트너도 함께 편성된다',()=>{
    const app=runtime(roster(4).map(p=>({...p,gender:p.id<=2?'M':'F'})));
    setPartner(app,1,2);setPartner(app,3,4);app.run('autoQueueMatch(courts[0].type)');
    assert.equal(sameTeam(app,1,2),true);assert.equal(sameTeam(app,3,4),true);
});

test('수동 매칭은 선택한 네 명 안의 파트너를 같은 팀으로 편성한다',()=>{
    const app=runtime(roster());setPartner(app,1,2);
    app.run('queueType=courts[0].type; openManualMatch(); [1,2,3,4].forEach(toggleManualSelect); confirmManualMatch()');
    assert.equal(sameTeam(app,1,2),true);
    assert.equal(app.run('courts[0].active.length'),0);
});

test('지정 저장은 현재 경기·예약·타이머를 바꾸지 않고 재접속·백업 복구·되돌리기를 지원한다',()=>{
    const list=roster(8);list.forEach(p=>p.status=p.id<=4?'playing':'reserved');
    const app=runtime(list,[court(1,{active:list.slice(0,4),next:list.slice(4),startTime:123})]);
    const before=app.run('JSON.stringify(courts)');
    setPartner(app,1,2);
    assert.deepEqual(app.json('courts[0].active.map(p=>p.id)'),[1,2,3,4]);
    assert.deepEqual(app.json('matchQueue.at(-1).players.map(p=>p.id)'),[5,6,7,8]);
    assert.equal(app.run('courts[0].startTime'),123);
    const backup=app.run('serializeState()');
    const reloaded=runtime([],[],[...app.storage]);
    assert.equal(reloaded.run('getTournamentPartner(players[0]).id'),2);
    reloaded.run('undoLastAction(); executeConfirm()');
    assert.equal(reloaded.run('JSON.stringify(courts)'),before);
    assert.equal(reloaded.run('players[0].tournamentPartnerId'),undefined);
    app.context.backup=JSON.parse(backup);setPartner(app,1,null);
    assert.equal(app.run('importValidatedData(backup)'),true);
    assert.equal(app.run('getTournamentPartner(players[0]).id'),2);
});

test('파트너 변경 저장 실패는 양쪽 지정과 프로필을 함께 원복한다',()=>{
    const app=runtime(roster());setPartner(app,1,2);
    const before=app.run('serializeState()');
    app.run('openPModal(1)');app.set('pPartner','3');app.set('pName','바뀐 이름');
    app.context.localStorage.setItem=()=>{throw new Error('quota');};app.run('savePlayer()');
    assert.equal(app.run('serializeState()'),before);
});

test('선수 삭제 시 파트너 연결을 해제하고 되돌리면 복원한다',()=>{
    const app=runtime(roster());setPartner(app,1,2);app.run('openPModal(1); deletePlayer(); executeConfirm()');
    assert.equal(app.run('players.find(p=>p.id===2).tournamentPartnerId'),undefined);
    app.run('undoLastAction(); executeConfirm()');
    assert.equal(app.run('getTournamentPartner(players.find(p=>p.id===2)).id'),1);
});

test('자기 자신·없는 선수·비대칭·여러 명의 파트너 참조가 있는 백업은 적용하지 않는다',()=>{
    const app=runtime(roster());const before=app.run('serializeState()');
    for(const overrides of [[{id:1,tournamentPartnerId:1}],[{id:1,tournamentPartnerId:99}],[{id:1,tournamentPartnerId:2}], [{id:1,tournamentPartnerId:2},{id:2,tournamentPartnerId:1},{id:3,tournamentPartnerId:2}]]) {
        const list=roster();overrides.forEach(update=>Object.assign(list.find(p=>p.id===update.id),update));
        app.context.invalid={players:list,courts:[court()],history:[]};
        assert.equal(app.run('importValidatedData(invalid)'),false);
        assert.equal(app.run('serializeState()'),before);
    }
});

test('반복 매칭에서도 지정 파트너가 다른 선수의 경기 수 우선순위를 넘지 않는다',()=>{
    const app=runtime(roster(12));setPartner(app,1,2);setPartner(app,3,4);
    for(let i=0;i<12;i++) app.run('autoQueueMatch(courts[0].type); startQueuedGame(matchQueue[0].id,1); completeGame(1)');
    const games=app.json('players.map(p=>p.games)');
    assert.equal(games.reduce((a,b)=>a+b,0),48);
    assert.ok(Math.max(...games)-Math.min(...games)<=1);
    assert.equal(app.run('history.every(record=>[1,2].every(id=>record.pIds.includes(id)) ? Math.floor(record.pIds.indexOf(1)/2)===Math.floor(record.pIds.indexOf(2)/2) : true)'),true);
});

test('새 모임에서는 당일 파트너 연결을 비우고 저장 회원은 유지한다',()=>{
    const app=runtime(roster());setPartner(app,1,2);app.run('members=[{id:99,name:"회원",gender:"M",tier:3}]; saveAction("회원 저장"); startNewMeeting(); executeConfirm()');
    assert.equal(app.run('players.length'),0);assert.equal(app.run('members.length'),1);
});

test('이전 백업의 0번 선수도 기존 선수를 수정해 파트너를 지정한다',()=>{
    const app=runtime([player(0),player(1),player(2),player(3)]);
    setPartner(app,0,1);
    assert.equal(app.run('players.length'),4);
    assert.equal(app.run('getTournamentPartner(players[0]).id'),1);
    assert.equal(app.run('getTournamentPartner(players[1]).id'),0);
});

test('카드의 파트너 표시는 양쪽 지정·이름 수정·해제에 맞춰 갱신되고 이름을 안전하게 출력한다',()=>{
    const app=runtime([player(1),player(2,{name:'<img src=x>'}),player(3),player(4)]);
    setPartner(app,1,2);
    const paired=app.elements.get('waitList').innerHTML;
    assert.equal((paired.match(/class="roster-partner"/g)||[]).length,2);
    assert.ok(paired.includes('파트너 · &lt;img src=x&gt;'));
    assert.ok(!paired.includes('<img'));
    app.run('openPModal(2)');app.set('pName','새 파트너 이름');app.run('savePlayer()');
    assert.ok(app.elements.get('waitList').innerHTML.includes('파트너 · 새 파트너 이름'));
    const saved=app.run('serializeState()');app.run('renderRoster()');assert.equal(app.run('serializeState()'),saved);
    setPartner(app,1,null);
    assert.ok(!app.elements.get('waitList').innerHTML.includes('class="roster-partner"'));
});
