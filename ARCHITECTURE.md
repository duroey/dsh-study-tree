# 架构说明

DSH Study Tree 是一个同时包含 Host 和 Web Client 的 DSH bundle。它在真实 session 之上维护学习导航，不实现另一套 Agent runtime，也不使用 subagent 委派来代替用户可进入的学习分支。

## 系统边界

~~~mermaid
flowchart LR
  User[用户] --> Client[Web Client]
  Client --> Controller[StudyController]
  Controller --> Adapter[DshAdapter]
  Adapter --> Sessions[DSH 原生 sessions]
  Sessions --> Chat[原生聊天与 Agent 执行]
  Controller --> Transport[同源 Fetch / 旧版 RPC]
  Transport --> Host[插件 Host]
  Host --> Store[AtomicTreeStore]
  Store --> File[导航 JSON 文件]
  Host --> Titles[BranchTitles]
  Titles --> NativeTitle[DSH 标题服务与模型 helper]
~~~

- **DSH 所有**：真实 session、会话事件、继承的历史、Agent 执行、模型配置、工具、原生标题。
- **Client 所有**：导航快照、选区、临时草稿、面板与焦点状态、阅读位置、未完成操作回执。
- **插件 Host 所有**：导航文件和辅助标题请求的协调。标题仍通过原生服务保存。

目录订阅只读取会话元数据；树中每个节点不会因此自动启动一个后台 Agent。进入节点后，用户继续操作 DSH 原生会话。

## 目录与模块

| 文件 | 职责 |
| --- | --- |
| `package.json` / `cordis.patch.yml` | bundle/client manifest、模块导出、宿主插件注册 |
| `locale/*.json` / `icon.svg` | 不激活插件即可读取的中英文展示 metadata 和原创图标 |
| `src/host.ts` | Host 入口；注册树读取、写入和标题请求 |
| `src/client.tsx` | Client 入口；注册 Slots、完成轮次标记和划词入口 |
| `src/controller.ts` | 统一协调导航、fork、草稿、发送、恢复、标题同步和显示状态 |
| `src/compat.ts` | 隔离新旧 DSH 的导航、会话引用、fork、prompt 和历史边界差异 |
| `src/contracts.ts` | Client 所需的最小结构接口和视图快照 |
| `src/tree.ts` | 树模型、拓扑校验、挂接、移动、同级排序和可见行投影 |
| `src/persistence.ts` | 文件存储、进程内队列、跨进程锁、修订号检查和原子替换 |
| `src/selection.ts` | 安全选区捕获、引用前后文、唯一匹配、原文定位和滚动恢复 |
| `src/title.ts` / `src/naming.ts` | 首条本地问题的临时标题、宿主辅助标题和输出解析 |
| `src/ui.tsx` | 树、草稿、划词表单、关联/管理弹窗、键盘和焦点交互 |
| `src/drag.ts` / `src/use-tree-drag.ts` | 拖动纯函数与 Pointer Events 生命周期 |
| `src/styles.ts` | 插件界面样式、局部抽屉动画、继承历史显示和样式清理 |
| `src/config.ts` | 布局、拖动、限额、超时和标题策略默认值 |
| `scripts/build.mjs` | Host ESM 与 Web Client 模块加载器封装 |
| `scripts/check-host.mjs` | 检查实际宿主安装产物和官方 CLI 的配置组合 |
| `test/*.test.ts` | 树、适配、控制器、持久化、选区、标题和拖动行为测试 |
| `.github/workflows/compatibility.yml` | 固定版本与滚动 latest 的安装/契约检查 |
| `verification.json` | 不含本地会话标识的公开验收摘要 |

## 数据模型

持久化文件位于 `$DSH_HOME/community/dsh-study-tree/tree.json`。默认 home 是 `~/.dsh`；索引不按 profile 分文件。

~~~json
{
  "revision": 3,
  "tree": {
    "schemaVersion": 1,
    "nodes": [
      {
        "id": "topic",
        "parentId": null,
        "title": "声音采集",
        "createdAt": 0
      },
      {
        "id": "sampling",
        "parentId": "topic",
        "title": "采样",
        "createdAt": 1,
        "source": {
          "sessionId": "topic",
          "seq": 12,
          "quote": "采样",
          "prefix": "将连续信号",
          "suffix": "为离散数值",
          "scrollTop": 240
        }
      }
    ]
  }
}
~~~

示例 ID 是固定占位符。实际 `id` 对应 DSH session ID，一个 session 只能出现一次。

- `parentId`：**导航**父节点，`null` 表示学习主题起点。
- `source`：划词 fork 的来源，包括引用、完成轮次和定位信息。
- `origin`：没有划词的新分支来源，含来源 session、可获得的完成轮次及阅读位置。
- `source` 和 `origin` 互斥；没有来源字段的已有会话是导航关联，不据此推断上下文继承。
- `collapsed`：分支折叠状态；节点数组的顺序决定根节点及同级节点的显示顺序。
- 标题以原生会话目录为权威；树中的 `title` 是快照，不是一套独立的名称系统。

