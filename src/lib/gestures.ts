/**
 * Pointer gestures for the three canvases, so a finger can do what a mouse can.
 *
 * All three drawings -- the flat map, the field of cones, and the single
 * topic's cone -- listened for mouse events only. On a phone that left them
 * inert: the field turned by itself and could not be turned by hand, and the
 * map could not be panned at all. Pointer events cover mouse, touch and pen in
 * one set of handlers, so this replaces the mouse listeners rather than sitting
 * beside them.
 *
 * Wheel is deliberately not here. Each canvas has its own zoom curve, tuned by
 * eye and approved as it is, and a shared curve would have quietly changed all
 * three. Pinch reports a multiplier instead, which each caller applies through
 * whatever clamp it already had.
 */

export type Point = { x: number; y: number };

export type Gestures = {
  /** A press begins, at a point relative to the canvas. */
  onPressStart?: (p: Point) => void;
  /**
   * A one-pointer drag.
   *
   * Both measures are given because the two uses want different ones: a
   * rotation is an absolute angle from where the press began, and a pan is a
   * sum of steps. Client pixels, so the arithmetic that was tuned against
   * mouse deltas reads identically.
   */
  onDrag?: (d: { totalX: number; totalY: number; stepX: number; stepY: number }) => void;
  onPressEnd?: () => void;
  /** A pinch, as a multiplier about an anchor relative to the canvas. */
  onPinch?: (z: { factor: number; x: number; y: number }) => void;
  /**
   * Mouse only.
   *
   * A touch has no hover. Reporting one would strand a tooltip under the
   * finger that opened it, with no later event to take it away.
   */
  onHover?: (p: Point | null) => void;
};

export function attachGestures(canvas: HTMLCanvasElement, g: Gestures): () => void {
  /*
   * Without this the browser claims the gesture first -- a drag scrolls the
   * page and a pinch zooms it -- and the canvas sees a pointercancel instead
   * of a turn.
   */
  const previousTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";

  const down = new Map<number, Point>();
  let start: Point | null = null;
  let last: Point | null = null;
  let pinch: number | null = null;

  const local = (e: { clientX: number; clientY: number }): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const spread = () => {
    const [a, b] = [...down.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (down.size === 1) {
      start = { x: e.clientX, y: e.clientY };
      last = { x: e.clientX, y: e.clientY };
      g.onPressStart?.(local(e));
    } else if (down.size === 2) {
      pinch = spread();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!down.has(e.pointerId)) {
      // No button held: a mouse looking around, which is the only thing that
      // can hover.
      if (down.size === 0 && e.pointerType === "mouse") g.onHover?.(local(e));
      return;
    }
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (down.size >= 2) {
      const now = spread();
      if (pinch !== null && pinch > 0 && now > 0) {
        const [a, b] = [...down.values()];
        const mid = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        g.onPinch?.({ factor: now / pinch, x: mid.x, y: mid.y });
      }
      pinch = now;
      return;
    }
    if (!start || !last) return;
    g.onDrag?.({
      totalX: e.clientX - start.x,
      totalY: e.clientY - start.y,
      stepX: e.clientX - last.x,
      stepY: e.clientY - last.y,
    });
    last = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!down.delete(e.pointerId)) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (down.size === 0) {
      start = null;
      last = null;
      pinch = null;
      g.onPressEnd?.();
      return;
    }
    /*
     * One finger lifted from a pinch. The remaining one becomes the drag, and
     * its origin has to be reset to where it is now -- otherwise the view
     * jumps by however far apart the two fingers had been.
     */
    const [remaining] = [...down.values()];
    start = { ...remaining };
    last = { ...remaining };
    pinch = null;
  };

  const onPointerLeave = (e: PointerEvent) => {
    if (down.size === 0 && e.pointerType === "mouse") g.onHover?.(null);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  return () => {
    canvas.style.touchAction = previousTouchAction;
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
  };
}
