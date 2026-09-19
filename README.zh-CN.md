[English](README.md) | 简体中文

# Last Time

Last Time 是一款离线优先、可安装的 React PWA，用来记录某件事上次发生或完成的时间。数据保存在本机 IndexedDB 中，也可选择通过 Microsoft Graph 的 OneDrive 应用文件夹同步一份应用私有 JSON 文档。

## 使用应用

在线 PWA 地址：**[https://lasttimeweb.feliciameow.workers.dev/](https://lasttimeweb.feliciameow.workers.dev/)**。

### 在 iPhone 或 iPad 上安装

1. 使用 Safari 打开上述准确地址。
2. 点按**分享**，然后选择**添加到主屏幕**。
3. 从主屏幕上的应用图标启动 Last Time。
4. 当应用显示**发现新版本**时，选择**立即更新**。应用会等待新版 Service Worker 接管后再重新加载；如果激活超时，会显示可重试的错误，而不会一直停留在更新状态。

### 在 Android 上安装

1. 使用 Chrome 或 Edge 打开在线地址。
2. 选择**安装应用**或**添加到主屏幕**。
3. 从已安装的应用图标启动 Last Time。

### 可选的跨设备同步

未登录时，数据只保存在当前设备的 IndexedDB 中。如需跨设备同步，请在每台设备上登录同一个个人或组织 Microsoft 帐户。应用只使用该帐户的私有 OneDrive 应用文件夹和委托权限 `Files.ReadWrite.AppFolder`，不会请求访问 OneDrive 中的其他文件。组织租户可能要求管理员同意。

同步在应用打开时运行，包括启动、回到前台、本地修改或导入、手动重试以及网络恢复。项目不声称也不依赖可靠的关闭应用后后台同步。

### 从 iOS 版「上次」迁移

先从 [iOS 应用「上次」（Last Time Tracker）](https://apps.apple.com/app/id534982023)导出 CSV，再在本应用中打开**设置 → 数据 → 导入 CSV**。在原始旧版格式中，`Event` 用于标识事项；当一行包含 `Timestamp` 或 `Date`/`Time` 时，通用 `Note` 会被视为该次历史记录的备注。

如果需要替换此前格式错误或产生重复事项的导入结果：

1. 关闭其他所有设备上的 Last Time。
2. 在一台设备上登录 Microsoft 并保持联网。
3. 打开**设置 → 数据 → 清空所有数据**，完成两步确认，并等待 OneDrive 删除同步成功。
4. 导入 CSV，然后再次同步。
5. 该次同步完成后，再重新打开其他设备。

此操作会永久删除现有事项和历史数据，但保留设置与 Microsoft 登录状态。本应用采用本地优先设计，没有应用服务端，也不包含分析统计；OneDrive 同步完全可选。

## 本地运行

需要 Node.js 20 或更高版本。

```powershell
npm install
npm run dev
```

生产检查：

```powershell
npm run lint
npm run typecheck
npm test
npm run test:layout
npm run build
```

## OneDrive 设置

本应用不使用也不需要客户端密码。请在 Microsoft Entra 管理中心创建一个**单页应用程序**注册：

1. 注册应用，并将支持的帐户类型设为**任何组织目录中的帐户和个人 Microsoft 帐户**（`AzureADandPersonalMicrosoftAccount`）。
2. 在**身份验证**中添加一个**单页应用程序**重定向 URI，必须与实际部署地址完全一致并包含末尾斜杠：
   - 本地 Vite：`http://localhost:5173/`
   - Cloudflare Workers：部署后显示的根地址 `https://lasttimeweb.<account-subdomain>.workers.dev/`（包含末尾斜杠），或自定义域名的准确根地址
3. 在 **API 权限**中添加 Microsoft Graph 委托权限 `Files.ReadWrite.AppFolder`。个人使用通常不需要管理员同意。
4. 将“应用程序（客户端）ID”复制到 `.env.local`：

```text
VITE_MS_CLIENT_ID=00000000-0000-0000-0000-000000000000
```

应用将 MSAL Browser 固定到 `https://login.microsoftonline.com/common`，与“组织帐户和个人 Microsoft 帐户”受众一致。应用只请求委托权限 `Files.ReadWrite.AppFolder`，并通过 Graph `/me/drive/special/approot` 读写 `last-time-data.json`。组织租户可能会根据租户策略要求用户或管理员同意；不要添加范围更大的 Graph 权限。同步会在启动、回到前台、本地数据变化、手动请求以及网络恢复时运行，错误会明确显示在界面中。

MSAL 始终使用部署源站的根地址作为重定向 URI。例如，部署地址为 `https://lasttimeweb.example.workers.dev` 时，必须在 Entra 中准确注册 `https://lasttimeweb.example.workers.dev/` 作为 SPA 重定向 URI；不要注册子路由，也不要省略末尾斜杠。

身份验证说明：

- 如果出现提到 `/common` 的 `userAudience` 错误，说明 Entra 应用注册的支持帐户类型不正确。请选择**任何组织目录中的帐户和个人 Microsoft 帐户**。
- 个人 Microsoft 帐户通常可以自行同意 `Files.ReadWrite.AppFolder`。
- 如果工作或学校帐户所在租户限制用户同意或未验证应用，可能会显示**需要管理员批准**或 `AADSTS65001`。此时需要租户管理员批准现有委托权限，或者改用个人 Microsoft 帐户。切换到 `/consumers` 或申请范围更大的 Graph 权限都不是正确解决方式。

## 部署

仓库已配置为使用 Cloudflare Workers Static Assets。`wrangler.jsonc` 仅发布 `dist/`，并使用 `single-page-application` 未找到处理，因此客户端路由会回退到 `index.html`。项目没有 Worker 服务端脚本，静态资源请求保持免费套餐下的纯静态行为。

在 Cloudflare 项目 `lasttimeweb` 的 **Workers Builds** 设置中使用：

```text
Build command: npm run build
Deploy command: npx wrangler deploy
```

本地命令行部署：

```powershell
npm run build
npx wrangler deploy
```

不要把 `VITE_MS_CLIENT_ID` 写入 `wrangler.jsonc`。请将它配置为 Cloudflare 构建变量，由 Vite 在构建时嵌入这个公开的应用程序 ID。首次部署后，请先把准确的 HTTPS 部署地址添加为 Microsoft Entra SPA 重定向 URI，再启用 OneDrive。

## 安装

- **iPhone/iPad：**在 Safari 中打开 HTTPS 网站，点按**分享**，然后选择**添加到主屏幕**。
- **Android：**在 Chrome/Edge 中打开网站，选择**安装应用**或**添加到主屏幕**。
- **桌面端：**使用浏览器地址栏中的安装图标。

首次成功加载后，Service Worker 会缓存应用外壳。离线时仍可使用事项、历史记录、导入/导出以及待同步数据。

在启动、回到前台以及应用打开期间的定期检查中，已安装的 PWA 会检查新版 Service Worker。发现等待中的版本时，应用会显示本地化的**发现新版本**横幅。**立即更新**会请求等待中的 Worker 激活，并且只在 `controllerchange` 后重新加载；**稍后**只在当前运行期间隐藏提示，不会打断正在编辑的内容或静默刷新。激活过程有明确的时间上限：如果 iOS 未能及时切换 Worker，更新进度会结束并显示可重试的本地化错误，而不会一直停留在“正在更新”。

## 导入与导出

设置页支持：

- 现有 iOS CSV 列：`Event`、`Note`、`Date`、`Time` 和 `Timestamp`。
- 扩展的可移植列：`Event`、`Event Note`、`Icon`、`Color`、`Event Created`、`Occurrence` 和 `Occurrence Note`。
- 常见旧版别名，包括 `Name`/`title`、`createdAt`、`eventId`、`occurrenceId`、`occurredAt` 和历史时间戳。

导出使用扩展的可移植格式，保留事项备注、图标、颜色、事项创建时间、历史发生时间和历史备注。导入时会忽略未来时间，编辑器也不允许保存未来的历史记录。

对于包含历史时间戳或 `Date`/`Time` 的旧版 iOS 行，通用 `Note` 列会被视为该次历史记录的备注。事项级备注使用 `Event Note`、`eventNote` 等明确别名。没有显式 `eventId` 的行按去除首尾空白后的事项名称归组，因此不会仅仅因为每次历史记录的备注不同而创建重复事项。

如果旧版 iOS CSV 曾创建同名重复事项，请先更新到此版本，然后打开**设置 → 数据 → 清空所有数据**；在已登录且联网时完成两步确认，等待 OneDrive 同步成功，再重新导入 CSV，并在其他设备重新打开应用前完成同步。清空操作会保留应用设置和 Microsoft 登录状态，但会在本机和 OneDrive 中为所有事项及历史记录创建永久删除标记。

## 同步行为

事项和历史记录使用稳定 UUID 与 ISO `updatedAt`。删除会保留为 tombstone。合并按 UUID 进行并选择更新时间较新的版本；时间戳相同时优先选择删除，再使用与属性顺序无关的规范化记录比较。相同 UUID 的历史记录不会重复，而彼此独立的重复发生记录仍会分别保留。

OneDrive 上传使用 DriveItem ETag 和 `If-Match`；首次创建文件时使用 `If-None-Match`。写入方数据过期时不会覆盖新文件，而是重新读取本地与远端数据、再次合并，并最多重试三次。本地修改和同步操作在支持时共享 Web Lock，否则使用进程内锁，因此旧同步快照无法覆盖已排队的修改。冲突顺序仍依赖设备生成的 `updatedAt` 墙上时钟；如果设备时钟严重偏移，现实中较早的修改可能会看起来更新。

## 致谢

Last Time 的核心理念与许多交互设计受到 [Sarun Wongpatcharapakorn](https://sarunw.com/) 开发的 [iOS 应用「上次」（Last Time Tracker）](https://apps.apple.com/app/id534982023)启发。可访问原产品的[官方网站](https://lasttimeapp.com/)或 [App Store 页面](https://apps.apple.com/app/id534982023)。感谢原作者创造了这种简洁实用的方式，让人记住某件事上次发生的时间。

如果你只在 iPhone 和 iPad 上使用、不需要与 Android 跨平台同步，我们推荐优先支持并使用[原版「上次」](https://apps.apple.com/app/id534982023)。

本仓库是独立、非官方实现，与原作者不存在背书或隶属关系，也不包含该应用的源代码或视觉资源。项目的动机是把这种以历史记录为核心的使用方式带到可安装的 Web 应用中，让 iOS 与 Android 设备都能使用，并增加 OneDrive 同步；这些跨平台与同步能力不是上述 iOS 应用在本工作流中提供的功能。

## AI 辅助开发

本项目在开发过程中大量使用了 [GitHub Copilot](https://github.com/features/copilot)，主要使用 GPT-5.6 Sol 模型，协助完成架构设计、代码实现、测试、文档和 UI 验证。产品方向与最终验收由用户主导。本项目与 GitHub 不存在赞助或背书关系。

## 许可证

本仓库的原创代码采用 [MIT License](LICENSE)，版权 © 2026 y-wan。Google Material Symbols 仍遵循其 Apache-2.0 许可证。对 Last Time Tracker 的说明仅用于注明产品灵感来源，并不授予使用该应用代码、品牌或资源的权利。

## 平台说明与许可证

- 本项目有意不包含每日提醒和应用锁功能：Last Time 用于记录历史，不是任务或习惯应用，也不会把浏览器后台调度描述成可靠能力。
- 目前尚不支持事项图片，因为可移植的离线二进制存储与 OneDrive 合并语义需要单独设计；PWA 不会创建只能留在本机、却静默无法同步的图片。
- 图标使用 `@material-symbols/svg-400` 中经过打包和 tree-shaking 的 Google Material Symbols Rounded SVG，遵循 Apache-2.0 许可证。应用不加载远程图标字体，因此图标离线时仍可使用。
