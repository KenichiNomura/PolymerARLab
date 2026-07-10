// Interactive scan viewfinder: tap the frame to capture, drag its body to move
// it, drag a corner bracket to resize. The captured crop follows the box's live
// rect (see cameraOverlay.drawFrameTo), so no capture-side change is needed.

const MIN_W = 110;
const MIN_H = 90;
const TAP_MOVE = 6; // px of movement below which a press counts as a tap

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScanFrameOptions {
  boxEl: HTMLElement;
  cornerEls: HTMLElement[];
  onCapture: () => void;
}

export function createScanFrame({ boxEl, cornerEls, onCapture }: ScanFrameOptions) {
  let rect = defaultRect();
  apply();

  window.addEventListener("resize", () => {
    clampIntoView();
    apply();
  });

  // Body: a near-stationary press captures; a drag moves the frame.
  boxEl.addEventListener("pointerdown", (event) => {
    if (event.button && event.button !== 0) return;
    event.preventDefault();
    boxEl.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = rect.x;
    const originY = rect.y;
    let moved = 0;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      moved = Math.max(moved, Math.hypot(dx, dy));
      rect.x = originX + dx;
      rect.y = originY + dy;
      clampIntoView();
      apply();
    };
    const up = () => {
      boxEl.removeEventListener("pointermove", move);
      boxEl.removeEventListener("pointerup", up);
      boxEl.removeEventListener("pointercancel", up);
      if (moved < TAP_MOVE) onCapture();
    };
    boxEl.addEventListener("pointermove", move);
    boxEl.addEventListener("pointerup", up);
    boxEl.addEventListener("pointercancel", up);
  });

  // Corners: resize from the anchored opposite corner.
  for (const corner of cornerEls) {
    const controlsLeft = corner.classList.contains("tl") || corner.classList.contains("bl");
    const controlsTop = corner.classList.contains("tl") || corner.classList.contains("tr");
    corner.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation(); // don't let the body handler treat this as a tap/move
      corner.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const o = { ...rect };
      const right = o.x + o.w;
      const bottom = o.y + o.h;

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let { x, y, w, h } = o;
        if (controlsLeft) {
          x = Math.max(0, Math.min(o.x + dx, right - MIN_W));
          w = right - x;
        } else {
          w = Math.max(MIN_W, Math.min(o.w + dx, window.innerWidth - o.x));
        }
        if (controlsTop) {
          y = Math.max(0, Math.min(o.y + dy, bottom - MIN_H));
          h = bottom - y;
        } else {
          h = Math.max(MIN_H, Math.min(o.h + dy, window.innerHeight - o.y));
        }
        rect = { x, y, w, h };
        apply();
      };
      const up = () => {
        corner.removeEventListener("pointermove", move);
        corner.removeEventListener("pointerup", up);
        corner.removeEventListener("pointercancel", up);
      };
      corner.addEventListener("pointermove", move);
      corner.addEventListener("pointerup", up);
      corner.addEventListener("pointercancel", up);
    });
  }

  function apply() {
    boxEl.style.left = `${rect.x}px`;
    boxEl.style.top = `${rect.y}px`;
    boxEl.style.width = `${rect.w}px`;
    boxEl.style.height = `${rect.h}px`;
  }

  function clampIntoView() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    rect.w = Math.min(rect.w, vw);
    rect.h = Math.min(rect.h, vh);
    rect.x = Math.min(Math.max(0, rect.x), vw - rect.w);
    rect.y = Math.min(Math.max(0, rect.y), vh - rect.h);
  }
}

// Centered 4:3 box, ~85% of the width, capped at 66% of the height.
function defaultRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(vw * 0.85, 640);
  const h = Math.min((w * 3) / 4, vh * 0.66);
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}
