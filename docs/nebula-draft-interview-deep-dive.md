# Nebula Draft 面试深挖手册

> 项目：React 19 + react-konva + Konva + Zustand 的轻量图形编辑画布  
> 定位：一个类白板/类 Figma 的 2D Canvas 图形编辑器  
> 说明：本手册基于当前源码整理，重点讲清楚真实实现，不把未实现能力包装成已经完成。

---

## 0. 心态校准

Nebula Draft 不是一个只会画几个图形的薄 demo。它已经具备画布编辑器的核心链路：React 组件化画布、Zustand 状态管理、CanvasBridge 业务级 Diff、react-konva 渲染、类似 DOM/React 合成事件系统的 Canvas 事件层、元素分组、撤销重做、图片插入、便签富文本编辑、IndexedDB 持久化和 Minimap 小地图。

但它也不是一个完整工业级 Figma。当前主画布不是自研 WebGL 渲染引擎，也没有独立 RendererRegistry、复杂几何命中、多人协同、Web Worker 持久化或视口裁剪 culling。面试时最好的策略是：主动讲清楚 3 到 4 个真实亮点，同时对缺口诚实说明，并给出可落地的改进方案。

一句话定位：

> "Nebula Draft 是一个基于 React 19、react-konva 和 Zustand 的图形编辑画布。我主要把它设计成单向数据流：用户交互只修改编辑器状态，CanvasBridge 对状态做业务级 Diff，生成 create/update/delete/viewport 等渲染命令，再由 React/Konva 和 Minimap 消费这些命令实现增量更新。"

---

## 1. 架构总览

当前项目可以按 5 层理解，数据流整体是单向的：

```text
React UI 层
  App / Toolbar / CanvasStage / PropertiesPanel / Minimap / Inline Note Editor
        |
        | dispatch(action)
        v
状态层 Zustand
  EditorHistoryState
  present: elements / groups / selectedIds / activeTool / gridSnapEnabled / viewport
  past / future 支持 undo / redo
        |
        | useCanvasBridge(present)
        v
桥接层 CanvasBridge
  stable element/group cache
  previousPresent -> nextPresent diff
  create-element / update-element / delete-element
  replace-selection / update-viewport / update-ui
  command merge + priority sort + rAF schedule + metrics
        |
        | renderCommands
        v
渲染与交互层
  CanvasStage + react-konva Stage/Layer/Group/Rect/Ellipse/Line/Text/Image/Transformer
  useSceneRenderModel 根据 renderCommands 维护渲染模型
  CanvasEventSystem 做 hitTest、capture/target/bubble 派发
        |
        | shared element data + renderCommands
        v
辅助能力
  Minimap 使用 Canvas2D 绘制缩略图和 dirty rect 局部重绘
  IndexedDB 持久化场景
  Hotkeys / Clipboard / Group / RichText utilities
```

一条数据流可以这样讲：

1. 用户在画布上点击或拖拽，Konva Stage 捕获 pointer 事件。
2. `EventBridge` 将 Konva 事件转换成统一的 `CanvasPointerEvent`，同时通过 `CoordinateTransformer` 把屏幕坐标转换成世界坐标。
3. `CanvasEventSystem` 根据世界坐标做命中检测，构造 `stage -> group -> element` 的逻辑传播路径，并按 capture、target、bubble 派发。
4. 业务交互最终通过 `dispatch(action)` 修改 Zustand 中的 `EditorPresentState`。
5. `useCanvasBridge(present)` 在 rAF 中调用 `CanvasBridge.reconcile()`，比较上一帧和当前帧状态，输出渲染命令。
6. `CanvasStage` 通过 `useSceneRenderModel(elements, renderCommands)` 维护渲染元素数组，并交给 `ElementNode` 渲染。
7. `Minimap` 同样消费 `renderCommands`，在元素少量变化时只清理和重绘 dirty rect 区域。

关键卖点：

> 状态层不直接操作 Konva 节点，CanvasBridge 把业务状态变化翻译成渲染命令。React Diff 继续负责组件更新，CanvasBridge Diff 负责业务语义识别，两者是上下游配合关系。

---

## 2. 主动出击：核心亮点

### 亮点 1：CanvasBridge 业务级 Diff

口播版：

> "我没有只依赖 React 自带的组件 Diff，而是在 Zustand 状态和渲染层之间加了一层 CanvasBridge。它比较前后两份 `EditorPresentState`，按元素 id 判断 create、update、delete，同时比较 selectedIds、viewport、activeTool 和 gridSnapEnabled。它输出的是业务命令，比如 `update-element`、`replace-selection`、`update-viewport`，而不是笼统地说某个组件 props 变了。这样主画布、小地图和性能面板都能知道这次变化到底是什么。"

