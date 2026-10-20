// Member-only compressed codes; legacy QR pages remain independently mergeable.
const MEMBER_SHARE_APP_URL = 'https://whcksdud.github.io/Badmintonmanage/';
const MEMBER_QR_URL_LIMIT = 450;
const MEMBER_COMPRESSED_QR_URL_LIMIT = 900;
const MEMBER_CODE_QR_FRAGMENT = '#member-code=';
const MEMBER_CODE_PREFIX = 'BM2-';
const MEMBER_CODE_BYTE_LIMIT = 2000000;
const MEMBER_CODE_CHAR_LIMIT = 2700000;
const MEMBER_QR_HISTORY_KEY = 'bmPendingMemberQr';
let memberSharePages = [];
let memberSharePage = 0;
let memberShareCode = '';
let memberShareDirectory = [];
let memberShareRequest = 0;
let memberImportRequest = 0;
let pendingMemberImport = null;

function validateMemberProfiles(rows, limit) {
    if(!Array.isArray(rows) || !rows.length || rows.length > limit)
        throw new Error('공유할 회원명단을 확인해 주세요.');
    return rows.map(row => {
        if(!Array.isArray(row) || row.length !== 3 || typeof row[0] !== 'string' ||
            !row[0].trim() || row[0].length > 120 || !['M', 'F'].includes(row[1]) ||
            !Number.isInteger(row[2]) || row[2] < 1 || row[2] > 5)
            throw new Error('회원 정보의 이름·성별·급수를 확인해 주세요.');
        return {name:row[0].trim(), gender:row[1], tier:row[2]};
    });
}

function validateSharedMembers(data) {
    if(!data || data.v !== 1 || !Number.isInteger(data.p) || !Number.isInteger(data.t) ||
        data.p < 1 || data.p > data.t || data.t > 2000 || !Array.isArray(data.m) ||
        !data.m.length || data.m.length > 50) throw new Error('올바른 회원명단 QR이 아닙니다.');
    return validateMemberProfiles(data.m, 50);
}

