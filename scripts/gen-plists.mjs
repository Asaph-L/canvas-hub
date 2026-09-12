import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const e = process.env;
const NODE_BIN = e.NODE_BIN || process.execPath;
const PORT = String(e.PORT || 8788);
const AGENTS = e.LAUNCH_AGENTS_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents');

function plistXml(opts) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">');
  out.push('<plist version="1.0">');
  out.push('<dict>');
  out.push('  <key>Label</key><string>' + opts.label + '</string>');
  out.push('  <key>ProgramArguments</key>');
  out.push('  <array>');
  out.push('    <string>' + NODE_BIN + '</string>');
  for (const a of opts.args) out.push('    <string>' + a + '</string>');
  out.push('  </array>');
  out.push('  <key>WorkingDirectory</key><string>' + ROOT + '</string>');
  if (opts.hour != null) {
    out.push('  <key>StartCalendarInterval</key>');
    out.push('  <dict><key>Hour</key><integer>' + opts.hour + '</integer><key>Minute</key><integer>' + opts.minute + '</integer></dict>');
  }
  if (opts.keepAlive) {
    out.push('  <key>RunAtLoad</key><true/>');
    out.push('  <key>KeepAlive</key><true/>');
  }
  out.push('  <key>StandardOutPath</key><string>' + path.join(ROOT, 'logs', opts.logName + '.log') + '</string>');
  out.push('  <key>StandardErrorPath</key><string>' + path.join(ROOT, 'logs', opts.logName + '.err') + '</string>');
  out.push('  <key>EnvironmentVariables</key>');
  out.push('  <dict>');
  out.push('    <key>PATH</key><string>' + path.dirname(NODE_BIN) + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>');
  out.push('    <key>CANVAS_HUB_PORT</key><string>' + PORT + '</string>');
  out.push('    <key>LARKSUITE_CLI_NO_UPDATE_NOTIFIER</key><string>1</string>');
  out.push('    <key>LARKSUITE_CLI_NO_SKILLS_NOTIFIER</key><string>1</string>');
  out.push('  </dict>');
  out.push('</dict>');
  out.push('</plist>');
  return out.join('\n') + '\n';
}

function writePlist(opts) {
  const xml = plistXml(opts);
  fs.mkdirSync(path.join(ROOT, 'LaunchAgents'), { recursive: true });
  fs.mkdirSync(AGENTS, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'LaunchAgents', opts.label + '.plist'), xml);
  fs.writeFileSync(path.join(AGENTS, opts.label + '.plist'), xml);
  console.log('已生成 ' + opts.label + '.plist');
  return opts.label;
}

const labels = [];
const morningOn = e.ENABLE_MORNING !== '0';
const eveningOn = e.ENABLE_EVENING !== '0';
const webOn = e.ENABLE_WEB !== '0';
const hm = String(e.MORNING || '08:00').split(':');
const em = String(e.EVENING || '20:00').split(':');

if (morningOn) labels.push(writePlist({ label: 'com.canvashub.morning', args: [path.join(ROOT, 'cli.mjs'), 'daily'], hour: Number(hm[0] || 8), minute: Number(hm[1] || 0), logName: 'launchd-morning' }));
if (eveningOn) labels.push(writePlist({ label: 'com.canvashub.evening', args: [path.join(ROOT, 'cli.mjs'), 'evening'], hour: Number(em[0] || 20), minute: Number(em[1] || 0), logName: 'launchd-evening' }));
if (webOn) labels.push(writePlist({ label: 'com.canvashub.web', args: [path.join(ROOT, 'server.mjs')], keepAlive: true, logName: 'launchd-web' }));

console.log('LABELS=' + labels.join(','));
