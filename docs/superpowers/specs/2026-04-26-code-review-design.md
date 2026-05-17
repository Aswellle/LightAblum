# LightAblum 全面代码审查与重构设计文档

**日期：** 2026-04-26  
**目标：** 为开源发布做准备——消除所有 bug、达到专业级解耦分层、良好可读性、健壮可移植可扩展  
**执行策略：** 三轨并行流水线（Track A / B / C 无状态冲突，可并发执行）

---

## 一、背景与问题总结

代码审查发现 40+ 个具体问题，按严重性分类：

### 硬性阻碍（开源前必须修复）
1. **无 LICENSE 文件** — README 声明 MIT 但仓库根目录无 LICENSE，法律上无法合法使用
2. **EventBus 内存泄漏** — `Promise.all` 若任一 listener reject 则所有 unlisten 不执行，监听器永久泄漏
3. **相册缓存刷新策略错误** — `album:updated` 使用 `invalidateQueries`，在 `staleTime:Infinity` 下无法触发 refetch，UI 显示旧数据
4. **无 CI/CD** — 代码合并无自动验证，broken build 可被合并

### 架构问题
5. **`usePhotoQuery` God Hook** — 170+ 行承担过滤器构建、变更检测、分页拉取、选区重置 4 个职责
6. **Rust 命令层直接依赖 SQL** — `commands/*.rs` 直接调用 `db::*` 函数，无法单独测试，无抽象边界
7. **两个 hook 竞争写入同一 photoStore** — `usePhotoQuery` 和 `useTagPhotoQuery` 均写 `photoStore`，所有权隐式
8. **`as any` 类型转义** — 4 处，绕过 TypeScript 类型系统，重构时静默失败

### 可移植性问题
9. **中文字符串硬编码** — 散布于 20+ 组件，无法国际化，无统一管理
10. **分页无上限校验** — `photos_list` 接受任意 `limit`，可触发 OOM

---

## 二、执行架构：三轨并行

```
┌─────────────────────────────────────────────────────────────────┐
│                   三条并行轨道（无共享状态冲突）                    │
├──────────────────┬───────────────────┬──────────────────────────┤
│   Track A        │   Track B         │   Track C                │
│   Rust 后端      │   前端 React/TS   │   横切面                  │
│   src-tauri/src/ │   src/            │   根目录 + .github/       │
└──────────────────┴───────────────────┴──────────────────────────┘
         唯一接触点：src/types/ipc.ts（三轨只读，不修改）
```

**轨道隔离保障：**
- Track A 只改 `src-tauri/src/`
- Track B 只改 `src/`
- Track C 只改根目录文档和 `.github/` 配置
- 合并时唯一可能冲突：`package.json` 新增 dev 依赖（Track C 最后合并解决）

---

## 三、Track A：Rust 后端重构

### A1. Repository Trait 架构

**目标目录结构：**
```
src-tauri/src/
├── db/
│   ├── mod.rs                  ← 导出 Database 聚合结构体
│   ├── schema.rs               ← 不变
│   └── repositories/           ← 新增
│       ├── mod.rs
│       ├── photo.rs            ← PhotoRepository trait + SqlitePhotoRepository impl
│       ├── album.rs            ← AlbumRepository trait + SqliteAlbumRepository impl
│       └── tag.rs              ← TagRepository trait + SqliteTagRepository impl
├── commands/
│   ├── photo.rs                ← 只依赖 &dyn PhotoRepository，不含 SQL
│   ├── album.rs                ← 只依赖 &dyn AlbumRepository
│   └── tag.rs                  ← 只依赖 &dyn TagRepository
```

