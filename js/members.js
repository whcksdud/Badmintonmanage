// Saved member directory and meeting attendance.

function sameMemberProfile(a, b) {
    return a.name.trim() === b.name.trim() && a.gender === b.gender && a.tier === b.tier;
}

function isMemberAttending(member) {
    return players.some(p => p.memberId === member.id || (p.memberId === undefined && sameMemberProfile(p, member)));
}

function openMembersModal() {
    selectedMemberIds.clear();
    document.getElementById('memberSearch').value = '';
    setMemberView('select');
    document.getElementById('membersModal').style.display = 'flex';
    document.getElementById('toast').classList.add('members-open');
    renderMembers();
}

function setMemberView(view) {
    const registration = view === 'register';
    document.getElementById('memberSelectPanel').hidden = registration;
    document.getElementById('memberRegisterPanel').hidden = !registration;
    document.getElementById('loadMembersButton').hidden = registration;
    ['Select', 'Register'].forEach((name, index) => {
        const active = registration === (index === 1);
        const tab = document.getElementById(`member${name}Tab`);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
    });
}

function handleMemberTabKey(event) {
    if(!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const registration = event.key === 'End' || (event.key !== 'Home' && event.target.id === 'memberSelectTab');
    setMemberView(registration ? 'register' : 'select');
    document.getElementById(registration ? 'memberRegisterTab' : 'memberSelectTab').focus();
}

function closeMemberEditor() { document.getElementById('memberEditorModal').style.display = 'none'; }

function closeMembersModal() {
    closeMemberEditor();
    document.getElementById('membersModal').style.display = 'none';
    document.getElementById('toast').classList.remove('members-open');
    selectedMemberIds.clear();
}

function visibleMembers() {
    const query = document.getElementById('memberSearch').value.trim().toLocaleLowerCase();
    return members.filter(m => m.name.toLocaleLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function renderMembers() {
    for(const id of selectedMemberIds) {
        const member = members.find(m => m.id === id);
        if(!member || isMemberAttending(member)) selectedMemberIds.delete(id);
    }
    const visible = visibleMembers();
    document.getElementById('memberSummary').innerText = `저장 회원 ${members.length}명 · 참가 중 ${members.filter(isMemberAttending).length}명`;
    const available = visible.filter(member => !isMemberAttending(member));
    const attendingMembers = visible.filter(isMemberAttending);
    const searching = document.getElementById('memberSearch').value.trim().length > 0;
    document.getElementById('memberSearchSummary').innerText = `${searching ? '검색 결과' : '전체'} ${visible.length}명`;
    document.getElementById('memberSelectAll').disabled = available.every(member => selectedMemberIds.has(member.id));
    document.getElementById('memberClearSelection').disabled = selectedMemberIds.size === 0;
    const renderMember = member => {
        const attending = isMemberAttending(member);
        return `<div class="member-row ${selectedMemberIds.has(member.id) ? 'is-selected' : ''} ${attending ? 'is-attending' : ''}">
            <label class="member-choice"><input id="member-choice-${member.id}" type="checkbox" ${attending ? 'disabled' : ''} ${selectedMemberIds.has(member.id) ? 'checked' : ''} onchange="toggleMemberSelection(${member.id}, this.checked)">
                <span class="member-profile"><span class="member-name">${escapeHTML(member.name)}</span><small>${member.gender === 'M' ? '남성' : '여성'} · ${tiers[member.tier]}</small>${attending ? '<span class="member-attending-badge">참가 중</span>' : ''}</span>
            </label>
            <button type="button" class="member-edit-button" onclick="openMemberEditor(${member.id})" aria-label="${escapeHTML(member.name)} 회원 수정" title="회원 수정">${renderUIIcon('edit')}</button>
        </div>`;
    };
    const renderGroup = (group, label) => group.length ? `<section class="member-group" aria-label="${label}"><h4>${label}<span>${group.length}명</span></h4><div class="member-grid">${group.map(renderMember).join('')}</div></section>` : '';
    document.getElementById('memberList').innerHTML = visible.length
        ? renderGroup(available, '참석자 선택') + renderGroup(attendingMembers, '참가 중')
        : (members.length
            ? `<div class="member-empty">${renderUIIcon('search')}<strong>검색 결과가 없습니다.</strong><span>다른 이름으로 검색해 주세요.</span></div>`
            : `<div class="member-empty">${renderUIIcon('users')}<strong>저장된 회원이 없어요</strong><span>회원 명단을 저장하면 모임마다 바로 불러올 수 있습니다.</span><button class="btn btn-outline" onclick="setMemberView('register')">회원 등록 시작하기</button></div>`);
    const button = document.getElementById('loadMembersButton');
    button.innerText = `선택 ${selectedMemberIds.size}명 불러오기`;
    button.disabled = selectedMemberIds.size === 0;
}

function toggleMemberSelection(id, checked) {
    if(checked) selectedMemberIds.add(id); else selectedMemberIds.delete(id);
    renderMembers();
    document.getElementById(`member-choice-${id}`)?.focus();
}

function selectVisibleMembers() {
    visibleMembers().filter(m => !isMemberAttending(m)).forEach(m => selectedMemberIds.add(m.id));
    renderMembers();
}

function openMemberEditor(id = null) {
    editMemberId = id;
    const member = members.find(m => m.id === id);
    document.getElementById('memberEditorTitle').innerText = member ? '회원 정보 수정' : '회원 등록';
    document.getElementById('memberNamesLabel').textContent = member ? '이름' : '이름 (여러 명은 줄바꿈으로 구분)';
    document.getElementById('memberNames').rows = member ? 1 : 4;
    document.getElementById('memberNames').value = member ? member.name : '';
    setFormChoice('memberGender', member ? member.gender : 'M', ['M', 'F']);
    setFormChoice('memberTier', member ? member.tier : 1, [5, 4, 3, 2, 1]);
    document.getElementById('deleteMemberButton').hidden = !member;
    document.getElementById('memberEditorModal').style.display = 'flex';
    document.getElementById('memberNames').focus();
}

function saveMember() {
    const names = document.getElementById('memberNames').value.split('\n').map(name => name.trim()).filter(Boolean);
    const gender = document.getElementById('memberGender').value;
    const tier = Number(document.getElementById('memberTier').value);
    if(!names.length) return showToast('회원 이름을 입력하세요.');
    if(!['M', 'F'].includes(gender) || !Number.isInteger(tier) || tier < 1 || tier > 5) return showToast('성별과 급수를 확인하세요.');
    if(editMemberId !== null) {
        if(names.length !== 1) return showToast('수정할 회원의 이름 하나만 입력하세요.');
        const member = members.find(m => m.id === editMemberId);
        if(!member) return showToast('회원을 찾을 수 없습니다.');
        const profile = {name:names[0], gender, tier};
        if(members.some(m => m.id !== editMemberId && sameMemberProfile(m, profile))) return showToast('같은 이름·성별·급수의 회원이 이미 있습니다. 동명이인은 이름에 구분을 추가하세요.');
        Object.assign(member, profile);
        players.filter(p => p.memberId === member.id).forEach(p => Object.assign(p, profile));
        if(!saveAction(`${member.name} 회원 정보 수정`)) return;
        showToast('회원 정보를 수정했습니다.');
    } else {
        let count = 0;
        names.forEach(name => {
            const profile = {name, gender, tier};
            if(members.some(m => sameMemberProfile(m, profile))) return;
            members.push({id:nextPersonId(), ...profile});
            count++;
        });
        if(!saveAction(`회원 ${count}명 등록`)) return;
        showToast(`회원 ${count}명 저장${names.length > count ? ` · 중복 ${names.length - count}명 제외` : ''}`);
    }
    closeMemberEditor(); setMemberView('select'); render(); renderMembers();
}

function saveRosterAsMembers() {
    if(!players.length) return showToast('현재 등록된 선수가 없습니다.');
    let count = 0;
    players.forEach(player => {
        let member = members.find(m => m.id === player.memberId) || members.find(m => sameMemberProfile(m, player));
        if(!member) {
            member = {id:nextPersonId(), name:player.name, gender:player.gender, tier:player.tier};
            members.push(member);
            count++;
        }
        if(!players.some(p => p.id !== player.id && p.memberId === member.id)) player.memberId = member.id;
    });
    if(!saveAction('현재 선수 명단을 회원으로 저장')) return;
    setMemberView('select'); renderMembers(); showToast(`회원 ${count}명 추가 저장 · 기존 회원은 중복 저장하지 않았습니다.`);
}

function deleteMember(id) {
    const member = members.find(m => m.id === id);
    if(!member) return;
    showConfirmModal(`${member.name} 회원을 저장 명단에서 삭제하시겠습니까?\n현재 모임의 선수와 경기 기록은 유지됩니다.`, () => {
        members = members.filter(m => m.id !== id);
        players.filter(p => p.memberId === id).forEach(p => { delete p.memberId; });
        if(!saveAction(`${member.name} 회원 삭제`)) return;
        closeMemberEditor(); renderMembers(); showToast('회원 명단에서 삭제했습니다.');
    });
}

function loadSelectedMembers() {
    const selected = members.filter(m => selectedMemberIds.has(m.id) && !isMemberAttending(m));
    if(!selected.length) return showToast('불러올 회원을 선택하세요.');
    const matchingOffset = getInitialMatchingGames();
    selected.forEach(member => players.push({
        id:nextPersonId(), memberId:member.id, name:member.name, gender:member.gender, tier:member.tier,
        games:0, matchingOffset, lastTime:0, status:'waiting', shuttlecock:false
    }));
    if(!saveAction(`회원 ${selected.length}명 불러오기`)) return;
    closeMembersModal(); render(); setMobileView('waiting'); showToast(`${selected.length}명을 대기실로 불러왔습니다.`);
}
