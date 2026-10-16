// Camera frames and selected photos are decoded locally; QR links are never navigated.
let memberQrScanRequest = 0;
let memberQrScanStream = null;
let memberQrScanTimer = null;
let memberQrRejectedValue = '';

function stopMemberQrCamera() {
    memberQrScanRequest++;
    if(memberQrScanTimer !== null) clearTimeout(memberQrScanTimer);
    memberQrScanTimer = null;
    if(memberQrScanStream) memberQrScanStream.getTracks().forEach(track => track.stop());
    memberQrScanStream = null;
    const video = document.getElementById('memberQrVideo');
    video?.pause?.();
    if(video) video.srcObject = null;
    const canvas = document.getElementById('memberQrCanvas');
    if(canvas) { canvas.width = 0; canvas.height = 0; }
}

function closeMemberQrScan() {
    stopMemberQrCamera();
    document.getElementById('memberQrScanModal').style.display = 'none';
}

function setMemberQrScanError(message) {
    stopMemberQrCamera();
    document.getElementById('memberQrScanPlaceholder').hidden = false;
    document.getElementById('memberQrScanStatus').innerText = message;
    document.getElementById('memberQrScanRetry').hidden = false;
}

function memberQrCameraError(error) {
    if(error.name === 'NotAllowedError' || error.name === 'SecurityError')
        return '카메라 접근이 허용되지 않았습니다. 기기 설정에서 카메라를 허용하거나 사진·코드로 불러와 주세요.';
    if(error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError')
        return '사용할 수 있는 카메라가 없습니다. QR 사진이나 공유 코드로 불러와 주세요.';
    if(error.name === 'NotReadableError' || error.name === 'TrackStartError')
        return '카메라를 사용할 수 없습니다. 다른 앱의 카메라를 닫은 뒤 다시 시도해 주세요.';
    return '카메라를 시작하지 못했습니다. 다시 시도하거나 사진·코드로 불러와 주세요.';
}

async function openMemberQrScan() {
    closeMemberImport();
    document.getElementById('memberQrScanModal').style.display = 'flex';
    await startMemberQrCamera();
}

async function startMemberQrCamera() {
    stopMemberQrCamera();
    const request = memberQrScanRequest;
    memberQrRejectedValue = '';
    document.getElementById('memberQrScanPlaceholder').hidden = false;
    document.getElementById('memberQrScanRetry').hidden = true;
    document.getElementById('memberQrScanStatus').innerText = '카메라 접근을 허용해 주세요.';
    if(window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
        setMemberQrScanError('이 환경에서는 카메라를 사용할 수 없습니다. HTTPS 앱에서 열거나 사진·코드로 불러와 주세요.');
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio:false,
            video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}
        });
        if(request !== memberQrScanRequest) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        memberQrScanStream = stream;
        stream.getVideoTracks().forEach(track => track.addEventListener?.('ended', () => {
            if(request === memberQrScanRequest) setMemberQrScanError('카메라 연결이 종료되었습니다. 다시 켜 주세요.');
        }));
        const video = document.getElementById('memberQrVideo');
        video.srcObject = stream;
        await video.play();
        if(request !== memberQrScanRequest) return;
        document.getElementById('memberQrScanPlaceholder').hidden = true;
        document.getElementById('memberQrScanStatus').innerText = '회원명단 공유 QR을 카메라에 비춰 주세요.';
        scheduleMemberQrFrame(request);
    } catch(error) {
        if(request === memberQrScanRequest) setMemberQrScanError(memberQrCameraError(error));
    }
}

function scheduleMemberQrFrame(request) {
    memberQrScanTimer = setTimeout(() => scanMemberQrFrame(request), 200);
}

function decodeMemberQrImage(source, width, height, maxSize = 960) {
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const canvas = document.getElementById('memberQrCanvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', {willReadFrequently:true});
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(pixels.data, pixels.width, pixels.height, {inversionAttempts:'attemptBoth'});
}

async function acceptMemberQrScan(value, request) {
    if(typeof value !== 'string') throw new Error('invalid QR');
    const isLink = /^https?:\/\//i.test(value.trim());
    // Validate before closing the scanner. Ordinary URLs and malformed QR data
    // stay in the scanner and cannot open another website or alter app data.
    if(isLink) decodeMemberShare(value);
    else await decodeMemberCode(value);
    if(request !== memberQrScanRequest) return false;
    closeMemberQrScan();
    return await previewMemberImport(value, isLink);
}

async function scanMemberQrFrame(request) {
    if(request !== memberQrScanRequest || !memberQrScanStream) return;
    memberQrScanTimer = null;
    const video = document.getElementById('memberQrVideo');
    try {
        if(video.readyState >= 2 && video.videoWidth && video.videoHeight) {
            const result = decodeMemberQrImage(video, video.videoWidth, video.videoHeight);
            if(result?.data && result.data !== memberQrRejectedValue) {
                try {
                    if(await acceptMemberQrScan(result.data, request)) return;
                } catch(error) {
                    if(request !== memberQrScanRequest) return;
                    memberQrRejectedValue = result.data;
                    document.getElementById('memberQrScanStatus').innerText = '회원명단 공유 QR이 아닙니다. 올바른 QR을 비춰 주세요.';
                }
            }
        }
    } catch(error) {
        if(request === memberQrScanRequest) setMemberQrScanError('카메라 화면을 읽지 못했습니다. 다시 시도하거나 QR 사진을 선택해 주세요.');
        return;
    }
    if(request === memberQrScanRequest) scheduleMemberQrFrame(request);
}

async function readMemberQrPhoto(input) {
    const file = input.files?.[0];
    input.value = '';
    if(!file) return false;
    stopMemberQrCamera();
    const request = memberQrScanRequest;
    document.getElementById('memberQrScanPlaceholder').hidden = false;
    document.getElementById('memberQrScanRetry').hidden = true;
    document.getElementById('memberQrScanStatus').innerText = '사진에서 QR을 읽고 있습니다…';
    let image;
    try {
        if(!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('image size or type');
        image = await createImageBitmap(file);
        if(request !== memberQrScanRequest) return false;
        const result = decodeMemberQrImage(image, image.width, image.height, 1600);
        if(!result?.data) throw new Error('QR not found');
        return await acceptMemberQrScan(result.data, request);
    } catch(error) {
        if(request === memberQrScanRequest) setMemberQrScanError('회원명단 QR을 읽지 못했습니다. QR 전체가 선명하게 보이는 사진을 선택해 주세요.');
        return false;
    } finally { image?.close(); }
}

function handleMemberQrVisibility() {
    if(document.visibilityState === 'hidden' && document.getElementById('memberQrScanModal').style.display === 'flex')
        setMemberQrScanError('스캔을 일시 중지했습니다. 카메라를 다시 켜 주세요.');
}

document.addEventListener('visibilitychange', handleMemberQrVisibility);
window.addEventListener('pagehide', closeMemberQrScan);
document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && document.getElementById('memberQrScanModal').style.display === 'flex') closeMemberQrScan();
});