树限额为 2,000 个节点、2 MB。校验拒绝重复 ID、缺失父节点、循环关系、非法来源字段和不兼容 schema。限额和交互策略集中在 `config.ts`，节点数上限在树模型中导出。

## 划词 fork 流程

~~~mermaid
sequenceDiagram
  participant U as 用户
  participant C as Client / Controller
  participant D as DSH sessions
  participant H as 插件 Host
  U->>C: 在已完成回答中划词并提问
  C->>C: 捕获引用、前后文、完成轮次和位置
  C->>D: sessions.fork({ atSeq })
  D-->>C: 真实子 session ID
  C->>C: 保存可恢复的操作回执
  C->>H: 保存树节点与来源
  C->>D: 打开子会话并设置名称
  C->>D: session.prompt(引用与问题, queue)
  D-->>U: 原生 Agent 对话
~~~

优先使用官方 `uiConversation.interactions` 和文字交互 Slot；旧版或其他选区消费者下保留兼容入口。只接受同一个已完成 assistant 回答中的安全选区，拒绝跨回答、编辑控件、未完成轮次或超限引用。

`atSeq` 是所选回答所属**已完成轮次**的边界，不是被选中字符的偏移。分支继承截至该轮次的历史，然后提交新问题；不是把引用单独交给一次模型调用。

划词路径在宿主 fork 正常返回 ID 后才记录恢复回执。如果宿主已经创建会话、但在返回 ID 之前失败，这条路径不保证发现该子会话。

## 无划词的新对话

1. `newBranch()` 创建内存草稿，不调用 fork、不写树节点。
2. 记录当前会话和阅读位置；公开快照提供完成轮次时记录该边界。边界不可获得时，首次发送会使用宿主默认的已完成前缀行为，不能声称总能在打开草稿瞬间精确冻结历史。
3. 新版使用公开 main panel；缺少相应布局能力的旧版使用插件覆盖层。
4. 用户首次发送后，调用真实 fork，通过 `onCreated` 尽早保存子 ID。
5. 保存导航、打开子会话、设置临时原生标题、提交用户原问题，再异步请求自动标题。
6. 取消、离开或刷新未发送草稿，直接丢弃内存状态。

草稿发送后继续使用原生聊天框。插件不长期接管原生输入框。

## 自动标题

仅无划词的 `origin` 分支使用这条辅助标题流程：

- 临时标题取首条问题的前 24 个 Unicode 字符。
- Host 读取子会话日志，选择首条**分支自身的用户文本消息**。新版使用 `session.isOwnSeq()`；旧版使用记录的 `origin.seq` 作为边界。
- 从运行中的宿主解析 `@deepseek-ai/dsh-session-title-llm`，适配新版 `executeSessionTitleLlm` 和旧版 `generateSessionTitleWithLlm`。
- 按 DSH 模型配置生成标题，通过 `sessionTitle.rename()` 和 `sessions.flush()` 保存。导航随后投影原生标题。
- 同一个会话的在途请求去重；生成期间手动重命名或会话实例变化时，放弃旧结果。
- 失败保留临时标题，不回滚已经发送的问题。冷会话不会仅为命名而被主动恢复。

策略上限是 1,500 个输入 Unicode 字符、8,192 输入字节、512 输出 token、12 秒。中文约 12 字、其他语言约 6 词是生成目标，不是严格长度保证。

## 导航、继承与拖动

`parentId` 与 `source/origin` 是不同概念：

- fork 创建时通常一致；关联已有会话不会创建继承。
- 显式管理窗口可以调整导航父节点，但不重写真实历史或来源。
- “回到原文/来源会话”使用 `source/origin.sessionId`，不按后来修改的 `parentId` 寻路。
- 后续 fork 总是从用户选择的**真实 session**派生，不沿导航祖先拼接上下文。
- 移出学习树只移除索引中的该节点及导航后代，原生会话仍在。

拖动只接受同父节点的 before/after，根主题也互为同级。UI 判定和树模型保存前都会检查父节点；旧的 inside/root 或跨父目标也会被拒绝。

Pointer Events 使用 4 px 激活阈值，鼠标可从整行开始，控件按钮和编辑区域被排除。触摸只从把手开始，保留列表正常滚动。捕获后按视口坐标命中目标；松手时重新计算落点，抑制随后的浏览器 click，避免误开会话。

预览线画在目标完整可见子树之后，也包含临时草稿。自动滚动仅作用于导航列表；滚轮移动列表后会重新命中静止指针。取消、失焦、丢失捕获、关闭抽屉或卸载时清理手势与动画帧。抽屉动画限定在插件自身的 transform/visibility。

## 保存与故障恢复

### 树写入

1. 校验新树及请求 revision。
2. 通过进程内队列串行化操作。
3. 获取跨进程独占锁，在锁内重新读取当前文件。
4. 比较 revision；不一致则拒绝过期写入。
5. revision 加一，经同目录临时文件和 rename 原子替换。