**PhotoRepository trait 接口：**
```rust
pub trait PhotoRepository: Send + Sync {
    fn list(&self, filter: &PhotoFilter, cursor: Option<&str>, limit: usize) -> Result<PhotoPage>;
    fn get(&self, id: &str) -> Result<Option<Photo>>;
    fn get_batch(&self, ids: &[&str]) -> Result<Vec<PhotoThumb>>;
    fn update(&self, id: &str, params: &PhotoUpdateParams) -> Result<Photo>;
    fn delete(&self, ids: &[&str]) -> Result<()>;
    fn restore(&self, ids: &[&str]) -> Result<()>;
    fn purge(&self, ids: &[&str]) -> Result<()>;
    fn purge_data(&self, ids: &[&str]) -> Result<()>;
    fn favorite(&self, id: &str, value: bool) -> Result<()>;
    fn favorite_batch(&self, ids: &[&str], value: bool) -> Result<()>;
    fn search(&self, query: &SearchQuery) -> Result<PhotoPage>;
    fn search_suggestions(&self, q: &str, limit: usize) -> Result<SearchSuggestions>;
    fn search_stats(&self) -> Result<LibraryStats>;
}
```

**AppState 变化：**
```rust
pub struct AppState {
    pub photos:      Arc<dyn PhotoRepository>,
    pub albums:      Arc<dyn AlbumRepository>,
    pub tags:        Arc<dyn TagRepository>,
    pub db:          DbPool,          // 保留供 scanner/thumbnail 直接使用
    pub data_dir:    PathBuf,
    pub thumb_dir:   PathBuf,
    pub scan_status: Arc<Mutex<ScanStatus>>,
    pub pipeline:    Mutex<Option<Arc<ThumbnailPipeline>>>,
    pub cache:       SharedCache,
    pub sidecar:     Arc<Mutex<SidecarHandle>>,
    pub watcher:     Mutex<Option<FsWatcher>>,
}
```

**命令层示例（photo.rs）：**
```rust
#[tauri::command]
pub async fn photos_list(
    state: tauri::State<'_, AppState>,
    filter: PhotoFilter,
    cursor: Option<String>,
    limit: Option<usize>,
) -> Result<PhotoPage> {
    let limit = limit.unwrap_or(100).min(1000); // Bug fix A1
    state.photos.list(&filter, cursor.as_deref(), limit)
}
```

### A2. Bug 修复清单

| # | 文件 | 问题 | 修复方案 |
|---|------|------|----------|
| 1 | `commands/photo.rs` | `photos_list` 无分页上限，可 OOM | `limit = limit.unwrap_or(100).min(1000)` |
| 2 | `scanner/walker.rs` | 深层目录递归可栈溢出 | 改为 `ignore` crate 的迭代器模式，天然无递归 |
| 3 | `db/search.rs` | 审查所有 SQL 拼接 | 确保全部使用 `rusqlite` 绑定参数，无字符串拼接 |
| 4 | `thumbnail/sidecar.rs` | sidecar 路径硬编码 | 改为 `tauri::utils::platform::current_exe()` 动态解析同目录二进制 |
| 5 | `state.rs` | bcrypt cost 未明确配置 | 显式设置 `bcrypt::DEFAULT_COST`（12），加注释说明安全原因 |

### A3. Rust 单元测试目标

使用 `tempfile::tempdir()` 创建隔离 SQLite：

```
tests/rust/
├── photo_repository_test.rs   ← list/filter/sort/cursor 正确性
├── filter_builder_test.rs     ← PhotoFilter → SQL WHERE 子句所有变体
├── pipeline_test.rs           ← 优先级队列入队去重、上限丢弃逻辑
└── schema_migration_test.rs   ← migration 幂等性（重复运行不崩溃）
```

每个测试使用独立临时数据库，无全局状态，可并行执行 (`cargo test -- --test-threads=4`)。

---

## 四、Track B：前端重构

### B1. EventBus 内存泄漏修复

**文件：** `src/services/eventBus.ts`

**修复：** 将 `Promise.all` 改为 `Promise.allSettled`，确保无论 listener 注册成功与否都执行清理：

```typescript
return () => {
  Promise.allSettled(unlistenRef.current).then((results) => {
    results.forEach((result) => {
      if (result.status === 'fulfilled') result.value()
    })
  })
  unlistenRef.current = []
}
```

同时修复 `album:updated` 缓存策略：
```typescript
// 修复前（无效，staleTime:Infinity 下不 refetch）
queryClient.invalidateQueries({ queryKey: ['albums'] })

// 修复后（与 scan:completed 保持一致策略）
queryClient.resetQueries({ queryKey: ['albums'] })
```

### B2. 类型安全清理（`as any` 全部消除）

