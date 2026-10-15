const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\s+src="(\.\/[^"]+)"\s*><\/script>/g)]
    .map(([, src]) => ({ src, code: fs.readFileSync(path.join(root, src), 'utf8') }));
const styles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(\.\/[^"]+)"\s*>/g)]
    .map(([, href]) => fs.readFileSync(path.join(root, href), 'utf8')).join('\n');
const appSource = scripts.map(script => script.code).join('\n');

if (scripts.length === 0) throw new Error('index.html에서 앱 스크립트를 찾을 수 없습니다.');

function runApp(context) {
    // Execute separate scripts in document order, matching browser global scope.
    scripts.forEach(({ src, code }) => vm.runInContext(code, context, { filename: src }));
}

module.exports = { html, scripts, styles, appSource, runApp };