async function transformMemberBytes(bytes, decompress = false) {
    const Codec = decompress ? globalThis.DecompressionStream : globalThis.CompressionStream;
    if(!Codec) throw new Error('압축 코드 기능을 사용하려면 브라우저를 최신 버전으로 업데이트해 주세요. QR 공유는 계속 사용할 수 있습니다.');
    const reader = new Blob([bytes]).stream().pipeThrough(new Codec('gzip')).getReader();
    const chunks = [];
    let size = 0;
    try {
        while(true) {
            const {value, done} = await reader.read();
            if(done) break;
            size += value.length;
            if(size > MEMBER_CODE_BYTE_LIMIT) {
                await reader.cancel().catch(() => {});
                throw new Error('공유 코드의 데이터가 너무 큽니다.');
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(size);
    let offset = 0;
    chunks.forEach(chunk => { result.set(chunk, offset); offset += chunk.length; });
    return result;
}

async function encodeMemberCode(directory, page = 1, total = 1) {
    const rows = directory.map(member => [member.name.trim(), member.gender, member.tier]);
    validateMemberProfiles(rows, 2000);
    const data = {v:2, m:rows};
    if(page !== 1 || total !== 1) Object.assign(data, {p:page, t:total});
    const bytes = await transformMemberBytes(new TextEncoder().encode(JSON.stringify(data)));
    // Chunk conversion avoids exceeding the argument limit with large directories.
    let binary = '';
    for(let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return MEMBER_CODE_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decodeMemberCode(input) {
    if(input.length > MEMBER_CODE_CHAR_LIMIT) throw new Error('공유 코드가 너무 깁니다.');
    const code = input.replace(/\s/g, '');
    const encoded = code.slice(MEMBER_CODE_PREFIX.length);
    if(!code.startsWith(MEMBER_CODE_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1)
        throw new Error('BM2-로 시작하는 공유 코드 전체를 붙여 넣어 주세요.');
    if(!globalThis.DecompressionStream)
        throw new Error('압축 코드를 읽으려면 브라우저를 최신 버전으로 업데이트해 주세요.');
    try {
        const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = await transformMemberBytes(Uint8Array.from(binary, c => c.charCodeAt(0)), true);
        const data = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
        if(!data || data.v !== 2) throw new Error('version');
        const paginated = data.p !== undefined || data.t !== undefined;
        if(paginated && (!Number.isInteger(data.p) || !Number.isInteger(data.t) || data.p < 1 || data.p > data.t || data.t > 2000))
            throw new Error('page');
        return {rows:validateMemberProfiles(data.m, 2000), page:paginated ? data.p : 1, total:paginated ? data.t : 1};
    } catch(error) { throw new Error('압축 코드를 읽을 수 없습니다. 코드 전체를 다시 복사해 주세요.'); }
}

function encodeMemberShare(rows, page, total) {
    const bytes = new TextEncoder().encode(JSON.stringify({v:1, p:page, t:total, m:rows}));
    const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${MEMBER_SHARE_APP_URL}#members=${encoded}`;
}

function decodeMemberShare(link) {
    const url = new URL(link);
    if(url.hash.startsWith(MEMBER_CODE_QR_FRAGMENT)) {
        if(link.length > MEMBER_COMPRESSED_QR_URL_LIMIT) throw new Error('회원명단 공유 링크를 확인해 주세요.');
        return decodeMemberCode(url.hash.slice(MEMBER_CODE_QR_FRAGMENT.length));
    }
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

async function buildCompressedMemberSharePages(directory, fullCode) {
    const toUrl = code => `${MEMBER_SHARE_APP_URL}${MEMBER_CODE_QR_FRAGMENT}${code}`;
    const completeUrl = toUrl(fullCode);
    if(completeUrl.length <= MEMBER_COMPRESSED_QR_URL_LIMIT)
        return [{url:completeUrl, count:directory.length}];
    const groups = [];
    async function split(group) {
        const code = await encodeMemberCode(group, 2000, 2000);
        // Reserve space for the final page metadata without making dense QR codes.
        if(group.length > 1 && toUrl(code).length > MEMBER_COMPRESSED_QR_URL_LIMIT - 64) {
            const middle = Math.ceil(group.length / 2);
            await split(group.slice(0, middle));
            await split(group.slice(middle));
        } else groups.push(group);
    }
    await split(directory);
    // Check actual output lengths too: gzip size varies with page numbers.
    while(true) {
        const pages = [];
        let oversized = -1;
        for(let i = 0; i < groups.length; i++) {
            const url = toUrl(await encodeMemberCode(groups[i], i + 1, groups.length));
            if(url.length > MEMBER_COMPRESSED_QR_URL_LIMIT) { oversized = i; break; }
            pages.push({url, count:groups[i].length});
        }
        if(oversized < 0) return pages;
        const group = groups[oversized];
        if(group.length === 1) throw new Error('회원명단 QR을 만들지 못했습니다. 압축 코드를 공유해 주세요.');
        const middle = Math.ceil(group.length / 2);
        groups.splice(oversized, 1, group.slice(0, middle), group.slice(middle));
    }
}

async function openMemberShare() {
    if(!members.length) return showToast('공유할 회원을 먼저 저장해 주세요.');
    const request = ++memberShareRequest;
    memberShareDirectory = members.map(({name, gender, tier}) => ({name, gender, tier}));
    memberShareCode = '';
    memberSharePages = [];
    memberSharePage = 0;
    document.getElementById('memberShareCode').value = '';
    document.getElementById('memberCodeSummary').innerText = '공유 코드를 만드는 중입니다…';
    document.getElementById('memberCodeSummary').hidden = false;
    document.getElementById('memberCodeCopy').disabled = true;
    document.getElementById('memberShareModal').style.display = 'flex';
    document.getElementById('memberQrImage').innerText = '전체 회원명단 QR을 만드는 중입니다…';
    document.getElementById('memberQrPagination').hidden = true;
    try {
        const code = await encodeMemberCode(memberShareDirectory);
        if(request !== memberShareRequest) return;
        memberShareCode = code;
        document.getElementById('memberShareCode').value = code;
        document.getElementById('memberCodeSummary').innerText = '';
        document.getElementById('memberCodeSummary').hidden = true;
        document.getElementById('memberCodeCopy').disabled = false;
    } catch(error) {
        if(request !== memberShareRequest) return;
        document.getElementById('memberCodeSummary').innerText = error.message;
    }
    if(request === memberShareRequest) await showMemberShareQr();
}

async function showMemberShareQr() {
    const request = memberShareRequest;
    try {
        const pages = memberShareCode
            ? await buildCompressedMemberSharePages(memberShareDirectory, memberShareCode)
            : buildMemberSharePages(memberShareDirectory);
        if(request !== memberShareRequest) return;
        memberSharePages = pages;
        renderMemberShare();
    } catch(error) {
        if(request !== memberShareRequest) return;
        document.getElementById('memberQrImage').innerText = error.message;
        document.getElementById('memberQrPagination').hidden = true;
    }
}

function renderMemberShare() {
    const page = memberSharePages[memberSharePage];
    const qr = qrcode(0, 'M');
    qr.addData(page.url, 'Byte');
    qr.make();
    document.getElementById('memberQrImage').innerHTML = qr.createSvgTag({cellSize:4, margin:16, scalable:true});
    document.getElementById('memberQrPage').innerText = `${memberSharePage + 1} / ${memberSharePages.length}`;
    document.getElementById('memberQrPrev').disabled = memberSharePage === 0;
    document.getElementById('memberQrNext').disabled = memberSharePage === memberSharePages.length - 1;
    document.getElementById('memberQrPagination').hidden = memberSharePages.length < 2;
}

function changeMemberSharePage(offset) {
    const next = memberSharePage + offset;
    if(next < 0 || next >= memberSharePages.length) return;
    memberSharePage = next;
    renderMemberShare();
}

async function copyMemberShareCode() {
    if(!memberShareCode) return;
    try {
        await navigator.clipboard.writeText(memberShareCode);
        showToast('전체 회원명단의 압축 코드를 복사했습니다.');
    } catch(error) {
        document.getElementById('memberShareCode').select();
        showToast('공유 코드를 길게 눌러 복사해 주세요.');
    }
}

function closeMemberShare() {
    memberShareRequest++;
    document.getElementById('memberShareModal').style.display = 'none';
}

function openMemberImport() {
    closeMemberQrScan();
    updateMemberQrImportState();
    memberImportRequest++;
    pendingMemberImport = null;
    document.getElementById('memberImportLink').value = '';
    document.getElementById('memberImportPreview').hidden = true;
    document.getElementById('memberImportInput').hidden = false;
    document.getElementById('memberImportButton').hidden = true;
    document.getElementById('memberImportModal').style.display = 'flex';
}

function closeMemberImport() {
    closeMemberQrScan();
    updateMemberQrImportState();
    memberImportRequest++;
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

function previewMemberImport(link = document.getElementById('memberImportLink').value.trim(), fromQr = false) {
    if(!fromQr) updateMemberQrImportState();
    const request = ++memberImportRequest;
    pendingMemberImport = null;
    document.getElementById('memberImportButton').hidden = true;
    const accept = data => {
        if(request !== memberImportRequest) return false;
        closeMemberQrScan();
        if(fromQr) updateMemberQrImportState(link);
        pendingMemberImport = data;
        renderMemberImportPreview();
        document.getElementById('memberImportModal').style.display = 'flex';
        return true;
    };
    const reject = error => {
        if(request !== memberImportRequest) return false;
        if(fromQr) updateMemberQrImportState();
        document.getElementById('memberImportInput').hidden = false;
        document.getElementById('memberImportPreview').hidden = true;
        showToast(error.message);
        return false;
    };
    if(!/^https?:\/\//i.test(link.trim())) return decodeMemberCode(link).then(accept, reject);
    try {
        const data = decodeMemberShare(link);
        return data && typeof data.then === 'function' ? data.then(accept, reject) : accept(data);
    } catch(error) { return reject(error); }
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
    if(!saveAction('회원명단 불러오기')) return false;
    closeMemberImport();
    render();
    openMembersModal();
    showToast(`새 회원 ${additions.length}명을 저장했습니다.`);
    return true;
}

function updateMemberQrImportState(link = null) {
    if(!window.location || !window.history?.replaceState) return;
    const browserState = window.history.state;
    const hasFragment = isMemberShareFragment(window.location.hash);
    const hasPendingQr = browserState && Object.prototype.hasOwnProperty.call(browserState, MEMBER_QR_HISTORY_KEY);
    if(!link && !hasFragment && !hasPendingQr) return;
    const nextState = browserState && typeof browserState === 'object' ? {...browserState} : {};
    if(link) nextState[MEMBER_QR_HISTORY_KEY] = link;
    else delete nextState[MEMBER_QR_HISTORY_KEY];
    // Keep the validated QR in this history entry until the user adds or closes it.
    // A service-worker controller change may reload the page after URL cleanup.
    const cleanUrl = window.location.pathname + window.location.search + (hasFragment ? '' : window.location.hash);
    try {
        window.history.replaceState(Object.keys(nextState).length ? nextState : null, '', cleanUrl);
    } catch(error) {
        // If history updates are unavailable, leave the original QR fragment intact.
    }
}

function handleMemberShareFragment() {
    if(!window.location) return;
    const hasFragment = isMemberShareFragment(window.location.hash);
    const browserState = window.history?.state;
    if(!hasFragment && !(browserState && Object.prototype.hasOwnProperty.call(browserState, MEMBER_QR_HISTORY_KEY))) return;
    const link = hasFragment ? window.location.href : browserState[MEMBER_QR_HISTORY_KEY];
    if(typeof link !== 'string' || !/^https?:\/\//i.test(link) || link.length > MEMBER_COMPRESSED_QR_URL_LIMIT) {
        updateMemberQrImportState();
        showToast('회원명단 공유 링크를 확인해 주세요.');
        return;
    }
    return previewMemberImport(link, true);
}

function isMemberShareFragment(hash) {
    return hash.startsWith('#members=') || hash.startsWith(MEMBER_CODE_QR_FRAGMENT);
}
