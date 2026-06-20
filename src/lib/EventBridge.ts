import type { ViewportState } from '../types/editor';
import { CoordinateTransformer } from './Coordinate/CoordinateTransformer';

export type CanvasPointerEventType = 'pointerdown' | 'pointermove' | 'pointerup';
export type CanvasKeyboardEventType = 'keyboard:down' | 'keyboard:up';
export type CanvasEventType = CanvasPointerEventType | CanvasKeyboardEventType;
export type CanvasEventPhase = 'capture' | 'target' | 'bubble';
export type CanvasEventTargetType = 'stage' | 'group' | 'element';

export interface CanvasEventTarget {
  type: CanvasEventTargetType;
  id: string;
}

export interface CanvasPointerEvent {
  type: CanvasPointerEventType;
  phase: CanvasEventPhase;
  screen: { x: number; y: number };
  world: { x: number; y: number };
  target: CanvasEventTarget;
  currentTarget: CanvasEventTarget;
  buttons: number;
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
  };
  nativeEvent: MouseEvent | TouchEvent;
  stopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface CanvasKeyboardEvent {
  type: CanvasKeyboardEventType;
  phase: CanvasEventPhase;
  target: CanvasEventTarget;
  currentTarget: CanvasEventTarget;
  key: string;
  code: string;
  repeat: boolean;
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
  };
  nativeEvent: KeyboardEvent;
  stopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export type CanvasStageEvent = CanvasPointerEvent | CanvasKeyboardEvent;

interface BridgeEventInput {
  type: CanvasPointerEventType;
  stage: { getPointerPosition(): { x: number; y: number } | null };
  viewport: ViewportState;
  target: CanvasEventTarget;
  native: { evt: MouseEvent | TouchEvent };
}

interface KeyboardBridgeEventInput {
  type: CanvasKeyboardEventType;
  target: CanvasEventTarget;
  native: KeyboardEvent;
}

export class EventBridge {
  private readonly coordinateTransformer: CoordinateTransformer;

  constructor(coordinateTransformer: CoordinateTransformer) {
    this.coordinateTransformer = coordinateTransformer;
  }

  toCanvasPointerEvent(input: BridgeEventInput): CanvasPointerEvent | null {
    const screen = this.coordinateTransformer.stagePointerToScreen(input.stage);
    if (!screen) {
      return null;
    }

    const world = this.coordinateTransformer.screenToWorld(screen, input.viewport);
    const native = input.native.evt;

    const canvasEvent: CanvasPointerEvent = {
      type: input.type,
      phase: 'target',
      screen,
      world,
      target: input.target,
      currentTarget: input.target,
      buttons: 'buttons' in native ? native.buttons : 0,
      modifiers: {
        shift: 'shiftKey' in native ? Boolean(native.shiftKey) : false,
        ctrl: 'ctrlKey' in native ? Boolean(native.ctrlKey) : false,
        alt: 'altKey' in native ? Boolean(native.altKey) : false,
        meta: 'metaKey' in native ? Boolean(native.metaKey) : false,
      },
      nativeEvent: native,
      stopped: false,
      preventDefault: () => {
        if ('preventDefault' in native) {
          native.preventDefault();
        }
      },
      stopPropagation: () => {
        canvasEvent.stopped = true;
        if ('stopPropagation' in native) {
          native.stopPropagation();
        }
      },
    };

    return canvasEvent;
  }

  toCanvasKeyboardEvent(input: KeyboardBridgeEventInput): CanvasKeyboardEvent {
    const native = input.native;

    const canvasEvent: CanvasKeyboardEvent = {
      type: input.type,
      phase: 'target',
      target: input.target,
      currentTarget: input.target,
      key: native.key,
      code: native.code,
      repeat: native.repeat,
      modifiers: {
        shift: native.shiftKey,
        ctrl: native.ctrlKey,
        alt: native.altKey,
        meta: native.metaKey,
      },
      nativeEvent: native,
      stopped: false,
      preventDefault: () => {
        native.preventDefault();
      },
      stopPropagation: () => {
        canvasEvent.stopped = true;
        native.stopPropagation();
      },
    };

    return canvasEvent;
  }
}
