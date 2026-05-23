# SillyTavern Message Navigator

给 SillyTavern 长聊天准备的轻量消息导航扩展。适合小说导入、长 RP、长记录复盘等场景。

## 功能

- 默认显示一个可拖动的 `导航` 悬浮按钮，点击后展开导航面板
- 在面板里显示 `上一条` / `下一条` 按钮
- 把当前聊天里的每条消息都作为导航项，不再依赖章节标题
- 支持消息下拉列表，按消息预览直接跳转
- 支持输入消息序号后直接跳转
- `上一条` / `下一条` 会按当前消息 ID 跳转，避免长聊天只暴露部分消息时误判最后一条
- 优先调用 SillyTavern 1.13.0+ 的 `/chat-jump`，长聊天只加载部分消息时也能更稳定地跳转
- 跳转后短暂高亮目标消息

## 安装

### 从 GitHub 安装

在 SillyTavern 中打开：

```text
Extensions -> Install Extension
```

填入仓库地址：

```text
https://github.com/ViaEasy/SillyTavern-ChapterNavigator
```

### 本地安装

也可以把整个目录复制到 SillyTavern 的扩展目录中：

```text
SillyTavern/data/<你的用户>/extensions/SillyTavern-ChapterNavigator
```

然后重启 SillyTavern 或在扩展管理里重新加载。

## 使用

打开任意聊天后，界面上会出现一个 `导航` 悬浮按钮。拖动按钮可以调整位置，点击按钮可以展开或收起消息导航面板。

- `上一条`：跳到上一条聊天记录
- `下一条`：跳到下一条聊天记录
- 下拉列表：直接跳到指定聊天记录
- 数字输入框：输入消息序号后点击 `跳转`

如果你导入的是“一章一条消息”的小说聊天记录，那 `上一条` / `下一条` 就等价于上一章 / 下一章。

## 兼容性

- 推荐 SillyTavern `1.13.0+`
- 低版本如果没有 `/chat-jump`，扩展会退回到浏览器原生滚动，但只能跳到已经加载在页面里的消息

## 开发说明

这个扩展没有构建步骤，文件结构保持最简单：

```text
manifest.json
index.js
style.css
README.md
```
