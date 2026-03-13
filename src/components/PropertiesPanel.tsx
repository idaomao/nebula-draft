import { useEffect, useRef } from 'react';
import type { BoardElement } from '../types/editor';
import { normalizeRichText, plainTextToRichText, richTextToPlainText } from '../utils/richText';

interface PropertiesPanelProps {
  selectedElement: BoardElement | null;
  selectionCount: number;
  onPatchElement: (id: string, patch: Partial<BoardElement>, trackHistory?: boolean) => void;
  onPatchSelected: (patch: Partial<BoardElement>, trackHistory?: boolean) => void;
  onDelete: () => void;
}

const roundNumber = (value: number): number => Math.round(value * 100) / 100;

export const PropertiesPanel = ({
  selectedElement,
  selectionCount,
  onPatchElement,
  onPatchSelected,
  onDelete,
}: PropertiesPanelProps) => {
  const richEditorRef = useRef<HTMLDivElement | null>(null);

  const applyPatch = (patch: Partial<BoardElement>) => {
    if (!selectedElement) {
      return;
    }

    if (selectionCount > 1) {
      onPatchSelected(patch, true);
      return;
    }

    onPatchElement(selectedElement.id, patch, true);
  };

  useEffect(() => {
    if (!selectedElement || selectedElement.kind !== 'note' || selectionCount !== 1) {
      if (richEditorRef.current) {
        richEditorRef.current.innerHTML = '';
      }
      return;
    }

    if (richEditorRef.current) {
      if (document.activeElement === richEditorRef.current) {
        return;
      }
      richEditorRef.current.innerHTML = normalizeRichText(selectedElement.richText);
    }
  }, [selectedElement, selectionCount]);

  const syncRichText = (trackHistory: boolean) => {
    if (!selectedElement || selectedElement.kind !== 'note' || !richEditorRef.current) {
      return;
    }

    const richText = normalizeRichText(richEditorRef.current.innerHTML);
    const plainText = richTextToPlainText(richText);
    onPatchElement(
      selectedElement.id,
      {
        richText,
        text: plainText,
      },
      trackHistory,
    );
  };

  const runRichCommand = (command: string, value?: string) => {
    if (!selectedElement || selectedElement.kind !== 'note') {
      return;
    }

    richEditorRef.current?.focus();
    document.execCommand(command, false, value);
    syncRichText(true);
  };

  const clearRichFormatting = () => {
    if (!selectedElement || selectedElement.kind !== 'note' || !richEditorRef.current) {
      return;
    }

    const plainText = richTextToPlainText(richEditorRef.current.innerHTML);
    const normalized = plainTextToRichText(plainText);
    richEditorRef.current.innerHTML = normalized;

    onPatchElement(
      selectedElement.id,
      {
        richText: normalized,
        text: plainText,
      },
      true,
    );
  };

  if (!selectedElement) {
    return (
      <aside className="property-panel">
        <div className="property-header">属性面板</div>
        <p className="panel-muted">请选择一个对象，或使用工具栏创建新对象。</p>
      </aside>
    );
  }

  return (
    <aside className="property-panel">
      <div className="property-header">
        {selectionCount > 1 ? `已选中 ${selectionCount} 个对象` : `对象 ${selectedElement.kind}`}
      </div>

      <div className="field-row two">
        <label className="field">
          <span>位置 X</span>
          <input
            type="number"
            value={roundNumber(selectedElement.x)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                applyPatch({ x: value });
              }
            }}
          />
        </label>

        <label className="field">
          <span>位置 Y</span>
          <input
            type="number"
            value={roundNumber(selectedElement.y)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                applyPatch({ y: value });
              }
            }}
          />
        </label>
      </div>

      <div className="field-row two">
        <label className="field">
          <span>宽度</span>
          <input
            type="number"
            min={20}
            value={roundNumber(selectedElement.width)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                applyPatch({ width: Math.max(20, value) });
              }
            }}
          />
        </label>

        <label className="field">
          <span>高度</span>
          <input
            type="number"
            min={20}
            value={roundNumber(selectedElement.height)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                applyPatch({ height: Math.max(20, value) });
              }
            }}
          />
        </label>
      </div>

      <div className="field-row two">
        <label className="field">
          <span>填充色</span>
          <input
            type="color"
            value={selectedElement.fill}
            onChange={(event) => {
              applyPatch({ fill: event.target.value });
            }}
          />
        </label>

        <label className="field">
          <span>描边色</span>
          <input
            type="color"
            value={selectedElement.stroke}
            onChange={(event) => {
              applyPatch({ stroke: event.target.value });
            }}
          />
        </label>
      </div>

      <label className="field">
        <span>描边宽度</span>
        <input
          type="range"
          min={0}
          max={12}
          step={0.5}
          value={selectedElement.strokeWidth}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
              applyPatch({ strokeWidth: value });
            }
          }}
        />
        <span className="field-value">{roundNumber(selectedElement.strokeWidth)} px</span>
      </label>

      {selectedElement.kind === 'note' && selectionCount === 1 ? (
        <>
          <label className="field">
            <span>文本内容</span>
            <div className="rich-editor-toolbar">
              <button type="button" className="tool-btn" onClick={() => runRichCommand('bold')}>
                B
              </button>
              <button type="button" className="tool-btn" onClick={() => runRichCommand('italic')}>
                I
              </button>
              <button type="button" className="tool-btn" onClick={() => runRichCommand('underline')}>
                U
              </button>
              <button type="button" className="tool-btn" onClick={() => runRichCommand('insertUnorderedList')}>
                列表
              </button>
              <button type="button" className="tool-btn" onClick={() => runRichCommand('justifyLeft')}>
                左
              </button>
              <button type="button" className="tool-btn" onClick={() => runRichCommand('justifyCenter')}>
                中
              </button>
              <button type="button" className="tool-btn" onClick={() => runRichCommand('justifyRight')}>
                右
              </button>
              <button type="button" className="tool-btn" onClick={clearRichFormatting}>
                清除格式
              </button>
            </div>
            <div
              ref={richEditorRef}
              className="rich-editor"
              contentEditable
              suppressContentEditableWarning
              onInput={() => syncRichText(false)}
              onBlur={() => syncRichText(true)}
            />
          </label>

          <div className="field-row two">
            <label className="field">
              <span>文字颜色</span>
              <input
                type="color"
                value={selectedElement.textColor}
                onChange={(event) => {
                  onPatchElement(selectedElement.id, { textColor: event.target.value }, true);
                  runRichCommand('foreColor', event.target.value);
                }}
              />
            </label>

            <label className="field">
              <span>字号</span>
              <input
                type="number"
                min={10}
                max={72}
                value={selectedElement.fontSize}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    onPatchElement(selectedElement.id, { fontSize: Math.min(72, Math.max(10, value)) }, true);
                  }
                }}
              />
            </label>
          </div>
        </>
      ) : null}

      <button type="button" className="tool-btn danger-btn panel-delete" onClick={onDelete}>
        删除选中
      </button>
    </aside>
  );
};