为什么出彩：

React Diff 可以让 UI 正确更新，但它不会暴露业务语义。CanvasBridge 能知道元素只是移动、只是样式变化、只是选区变化，进而支持命令合并、小地图 dirty rect 和性能统计。

要点：

1. Diff 的对象是 `EditorPresentState`，不是 React 组件树。
2. 元素通过 `id` 建 Map 判断新增、删除和更新。
3. `areElementsEqual()` 比较位置、尺寸、旋转、样式、分组、便签文本、图片 src。
4. `createElementPatch()` 只生成变化字段。
5. `optimizeCommands()` 合并重复命令并按优先级排序。
6. `useCanvasBridge()` 用 rAF 合并一帧内更新，并记录 `commandCount`、`createCount`、`updateCount`、`deleteCount` 和耗时。

### 亮点 2：React + react-konva 的组件化画布

口播版：

> "当前项目不是手写一整套 Canvas 渲染器注册表，而是利用 React 和 react-konva 做组件化画布。`CanvasStage` 负责舞台、视口、选择、拖拽、绘制和事件接入；`ElementNode` 是统一元素入口，根据 `element.kind` 渲染不同 Konva 节点。矩形用 Rect，椭圆用 Ellipse，三角形和菱形用 Line 的 points 闭合，便签用 Rect + Text，图片交给 `CanvasImageNode` 加载后用 KonvaImage 渲染。"

为什么出彩：

它保留了 React 的组件模型和 props 驱动思路，同时通过 `React.memo` 和 CanvasBridge 的稳定对象引用减少未变化元素的重渲染。

要点：

1. `BoardElement` 是元素 props 的数据模型。
2. `ElementNode` 根据 `kind` 分支渲染不同图形。
3. 图片不是直接在 `ElementNode` 里加载，而是由 `CanvasImageNode` 创建 `window.Image()`，加载完成后传给 `KonvaImage`。
4. 分组不是嵌套组件，而是 `ElementGroup + groupId + childIds` 的数据关系。
5. `ElementNode` 使用 `memo`，比较条件是 `prev.element === next.element && prev.tool === next.tool`。

### 亮点 3：自研 Canvas 合成事件系统

口播版：

> "Canvas 原生事件只知道用户点了 canvas，不知道点中了哪个图形，也没有 DOM 树上的捕获和冒泡。所以我在 Konva/DOM 原生事件之上做了一层轻量合成事件系统。`EventBridge` 和 `DOMEventBridge` 把 pointer/keyboard 事件包装成统一事件对象，`CanvasEventSystem` 做 hitTest、构建 `stage -> group -> element` 逻辑路径，再按 capture、target、bubble 派发，并支持 priority 和 stopPropagation。"

为什么出彩：

它借鉴了 React 合成事件系统的核心思想：事件委托、统一事件对象、传播路径、捕获/冒泡和阻止传播。但它不依赖真实 DOM 树，而是基于 Canvas 元素数据结构和命中检测构造逻辑路径。

要点：

1. `EventBridge.toCanvasPointerEvent()` 将 Konva pointer 事件转换为 `CanvasPointerEvent`。
2. `DOMEventBridge` 监听 window 的 keydown/keyup，并转换为 `CanvasKeyboardEvent`。
3. `CoordinateTransformer` 提供 `screenToWorld()` 和 `worldToScreen()`。
4. `CanvasEventSystem.hitTest()` 根据世界坐标命中元素。
5. `buildPath()` 根据 `groupId` 和 `ElementGroup` 构造 `stage -> group -> element`。
6. dispatch 顺序是 capture 阶段、target 阶段、bubble 阶段。

### 亮点 4：Minimap 小地图 + dirty rect 局部重绘

口播版：

> "主画布使用 react-konva 渲染，小地图没有再开一套 Konva，而是用原生 Canvas2D 绘制缩略图。它会根据主画布元素和 viewport 计算世界范围、可视区域和缩放比例。更关键的是，小地图会消费 CanvasBridge 的 renderCommands：如果只是少量元素 create/update/delete，就只清理元素前后位置对应的 dirty rect 并重绘相关元素；如果脏区太多或世界范围变化，再回退全量重绘。"

为什么出彩：

