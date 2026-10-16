// Member-only QR links. Each page is independently mergeable and safe to scan again.
const MEMBER_SHARE_APP_URL = 'https://whcksdud.github.io/Badmintonmanage/';
const MEMBER_QR_URL_LIMIT = 450;
let memberSharePages = [];
let memberSharePage = 0;
let pendingMemberImport = null;

function validateSharedMembers(data) {
    if(!data || data.v !== 1 || !Number.isInteger(data.p) || !Number.isInteger(data.t) ||
        data.p < 1 || data.p > data.t || data.t > 2000 || !Array.isArray(data.m) ||
        !data.m.length || data.m.length > 50) throw new Error('올바른 회원명단 QR이 아닙니다.');
    return data.m.map(row => {
        if(!Array.isArray(row) || row.length !== 3 || typeof row[0] !== 'string' ||
            !row[0].trim() || row[0].length > 120 || !['M', 'F'].includes(row[1]) ||
            !Number.isInteger(row[2]) || row[2] < 1 || row[2] > 5)
            throw new Error('회원 정보의 이름·성별·급수를 확인해 주세요.');
        return {name:row[0].trim(), gender:row[1], tier:row[2]};
    });
}

function encodeMemberShare(rows, page, total) {
    const bytes = new TextEncoder().encode(JSON.stringify({v:1, p:page, t:total, m:rows}));
    const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${MEMBER_SHARE_APP_URL}#members=${encoded}`;
}

function decodeMemberShare(link) {
    const url = new URL(link);
    const encoded = url.hash.slice('#members='.length);
    if(!url.hash.startsWith('#members=') || link.length > MEMBER_QR_URL_LIMIT ||
        !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1)
        throw new Error('회원명단 공유 링크를 확인해 주세요.');
    try {
        const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
        const data = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
        return {rows:validateSharedMembers(data), page:data.p, total:data.t};
    } catch(error) {
        throw new Error('회원명단 공유 정보를 읽을 수 없습니다.');
    }
}

function buildMemberSharePages(directory) {
    if(directory.length > 2000) throw new Error('한 번에 공유할 수 있는 회원은 2,000명까지입니다.');
    const rows = directory.map(member => [member.name.trim(), member.gender, member.tier]);
    const groups = [];
    let group = [];
    for(const row of rows) {
        validateSharedMembers({v:1, p:1, t:1, m:[row]});
        if(group.length && (group.length === 50 || encodeMemberShare([...group, row], 2000, 2000).length > MEMBER_QR_URL_LIMIT)) {
            groups.push(group);
            group = [];
        }
        if(encodeMemberShare([row], 2000, 2000).length > MEMBER_QR_URL_LIMIT)
            throw new Error('이름이 너무 긴 회원이 있습니다. 이름을 줄인 뒤 다시 공유해 주세요.');
        group.push(row);
    }
    if(group.length) groups.push(group);
    return groups.map((rows, index) => ({url:encodeMemberShare(rows, index + 1, groups.length), count:rows.length}));
}

function openMemberShare() {
    if(!members.length) return showToast('공유할 회원을 먼저 저장해 주세요.');
    try {
        memberSharePages = buildMemberSharePages(members);
        memberSharePage = 0;
        renderMemberShare();
        document.getElementById('memberShareModal').style.display = 'flex';
    } catch(error) { showToast(error.message); }
}

function renderMemberShare() {
    const page = memberSharePages[memberSharePage];
    const qr = qrcode(0, 'M');
    qr.addData(page.url, 'Byte');
    qr.make();
    document.getElementById('memberQrImage').innerHTML = qr.createSvgTag({cellSize:4, margin:16, scalable:true});
    document.getElementById('memberQrSummary').innerText = `총 ${memberSharePages.reduce((sum, item) => sum + item.count, 0)}명 · 이 QR에 ${page.count}명`;
    document.getElementById('memberQrPage').innerText = `${memberSharePage + 1} / ${memberSharePages.length}`;
    document.getElementById('memberQrPrev').disabled = memberSharePage === 0;
    document.getElementById('memberQrNext').disabled = memberSharePage === memberSharePages.length - 1;
    document.getElementById('memberQrPagination').hidden = memberSharePages.length < 2;
    document.getElementById('memberShareLink').value = page.url;
}

