const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const script = fs.readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const player = { id:1, name:'기존회원', gender:'M', tier:3, games:5, matchingOffset:2, lastTime:20, status:'waiting', shuttlecock:true };
const court = { id:1, type:'A', active:[], next:[], startTime:null };

function runtime(saved) {
    const storage = new Map(saved || [['bm_p_v13', JSON.stringify([player])], ['bm_c_v13', JSON.stringify([court])]]);
    const elements = new Map();
    const element = () => ({value:'', style:{}, classList:{toggle(){}, add(){}, remove(){}}, setAttribute(){}, addEventListener(){}, focus(){}, click(){}});
    const context = vm.createContext({
        console, Blob, URL, navigator:{},
        document:{getElementById(id) { if(!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement:element, addEventListener(){}},
        window:{navigator:{}, matchMedia:() => ({matches:false}), addEventListener(){}},
        localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value)},
        setTimeout(){}, clearTimeout(){}, setInterval(){}
    });
    vm.runInContext(script, context);
    return {context, storage, run:code => vm.runInContext(code, context), set:(id, value) => { context.document.getElementById(id).value = value; }};
}

let app = runtime();
assert.equal(app.run('members.length'), 0, '기존 저장 데이터는 회원 목록 없이 읽을 수 있어야 합니다.');
app.run('saveRosterAsMembers(); saveRosterAsMembers()');
assert.equal(app.run('members.length'), 1);
assert.equal(app.run('players[0].memberId === members[0].id'), true);
assert.equal(app.run('Object.keys(members[0]).sort().join(",")'), 'gender,id,name,tier');

app = runtime(app.storage);
assert.equal(app.run('members.length'), 1, '재접속 시 회원을 보존해야 합니다.');
app.run('openMembersModal(); selectVisibleMembers()');
assert.equal(app.run('selectedMemberIds.size'), 0, '참가 중인 회원은 중복 선택할 수 없습니다.');

app.run('openMemberEditor()');
app.set('memberNames', '신규회원\n신규회원\n<회원 & 이름>');
app.set('memberGender', 'F');
app.set('memberTier', '2');
app.run('saveMember()');
assert.equal(app.run('members.length'), 3, '일괄 등록에서 같은 프로필 중복을 제외해야 합니다.');
assert.equal(app.run('players.length'), 1, '회원 등록만으로 당일 대기실에 추가하면 안 됩니다.');
assert.equal(app.run('document.getElementById("memberList").innerHTML.includes("&lt;회원 &amp; 이름&gt;")'), true);

app.set('memberSearch', '신규');
app.run('selectVisibleMembers(); loadSelectedMembers()');
assert.equal(app.run('players.length'), 2);
assert.equal(app.run('players[1].games === 0 && players[1].matchingOffset === 6 && !players[1].shuttlecock && players[1].status === "waiting"'), true, '출석에는 이전 경기나 셔틀콕 정보를 복사하지 않고 현행 매칭 기준을 적용해야 합니다.');
app.run('openMembersModal(); selectedMemberIds.add(members[1].id); loadSelectedMembers()');
assert.equal(app.run('players.length'), 2, '직접 호출해도 중복 참석을 방지해야 합니다.');

app.run('startNewMeeting(); executeConfirm()');
assert.equal(app.run('players.length === 0 && members.length === 3 && history.length === 0'), true);
app.run('selectVisibleMembers(); loadSelectedMembers()');
assert.equal(app.run('players.length'), 3);
assert.equal(app.run('players.every(p => p.games === 0 && p.matchingOffset === 0 && p.lastTime === 0 && !p.shuttlecock)'), true);
assert.equal(app.run('new Set(players.map(p => p.id)).size'), 3, '같은 순간 불러온 회원들의 선수 ID는 고유해야 합니다.');

app.run('openMemberEditor(members[0].id)');
app.set('memberNames', '수정회원');
app.set('memberTier', '5');
app.run('saveMember()');
assert.equal(app.run('players.find(p => p.memberId === members[0].id).name'), '수정회원');
app.run('deleteMember(members[0].id); executeConfirm()');
assert.equal(app.run('members.length === 2 && players.length === 3 && players[0].memberId === undefined'), true);
app.run('undoLastAction(); executeConfirm()');
assert.equal(app.run('members.length === 3 && players[0].memberId === members[0].id'), true, '되돌리기는 회원 연결도 복원해야 합니다.');

const backup = app.run('serializeState()');
app.run('resetAll(); executeConfirm()');
assert.equal(app.run('members.length + players.length'), 0);
app.context.backup = JSON.parse(backup);
assert.equal(app.run('importValidatedData(backup)'), true);
assert.equal(app.run('members.length === 3 && players.length === 3'), true, '백업 복구 시 회원과 참석자를 모두 복원해야 합니다.');
app.context.legacy = {players:[player], courts:[court], history:[]};
assert.equal(app.run('importValidatedData(legacy)'), true);
assert.equal(app.run('members.length'), 3, '이전 형식 백업으로 복구해도 저장된 회원은 유지해야 합니다.');
app.run('restoreBeforeImport(); executeConfirm()');
assert.equal(app.run('players.length === 3 && members.length === 3'), true);

for(const change of [
    data => { data.members = {}; },
    data => { data.members.push({...data.members[0]}); },
    data => { data.members[0].tier = 9; },
    data => { data.players[0].memberId = -1; },
    data => { data.players[1].memberId = data.players[0].memberId; }
]) {
    const invalid = JSON.parse(backup);
    change(invalid);
    app.context.invalid = invalid;
    const before = app.run('serializeState()');
    assert.equal(app.run('importValidatedData(invalid)'), false);
    assert.equal(app.run('serializeState()'), before, '잘못된 백업으로 기존 데이터를 변경하면 안 됩니다.');
}

app.run('openMemberEditor()');
app.set('memberNames', '저장실패회원');
const beforeFailure = app.run('serializeState()');
app.context.localStorage.setItem = () => { throw new Error('quota'); };
app.run('saveMember()');
assert.equal(app.run('serializeState()'), beforeFailure, '저장 실패 시 회원 변경을 취소해야 합니다.');

console.log('회원 등록·중복 방지·출석·재접속·새 모임·수정·삭제·백업·되돌리기·저장 실패 테스트 통과');