这说明 CanvasBridge 的命令不只是展示指标，而是被实际用于非 React 渲染层的增量绘制。它也很好回答"为什么不只用 React Diff"这个问题。

要点：

1. Minimap 有静态层和元素层缓存。
2. 静态层绘制背景、网格、世界边界。
3. 元素层绘制缩略图元素。
4. 动态 overlay 绘制选中框和 viewport 框。
5. 点击或拖动小地图会反算世界坐标并更新主画布 viewport。
6. dirty rect 数量超过阈值时回退全量重绘。

---

## 3. 设计模式清单

| 模式 | 当前项目里的体现 |
| --- | --- |
| 桥接/适配器 | `CanvasBridge` 将编辑器状态转换为渲染命令；`EventBridge` 将 Konva/DOM 原生事件转换为统一 Canvas 事件 |
| Reducer | `editorReducer` 统一处理编辑器 action，维护 `past/present/future` |
| 命令式数据流 | 业务动作通过 `dispatch(action)` 进入 store，再由 bridge 输出渲染命令 |
| 备忘录/快照 | undo/redo 使用 `past/present/future` 保存 `EditorPresentState` 快照 |
| 组合数据模型 | `ElementGroup + groupId + childIds` 表达逻辑分组 |
| 事件委托 | pointer/keyboard 事件统一进入 `CanvasEventSystem` 后再分发 |
| 合成事件 | `CanvasStageEvent` 统一 target/currentTarget/phase/modifiers/preventDefault/stopPropagation |
| 缓存/稳定引用 | `CanvasBridge` 缓存 element/group，`useSceneRenderModel` 缓存 element map/order |
| 分层渲染 | 主画布使用 Stage/Layer；Minimap 分静态层、元素层和动态 overlay |
| 懒加载 | `CanvasStage` 和 `PropertiesPanel` 通过 React lazy + Suspense 加载 |

需要避免误说：

1. 当前项目没有 `ElementRendererRegistry`。
2. 当前项目没有 PixiJS `RenderEngine`。
3. 当前项目没有 Web Worker history。
4. 当前项目没有真正的 DOM 树，group 是逻辑事件目标，不是嵌套组件。

---

## 4. 深挖问答库

### A. 技术选型

**Q：为什么用 react-konva，而不是直接 Canvas2D、SVG 或 PixiJS？**

当前项目定位是轻量图形编辑器，react-konva 能把 Konva 的 Canvas 渲染能力包装成 React 组件模型。我们可以用 `Stage`、`Layer`、`Group`、`Rect`、`Ellipse`、`Line`、`Text`、`Image` 和 `Transformer` 快速实现图形编辑能力，同时保留 React props 驱动和组件拆分。Canvas2D 全手写会让节点管理、选择框、变换器和事件接入复杂很多；SVG 虽然天然有 DOM 事件，但元素多时 DOM 成本会变高；PixiJS 更适合 GPU 渲染和大规模元素，但当前项目没有做到那一层，使用 react-konva 更符合项目体量。

**Q：为什么状态用 Zustand？**

Zustand API 简单，适合当前这种局部状态清晰、更新入口统一的画布项目。项目通过 `useEditorStore` 暴露 `history` 和 `dispatch`，所有修改都进入 `editorReducer`。这样业务状态和 UI 组件之间保持清晰关系，CanvasBridge 也可以直接拿到 `present` 做业务 Diff。

**Q：为什么不只依赖 React Diff？**

React Diff 是组件层面的更新机制，它能知道某个组件 props 变了，但不会告诉我们业务上是元素新增、删除、移动、选区变化还是视口变化。CanvasBridge Diff 是业务层面的增量计算，它把前后 `EditorPresentState` 的差异翻译成 `create-element`、`update-element`、`delete-element`、`replace-selection`、`update-viewport`、`update-ui` 等命令。React Diff 负责组件正确更新，CanvasBridge Diff 负责业务语义和跨渲染层优化。

### B. 组件化和图形渲染

**Q：当前项目的图形是怎么实现的？**

图形先被抽象成 `BoardElement` 数据，包括 `id`、`kind`、位置、尺寸、旋转、填充、描边、分组等属性。`CanvasStage` 遍历 `renderElements`，把每个元素交给 `ElementNode`。`ElementNode` 根据 `kind` 渲染不同 Konva 图形：矩形用 `Rect`，椭圆用 `Ellipse`，三角形和菱形用 `Line` 的 points 闭合，便签用 `Rect + KonvaText`，图片交给 `CanvasImageNode` 加载后用 `KonvaImage` 渲染。

