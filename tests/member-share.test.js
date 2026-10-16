const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const {runApp} = require('./helpers/app-runtime');

const state = {
    members:[{id:100,name:'기존 회원',gender:'M',tier:3}],
    players:[{id:1,name:'오늘만 참가',gender:'F',tier:2,games:3,matchingOffset:0,lastTime:0,status:'waiting',shuttlecock:true,waitingSince:100}],
    courts:[{id:1,type:'A',active:[],next:[],startTime:null}],
    history:[{cId:1,startTime:100,endTime:200,pIds:[1,2,3,4],teamNames:[['오늘만 참가','이전 선수'],['상대1','상대2']],scores:[21,17]}]
};
function runtime(saved, href) {
    const storage = new Map(saved || [['bm_state_v14',JSON.stringify({current:state,previous:null})]]);
    const elements = new Map();
    const el = () => ({value:'',style:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},addEventListener(){},focus(){},select(){},click(){}});
    const location = href ? new URL(href) : undefined;
    const context = vm.createContext({console,Blob,URL,TextEncoder,TextDecoder,btoa,atob,navigator:{},
        document:{getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id);},createElement:el,addEventListener(){}},
        window:{navigator:{},location,history:{replaceState(a,b,url){context.cleanedUrl=url;}},matchMedia:()=>({matches:false}),addEventListener(){}},
        localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
        setTimeout(){},clearTimeout(){},setInterval(){}});
    runApp(context);
    return {context,storage,run:code=>vm.runInContext(code,context)};
}
function link(rows, extra={}) {
    const data={v:1,p:1,t:1,m:rows,...extra};
    return 'https://whcksdud.github.io/Badmintonmanage/#members='+Buffer.from(JSON.stringify(data)).toString('base64url');
}
function preview(app, url) {app.context.inputLink=url;return app.run('previewMemberImport(inputLink)');}

test('QR shares only saved member profiles, round-trips Korean and escapes names',()=>{
    const app=runtime();
    app.run('members.push({id:101,name:"<홍길동 & 회원>",gender:"F",tier:5,secret:"never-share"}); openMemberShare()');
    const url=app.run('memberSharePages[0].url');
    const payload=JSON.parse(Buffer.from(url.split('#members=')[1],'base64url'));
    assert.deepEqual(Object.keys(payload).sort(),['m','p','t','v']);
    assert.deepEqual(payload.m,[['기존 회원','M',3],['<홍길동 & 회원>','F',5]]);
    assert.ok(!url.includes('127.0.0.1'));
    assert.equal(preview(app,url),true);
    assert.equal(app.run('document.getElementById("memberImportList").innerHTML.includes("&lt;홍길동 &amp; 회원&gt;")'),false,'all existing profiles are excluded');
    assert.equal(preview(app,link([['<새 회원>','M',1]])),true);
    assert.ok(app.run('document.getElementById("memberImportList").innerHTML.includes("&lt;새 회원&gt;")'));
});

test('merge preserves existing members and games, trims and deduplicates profiles, persists and undoes',()=>{
    const app=runtime();
    const before=JSON.parse(app.run('serializeState()'));
    const url=link([[' 기존 회원 ','M',3],['새 회원','F',2],[' 새 회원 ','F',2],['새 회원','M',2],['새 회원','F',3]]);
    assert.equal(preview(app,url),true);
    assert.equal(app.run('document.getElementById("memberImportSummary").innerText'),'새 회원 3명 · 중복 2명 제외');
    assert.equal(app.run('importSharedMembers()'),true);
    const after=JSON.parse(app.run('serializeState()'));
    assert.equal(after.members.length,4);
    assert.deepEqual(after.members[0],before.members[0]);
    for(const key of ['players','courts','history'])assert.deepEqual(after[key],before[key]);
    assert.equal(new Set(after.members.map(member=>member.id)).size,4);
    assert.equal(runtime(app.storage).run('members.length'),4);
    const envelope=app.storage.get('bm_state_v14');
    preview(app,url);
    assert.equal(app.run('importSharedMembers()'),false);
    assert.equal(app.storage.get('bm_state_v14'),envelope,'repeat scans must preserve undo');
    app.run('undoLastAction(); executeConfirm()');
    assert.deepEqual(JSON.parse(app.run('serializeState()')),before);
});

