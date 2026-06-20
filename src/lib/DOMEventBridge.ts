import { EventBridge, type CanvasEventTarget, type CanvasKeyboardEvent } from './EventBridge';

interface DOMEventBridgeOptions {
  onEvent: (event: CanvasKeyboardEvent) => void;
  target?: CanvasEventTarget;
}

export class DOMEventBridge {
  private readonly eventBridge: EventBridge;

  private isInitialized = false;

  private cleanup: (() => void) | null = null;

  constructor(eventBridge: EventBridge) {
    this.eventBridge = eventBridge;
  }

  init(options: DOMEventBridgeOptions): () => void {
    if (this.isInitialized && this.cleanup) {
      return this.cleanup;
    }

    const target = options.target ?? { type: 'stage', id: 'stage' };

    const onKeyDown = (native: KeyboardEvent) => {
      const event = this.eventBridge.toCanvasKeyboardEvent({
        type: 'keyboard:down',
        target,
        native,
      });
      options.onEvent(event);
    };

    const onKeyUp = (native: KeyboardEvent) => {
      const event = this.eventBridge.toCanvasKeyboardEvent({
        type: 'keyboard:up',
        target,
        native,
      });
      options.onEvent(event);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    this.cleanup = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      this.isInitialized = false;
      this.cleanup = null;
    };

    this.isInitialized = true;
    return this.cleanup;
  }
}
