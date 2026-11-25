// Move court cards by touch, mouse, or keyboard.

const courtHoldDelay = 380;
const courtHoldSlop = 9;
const courtCardSelector = '#courtGrid > .court-card';
let courtHold = null;
let suppressCourtClick = false;
let selectedCourtOrderHandle = null;

function renderCourtOrderHandle(id, title) {
    if(courts.length < 2) return '';
    return `<button id="court-order-${id}" class="court-order-handle" type="button"
        aria-label="${title} 순서 이동" aria-pressed="false" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        title="길게 눌러 끌어서 이동" onclick="selectCourtOrderPosition(${id})"
        onkeydown="handleCourtOrderKey(event, ${id})">${renderUIIcon('grip')}</button>`;
}

function moveCourtToPosition(id, targetId, restoreFocus = false) {
    const ids = getCourtsInDisplayOrder().map(court => court.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if(from < 0 || to < 0 || from === to) return;

    ids.splice(from, 1);
    ids.splice(to, 0, id);
    const saved = setCourtDisplayOrder(ids);
    if(saved) {
        render();
        const message = `${courtTitle(id)} · ${to + 1}번째로 이동했습니다.`;
        document.getElementById('courtOrderStatus').textContent = message;
        showToast(message);
    }
    if(restoreFocus) document.getElementById(`court-order-${id}`)?.focus();
}

function clearCourtOrderSelection() {
    const selected = selectedCourtOrderHandle;
    selectedCourtOrderHandle = null;
    selected?.setAttribute('aria-pressed', 'false');
    return selected;
}

function selectCourtOrderPosition(id) {
    const selected = clearCourtOrderSelection();
    if(selected) {
        moveCourtToPosition(Number(selected.closest(courtCardSelector).dataset.courtId), id, true);
        return;
    }
    selectedCourtOrderHandle = document.getElementById(`court-order-${id}`);
    selectedCourtOrderHandle.setAttribute('aria-pressed', 'true');
    const message = '옮길 위치의 코트 이동 버튼을 누르세요.';
    document.getElementById('courtOrderStatus').textContent = message;
    showToast(message);
}

function handleCourtOrderKey(event, id) {
    const offset = {ArrowUp:-1, ArrowLeft:-1, ArrowDown:1, ArrowRight:1}[event.key];
    if(!offset) return;
    event.preventDefault();
    clearCourtOrderSelection();
    const order = getCourtsInDisplayOrder();
    const from = order.findIndex(court => court.id === id);
    moveCourtToPosition(id, order[from + offset]?.id, true);
}

function startCourtHold(target, point, kind, pointerId) {
    const card = target.closest?.(courtCardSelector);
    if(courtHold || !card || courts.length < 2) return;
    const control = target.closest('button, a, input, select, textarea, [role="button"]');
    if(control && !control.classList.contains('court-order-handle')) return;

    const hold = {
        card, kind, pointerId, target:null,
        x:point.clientX, y:point.clientY,
        startX:point.clientX, startY:point.clientY,
        active:false, moved:false, frame:0
    };
    hold.timer = setTimeout(() => activateCourtHold(hold), courtHoldDelay);
    courtHold = hold;
}

function activateCourtHold(hold) {
    if(courtHold !== hold) return;
    if(document.elementFromPoint(hold.x, hold.y)?.closest(courtCardSelector) !== hold.card) {
        cancelCourtHold();
        return;
    }
    hold.active = true;
    clearCourtOrderSelection();
    closeHeaderActions();
    closeReserveTypeMenu();
    hold.card.classList.add('is-court-dragging');
    hold.card.parentElement.classList.add('is-reordering');
    hold.preview = document.getElementById('courtDragPreview');
    document.getElementById('courtDragPreviewName').textContent = courtTitle(Number(hold.card.dataset.courtId));
    hold.preview.hidden = false;
    hold.previewWidth = hold.preview.offsetWidth;
    hold.previewHeight = hold.preview.offsetHeight;
    hold.area = document.getElementById('courtArea');
    updateCourtHoldPosition(hold);
    hold.frame = requestAnimationFrame(() => scrollCourtWhileDragging(hold));
}

function updateCourtHold(point) {
    const hold = courtHold;
    hold.x = point.clientX;
    hold.y = point.clientY;
    const moved = Math.hypot(hold.x - hold.startX, hold.y - hold.startY) > courtHoldSlop;
    if(!hold.active) {
        if(moved) cancelCourtHold();
        return;
    }
    hold.moved ||= moved;
    updateCourtHoldPosition(hold);
}

function updateCourtHoldPosition(hold) {
    const x = Math.max(8, Math.min(hold.x - hold.previewWidth / 2, window.innerWidth - hold.previewWidth - 8));
    const y = Math.max(8, hold.y - hold.previewHeight - 16);
    hold.preview.style.transform = `translate(${x}px, ${y}px)`;
    const hit = document.elementFromPoint(hold.x, hold.y)?.closest(courtCardSelector);
    const target = hit && hit !== hold.card ? hit : null;
    if(hold.target === target) return;
    hold.target?.classList.remove('is-court-drop-target');
    target?.classList.add('is-court-drop-target');
    hold.target = target;
}

function scrollCourtWhileDragging(hold) {
    if(courtHold !== hold) return;
    const {top, bottom, left, right} = hold.area.getBoundingClientRect();
    if(hold.moved && hold.x >= left && hold.x <= right && hold.y >= top && hold.y <= bottom) {
        const edge = Math.min(64, (bottom - top) / 3);
        const speed = (Math.max(0, hold.y - bottom + edge) - Math.max(0, top + edge - hold.y)) / 4;
        if(speed) {
            const previous = hold.area.scrollTop;
            hold.area.scrollTop += speed;
            if(hold.area.scrollTop !== previous) updateCourtHoldPosition(hold);
        }
    }
    hold.frame = requestAnimationFrame(() => scrollCourtWhileDragging(hold));
}

function cancelCourtHold() {
    const hold = courtHold;
    if(!hold) return;
    courtHold = null;
    clearTimeout(hold.timer);
    if(!hold.active) return;
    cancelAnimationFrame(hold.frame);
    hold.preview.hidden = true;
    hold.card.classList.remove('is-court-dragging');
    hold.card.parentElement?.classList.remove('is-reordering');
    hold.target?.classList.remove('is-court-drop-target');
    suppressCourtClick = true;
}

function dropCourtHold(point) {
    const hold = courtHold;
    if(hold.active) updateCourtHold(point);
    cancelCourtHold();
    if(hold.target) moveCourtToPosition(Number(hold.card.dataset.courtId), Number(hold.target.dataset.courtId));
}

document.addEventListener('pointerdown', event => {
    if(!event.isPrimary || event.button !== 0) return;
    suppressCourtClick = false;
    if(event.pointerType !== 'touch') startCourtHold(event.target, event, 'pointer', event.pointerId);
});
document.addEventListener('pointermove', event => {
    if(courtHold?.kind === 'pointer' && courtHold.pointerId === event.pointerId) updateCourtHold(event);
});
document.addEventListener('pointerup', event => {
    if(courtHold?.kind === 'pointer' && courtHold.pointerId === event.pointerId) dropCourtHold(event);
});
document.addEventListener('pointercancel', event => {
    if(courtHold?.kind === 'pointer' && courtHold.pointerId === event.pointerId) cancelCourtHold();
});

// Native panning stays available until the hold activates. Prevent only the
// touch moves and release that belong to an active drag.
document.addEventListener('touchstart', event => {
    if(event.touches.length !== 1) {
        cancelCourtHold();
        return;
    }
    suppressCourtClick = false;
    startCourtHold(event.target, event.touches[0], 'touch');
}, {passive:true});
document.addEventListener('touchmove', event => {
    if(courtHold?.kind !== 'touch') return;
    if(courtHold.active && event.cancelable) event.preventDefault();
    updateCourtHold(event.touches[0]);
}, {passive:false});
document.addEventListener('touchend', event => {
    if(courtHold?.kind !== 'touch') return;
    if(courtHold.active && event.cancelable) event.preventDefault();
    dropCourtHold(event.changedTouches[0]);
}, {passive:false});
document.addEventListener('touchcancel', cancelCourtHold);
document.addEventListener('contextmenu', event => {
    if(courtHold?.active) event.preventDefault();
});
document.addEventListener('click', event => {
    if(!suppressCourtClick || event.detail === 0) return;
    suppressCourtClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
}, true);
document.addEventListener('keydown', event => {
    if(event.key !== 'Escape') return;
    cancelCourtHold();
    clearCourtOrderSelection();
});
window.addEventListener('blur', cancelCourtHold);
window.addEventListener('resize', cancelCourtHold);