**Q：如果新增一个图形要怎么做？**

需要沿着数据、工具、渲染、绘制预览、属性编辑和 Diff 几条线扩展：

1. 在 `BoardElement` 联合类型里增加新的元素类型。
2. 在 `Tool` 和工具栏里增加对应工具。
3. 在 `CanvasStage` 的绘制完成逻辑里创建新元素数据。
4. 在 `ElementNode` 中增加对应 `kind` 的渲染分支。
5. 如果需要预览图形，也要在 draft 渲染区加预览分支。
6. 如果新元素有特殊属性，要在 `areElementsEqual()` 和 `createElementPatch()` 中纳入比较。
7. 如果 PropertiesPanel 要编辑新属性，也要补对应控件。

**Q：分组不是嵌套组件，那结构是什么？**

当前项目是"扁平元素列表 + 分组关系表"。元素仍然按列表独立渲染，`ElementGroup` 只保存 `id`、`name` 和 `childIds`，每个子元素通过 `groupId` 指向所属分组。选择、拖拽、复制粘贴、事件传播等业务逻辑会根据这些关系把多个元素当成一个整体处理。

### C. CanvasBridge 和 Diff

**Q：CanvasBridge Diff 的是什么？**

Diff 的是前后两份 `EditorPresentState`，包括 `elements`、`groups`、`selectedIds`、`activeTool`、`gridSnapEnabled` 和 `viewport`。其中元素 Diff 最核心，会根据 `element.id` 判断 create、delete、update。更新时比较 `x/y`、`width/height`、`rotation`、`fill`、`stroke`、`strokeWidth`、`groupId`，便签还比较 `text/richText/fontSize/textColor`，图片还比较 `src`。

**Q：CanvasBridge 的优势体现在哪里？**

它把普通 state/props 变化翻译成业务命令。比如元素从 `x=100` 移到 `x=120`，React 只知道 `ElementNode` 的 props 变了；CanvasBridge 能生成 `{ type: 'update-element', id, patch: { x: 120 } }`。这个命令可以被主画布用来稳定元素引用，被小地图用来 dirty rect 局部重绘，被性能面板用来统计 create/update/delete 数量。

**Q：CanvasBridge 是不是替代 React Diff？**

不是。它们是上下游关系。CanvasBridge 先做业务状态 Diff，生成渲染命令；React 再根据组件 props 变化更新 `CanvasStage`、`ElementNode` 和 `Minimap`。CanvasBridge 解决"业务上发生了什么"，React Diff 解决"组件如何更新"。

### D. 事件系统

**Q：当前事件系统是不是 Canvas 原生事件？**

不是。Canvas 原生事件只知道用户点了 `<canvas>`，不知道点中了内部哪个图形，也没有内部图形的冒泡和捕获。当前项目是在 Konva/DOM 原生事件之上自主设计了一层 Canvas 合成事件系统。

**Q：它学到了 React 合成事件系统的哪些核心？**

主要有事件委托、统一事件对象、传播路径构建、捕获/目标/冒泡阶段、`preventDefault()`、`stopPropagation()` 和监听器优先级。区别是 React 基于真实 DOM 树，而当前项目基于 `BoardElement`、`ElementGroup` 和 hitTest 构造逻辑事件路径。

**Q：EventBridge 是怎么转换事件的？**

`EventBridge.toCanvasPointerEvent()` 从 Konva 事件中取 Stage 指针坐标，通过 `CoordinateTransformer.screenToWorld()` 转成世界坐标，同时提取 buttons、shift/ctrl/alt/meta、nativeEvent，并包装 `preventDefault()` 和 `stopPropagation()`。`DOMEventBridge` 监听 window 的 keydown/keyup，再调用 `toCanvasKeyboardEvent()` 包装成统一键盘事件。

**Q：group 不是组件，也可以在 `stage -> group -> element` 路径里吗？**

可以。这里的 group 是逻辑事件目标，不是 React 组件或 Konva 节点。事件系统根据元素的 `groupId` 和 `ElementGroup.childIds` 构造逻辑父子关系。当点击组内元素时，路径可以是 `stage -> group-1 -> rect-1`，从而模拟 DOM 冒泡。

### E. 坐标、视口和交互

**Q：缩放和平移怎么做？**

主画布的 viewport 存在状态里，包含 `x`、`y` 和 `scale`。`Stage` 直接使用 `x={viewport.x}`、`y={viewport.y}`、`scaleX={viewport.scale}`、`scaleY={viewport.scale}`。滚轮普通模式更新 `x/y` 实现平移，Ctrl/Meta + 滚轮按光标位置做锚点缩放。

