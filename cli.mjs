#!/usr/bin/env node
import { sync } from './src/sync.mjs';
import { status } from './src/status.mjs';
import { due } from './src/due.mjs';
import { digest } from './src/digest.mjs';
import { dashboard } from './src/dashboard.mjs';
import { notify, eveningNotify } from './src/notify.mjs';
import { syncCalendar } from './src/calendar.mjs';
import { syncBase } from './src/base.mjs';
import { analyzeSyllabi } from './src/syllabus.mjs';
import { smartClassify } from './src/smartclassify.mjs';
import { doctor } from './src/doctor.mjs';
import { larkInit } from './src/larkinit.mjs';
import { larkSetup } from './src/larksetup.mjs';
import { demo } from './src/demo.mjs';

const cmd = process.argv[2] || 'help';
const force = process.argv.includes('--force');
const all = process.argv.includes('--all');
const dryRun = process.argv.includes('--dry-run');
const noWait = process.argv.includes('--no-wait');
const finishIdx = process.argv.indexOf('--finish');
const finishCode = finishIdx >= 0 ? String(process.argv[finishIdx + 1] || '') : '';

const cmds = {
  sync: () => sync(),
  status: () => status(),
  due: () => due({ horizonDays: Number(process.argv[3]) || 10 }),
  digest: () => digest(),
  dashboard: () => dashboard(),
  notify: () => notify(),
  calendar: () => syncCalendar(),
  base: () => syncBase(),
  analyze: () => analyzeSyllabi({ force }),
  classify: () => smartClassify({ scope: all ? 'all' : 'other' }),
  doctor: () => doctor(),
  demo: () => demo({ off: process.argv.includes('--off') }),
  'lark-init': () => larkInit({ dryRun }),
  'lark-setup': () => larkSetup({ noWait, finishCode }),
  lark: async () => { await syncCalendar(); await syncBase(); },
  evening: async () => { await sync(); await eveningNotify(); },
  daily: async () => { await sync(); await analyzeSyllabi({ force: false }); await smartClassify({ scope: 'other' }); digest(); dashboard(); await syncCalendar(); await syncBase(); await notify(); },
};
if (cmds[cmd]) await cmds[cmd]();
else {
  console.log('Canvas 课程管家 · 命令一览');
  console.log('');
  console.log('  node cli.mjs doctor              # 环境自检（出问题先跑这个）');
  console.log('  node cli.mjs daily               # 早间一整套（08:00 定时任务调用）');
  console.log('  node cli.mjs evening             # 晚间同步 + 截止提醒（20:00 定时任务调用）');
  console.log('  node cli.mjs sync                # 只同步 Canvas（增量下载、分类归档）');
  console.log('  node cli.mjs analyze [--force]   # 解析课程大纲评分组成与安全线');
  console.log('  node cli.mjs classify [--all]    # DeepSeek 智能分类（默认只处理「其他」）');
  console.log('  node cli.mjs due [天数]           # 查看近期截止（默认 10 天）');
  console.log('  node cli.mjs status              # 本地统计');
  console.log('  node cli.mjs digest              # 生成每日摘要 Markdown');
  console.log('  node cli.mjs dashboard           # 生成离线 HTML 仪表盘');
  console.log('  node cli.mjs notify              # 推送摘要（macOS / 飞书）');
  console.log('  node cli.mjs calendar            # 同步截止到飞书日历');
  console.log('  node cli.mjs base                # 同步数据到飞书 Base');
  console.log('  node cli.mjs lark-init [--dry-run]   # 创建飞书 Base 与 4 张表');
  console.log('  node cli.mjs lark-setup [--no-wait]  # 引导完成飞书授权');
  console.log('  node cli.mjs server              # 前台启动 Web 看板（默认 8788）');
  console.log('  node cli.mjs demo [--off]        # 生成/退出演示数据（无需 Canvas Token）');
}
