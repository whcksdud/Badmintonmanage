const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, styles, runApp } = require('./helpers/app-runtime');

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
            createElement,
            addEventListener() {}
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
    runApp(context);
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
assertInRuntime(context, 'getOverallStatistics().recordedGames === 4', '전체 통계의 기록 경기 수가 올바르지 않습니다.');
assertInRuntime(context, 'getOverallStatistics().participantCount === 9 && getOverallStatistics().totalAppearances === 16', '전체 통계의 참여 선수·총 출전 집계가 올바르지 않습니다.');
assertInRuntime(context, 'Math.abs(getOverallStatistics().averageAppearances - (16 / 9)) < 0.0001', '전체 통계의 선수당 평균 출전 집계가 올바르지 않습니다.');
assertInRuntime(context, '(() => { const ranking = getOverallStatistics().rankings.find(item => item.name === "통계대상"); return ranking && ranking.games === 3; })()', '전체 통계의 출전 횟수 순위가 올바르지 않습니다.');
assertInRuntime(context, '(() => { const pair = getOverallStatistics().topPartners[0]; return pair.count === 2 && pair.names.includes("통계대상") && pair.names.includes("파트너A"); })()', '전체 통계의 같은 팀 조합 순위가 올바르지 않습니다.');
assertInRuntime(context, '(() => { const pair = getOverallStatistics().topOpponents[0]; return pair.count === 3 && pair.names.includes("통계대상") && pair.names.includes("상대전용"); })()', '전체 통계의 상대 조합 순위가 올바르지 않습니다.');
assertInRuntime(context, 'getOverallStatistics().rankings.length <= 3 && getOverallStatistics().topPartners.length <= 3 && getOverallStatistics().topOpponents.length <= 3', '전체 통계가 한눈에 보는 TOP 3 범위를 초과합니다.');
assertInRuntime(context, 'getOverallStatistics().playerAppearances.length === players.length && players.every(player => getOverallStatistics().playerAppearances.some(item => item.name === player.name))', '전체 통계에 현재 등록된 모든 선수 이름이 포함되지 않았습니다.');
assertInRuntime(context, 'players.every(player => getOverallStatistics().playerAppearances.some(item => item.name === player.name && item.gender === player.gender))', '전체 통계 선수 정보에 성별이 포함되지 않았습니다.');
if (!html.includes('role="tablist" aria-label="통계 보기"') || !html.includes('id="statsOverallTab"') || !html.includes('id="statsPlayerTab"')) throw new Error('전체·선수별 통계 탭 구조가 없습니다.');

vm.runInContext('openStatsModal(1)', context);
if (context.__elements.get('statsModal').style.display !== 'flex') throw new Error('선수 통계 모달이 열리지 않았습니다.');
assertInRuntime(context, 'statsView === "player"', '선수를 지정해 통계를 열었을 때 선수별 탭이 선택되지 않았습니다.');
if (context.__elements.get('statsOverallPanel').hidden !== true || context.__elements.get('statsPlayerPanel').hidden !== false) throw new Error('선수별 통계 탭의 패널 표시 상태가 올바르지 않습니다.');
if (!context.__elements.get('statsPlayerList').innerHTML.includes('통계대상')) throw new Error('통계 선수 목록이 렌더링되지 않았습니다.');
if (!context.__elements.get('statsDetail').innerHTML.includes('파트너A')) throw new Error('선수별 관계 통계가 렌더링되지 않았습니다.');
if (!context.__elements.get('statsDetail').innerHTML.includes('삭제선수')) throw new Error('삭제된 상대 선수가 통계 화면에 표시되지 않았습니다.');
if (!context.__elements.get('statsPlayerList').innerHTML.includes('gender-card gender-m')) throw new Error('통계 선수 목록의 카드 성별 색상 표시가 없습니다.');
if (!context.__elements.get('statsDetail').innerHTML.includes('gender-card gender-f')) throw new Error('통계 관계 목록의 카드 성별 색상 표시가 없습니다.');
if (context.__elements.get('statsDetail').innerHTML.includes('<button type="button" class="stats-relation-row') || context.__elements.get('statsDetail').innerHTML.includes('onclick="selectStatsPlayer(')) throw new Error('선수별 경기 관계 목록에서 다른 선수 통계로 이동하는 동작이 남아 있습니다.');
if (!context.__elements.get('statsPlayerList').innerHTML.includes('stats-player-option-meta') || !context.__elements.get('statsPlayerList').innerHTML.includes('C조 · 3경기')) throw new Error('통계 선수 카드의 이름·급수·경기 수 배치가 대기실 카드와 통일되지 않았습니다.');
if (!context.__elements.get('statsDetail').innerHTML.includes('stats-profile-meta') || !context.__elements.get('statsDetail').innerHTML.includes('C조 · 3경기')) throw new Error('통계 상단 선수 카드의 이름·급수·경기 수가 한 줄에 표시되지 않았습니다.');
if (context.__elements.get('statsPlayerList').innerHTML.includes('stats-status-') || context.__elements.get('statsDetail').innerHTML.includes('stats-status-') || context.__elements.get('statsDetail').innerHTML.includes('대기 중') || context.__elements.get('statsDetail').innerHTML.includes('stats-profile-games')) throw new Error('통계 카드에 불필요한 선수 상태 표시나 분리된 경기 수 영역이 남아 있습니다.');
if (!styles.includes('.stats-relation-row.gender-card.gender-m { background: #fff;') || !styles.includes('.stats-relation-row.gender-card.gender-f { background: #fff;') || !styles.includes('border-left: 5px solid #38bdf8') || !styles.includes('border-left: 5px solid #f472b6')) throw new Error('통계 선수 카드의 성별 왼쪽 구분선 스타일이 없습니다.');
if (context.__elements.get('statsDetail').innerHTML.includes('gender-marker')) throw new Error('통계 화면에 불필요한 성별 동그라미가 남아 있습니다.');
if (context.__elements.get('statsDetail').innerHTML.includes('>남<') || context.__elements.get('statsDetail').innerHTML.includes('>여<')) throw new Error('통계 화면에 남·녀 글자 배지가 남아 있습니다.');
if (!styles.includes('.stats-player-list { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 40px; gap: 5px; }') || !styles.includes('.stats-player-option { height: 40px; min-height: 40px; padding: 5px 7px; border-radius: 8px; }')) throw new Error('모바일 통계 선수 선택 카드가 2열·2행으로 보이는 밀도로 축소되지 않았습니다.');