**Q：世界坐标怎么计算？**

`CoordinateTransformer.screenToWorld()` 使用 `(screen - viewportOffset) / scale`。也就是：

```ts
x = (screen.x - viewport.x) / viewport.scale
y = (screen.y - viewport.y) / viewport.scale
```

这个世界坐标用于绘制新元素、拖拽、框选、命中检测和 Minimap 定位。

**Q：当前命中检测精确吗？**

不完全精确。当前 `CanvasEventSystem.hitTest()` 主要按元素的矩形 bounds 判断命中，并按渲染顺序选择最上层元素。它没有对旋转后的精确形状、三角形、菱形、椭圆真实轮廓做几何命中。这是一个可以诚实说明的改进点。

### F. 数据、撤销和持久化

**Q：undo/redo 怎么做？**

当前是快照式 history，不是命令模式。`EditorHistoryState` 包含 `past`、`present` 和 `future`。有历史记录的操作会把当前 `present` clone 进 `past`，撤销时从 `past` 取上一个快照，重做时从 `future` 恢复。

**Q：拖拽会不会产生很多 undo？**

拖拽过程中会用 `trackHistory=false` 做临时更新，松手后通过 `commit-drag-transaction` 提交一次最终变更。因此一次拖拽不会生成一堆 undo 快照。

**Q：持久化怎么做？**

项目使用 IndexedDB 保存序列化后的 `EditorPresentState`。启动时先尝试从 IndexedDB 恢复，如果没有，再尝试从旧 localStorage key 迁移。保存时调用 `savePresentStateToIndexedDB()` 写入默认场景记录。

---

## 5. 诚实风险清单和标准话术

| # | 真实缺口 | 被问到时的标准话术 |
| --- | --- | --- |
| 1 | 主画布没有真正 dirty rect 重绘 | "主画布当前交给 React/Konva 节点更新，优化主要来自 CanvasBridge 稳定引用、React.memo 和命令模型。真正 dirty rect 局部重绘体现在 Minimap。要把主画布也做到 dirty rect，需要改成更底层的 Canvas2D 绘制管线或自研渲染调度。" |
| 2 | hitTest 主要基于矩形 bounds | "当前命中检测满足基础交互，但没有做旋转后精确形状命中。要增强的话，会把 world 坐标逆变换到元素局部坐标，再按矩形、椭圆、三角形、菱形分别做几何判断。" |
| 3 | 没有视口裁剪 culling | "目前元素仍然由 React/Konva 常驻渲染，没有按 viewport 剔除。元素量上去后，我会先算 visible world bounds，过滤或隐藏视口外节点，再进一步引入网格或四叉树索引。" |
| 4 | 没有独立 RendererRegistry | "当前是 React 组件分支渲染，不是注册表式渲染器。如果元素类型继续增加，可以把 ElementNode 的 kind 分支抽离成 registry 或 renderer map，降低单组件复杂度。" |
| 5 | 分组是逻辑数据，不是嵌套渲染树 | "这是有意选择：保持元素列表扁平，选择、拖拽和事件路径根据 groupId/childIds 计算。缺点是不能天然利用 Konva Group 的父子变换，复杂组合变换需要额外计算。" |
| 6 | 没有 Web Worker 持久化 | "当前 IndexedDB 保存是主线程序列化，项目体量还可接受。如果场景很大或图片很多，可以把 JSON 序列化、压缩、图片资源处理移到 Worker，并做 latest-wins 防堆积。" |
| 7 | 没有多人协同 | "当前没有 CRDT/OT，也没有远端同步协议。不能说支持协同。要做的话会先定义操作日志或 CRDT 文档模型，再处理冲突、光标状态和权限。" |
| 8 | 中文源码字符串存在编码显示问题 | "部分中文在当前终端显示为乱码，功能逻辑不受影响，但交付前应该统一文件编码为 UTF-8 并检查 UI 文案。" |
| 9 | 缺少自动化测试 | "当前没有针对 CanvasBridge、CanvasEventSystem、Minimap dirty rect 的单元测试。后续应优先补这些纯逻辑模块的测试，再加 Playwright 做关键交互回归。" |

通用回答公式：

> "这块当前是这样实现的，能满足基础编辑器能力；如果要上更大规模或更强一致性，我会从某某方向改。"

---

## 6. 角色叙事建议

