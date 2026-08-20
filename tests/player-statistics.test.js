const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

if (!inlineScript) throw new Error('index.html의 인라인 스크립트를 찾을 수 없습니다.');

function createElement() {
    return {
        value: '',
        innerText: '',
        innerHTML: '',
        className: '',
        disabled: false,
        title: '',
        style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {},
        addEventListener() {},
        focus() {},
        click() {}
    };
}

function createRuntime(players, history) {
    const storage = new Map([
        ['bm_p_v13', JSON.stringify(players)],
        ['bm_c_v13', JSON.stringify([{ id: 1, type: 'A', active: [], next: [], startTime: null }])],
        ['bm_h_v13', JSON.stringify(history)]
    ]);
    const elements = new Map();
    const context = {
        console,
        __elements: elements,
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, createElement());
                return elements.get(id);
            },
            createElement
        },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, value); },
            clear() { storage.clear(); }
        },
        navigator: {},
        window: {
            navigator: {},
            matchMedia() { return { matches: false }; },
            addEventListener() {},
            isSecureContext: false
        },
        setInterval() { return 0; },
        setTimeout() { return 0; },
        clearTimeout() {},
        Blob,
        URL
    };

    vm.createContext(context);
    vm.runInContext(inlineScript, context);
    return context;
}

function assertInRuntime(context, assertion, message) {
    if (!vm.runInContext(assertion, context)) throw new Error(message);
}

const players = [
    { id: 1, name: '통계대상', gender: 'M', tier: 3, games: 3, lastTime: 0, status: 'waiting', shuttlecock: false },
    { id: 2, name: '파트너A', gender: 'F', tier: 2, games: 3, lastTime: 0, status: 'waiting', shuttlecock: false },
    { id: 3, name: '파트너B', gender: 'M', tier: 4, games: 2, lastTime: 0, status: 'waiting', shuttlecock: false },
    { id: 4, name: '상대전용', gender: 'F', tier: 1, games: 3, lastTime: 0, status: 'waiting', shuttlecock: false }
];

const history = [
    {
        pIds: [1, 2, 4, 5],
        teamNames: [['통계대상', '파트너A'], ['상대전용', '삭제선수']],
        startTime: 300,
        endTime: 400,
        cId: 1
    },
    {
        pIds: [3, 1, 2, 4],
        teamNames: [['파트너B', '통계대상'], ['파트너A', '상대전용']],
        startTime: 200,
        endTime: 300,
        cId: 1
    },
    {
        pIds: [1, 2, 3, 4],
        teamNames: [['통계대상', '파트너A'], ['파트너B', '상대전용']],
        startTime: 100,
        endTime: 200,
        cId: 1
    },
    {
        names: '이전, 형식, 기록, 제외',
        startTime: 0,
        endTime: 100,
        cId: 1
    }
];

const context = createRuntime(players, history);

assertInRuntime(context, 'getPlayerStatistics(1).recordedGames === 3', '선수의 기록 경기 수가 올바르지 않습니다.');
assertInRuntime(context, 'getPlayerStatistics(1).relations.length === 4', '함께 경기한 선수 수가 올바르지 않습니다.');
assertInRuntime(context, 'getPlayerStatistics(1).uniquePartners === 2', '같은 팀 선수 수가 올바르지 않습니다.');
assertInRuntime(context, 'getPlayerStatistics(1).uniqueOpponents === 4', '상대 팀 선수 수가 올바르지 않습니다.');
assertInRuntime(context, '(() => { const relation = getPlayerStatistics(1).relations.find(item => item.playerId === 2); return relation.together === 3 && relation.sameTeam === 2 && relation.opponent === 1; })()', '같은 선수와의 전체·같은 팀·상대 팀 횟수가 잘못 집계되었습니다.');
assertInRuntime(context, '(() => { const relation = getPlayerStatistics(1).relations.find(item => item.playerId === 4); return relation.together === 3 && relation.sameTeam === 0 && relation.opponent === 3; })()', '상대 팀 전용 관계가 잘못 집계되었습니다.');
assertInRuntime(context, '(() => { const relation = getPlayerStatistics(1).relations.find(item => item.playerId === 5); return relation.name === "삭제선수" && relation.currentPlayer === null; })()', '삭제된 선수의 기록상 이름을 유지하지 못했습니다.');
assertInRuntime(context, 'escapeHTML("<선수 & 이름>") === "&lt;선수 &amp; 이름&gt;"', '통계 화면의 선수 이름 이스케이프가 올바르지 않습니다.');

vm.runInContext('openStatsModal(1)', context);
if (context.__elements.get('statsModal').style.display !== 'flex') throw new Error('선수 통계 모달이 열리지 않았습니다.');
if (!context.__elements.get('statsPlayerList').innerHTML.includes('통계대상')) throw new Error('통계 선수 목록이 렌더링되지 않았습니다.');
if (!context.__elements.get('statsDetail').innerHTML.includes('파트너A')) throw new Error('선수별 관계 통계가 렌더링되지 않았습니다.');
if (!context.__elements.get('statsDetail').innerHTML.includes('삭제선수')) throw new Error('삭제된 상대 선수가 통계 화면에 표시되지 않았습니다.');
if (!context.__elements.get('statsPlayerList').innerHTML.includes('gender-card gender-m')) throw new Error('통계 선수 목록의 카드 성별 색상 표시가 없습니다.');
if (!context.__elements.get('statsDetail').innerHTML.includes('gender-card gender-f')) throw new Error('통계 관계 목록의 카드 성별 색상 표시가 없습니다.');
if (!context.__elements.get('statsPlayerList').innerHTML.includes('stats-player-option-meta') || !context.__elements.get('statsPlayerList').innerHTML.includes('C조 · 3경기')) throw new Error('통계 선수 카드의 이름·급수·경기 수 배치가 대기실 카드와 통일되지 않았습니다.');
if (!context.__elements.get('statsDetail').innerHTML.includes('stats-profile-meta') || !context.__elements.get('statsDetail').innerHTML.includes('C조 · 3경기')) throw new Error('통계 상단 선수 카드의 이름·급수·경기 수가 한 줄에 표시되지 않았습니다.');
if (context.__elements.get('statsPlayerList').innerHTML.includes('stats-status-') || context.__elements.get('statsDetail').innerHTML.includes('stats-status-') || context.__elements.get('statsDetail').innerHTML.includes('대기 중') || context.__elements.get('statsDetail').innerHTML.includes('stats-profile-games')) throw new Error('통계 카드에 불필요한 선수 상태 표시나 분리된 경기 수 영역이 남아 있습니다.');
if (!html.includes('.stats-relation-row.gender-card.gender-m { background: #fff;') || !html.includes('.stats-relation-row.gender-card.gender-f { background: #fff;') || !html.includes('border-left: 5px solid #38bdf8') || !html.includes('border-left: 5px solid #f472b6')) throw new Error('통계 선수 카드의 성별 왼쪽 구분선 스타일이 없습니다.');
if (context.__elements.get('statsDetail').innerHTML.includes('gender-marker')) throw new Error('통계 화면에 불필요한 성별 동그라미가 남아 있습니다.');
if (context.__elements.get('statsDetail').innerHTML.includes('>남<') || context.__elements.get('statsDetail').innerHTML.includes('>여<')) throw new Error('통계 화면에 남·녀 글자 배지가 남아 있습니다.');

vm.runInContext('selectStatsPlayer(2, true)', context);
assertInRuntime(context, 'statsPlayerId === 2', '통계 대상 선수 변경에 실패했습니다.');

console.log('선수별 경기 관계 통계 테스트 통과');
