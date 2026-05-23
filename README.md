# SillyTavern Chapter Navigator

给 SillyTavern 长聊天准备的轻量章节导航扩展。适合把小说导入成“一章一条消息”的场景。

## 功能

- 在聊天界面右下角显示 `上一章` / `下一章` 按钮
- 自动识别常见章节标题：`第一章`、`第1章`、`第一回`、`卷一`、`Chapter 1`、`序章`、`番外`
- 支持章节下拉列表，直接跳到指定章节
- 优先调用 SillyTavern 1.13.0+ 的 `/chat-jump`，长聊天只加载部分消息时也能更稳定地跳转
- 跳转后短暂高亮目标消息

## 安装

### 从 GitHub 安装

把这个仓库推到 GitHub 后，在 SillyTavern 中打开：

```text
Extensions -> Install Extension
```

填入你的仓库地址，例如：

```text
https://github.com/your-name/SillyTavern-ChapterNavigator
```

### 本地安装

也可以把整个目录复制到 SillyTavern 的扩展目录中：

```text
SillyTavern/data/<你的用户>/extensions/SillyTavern-ChapterNavigator
```

然后重启 SillyTavern 或在扩展管理里重新加载。

## 使用

打开一个聊天后，如果消息开头能识别到章节标题，右下角会出现章节导航面板。

如果没有显示，请确认每条章节消息的第一行类似：

```text
第一章 标题

正文……
```

或者：

```text
第一回     靈根育孕源流出　心性修持大道生

正文……
```

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