test('invalid QR data is rejected without changing stored state',()=>{
    const app=runtime();
    const before=app.run('serializeState()');
    const invalid=[link([['X','M',1]],{v:2}),link([['X','M',1]],{p:0}),link([['X','M',1]],{t:0}),
        link([['X','M',1]],{m:[]}),link([['','M',1]]),link([['X','other',1]]),link([['X','F',6]]),
        link([['X','M',1.2]]),link([['X','M',1,'extra']]),link([['X'.repeat(121),'M',1]]),
        'https://example.com/#members=!', 'https://example.com/#members=A',
        'https://example.com/#members=_w', 'https://example.com/#members='+'A'.repeat(900)];
    for(const url of invalid) {
        assert.equal(preview(app,url),false,url);
        assert.equal(app.run('serializeState()'),before);
    }
});

test('failed storage rolls back the merge and allows retry; blocked storage prevents import',()=>{
    const app=runtime();
    preview(app,link([['새 회원','F',4]]));
    const before=app.run('serializeState()');
    app.context.localStorage.setItem=()=>{throw new Error('quota');};
    assert.equal(app.run('importSharedMembers()'),false);
    assert.equal(app.run('serializeState()'),before);
    assert.ok(app.run('pendingMemberImport !== null'));
    app.context.localStorage.setItem=(key,value)=>app.storage.set(key,value);
    assert.equal(app.run('importSharedMembers()'),true);
    preview(app,link([['다른 회원','M',2]]));
    app.run('storageBlocked=true');
    assert.equal(app.run('importSharedMembers()'),false);
    assert.equal(app.run('members.length'),2);
});

test('incoming non-profile fields never replace game data or become saved member fields',()=>{
    const app=runtime();
    const before=JSON.parse(app.run('serializeState()'));
    preview(app,link([['회원만 추가','M',1]],{players:[],courts:[],history:[],members:[],id:1}));
    assert.equal(app.run('importSharedMembers()'),true);
    const after=JSON.parse(app.run('serializeState()'));
    for(const key of ['players','courts','history'])assert.deepEqual(after[key],before[key]);
    assert.deepEqual(Object.keys(after.members[1]).sort(),['gender','id','name','tier']);
});

test('large directory splits into readable QR pages and every page generates and merges independently',()=>{
    const app=runtime();
    app.context.directory=Array.from({length:150},(_,i)=>({id:i+1000,name:`테스트 회원 ${i} 🏸`,gender:i%2?'M':'F',tier:i%5+1}));
    app.run('memberSharePages=buildMemberSharePages(directory)');
    const pages=JSON.parse(app.run('JSON.stringify(memberSharePages)'));
    assert.ok(pages.length>1);
    const names=[];
    for(let i=0;i<pages.length;i++) {
        assert.ok(pages[i].url.length<=app.run('MEMBER_QR_URL_LIMIT'));
        app.context.pageUrl=pages[i].url;
        app.run('{ const qrTest=qrcode(0,"M"); qrTest.addData(pageUrl); qrTest.make(); }');
        assert.equal(preview(app,pages[i].url),true);
        const data=JSON.parse(app.run('JSON.stringify(pendingMemberImport)'));
        assert.equal(data.page,i+1);assert.equal(data.total,pages.length);
        names.push(...data.rows.map(member=>member.name));
        assert.equal(app.run('importSharedMembers()'),true);
    }
    assert.equal(new Set(names).size,150);
    assert.equal(app.run('members.length'),151);
    assert.equal(app.run('players.length'),1);
});

test('opening a QR link previews without importing and removes member data from the address',()=>{
    const url=link([['링크 회원','F',5]]);
    const app=runtime(undefined,url);
    assert.equal(app.context.cleanedUrl,'/Badmintonmanage/');
    assert.equal(app.run('members.length'),1);
    assert.equal(app.run('document.getElementById("memberImportModal").style.display'),'flex');
    app.run('closeMemberImport()');
    assert.equal(app.run('pendingMemberImport'),null);
    assert.equal(app.run('members.length'),1);
});
