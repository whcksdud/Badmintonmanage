const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { runApp } = require('./helpers/app-runtime');
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
    runApp(context);
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
assert.equal(app.run('players[1].games === 0 && players[1].matchingOffset === 7 && !players[1].shuttlecock && players[1].status === "waiting"'), true, '출석에는 이전 경기나 셔틀콕 정보를 복사하지 않고 활동 선수 평균의 매칭 기준을 적용해야 합니다.');
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

test('참석자 선택은 참가 중 회원을 구분하고 검색·탭 전환 중 선택을 보존한다', () => {
    const ui=runtime();
    ui.run('members=[{id:101,name:"기존회원",gender:"M",tier:3},{id:102,name:"새회원",gender:"F",tier:2},{id:103,name:"다른회원",gender:"M",tier:1}]; openMembersModal(); toggleMemberSelection(102,true)');
    let content=ui.run('document.getElementById("memberList").innerHTML');
    assert.ok(content.includes('aria-label="참석자 선택"') && content.includes('aria-label="참가 중"'));
    assert.ok(content.includes('member-choice-101" type="checkbox" disabled'));
    assert.ok(content.includes('is-selected') && content.includes('member-choice-102" type="checkbox"  checked'));
    ui.set('memberSearch','다른');
    ui.run('renderMembers(); setMemberView("register"); setMemberView("select")');
    assert.equal(ui.run('selectedMemberIds.has(102)'),true);
    assert.equal(ui.run('document.getElementById("memberSearchSummary").innerText'),'검색 결과 1명');
    assert.equal(ui.run('document.getElementById("loadMembersButton").innerText'),'선택 1명 불러오기');
    ui.run('selectVisibleMembers(); loadSelectedMembers()');
    assert.equal(ui.run('players.length'),3);
    assert.equal(ui.run('players.filter(p=>p.name==="기존회원").length'),1);
});

test('전체 선택·선택 해제 버튼은 선택 가능한 회원 수에 맞춰 활성화된다', () => {
    const ui=runtime();
    ui.run('members=[{id:101,name:"기존회원",gender:"M",tier:3}]; openMembersModal()');
    assert.equal(ui.run('document.getElementById("memberSelectAll").disabled'),true);
    assert.equal(ui.run('document.getElementById("memberClearSelection").disabled'),true);
    ui.run('members.push({id:102,name:"신규",gender:"F",tier:1}); renderMembers()');
    assert.equal(ui.run('document.getElementById("memberSelectAll").disabled'),false);
    ui.run('selectVisibleMembers()');
    assert.equal(ui.run('document.getElementById("memberSelectAll").disabled'),true);
    assert.equal(ui.run('document.getElementById("memberClearSelection").disabled'),false);
    ui.set('memberSearch','없는이름');
    ui.run('renderMembers()');
    assert.ok(ui.run('document.getElementById("memberList").innerHTML').includes('검색 결과가 없습니다.'));
    assert.equal(ui.run('selectedMemberIds.size'),1);
    ui.run('selectedMemberIds.clear(); renderMembers()');
    assert.equal(ui.run('document.getElementById("loadMembersButton").disabled'),true);
});

test('등록 방식 전환은 입력을 보존하고 회원과 게스트를 각각 올바른 명단에 저장한다', () => {
    const ui = runtime();
    ui.run('openMembersModal(); setMemberView("register"); openMemberEditor()');
    ui.set('memberNames', '등록예시\n등록예시');
    ui.set('memberGender', 'F');
    ui.set('memberTier', '2');
    ui.run('setMemberRegistrationMode("guest"); setMemberRegistrationMode("member")');
    assert.equal(ui.run('document.getElementById("memberNames").value'), '등록예시\n등록예시');
    assert.equal(ui.run('document.getElementById("memberGender").value'), 'F');
    assert.equal(ui.run('document.getElementById("memberTier").value'), '2');
    ui.run('saveMember()');
    assert.equal(ui.run('members.length'), 1);
    assert.equal(ui.run('players.length'), 1);
    ui.run('openMemberEditor(); setMemberRegistrationMode("guest")');
    ui.set('memberNames', '게스트1\n게스트2');
    ui.set('memberGender', 'F');
    ui.set('memberTier', '2');
    ui.run('saveMember()');
    assert.equal(ui.run('members.length'), 1);
    assert.equal(ui.run('players.length'), 3);
    assert.equal(ui.run('players.slice(1).every(p => p.gender === "F" && p.tier === 2 && p.status === "waiting" && p.memberId === undefined)'), true);
    const reloaded = runtime(ui.storage);
    assert.equal(reloaded.run('members.length === 1 && players.length === 3'), true);
});