锁最多等待 5 秒，每 30 毫秒重试；超过 30 秒且确认原进程不存在时才清理遗留锁。文件损坏会明确报错，只有文件不存在时返回空树。CAS 冲突后重新读取最新树，提示用户重试，不自动合并全部改动。

这里没有跨 session、树文件和模型请求的分布式事务，也不提供任意断电下的 exactly-once 或 fsync 保证。

### 已创建分支的回执

浏览器 localStorage 保存 `pendingFork`，可能包含子 ID、来源和已提交问题。恢复复用已知 ID，避免再次 fork。提交 prompt 前先记录 `promptAttempted=true`；如果结果不确定，恢复时不自动重发，提示用户检查原生会话。

无划词路径可以利用 `onCreated` 和宿主附带的已创建子 ID 处理部分 fork 后失败。划词路径的较晚回执边界见上文。清除浏览器本地存储会丢失这些恢复回执。

## 通信与会话所有权

新版 Client 同源 POST 到 `/api/study-tree/read`、`write`、`title`；Host 依赖 DSH Connection 的认证、Host/Origin 和 owner-only Fetch 路由约束。旧版使用 `/study-tree` RPC 的 trusted-host 注册，并检查可获得的 peer owner 身份。Client 只在 HTTP 404/405 时回退 RPC，其他失败会显示给用户。

操作会话时，新版借用 `sessions.retain()` 引用并在 finally 中释放；旧版使用 `sessions.binding()` 借用宿主已有绑定，不自行释放该绑定。发送要求宿主明确返回 `accepted: true`；不把网络调用返回本身当作发送成功。

## 兼容适配与已知边界

| 能力 | 新版路径 | 旧版/退化路径 |
| --- | --- | --- |
| 打开原生会话 | `uiWorkspace.openSession()` | `sessions.open()` |
| 会话引用 | `sessions.retain()` | `sessions.binding()` |
| 临时主页面 | main Slot + `layout.selectPanel()` | 插件草稿覆盖层 |
| 完成轮次 | turn-tail 标记 | 旧版 assistant projection 标记 |
| 标题生成 | `executeSessionTitleLlm` | `generateSessionTitleWithLlm` |
| Host 通信 | Connection Fetch 路由 | trusted-host RPC |
| 继承历史显示 | 已知 seed/所有权边界 | 完成轮次边界；无法判断时保留完整显示 |

适配按能力检测，不只按版本号。仍有两类需要随 DSH 变化维护的耦合：

1. **显示与定位**使用已知 DOM 标记、完成轮次 Slot 和数据属性。继承历史只是可逆隐藏，不删除事件；找不到安全边界时保留完整内容。原文未加载、变更或匹配不唯一时返回失败提示。
2. **辅助标题**动态解析宿主所带 helper；它不是一个由本插件控制、承诺长期稳定的 API。Host 还需要注入 `sessionTitle`、`sessionQuery` 和 `llm`。缺失 helper 可能使标题失败，缺少强制宿主服务可能使插件无法激活。

不捆绑 DSH/Cordis runtime；React 是宿主提供的可选 peer。构建产物不包含另一套框架单例。

旧版 `0.1.1-rc.2` 的独立测试环境因上游依赖漂移，固定了 Cordis、Schemastery、React 等依赖。修复只存在于测试 fixture/CI，未把旧依赖塞进分发插件。对旧版的验收以该修复环境为前提。

## 构建、发布与验证

Host 构建到 `lib/index.js`，是 Node ESM；Client 构建到 `lib/client.js`，以 `window.__ModuleLoader__.load` 注册并外置 React。source map 只引用相对项目源码路径。Git 仓库和发布包均包含 lib，不要求使用者运行构建脚本。

`package.json` 是宿主所需 manifest：`dsh.bundle` 声明 patch，`dsh.client` 声明 Web 入口及注入。中英文 `locale` 和原创 SVG 经 exports/files 发布，供插件管理器加载。GitHub 的 `dsh-plugin` topic 用于社区发现；没有自行声称官方收录或 npm 发布。

验证分三层：

1. `npm run verify`：类型检查、75 项行为测试、双端构建。
2. CI/`check-host.mjs`：真实安装、9 项会话/Slots/RPC 契约、官方配置组合。`uiVerified` 明确为 false；不覆盖所有 DOM、标题 helper 或真实模型交互。
3. 人工/浏览器实机验收：递归会话、连续聊天、上下文隔离、来源定位、标题、草稿、排序和恢复。按宿主版本与功能记录，不能用契约通过代替这一层。

公开发布保留可安装的版本化 tgz、源码、许可和验收摘要。安装包以实际打包清单为准；发布后从公开 URL 在独立 DSH_HOME 中重新安装检查。后续更新由固定版本和 latest CI 提供变化信号，仍需针对有改动的交互做实机验收。
