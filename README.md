# Nebula Draft

Nebula Draft 是一个基于 React + TypeScript 的轻量图形编辑器。

- 渲染引擎：Konva
- 状态模型：useReducer + 历史栈
- UI 风格：渐变网格画布

## 功能清单

- 绘制矩形，椭圆,棱形，三角形
- 创建便签文本块（双击可编辑）
- 选择、拖拽、缩放、旋转
- 框选多选（Shift + 框选可追加）
- 属性面板编辑（位置、尺寸、颜色、描边）
- 多选统一改样式
- 撤销 / 重做
- 本地持久化（indexDB）
- 快捷键

## 快捷键

- V: 选择工具
- H: 平移工具
- R: 矩形工具
- E: 椭圆工具
- T: 便签工具
- Ctrl/Cmd + Z: 撤销
- Ctrl/Cmd + Shift + Z 或 Ctrl/Cmd + Y: 重做
- Ctrl/Cmd + C / Ctrl/Cmd + V: 复制 / 粘贴
- Ctrl/Cmd + G / Ctrl/Cmd + Shift + G: 打组 / 解组
- Ctrl/Cmd + A: 全选
- G: 网格吸附开关
- Delete/Backspace: 删除选中

## 启动方式

```bash
pnpm install
pnpm dev
```

## 构建

```bash
pnpm build
pnpm preview
```

## 项目结构

```text
src/
  components/
    CanvasStage.tsx
    PropertiesPanel.tsx
    Toolbar.tsx
  hooks/
    useHotkeys.ts
    useStageSize.ts
  state/
    editorState.ts
  types/
    editor.ts
  App.tsx
```
