import type { Tool } from '../types/editor';

interface ToolbarProps {
  activeTool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  isSaving: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  gridSnapEnabled: boolean;
  scale: number;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onInsertImage: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onToggleGridSnap: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
}

const toolButtons: Array<{ tool: Tool; label: string; shortcut: string }> = [
  { tool: 'select', label: '选择', shortcut: 'V' },
  { tool: 'pan', label: '平移', shortcut: 'H' },
  { tool: 'rect', label: '矩形', shortcut: 'R' },
  { tool: 'ellipse', label: '椭圆', shortcut: 'E' },
  { tool: 'triangle', label: '三角形', shortcut: 'Y' },
  { tool: 'diamond', label: '菱形', shortcut: 'D' },
  { tool: 'note', label: '便签', shortcut: 'T' },
];

export const Toolbar = ({
  activeTool,
  canUndo,
  canRedo,
  isSaving,
  canCopy,
  canPaste,
  canGroup,
  canUngroup,
  gridSnapEnabled,
  scale,
  onToolChange,
  onUndo,
  onRedo,
  onSave,
  onDelete,
  onCopy,
  onPaste,
  onInsertImage,
  onGroup,
  onUngroup,
  onToggleGridSnap,
  onZoomIn,
  onZoomOut,
  onResetView,
}: ToolbarProps) => {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        {toolButtons.map((item) => (
          <button
            key={item.tool}
            type="button"
            className={`tool-btn ${activeTool === item.tool ? 'active' : ''}`}
            onClick={() => onToolChange(item.tool)}
            title={`${item.label} (${item.shortcut})`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <button type="button" className="tool-btn" onClick={onUndo} disabled={!canUndo}>
          撤销
        </button>
        <button type="button" className="tool-btn" onClick={onRedo} disabled={!canRedo}>
          重做
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onSave}
          disabled={isSaving}
          title="保存到 IndexedDB (Ctrl/Cmd+S)"
        >
          {isSaving ? '保存中...' : '保存'}
        </button>
        <button type="button" className="tool-btn" onClick={onCopy} disabled={!canCopy}>
          复制
        </button>
        <button type="button" className="tool-btn" onClick={onPaste} disabled={!canPaste}>
          粘贴
        </button>
        <button type="button" className="tool-btn" onClick={onInsertImage} title="插入图片 (I)">
          图片
        </button>
        <button type="button" className="tool-btn" onClick={onGroup} disabled={!canGroup}>
          打组
        </button>
        <button type="button" className="tool-btn" onClick={onUngroup} disabled={!canUngroup}>
          解组
        </button>
        <button type="button" className="tool-btn danger-btn" onClick={onDelete}>
          删除
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className={`tool-btn ${gridSnapEnabled ? 'active' : ''}`}
          onClick={onToggleGridSnap}
          title="网格吸附 (G)"
        >
          网格吸附
        </button>
        <button type="button" className="tool-btn" onClick={onZoomOut}>
          -
        </button>
        <span className="zoom-pill">{Math.round(scale * 100)}%</span>
        <button type="button" className="tool-btn" onClick={onZoomIn}>
          +
        </button>
        <button type="button" className="tool-btn" onClick={onResetView}>
          重置视图
        </button>
      </div>
    </div>
  );
};