| 位置 | 原代码 | 修复后 |
|------|--------|--------|
| `usePhotoQuery.ts:91` | `(currentView as any).query` | `currentView.type === 'search' && 'query' in currentView && currentView.query` |
| `BatchActionBar.tsx:241` | `icon as any` | `Record<ActionKey, LucideIcon>` 映射，编译期校验 |
| `eventBus.ts:183` | `rawPayload as any` | 删除 workaround，直接使用 `LibraryChangedPayload`（已在 ipc.ts 统一为 string[]）|

**`ViewState` 判别联合使用规范：**
```typescript
// 推荐模式（替换所有 as any 访问）
if (currentView.type === 'search') {
  // TypeScript 自动收窄为 SearchView 类型
  const query = currentView.query // 类型安全
}
```

### B3. Hook 两层分离

**新文件：`src/hooks/usePhotoData.ts`（纯数据层）**

职责：
- 接收 `PhotoFilter` 作为参数（不感知视图）
- 管理 TanStack Query `useInfiniteQuery`
- 管理 cursor / hasMore 状态
- 写入 `photoStore.setPhotos()` / `photoStore.appendPhotos()`
- 暴露 `fetchMore()` 方法

```typescript
export function usePhotoData(filter: PhotoFilter) {
  const setPhotos = usePhotoStore((s) => s.setPhotos)
  // appendPhotos 由 photoStore 内部维护；useInfiniteQuery 持有全部分页，
  // 每次更新时以 setPhotos 全量同步，避免与 TanStack 内部分页状态不一致。

  const query = useInfiniteQuery({
    queryKey: ['photos', filter],
    queryFn: ({ pageParam }) => api.photos.list(filter, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: Infinity,
  })

  // 同步到 photoStore
  useEffect(() => {
    if (!query.data) return
    const allPhotos = query.data.pages.flatMap((p) => p.photos)
    setPhotos(allPhotos, query.data.pages[0]?.total ?? 0)
  }, [query.data])

  return { fetchMore: query.fetchNextPage, hasMore: query.hasNextPage, isLoading: query.isLoading }
}
```

**重构后的 `src/hooks/usePhotoQuery.ts`（协调层）**

职责：
- 从 `layoutStore` 读取 `viewState`
- 调用 `viewStateToFilter()` 构建 `PhotoFilter`
- 检测 filter 变化，触发 `photoStore.reset()`
- 视图切换时重置 `selectionStore`
- 组合调用 `usePhotoData(filter)`

```typescript
export function usePhotoQuery() {
  const viewState = useLayoutStore((s) => s.viewState)
  const resetPhotos = usePhotoStore((s) => s.reset)
  const resetSelection = useSelectionStore((s) => s.clear)

  const filter = useMemo(() => viewStateToFilter(viewState), [viewState])

  // 视图切换时清空状态
  useEffect(() => {
    resetPhotos()
    resetSelection()
  }, [filter])

  return usePhotoData(filter)
}
```

**职责边界规则（写入 CLAUDE.md）：**
- `usePhotoData` — 只知道 filter，不知道视图类型
- `usePhotoQuery` — 只做协调，不含数据请求逻辑
- 这两个 hook 是唯一允许写入 `photoStore` 的入口

### B4. Vitest 单元测试

```
src/
├── stores/__tests__/
│   ├── photoStore.test.ts      ← appendPhotos 增量分组正确性、removePhotos
│   └── selectionStore.test.ts  ← 多选、清空、toggle 全路径
├── hooks/__tests__/
│   └── usePhotoData.test.ts    ← filter 变化触发 reset，cursor 累积
└── types/__tests__/
    └── layout.test.ts          ← viewStateToFilter 所有 ViewState 变体
```

Mock 策略：`vi.mock('@/services/tauriIpc')` 替换所有 IPC 调用，测试纯逻辑。

---

## 五、Track C：横切面

### C1. Locale 文件集中化

**目标结构：**
```
src/locales/
├── index.ts      ← 导出 t() 函数，预留 i18n 扩展接口
└── zh-CN.ts      ← 所有中文字符串的单一来源（按模块分组）
```

