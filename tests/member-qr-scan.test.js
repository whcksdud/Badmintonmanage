const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const {gzipSync} = require('node:zlib');
const qrcode = require('../js/vendor/qrcode');
const jsQR = require('../js/vendor/jsQR');
const {runApp} = require('./helpers/app-runtime');

function qrLink(rows, extra = {}) {
    return 'https://whcksdud.github.io/Badmintonmanage/#members=' +
        Buffer.from(JSON.stringify({v:1,p:1,t:1,m:rows,...extra})).toString('base64url');
}

function qrPixels(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const scale = 4, margin = 4, count = qr.getModuleCount();
    const width = (count + margin * 2) * scale;
    const data = new Uint8ClampedArray(width * width * 4).fill(255);
    for(let row = 0; row < count; row++) for(let col = 0; col < count; col++) {
        if(!qr.isDark(row, col)) continue;
        for(let y = 0; y < scale; y++) for(let x = 0; x < scale; x++) {
            const pixel = (((row + margin) * scale + y) * width + (col + margin) * scale + x) * 4;
            data[pixel] = data[pixel + 1] = data[pixel + 2] = 0;
        }
    }
    return {data, width, height:width};
}

function runtime(initialFrame = qrPixels(qrLink([['스캔 회원','F',4]]))) {
    const saved = {
        members:[{id:100,name:'기존 회원',gender:'M',tier:3}],
        players:[{id:1,name:'오늘 선수',gender:'M',tier:3,games:2,matchingOffset:0,lastTime:0,status:'waiting',shuttlecock:false,waitingSince:100}],
        courts:[{id:1,type:'A',active:[],next:[],startTime:null}],
        history:[{cId:1,startTime:100,endTime:200,pIds:[1,2,3,4],teamNames:[['오늘 선수','이전 선수'],['상대1','상대2']],scores:[21,17]}]
    };
    const storage = new Map([['bm_state_v14',JSON.stringify({current:saved,previous:null})]]);
    const elements = new Map(), timers = new Map(), events = new Map(), tracks = [], requests = [];
    function listen(key, cb) {
        const previous = events.get(key);
        events.set(key, previous ? event => { previous(event); cb(event); } : cb);
    }
    let nextTimer = 1, frame = initialFrame, imageClosed = 0;
    const element = () => ({value:'',style:{},hidden:false,classList:{toggle(){},add(){},remove(){}},
        setAttribute(){},addEventListener(){},focus(){},select(){},click(){},pause(){},play:async()=>{},
        readyState:2,videoWidth:frame.width,videoHeight:frame.height,
        getContext:()=>({drawImage(){},getImageData:()=>frame})});
    function el(id) {if(!elements.has(id))elements.set(id,element());return elements.get(id);}
    function makeStream() {
        const track={stops:0,readyState:'live',stop(){this.stops++;this.readyState='ended';},addEventListener(type,cb){this[type]=cb;}};
        tracks.push(track);
        return {getTracks:()=>[track],getVideoTracks:()=>[track]};
    }
    const location=new URL('https://example.test/Badmintonmanage/');
    const context=vm.createContext({console,Blob,URL,TextEncoder,TextDecoder,btoa,atob,CompressionStream,DecompressionStream,
        navigator:{mediaDevices:{getUserMedia:async constraints=>{requests.push(constraints);return makeStream();}}},
        document:{visibilityState:'visible',getElementById:el,createElement:element,addEventListener(type,cb){listen(`document:${type}`,cb);}},
        window:{navigator:{},location,isSecureContext:true,history:{state:null,replaceState(state,title,url){this.state=state;location.href=new URL(url,location.href).href;}},
            matchMedia:()=>({matches:false}),addEventListener(type,cb){listen(`window:${type}`,cb);}},
        localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
        setTimeout(cb){const id=nextTimer++;timers.set(id,cb);return id;},clearTimeout(id){timers.delete(id);},setInterval(){},
        createImageBitmap:async()=>({width:frame.width,height:frame.height,close(){imageClosed++;}})
    });
    runApp(context);
    return {context,storage,tracks,requests,events,timers,el,makeStream,
        get imageClosed(){return imageClosed;},
        run:code=>vm.runInContext(code,context),
        setFrame(image){frame=image;el('memberQrVideo').videoWidth=image.width;el('memberQrVideo').videoHeight=image.height;},
        async tick(){const [id,cb]=timers.entries().next().value;timers.delete(id);return await cb();}
    };
}