function changeMemberSharePage(offset) {
    const next = memberSharePage + offset;
    if(next < 0 || next >= memberSharePages.length) return;
    memberSharePage = next;
    renderMemberShare();
}

async function copyMemberShareLink() {
    try {
        await navigator.clipboard.writeText(memberSharePages[memberSharePage].url);
        showToast('현재 QR의 공유 링크를 복사했습니다.');
    } catch(error) {
        document.getElementById('memberShareLink').select();
        showToast('공유 링크를 길게 눌러 복사해 주세요.');
    }
}

function closeMemberShare() { document.getElementById('memberShareModal').style.display = 'none'; }

function openMemberImport() {
    pendingMemberImport = null;
    document.getElementById('memberImportLink').value = '';
    document.getElementById('memberImportPreview').hidden = true;
    document.getElementById('memberImportInput').hidden = false;
    document.getElementById('memberImportButton').hidden = true;
    document.getElementById('memberImportModal').style.display = 'flex';
}

function closeMemberImport() {
    document.getElementById('memberImportModal').style.display = 'none';
    pendingMemberImport = null;
}

function uniqueIncomingMembers(rows) {
    const additions = [];
    rows.forEach(member => {
        if(!members.some(existing => sameMemberProfile(existing, member)) &&
            !additions.some(existing => sameMemberProfile(existing, member))) additions.push(member);
    });
    return additions;
}

function previewMemberImport(link = document.getElementById('memberImportLink').value.trim()) {
    try {
        const data = decodeMemberShare(link);
        pendingMemberImport = data;
        renderMemberImportPreview();
        document.getElementById('memberImportModal').style.display = 'flex';
        return true;
    } catch(error) { closeMemberImport(); showToast(error.message); return false; }
}

function renderMemberImportPreview() {
    const {rows, page, total} = pendingMemberImport;
    const additions = uniqueIncomingMembers(rows);
    document.getElementById('memberImportInput').hidden = true;
    document.getElementById('memberImportPreview').hidden = false;
    document.getElementById('memberImportSummary').innerText = `새 회원 ${additions.length}명 · 중복 ${rows.length - additions.length}명 제외`;
    document.getElementById('memberImportPage').innerText = total > 1 ? `QR ${page} / ${total} · 나머지 QR도 차례로 읽어 주세요.` : '기존 회원과 현재 경기 기록은 유지됩니다.';
    document.getElementById('memberImportList').innerHTML = additions.map(member =>
        `<li><strong>${escapeHTML(member.name)}</strong><span>${member.gender === 'M' ? '남성' : '여성'} · ${tiers[member.tier]}</span></li>`).join('') || '<li>이미 모두 저장된 회원입니다.</li>';
    const button = document.getElementById('memberImportButton');
    button.hidden = false;
    button.disabled = !additions.length || storageBlocked;
    button.innerText = `회원 ${additions.length}명 추가`;
}

function importSharedMembers() {
    if(!pendingMemberImport || storageBlocked) return false;
    const additions = uniqueIncomingMembers(pendingMemberImport.rows);
    if(!additions.length) { renderMemberImportPreview(); return false; }
    additions.forEach(member => members.push({id:nextPersonId(), name:member.name, gender:member.gender, tier:member.tier}));
    if(!saveAction('회원명단 QR 불러오기')) return false;
    closeMemberImport();
    render();
    openMembersModal();
    showToast(`새 회원 ${additions.length}명을 저장했습니다.`);
    return true;
}

function handleMemberShareFragment() {
    if(!window.location?.hash.startsWith('#members=')) return;
    const link = window.location.href;
    // The browser API must be explicit: the app's `history` is the game log.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    previewMemberImport(link);
}