**`zh-CN.ts` 分组结构：**
```typescript
export const zhCN = {
  nav: { allPhotos: '所有照片', favorites: '收藏', recentImports: '最近导入', trash: '回收站' },
  errors: {
    SCAN_IN_PROGRESS: '正在扫描中，请稍候',
    PHOTO_NOT_FOUND: '找不到该照片，可能已被移动或删除',
    ALBUM_NOT_FOUND: '找不到该相册',
    // ... 全部 IPC 错误码
  },
  album: { create: '新建相册', delete: '删除相册', private: '私密相册', ... },
  preview: { exif: 'EXIF 信息', close: '关闭', ... },
  settings: { theme: '主题', gridDensity: '网格密度', ... },
  toast: {
    scanComplete: (newCount: number, sec: string) =>
      `扫描完成：新增 ${newCount} 张（用时 ${sec}s）`,
  },
} as const
```

**`index.ts` 预留扩展接口（两种模式）：**
```typescript
type Locale = typeof zhCN

// 模式一：静态字符串 —— t('nav.allPhotos') → '所有照片'
// 未来替换为 i18next.t() 时调用方签名不变
export function t<K extends NestedKeyOf<Locale>>(key: K): string {
  return getNestedValue(zhCN, key)
}

// 模式二：参数化字符串 —— 直接从 locale 对象取函数调用
// 例：locale.toast.scanComplete(3, '1.2')
// 未来 i18n 替换时只改 zh-CN.ts 实现，调用方不变
export const locale = zhCN
```

替换范围：`tauriIpc.ts` 中的 `buildUserMessage`、`routes.tsx` 导航标签、所有组件内联中文字符串（约 20 个文件）。

### C2. 开源法律与社区文件

| 文件 | 内容说明 |
|------|----------|
| `LICENSE` | MIT 完整文本，2026 年，作者占位符（需在发布前替换为真实姓名）|
| `CONTRIBUTING.md` | 环境搭建（Node 20+、Rust 1.77+、pnpm 8+、平台工具链）、分支规范、提交格式、PR checklist、sidecar 构建、测试运行 |
| `CODE_OF_CONDUCT.md` | Contributor Covenant v1.4 |
| `SECURITY.md` | 私密漏洞披露邮箱、30 天响应 SLA |
| `CHANGELOG.md` | v0.1.0 首个版本条目 |
| `.github/PULL_REQUEST_TEMPLATE.md` | 改动描述、测试方法、checklist（lint/typecheck/test 通过） |

### C3. GitHub Actions CI/CD

**文件：** `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test --run   # Vitest 单元测试

  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo fmt --check
        working-directory: src-tauri
      - run: cargo clippy -- -D warnings
        working-directory: src-tauri
      - run: cargo test
        working-directory: src-tauri

  compatibility:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: cargo check
        working-directory: src-tauri
```

### C4. README 补全内容

补充以下当前缺失的章节：
1. **平台工具链安装** — Windows MSVC Build Tools、macOS Xcode CLT 具体命令
2. **Sidecar 构建步骤** — `cd sidecar && node scripts/bundle.js`（首次 & 更新时必须运行）
3. **数据目录位置** — Windows: `%APPDATA%/LightAlbum/`，macOS: `~/Library/Application Support/LightAlbum/`
4. **开发调试指南** — VSCode 推荐插件列表、`launch.json` Tauri 调试配置
5. **CI 状态徽章** — 链接到 GitHub Actions

---

## 六、验收标准

| 轨道 | 验收条件 |
|------|----------|
| Track A | `cargo test` 全部通过；`cargo clippy` 零 warning；所有 Repository trait 有 impl；commands 无直接 SQL 调用 |
| Track B | `pnpm typecheck` 零错误；`pnpm test` 全部通过；全项目零 `as any`；EventBus 无内存泄漏 |
| Track C | LICENSE 文件存在；CI workflow 在 GitHub 上全部绿灯；locale 文件覆盖全部硬编码中文字符串 |
| 整体 | `pnpm tauri build` 成功；现有 Playwright E2E 测试无回归 |

---

## 七、不在本次范围内

- i18n 多语言切换（预留接口，不实现）
- E2E 测试补全（现有用例不回归即可）
- 云同步 / 远程相册功能
- 插件化缩略图引擎
- 数据库迁移工具（sqlx/diesel）