面试官可能会问："这个项目你具体负责哪部分？"

可以按下面方式准备：

1. 如果你主导架构：强调你设计了单向数据流、CanvasBridge、事件系统分层和 Minimap 消费命令的路径。
2. 如果你主要实现部分模块：重点讲你最熟的模块，比如 CanvasBridge、CanvasEventSystem、Minimap 或富文本便签，不要把不熟的部分说成自己亲手写的。
3. 如果被追问为什么这样设计：围绕"状态和渲染解耦"、"React Diff 与业务 Diff 分工"、"Canvas 没有 DOM 子节点所以要自研事件系统"展开。

STAR 叙事模板：

1. **S**：要做一个轻量图形编辑画布，支持绘制、选择、拖拽、分组、撤销、保存和小地图。
2. **T**：需要在 React 组件化开发和 Canvas 高性能交互之间找到平衡。
3. **A**：引入 CanvasBridge 做业务级 Diff；用 CanvasEventSystem 模拟 DOM 事件；Minimap 消费 renderCommands 做局部重绘。
4. **R**：架构层次清晰，交互状态统一，主画布和小地图都能复用同一份业务命令。

---

## 7. 必背事实卡

- 技术栈：React 19 + TypeScript + Vite + Zustand + Konva + react-konva
- 主画布渲染：`Stage -> Layer -> ElementNode`
- 图形类型：rect / ellipse / triangle / diamond / note / image
- 图片渲染：`CanvasImageNode` 加载 `window.Image()` 后传给 `KonvaImage`
- 状态模型：`EditorHistoryState = past + present + future`
- 当前状态：`EditorPresentState = elements + groups + selectedIds + activeTool + gridSnapEnabled + viewport`
- 分组模型：扁平元素列表 + `ElementGroup.childIds` + 元素 `groupId`
- Diff 输出：`create-element` / `update-element` / `delete-element` / `replace-selection` / `update-viewport` / `update-ui`
- 事件模型：`EventBridge` / `DOMEventBridge` / `CanvasEventSystem`
- 事件阶段：capture / target / bubble
- 坐标转换：`screenToWorld = (screen - viewportOffset) / scale`
- 缩放范围：0.2 到 4
- 小地图：Canvas2D 绘制，支持 dirty rect 和点击/拖动定位
- 持久化：IndexedDB，兼容旧 localStorage 迁移
- 不能误说：没有 PixiJS、没有 RendererRegistry、没有 Web Worker history、没有 CRDT/OT 协同

---

## 8. 高频追问速答

**Q：为什么 CanvasBridge 有意义，React Diff 不是也能用吗？**

React Diff 能让组件更新正确，但它不暴露业务语义。CanvasBridge 能把前后编辑器状态差异翻译成 `create/update/delete/selection/viewport/ui` 命令，服务主画布、小地图和性能统计。

**Q：Diff 的到底是什么？**

Diff 的是 `EditorPresentState`，包括元素、分组、选区、当前工具、网格吸附和视口，不是 React 虚拟 DOM。

**Q：事件系统是不是 Canvas 原生事件？**

不是。它是在 Konva/DOM 原生事件之上，自主封装的一层 Canvas 合成事件系统。

**Q：group 不是组件，怎么冒泡？**

事件系统构造的是逻辑路径，不是真 DOM 路径。group 是 `ElementGroup` 数据代表的逻辑父节点，可以参与 `stage -> group -> element` 的传播。

**Q：当前项目怎么做到组件化？**

通过 React + react-konva。`CanvasStage` 管舞台，`ElementNode` 管单个元素渲染，`CanvasImageNode` 管图片资源，`Minimap` 独立用 Canvas2D 绘制。

**Q：为什么不说有 ElementRendererRegistry？**

因为当前源码没有这个注册表。当前是 `ElementNode` 内部按 `kind` 分支渲染。可以说未来元素多了可以演进成注册表模式，但不能说已经实现。

---

## 9. 复习顺序

建议优先背这 4 块：

1. 架构总览：React UI -> Zustand -> CanvasBridge -> CanvasStage/Minimap。
2. CanvasBridge：业务级 Diff，和 React Diff 的区别。
3. CanvasEventSystem：为什么 Canvas 需要合成事件，怎么模拟捕获和冒泡。
4. 风险清单：主画布不是 dirty rect、hitTest 不精确、没有 culling、没有 Worker/协同。

背熟这几块，基本能扛住大部分围绕架构、性能、事件和 Canvas 交互的深挖。