test('회원 수정은 게스트 방식으로 전환되지 않고 취소와 재열기는 등록 기본값을 복원한다', () => {
    const ui = runtime();
    ui.run('members=[{id:101,name:"회원",gender:"M",tier:3}]; openMemberEditor(); setMemberRegistrationMode("guest"); closeMemberEditor(); openMemberEditor()');
    assert.equal(ui.run('memberRegistrationMode'), 'member');
    assert.equal(ui.run('document.getElementById("memberNames").value'), '');
    ui.run('openMemberEditor(101); setMemberRegistrationMode("guest")');
    assert.equal(ui.run('document.getElementById("registrationModeField").hidden'), true);
    ui.set('memberNames', '수정회원');
    ui.run('saveMember()');
    assert.equal(ui.run('members[0].name'), '수정회원');
    assert.equal(ui.run('players.length'), 1);
});

test('게스트 등록 저장 실패는 회원과 대기실을 복구하고 입력 창을 유지한다', () => {
    const ui = runtime();
    ui.run('openMemberEditor(); setMemberRegistrationMode("guest")');
    ui.set('memberNames', '저장실패');
    const before = ui.run('serializeState()');
    ui.context.localStorage.setItem = () => { throw new Error('quota'); };
    ui.run('saveMember()');
    assert.equal(ui.run('serializeState()'), before);
    assert.equal(ui.run('document.getElementById("memberEditorModal").style.display'), 'flex');
});

test('게스트 표시는 같은 프로필의 회원이 있어도 구분되고 재접속·정보 수정·백업 복구 후 유지된다', () => {
    const ui = runtime();
    ui.run('members=[{id:101,name:"등록예시",gender:"F",tier:2}]; openMemberEditor(); setMemberRegistrationMode("guest")');
    ui.set('memberNames', '등록예시');
    ui.set('memberGender', 'F');
    ui.set('memberTier', '2');
    ui.run('saveMember()');
    assert.equal(ui.run('players[1].isGuest'), true);
    assert.match(ui.run('renderRosterSummary(players[1])'), /class="roster-guest-badge">게스트/);
    const reloaded = runtime(ui.storage);
    reloaded.run('openPModal(players[1].id)');
    reloaded.set('pName', '수정게스트');
    reloaded.run('savePlayer()');
    assert.equal(reloaded.run('isGuestPlayer(players[1])'), true);
    reloaded.run('var guestBackup=JSON.parse(serializeState()); validateImportData(guestBackup); applyState(JSON.stringify(guestBackup)); render()');
    assert.match(reloaded.run('document.getElementById("waitList").innerHTML'), /roster-guest-badge/);
    assert.equal(reloaded.run('players[1].name'), '수정게스트');
});

test('기존 미저장 선수는 게스트로 표시하고 회원으로 불러온 선수와 저장 회원은 제외한다', () => {
    const ui = runtime();
    assert.equal(ui.run('isGuestPlayer(players[0])'), true);
    ui.run('members=[{id:101,name:"기존회원",gender:"M",tier:3},{id:102,name:"새회원",gender:"F",tier:2}]');
    assert.equal(ui.run('isGuestPlayer(players[0])'), false);
    ui.run('selectedMemberIds.add(102); loadSelectedMembers()');
    assert.doesNotMatch(ui.run('renderRosterSummary(players[1])'), /roster-guest-badge/);
    ui.run('players[0].isGuest="true"');
    assert.throws(() => ui.run('validateImportData(JSON.parse(serializeState()))'));
});

console.log('회원 등록·중복 방지·출석·재접속·새 모임·수정·삭제·백업·되돌리기·저장 실패 테스트 통과');