test('bundled decoder reads the generated QR pages, including Korean and emoji names',()=>{
    const app=runtime();
    app.context.directory=Array.from({length:35},(_,i)=>({name:`회원 ${i} 🏸`,gender:i%2?'M':'F',tier:i%5+1}));
    const pages=JSON.parse(app.run('JSON.stringify(buildMemberSharePages(directory))'));
    assert.ok(pages.length>1);
    const names=[];
    for(const page of pages) {
        const pixels=qrPixels(page.url);
        const result=jsQR(pixels.data,pixels.width,pixels.height);
        assert.equal(result.data,page.url);
        app.context.scanned=result.data;
        names.push(...JSON.parse(app.run('JSON.stringify(decodeMemberShare(scanned).rows)')).map(m=>m.name));
    }
    assert.deepEqual(names,app.context.directory.map(m=>m.name));
});

test('camera QR stays in the app, stops the camera, previews and merges without replacing game data',async()=>{
    const url=qrLink([[' 기존 회원 ','M',3],['스캔 회원','F',4],['스캔 회원','F',4]]);
    const app=runtime(qrPixels(url));
    const before=JSON.parse(app.run('serializeState()'));
    const address=app.context.window.location.href;
    await app.run('openMemberQrScan()');
    assert.equal(app.requests[0].audio,false);
    assert.equal(app.requests[0].video.facingMode.ideal,'environment');
    assert.equal(app.tracks[0].stops,0);
    await app.tick();
    assert.equal(app.tracks[0].stops,1);
    assert.equal(app.el('memberQrVideo').srcObject,null);
    assert.equal(app.el('memberQrScanModal').style.display,'none');
    assert.equal(app.el('memberImportModal').style.display,'flex');
    assert.equal(app.el('memberImportSummary').innerText,'새 회원 1명 · 중복 2명 제외');
    assert.equal(app.context.window.location.href,address,'QR must not navigate to the sender URL');
    assert.equal(app.context.window.history.state.bmPendingMemberQr,url,'preview survives an app update');
    assert.deepEqual(JSON.parse(app.run('serializeState()')),before);
    assert.equal(app.run('importSharedMembers()'),true);
    const after=JSON.parse(app.run('serializeState()'));
    assert.equal(after.members.length,2);
    for(const key of ['players','courts','history'])assert.deepEqual(after[key],before[key]);
    app.run('undoLastAction(); executeConfirm()');
    assert.deepEqual(JSON.parse(app.run('serializeState()')),before);
});

test('ordinary and malformed QR codes do not navigate, import or stop scanning',async()=>{
    const app=runtime(qrPixels('https://example.com/do-not-open'));
    const before=app.run('serializeState()');
    await app.run('openMemberQrScan()');
    await app.tick();
    assert.match(app.el('memberQrScanStatus').innerText,/회원명단 공유 QR이 아닙니다/);
    assert.equal(app.tracks[0].stops,0);
    assert.equal(app.run('pendingMemberImport'),null);
    assert.equal(app.context.window.location.href,'https://example.test/Badmintonmanage/');
    app.setFrame(qrPixels(qrLink([['잘못된 급수','M',8]])));
    await app.tick();
    assert.equal(app.run('serializeState()'),before);
    app.setFrame(qrPixels(qrLink([['올바른 회원','F',2]])));
    await app.tick();
    assert.equal(app.run('pendingMemberImport.rows[0].name'),'올바른 회원');
    assert.equal(app.tracks[0].stops,1);
});

test('denied, missing, busy or unsupported cameras offer retry and code/photo fallback',async()=>{
    for(const name of ['NotAllowedError','NotFoundError','NotReadableError','AbortError']) {
        const app=runtime();
        app.context.navigator.mediaDevices.getUserMedia=async()=>{throw Object.assign(new Error('camera error'),{name});};
        await app.run('openMemberQrScan()');
        assert.equal(app.el('memberQrScanModal').style.display,'flex');
        assert.equal(app.el('memberQrScanRetry').hidden,false);
        assert.ok(app.el('memberQrScanStatus').innerText.length>10);
        assert.equal(app.run('memberQrScanStream'),null);
        assert.equal(app.run('memberQrScanTimer'),null);
    }
    const app=runtime();
    app.context.window.isSecureContext=false;
    await app.run('openMemberQrScan()');
    assert.equal(app.requests.length,0);
    assert.match(app.el('memberQrScanStatus').innerText,/HTTPS/);
    app.run('openMemberImport()');
    assert.equal(app.el('memberQrScanModal').style.display,'none');
    assert.equal(app.el('memberImportModal').style.display,'flex');
});

