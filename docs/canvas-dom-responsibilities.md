# Nebula Draft: Canvas 与 DOM 职责边界文档

## 1. 目标

本文档定义 Nebula Draft 中 Canvas 与 DOM 的职责分工，确保以下目标长期成立：

- 图元层级语义一致，避免图片压住图形等跨通道层级错觉。
- DOM 仅承担交互壳与文本编辑，不承担常态图元展示。
- 渲染性能可扩展，便于继续做 diff、增量更新与性能埋点。

## 2. 核心原则

1. 常态可视内容优先走 Canvas。
2. DOM 只做 UI 容器、输入控件、编辑器与系统交互桥接。
3. 编辑态可临时使用 DOM 覆盖层，但提交后回到 Canvas 常态渲染。
4. 层级以元素顺序为准，不以元素类型固定优先级。

## 3. Canvas 负责什么

### 3.1 主舞台与图元渲染

Canvas 负责所有常态可视图元：

- 矩形、椭圆、三角形、菱形。
- 图片图元。
- 便签外框与便签文本常态显示。
- 预览绘制图形、框选框、吸附辅助线。
- 选中框与变换锚点（Transformer）。

对应实现：

- src/components/CanvasStage.tsx

### 3.2 视口与相机交互

Canvas 负责视口层交互与空间变换：

- 平移工具拖动画布。
- 滚轮平移。
- Ctrl/Cmd + 滚轮缩放。
- 世界坐标与屏幕坐标转换。

对应实现：

- src/components/CanvasStage.tsx

### 3.3 对象级交互

Canvas 负责对象在舞台上的直接操作：

- 点击选中。
- Shift 追加/取消选中。
- 拖拽移动（含网格吸附与元素吸附）。
- 缩放旋转。
- 框选命中。
- 双击便签进入编辑态。

对应实现：

- src/components/CanvasStage.tsx

### 3.4 层级与绘制顺序

Canvas 负责图元层级语义：

- 元素统一同级。
- 拖动开始时触发提层（bring-to-front），保证交互对象到最上层。
- 不再以 note/image/shape 类型固定优先级。

对应实现：

- src/state/editorState.ts
- src/components/CanvasStage.tsx

### 3.5 小地图渲染

小地图虽然独立使用 HTMLCanvasElement，但归属渲染职责：

- 静态层、元素层、动态层合成。
- 命令驱动增量更新，支持脏区重绘。

对应实现：

- src/components/Minimap.tsx

## 4. DOM 负责什么

### 4.1 编辑器外壳 UI

DOM 负责应用壳与控制面板：

- 顶部工具栏按钮。
- 属性面板输入控件。
- 保存状态提示。
- 布局容器与样式系统。

对应实现：

- src/App.tsx
- src/components/Toolbar.tsx
- src/components/PropertiesPanel.tsx
- src/App.css

### 4.2 文本编辑交互

DOM 负责富文本输入与格式编辑，仅在编辑态开启：

- 便签 inline editor（contentEditable）。
- 属性面板富文本编辑区域（contentEditable）。
- 格式命令触发（bold、italic、justify 等）。
- 编辑结果同步回状态（richText 与 plain text）。

对应实现：

- src/components/CanvasStage.tsx
- src/components/PropertiesPanel.tsx
- src/utils/richText.ts

### 4.3 键盘与系统输入桥接

DOM 负责全局输入事件桥接，不直接画图：

- 快捷键监听与分发。
- 复制粘贴触发。
- 撤销重做触发。
- 工具切换触发。

对应实现：

- src/hooks/useHotkeys.ts

### 4.4 文件输入与系统弹窗

DOM 负责浏览器原生输入控件：

- 隐藏 file input（插图上传）。
- 读取本地图片并转换数据 URL。

对应实现：

- src/components/CanvasStage.tsx

## 5. 交互归属清单

| 交互 | 归属 | 说明 |
| --- | --- | --- |
| 舞台点击选中 | Canvas | 命中测试与对象选择在舞台事件中处理 |
| 拖动对象 | Canvas | 包含吸附、组拖动、提层 |
| 缩放旋转 | Canvas | Transformer 与节点变换结束回写 |
| 框选 | Canvas | 通过世界坐标与 bounds 命中 |
| 画图工具创建图元 | Canvas | 指针按下/移动/抬起形成图元 |
| 视口平移/缩放 | Canvas | 滚轮与拖动画布 |
| 便签常态文本显示 | Canvas | Konva Text 渲染 |
| 便签编辑输入 | DOM | contentEditable 编辑，提交后回写状态 |
| 工具栏点击 | DOM | 触发 action，不直接渲染图元 |
| 属性面板输入 | DOM | 触发 patch action，不直接渲染图元 |
| 全局快捷键 | DOM | 监听 window keydown 并分发 action |
| 插图文件选择 | DOM | file input 负责系统文件选择 |
| 小地图显示 | Canvas | 独立 canvas 渲染，不经 DOM 图元层 |

## 6. 数据流

### 6.1 DOM 到 Canvas 的主链路

1. DOM 触发 action（按钮、输入、快捷键、编辑提交）。
2. reducer 产出新的 present 状态。
3. CanvasBridge 计算命令与稳定引用。
4. CanvasStage 与 Minimap 消费命令，执行增量渲染。

对应实现：

- src/App.tsx
- src/state/editorState.ts
- src/bridge/canvasBridge.ts
- src/components/CanvasStage.tsx
- src/components/Minimap.tsx

### 6.2 Canvas 到状态的回写链路

1. Canvas 事件产生交互结果（位置、尺寸、旋转、选择、视口）。
2. 通过回调分发 patch 或 set action。
3. 状态更新后再次进入 bridge + 渲染链路。

## 7. 为什么文本编辑仍建议保留 DOM

虽然常态文本显示已迁移至 Canvas，但编辑态继续使用 DOM 具备现实优势：

- 浏览器原生输入法、选区、复制粘贴行为成熟。
- contentEditable 实现成本低于完整画布内文本编辑器。
- 复杂富文本命令在 DOM 场景下更容易落地。

当前推荐模式：

- 显示态: Canvas
- 编辑态: DOM

## 8. 新功能接入准则

新增功能时按以下顺序判断归属：

1. 这是常态视觉内容吗？是则优先 Canvas。
2. 这是编辑输入或系统输入吗？是则放 DOM。
3. 这个功能是否会引入层级语义？必须落在 Canvas 管线内。
4. 需要性能优化吗？优先接入 bridge 命令和增量更新。

## 9. 当前边界状态总结

- 已完成：便签常态文本 Canvas 化。
- 已完成：拖动时提层，类型不再固定压层。
- 已完成：Minimap 命令驱动增量更新。
- 保留：DOM 编辑器仅用于文本编辑与 UI 操作。