vm.runInContext('selectStatsPlayer(2)', context);
assertInRuntime(context, 'statsPlayerId === 2', '통계 대상 선수 변경에 실패했습니다.');

vm.runInContext('setStatsView("overall")', context);
assertInRuntime(context, 'statsView === "overall"', '전체 통계 탭 전환에 실패했습니다.');
if (context.__elements.get('statsOverallPanel').hidden !== false || context.__elements.get('statsPlayerPanel').hidden !== true) throw new Error('전체 통계 탭의 패널 표시 상태가 올바르지 않습니다.');
const overallHtml = context.__elements.get('statsOverall').innerHTML;
if (!overallHtml.includes('기록 경기') || !overallHtml.includes('등록 선수') || !overallHtml.includes('총 출전') || !overallHtml.includes('평균 출전')) throw new Error('전체 통계 요약 카드가 렌더링되지 않았습니다.');
if (!overallHtml.includes('전체 선수 4명') || !players.every(player => overallHtml.includes(player.name)) || !overallHtml.includes('같은 팀 TOP 3') || !overallHtml.includes('상대 TOP 3')) throw new Error('전체 통계에 모든 선수 이름과 조합 목록이 렌더링되지 않았습니다.');
if (!overallHtml.includes('stats-all-player-item gender-card gender-m') || !overallHtml.includes('stats-all-player-item gender-card gender-f') || !styles.includes('.stats-all-player-item.gender-card.gender-m') || !styles.includes('.stats-all-player-item.gender-card.gender-f')) throw new Error('전체 통계 선수 카드에 성별 구분선이 표시되지 않았습니다.');
if (!/\.stats-overall-panel\s*\{[^}]*overflow:\s*hidden/.test(styles) || html.includes('stats-overall-side')) throw new Error('전체 통계가 내부 스크롤 없는 압축형 대시보드로 구성되지 않았습니다.');
if (!/@media \(min-width: 601px\) and \(max-width: 1024px\)\s*\{[^}]*\.stats-modal-box\s*\{[^}]*height:\s*calc\(100dvh - 32px\)/.test(styles) || !/\.stats-overall-content\s*\{[^}]*grid-template-rows:\s*auto auto/.test(styles)) throw new Error('아이패드 통계 창이 화면 높이에 맞춰 조절되지 않습니다.');
if (!/@media \(min-width: 601px\) and \(max-width: 1024px\) and \(orientation: portrait\)\s*\{[^}]*\.stats-overall-ranking \.stats-all-player-list\s*\{[^}]*grid-auto-rows:\s*max-content;[^}]*align-content:\s*start/.test(styles) || !/\.stats-all-player-item\s*\{[^}]*min-height:\s*36px;[^}]*padding:\s*5px 7px/.test(styles)) throw new Error('아이패드 세로 화면의 전체 선수 항목에 과도한 위아래 여백이 남아 있습니다.');
if ((styles.match(/\.stats-overall-ranking \.stats-all-player-list\s*\{[^}]*grid-auto-rows:\s*max-content;[^}]*align-content:\s*start/g) || []).length < 2 || /\.stats-overall-ranking\s*\{[^}]*min-height:\s*clamp/.test(styles)) throw new Error('태블릿과 모바일의 전체 선수 섹션에 불필요한 위아래 여백이 남아 있습니다.');
if (!/\.stats-all-player-item\s*\{[^}]*min-height:\s*44px;[^}]*flex-direction:\s*column;[^}]*justify-content:\s*center/.test(styles) || !/\.stats-all-player-name\s*\{[^}]*width:\s*100%;[^}]*overflow-wrap:\s*anywhere/.test(styles)) throw new Error('모바일 전체 선수 카드의 이름과 경기 수가 위아래로 표시되지 않습니다.');
if (overallHtml.includes('onclick=')) throw new Error('전체 통계의 표시 전용 순위에 불필요한 이동 동작이 있습니다.');
vm.runInContext('handleStatsTabKey({ key: "ArrowRight", preventDefault() {} })', context);
assertInRuntime(context, 'statsView === "player"', '키보드로 선수별 통계 탭을 전환하지 못했습니다.');