test('late camera permission after close releases tracks and cannot reopen or overwrite another scan',async()=>{
    const app=runtime();
    let finish;
    app.context.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{finish=resolve;});
    const opening=app.run('openMemberQrScan()');
    app.run('closeMemberQrScan()');
    finish(app.makeStream());
    await opening;
    assert.equal(app.tracks[0].stops,1);
    assert.equal(app.el('memberQrScanModal').style.display,'none');
    assert.equal(app.el('memberQrVideo').srcObject,null);
    assert.equal(app.run('memberQrScanTimer'),null);
});

test('close, Escape, app hiding, page exit and failed playback all release the camera',async()=>{
    for(const event of ['close','Escape','visibilitychange','pagehide','ended']) {
        const app=runtime();
        await app.run('openMemberQrScan()');
        if(event==='close') app.run('closeMemberQrScan()');
        if(event==='Escape') app.events.get('document:keydown')({key:'Escape'});
        if(event==='visibilitychange') {app.context.document.visibilityState='hidden';app.events.get('document:visibilitychange')();}
        if(event==='pagehide') app.events.get('window:pagehide')();
        if(event==='ended') app.tracks[0].ended();
        assert.equal(app.tracks[0].stops,1,event);
        assert.equal(app.el('memberQrVideo').srcObject,null,event);
        assert.equal(app.run('memberQrScanTimer'),null,event);
        assert.equal(app.timers.size,0,event);
    }
    const app=runtime();
    app.el('memberQrVideo').play=async()=>{throw new Error('play failed');};
    await app.run('openMemberQrScan()');
    assert.equal(app.tracks[0].stops,1);
    assert.equal(app.el('memberQrScanRetry').hidden,false);
});

test('a chosen QR photo uses the real decoder, closes the image and supports duplicate-safe import',async()=>{
    const app=runtime();
    await app.run('openMemberQrScan()');
    const input=app.el('memberQrPhoto');
    input.files=[{type:'image/png',size:1024}];
    assert.equal(await app.run('readMemberQrPhoto(document.getElementById("memberQrPhoto"))'),true);
    assert.equal(app.tracks[0].stops,1);
    assert.equal(app.imageClosed,1);
    assert.equal(app.run('members.length'),1);
    assert.equal(app.run('importSharedMembers()'),true);
    assert.equal(app.run('members.length'),2);
    await app.run('openMemberQrScan()');
    assert.equal(await app.run('readMemberQrPhoto(document.getElementById("memberQrPhoto"))'),true);
    assert.equal(app.el('memberImportButton').disabled,true);
    assert.equal(app.run('importSharedMembers()'),false);
    assert.equal(app.run('members.length'),2);
});

test('unreadable photos and cancelled asynchronous decoding cannot import or revive the scanner',async()=>{
    const app=runtime(qrPixels('unrelated photo QR'));
    await app.run('openMemberQrScan()');
    app.el('memberQrPhoto').files=[{type:'image/png',size:1024}];
    assert.equal(await app.run('readMemberQrPhoto(document.getElementById("memberQrPhoto"))'),false);
    assert.equal(app.run('pendingMemberImport'),null);
    assert.equal(app.el('memberQrScanRetry').hidden,false);
    assert.equal(app.imageClosed,1);
    app.el('memberQrPhoto').files=[{type:'image/png',size:21*1024*1024}];
    assert.equal(await app.run('readMemberQrPhoto(document.getElementById("memberQrPhoto"))'),false);
    assert.equal(app.imageClosed,1,'oversized images must not be decoded');
    app.setFrame(qrPixels(qrLink([['취소할 사진','F',1]])));
    let finish, closed=0;
    app.context.createImageBitmap=()=>new Promise(resolve=>{finish=resolve;});
    app.el('memberQrPhoto').files=[{type:'image/png',size:1024}];
    const reading=app.run('readMemberQrPhoto(document.getElementById("memberQrPhoto"))');
    app.run('closeMemberQrScan()');
    finish({width:320,height:320,close(){closed++;}});
    assert.equal(await reading,false);
    assert.equal(closed,1);
    assert.equal(app.run('pendingMemberImport'),null);
    assert.equal(app.run('members.length'),1);
});

test('QR containing a compressed code can also be read without navigating',async()=>{
    const code='BM2-'+gzipSync(Buffer.from(JSON.stringify({v:2,m:[['압축 QR 회원','M',5]]}))).toString('base64url');
    const app=runtime(qrPixels(code));
    await app.run('openMemberQrScan()');
    await app.tick();
    assert.equal(app.run('pendingMemberImport.rows[0].name'),'압축 QR 회원');
    assert.equal(app.tracks[0].stops,1);
    assert.equal(app.context.window.location.href,'https://example.test/Badmintonmanage/');
});
