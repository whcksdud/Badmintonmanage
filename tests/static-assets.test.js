const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { html, scripts } = require('./helpers/app-runtime');

test('GitHub Pages 하위 경로에서 캐시를 업데이트하고 앱 파일을 오프라인으로 다시 불러온다', async () => {
    const root = path.resolve(__dirname, '..');
    const base = new URL('https://example.test/Badmintonmanage/');
    const callbacks = new Map();
    const stores = new Map([
        ['badminton-manager-app-v17', new Map([[new URL('./', base).href, new Response('old app')]])],
        ['badminton-manager-runtime-v17', new Map()],
        ['badminton-manager-app-v18', new Map([[new URL('./css/style.css', base).href, new Response('old design')]])],
        ['badminton-manager-runtime-v18', new Map()],
        ['badminton-manager-app-v19', new Map([[new URL('./js/matching.js', base).href, new Response('old matching rules')]])],
        ['badminton-manager-runtime-v19', new Map()],
        ['badminton-manager-app-v20', new Map([[new URL('./js/matching.js', base).href, new Response('strict FIFO matching')]])],
        ['badminton-manager-runtime-v20', new Map()],
        ['badminton-manager-app-v21', new Map([[new URL('./js/courts.js', base).href, new Response('transfer without exchange')]])],
        ['badminton-manager-runtime-v21', new Map()],
        ['badminton-manager-app-v22', new Map([[new URL('./js/courts.js', base).href, new Response('old court labels')]])],
        ['badminton-manager-runtime-v22', new Map()],
        ['badminton-manager-app-v23', new Map([[new URL('./js/statistics.js', base).href, new Response('old history list')]])],
        ['badminton-manager-runtime-v23', new Map()],
        ['badminton-manager-app-v24', new Map([[new URL('./js/members.js', base).href, new Response('old attendance UI')]])],
        ['badminton-manager-runtime-v24', new Map()],
        ['badminton-manager-app-v25', new Map([[new URL('./css/style.css', base).href, new Response('old attendance layout')]])],
        ['badminton-manager-runtime-v25', new Map()],
        ['badminton-manager-app-v26', new Map([[new URL('./js/pwa.js', base).href, new Response('old settings buttons')]])],
        ['badminton-manager-runtime-v26', new Map()],
        ['badminton-manager-app-v27', new Map([[new URL('./css/style.css', base).href, new Response('old help typography')]])],
        ['badminton-manager-runtime-v27', new Map()],
        ['badminton-manager-app-v28', new Map([[new URL('./css/style.css', base).href, new Response('old meeting icon')]])],
        ['badminton-manager-runtime-v28', new Map()],
        ['badminton-manager-app-v29', new Map([[new URL('./js/courts.js', base).href, new Response('old player swap')]])],
        ['badminton-manager-runtime-v29', new Map()],
        ['badminton-manager-app-v30', new Map([[new URL('./js/courts.js', base).href, new Response('old team action icon')]])],
        ['badminton-manager-runtime-v30', new Map()],
        ['badminton-manager-app-v31', new Map([[new URL('./css/style.css', base).href, new Response('old stats modal spacing')]])],
        ['badminton-manager-runtime-v31', new Map()],
        ['badminton-manager-app-v32', new Map([[new URL('./css/style.css', base).href, new Response('old court center line')]])],
        ['badminton-manager-runtime-v32', new Map()],
        ['unrelated-app-cache', new Map()]
    ]);
    let online = true;
    const keyFor = request => new URL(typeof request === 'string' ? request : request.url, base).href;
    const fetchFile = async request => {
        if (!online) throw new Error('offline');
        const url = new URL(keyFor(request));
        assert.ok(url.pathname.startsWith(base.pathname), '앱 파일은 프로젝트 하위 경로에서 요청해야 합니다.');
        const relative = url.pathname.slice(base.pathname.length) || 'index.html';
        return new Response(fs.readFileSync(path.join(root, relative)));
    };
    const caches = {
        async open(name) {
            if (!stores.has(name)) stores.set(name, new Map());
            const entries = stores.get(name);
            return {
                async addAll(requests) {
                    for (const request of requests) entries.set(keyFor(request), await fetchFile(request));
                },
                async put(request, response) { entries.set(keyFor(request), response.clone()); }
            };
        },
        async match(request) {
            for (const entries of stores.values()) {
                const response = entries.get(keyFor(request));
                if (response) return response.clone();
            }
        },
        async keys() { return [...stores.keys()]; },
        async delete(name) { return stores.delete(name); }
    };
    const context = vm.createContext({
        caches, fetch: fetchFile, Response,
        self: {
            addEventListener(type, callback) { callbacks.set(type, callback); },
            async skipWaiting() {},
            clients: { async claim() {} }
        }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'), context);
    let pending;
    callbacks.get('install')({ waitUntil(promise) { pending = promise; } });
    await pending;
    callbacks.get('activate')({ waitUntil(promise) { pending = promise; } });
    await pending;
    for (const version of [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) {
        assert.equal(stores.has(`badminton-manager-app-v${version}`), false);
        assert.equal(stores.has(`badminton-manager-runtime-v${version}`), false);
    }
    assert.equal(stores.has('unrelated-app-cache'), true);

    const linkedAssets = [
        ...scripts.map(script => script.src),
        ...[...html.matchAll(/<link\b[^>]*href="(\.\/[^"]+)"/g)].map(([, href]) => href)
    ];
    online = false;
    for (const asset of ['./', './index.html', ...new Set(linkedAssets)]) {
        let responsePromise;
        callbacks.get('fetch')({
            request: { method: 'GET', mode: asset === './' ? 'navigate' : 'cors', url: new URL(asset, base).href },
            respondWith(promise) { responsePromise = promise; }
        });
        const response = await responsePromise;
        assert.equal(response?.status, 200, `${asset}는 오프라인에서도 제공되어야 합니다.`);
        const relative = asset === './' ? 'index.html' : asset.slice(2);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(root, relative)), `${asset} 캐시 내용이 원본과 일치해야 합니다.`);
    }
});