const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
if (emojiPattern.test(html)) throw new Error('화면에 OS 글꼴에 의존하는 문자 이모지가 남아 있습니다.');
if (!html.includes('class="ui-icon-sprite"') || !html.includes('id="icon-chart"') || !html.includes('<use href="#icon-settings"></use>') || !html.includes('<use href="#icon-phone"></use>')) throw new Error('공통 SVG 아이콘 체계가 화면 요소에 적용되지 않았습니다.');

test('점수 없는 기록도 팀을 구분하고 선수 이름을 안전하게 표시한다', () => {
    const record = {cId:1,startTime:1000,endTime:3000,pIds:[1,2,3,4],teamNames:[['<img src=x onerror=alert(1)>','A&B'],['셋','넷']]};
    const runtime = createRuntime(players,[record]);
    vm.runInContext('openHistory()',runtime);
    const content=runtime.__elements.get('historyList').innerHTML;
    assert.ok(content.includes('aria-label="A팀"') && content.includes('aria-label="B팀"'));
    assert.ok(content.includes('&lt;img src=x onerror=alert(1)&gt;') && content.includes('A&amp;B'));
    assert.ok(!content.includes('<img src=x'));
    assert.ok(content.includes('1분 미만') && content.includes('점수 미입력'));
    assert.equal(runtime.__elements.get('historySummary').innerText,'총 1경기 · 최신순');
});

test('점수 수정은 선택한 기록에 저장되고 최신순·승패 표시·되돌리기가 유지된다', () => {
    const records=[0,1].map(i=>({cId:1,startTime:1000-i*100,endTime:901000-i*100,pIds:[1,2,3,4],teamNames:[['첫팀1','첫팀2'],['상대1','상대2']]}));
    records[0].scores=[0,21];
    const runtime=createRuntime(players,records);
    vm.runInContext('openHistory(); editHistoryScore(1)',runtime);
    runtime.__elements.get('scoreTeam1').value='21';
    runtime.__elements.get('scoreTeam2').value='19';
    vm.runInContext('saveHistoryScore()',runtime);
    assertInRuntime(runtime,'history[0].scores[0]===0 && history[0].scores[1]===21 && history[1].scores[0]===21 && history[1].scores[1]===19','다른 기록에 점수가 저장됐습니다.');
    const content=runtime.__elements.get('historyList').innerHTML;
    assert.ok(content.includes('aria-label="0 대 21"') && content.includes('aria-label="21 대 19"'));
    assert.ok(!content.includes('점 차'));
    assert.ok(content.includes('history-result-badge win') && content.includes('history-result-badge loss'));
    assert.ok(content.indexOf('editHistoryScore(0)')<content.indexOf('editHistoryScore(1)'));
    vm.runInContext('undoLastAction(); onConfirmAction()',runtime);
    assertInRuntime(runtime,'!history[1].scores && history[0].scores[1]===21','점수 변경을 되돌리지 못했습니다.');
});

test('빈 기록과 이전 형식의 팀 정보 없는 기록도 표시한다', () => {
    const runtime=createRuntime(players,[]);
    vm.runInContext('openHistory()',runtime);
    assert.ok(runtime.__elements.get('historyList').innerHTML.includes('아직 완료된 경기가 없어요'));
    vm.runInContext('history=[{cId:99,names:"<이전 기록>"}]; openHistory()',runtime);
    const content=runtime.__elements.get('historyList').innerHTML;
    assert.ok(content.includes('삭제된 코트') && content.includes('&lt;이전 기록&gt;'));
    assert.ok(content.includes('시간 미기록') && content.includes('팀 정보 미기록'));
    assert.ok(!content.includes('editHistoryScore(') && !content.includes('NaN'));
});

console.log('전체·선수별 경기 통계와 SVG 아이콘 테스트 통과');
