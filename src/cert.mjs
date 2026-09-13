// 自签名 TLS 证书（纯 Node 内置，零依赖）
//
// 为什么需要：手机离线看板（PWA）要求 Service Worker 运行在安全上下文里，
// 而局域网 IP 既不是 localhost 也没有公网证书。隐私最优解是本地自签 CA：
//   1. 生成一个本地根 CA（CA:TRUE，10 年）
//   2. 用 CA 签发服务器证书（SAN 覆盖本机所有局域网 IP），825 天
//   3. 手机只需安装一次 CA；之后换 IP / 证书过期都只用重签服务器证书，无需重装
// 全部 ASN.1/DER 手工编码，不依赖 openssl（Windows 默认没有）。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---------------- DER / ASN.1 ----------------

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const out = [];
  let v = n;
  while (v > 0) { out.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | out.length, ...out]);
}

function tlv(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

const seq = (...c) => tlv(0x30, Buffer.concat(c));
const setOf = (...c) => tlv(0x31, Buffer.concat(c));

function int(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && (b[1] & 0x80) === 0) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

function intFromNumber(n) {
  const bytes = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v = Math.floor(v / 256); }
  return int(Buffer.from(bytes.length ? bytes : [0]));
}

function oid(str) {
  const parts = str.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const chunk = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) { chunk.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

const utf8Str = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const octetStr = (b) => tlv(0x04, Buffer.from(b));
const bitStr = (b, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), Buffer.from(b)]));
const boolean = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const ctxPrim = (n, b) => tlv(0x80 | n, Buffer.from(b));
const ctxCons = (n, c) => tlv(0xa0 | n, c);

function utcTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  const s = p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  return tlv(0x17, Buffer.from(s, 'ascii'));
}

const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_P256 = '1.2.840.10045.3.1.7';
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const ALG_ECDSA_SHA256 = seq(oid(OID_ECDSA_SHA256));

function name(cn, org) {
  const rdns = [];
  if (org) rdns.push(setOf(seq(oid('2.5.4.10'), utf8Str(org))));
  rdns.push(setOf(seq(oid('2.5.4.3'), utf8Str(cn))));
  return seq(...rdns);
}

function extension(o, critical, valueDer) {
  const parts = [oid(o)];
  if (critical) parts.push(boolean(true));
  parts.push(octetStr(valueDer));
  return seq(...parts);
}

const extBasicConstraints = (isCa) =>
  extension('2.5.29.19', true, isCa ? seq(boolean(true)) : seq(boolean(false)));

function extKeyUsage(bits) {
  const maxBit = Math.max(...bits);
  const buf = Buffer.alloc(Math.floor(maxBit / 8) + 1);
  for (const b of bits) buf[Math.floor(b / 8)] |= 0x80 >> (b % 8);
  return extension('2.5.29.15', true, bitStr(buf, 0));
}

const extExtKeyUsage = (oids) => extension('2.5.29.37', false, seq(...oids.map(oid)));
const extSubjectKeyId = (ski) => extension('2.5.29.14', false, octetStr(ski));
const extAuthorityKeyId = (aki) => extension('2.5.29.35', false, seq(ctxPrim(0, aki)));

function extSubjectAltName(entries) {
  const gens = entries.map((e) => (e.type === 'ip'
    ? ctxPrim(7, e.bytes)
    : ctxPrim(2, Buffer.from(e.value, 'ascii'))));
  return extension('2.5.29.17', false, seq(...gens));
}

// ---------------- 密钥与证书 ----------------

function newKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  // P-256 的 SPKI 末尾就是 65 字节未压缩公钥点，SKI = SHA-1(公钥点)
  const point = spki.subarray(spki.length - 65);
  return { publicKey, privateKey, spki, pkcs8, ski: crypto.createHash('sha1').update(point).digest() };
}

function assemble({ subject, issuer, spki, serial, notBefore, notAfter, isCa, sans, keyUsageBits, eku, ski, aki }, signerKey) {
  const exts = [extBasicConstraints(isCa), extKeyUsage(keyUsageBits)];
  if (eku) exts.push(extExtKeyUsage(eku));
  if (sans && sans.length) exts.push(extSubjectAltName(sans));
  if (ski) exts.push(extSubjectKeyId(ski));
  if (aki) exts.push(extAuthorityKeyId(aki));
  const tbs = seq(
    ctxCons(0, intFromNumber(2)),
    int(serial),
    ALG_ECDSA_SHA256,
    issuer,
    seq(utcTime(notBefore), utcTime(notAfter)),
    subject,
    spki,
    ctxCons(3, seq(...exts)),
  );
  const sig = crypto.createSign('SHA256').update(tbs).sign(signerKey);
  return seq(tbs, ALG_ECDSA_SHA256, bitStr(sig));
}

function toPem(der, label) {
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trim();
  return '-----BEGIN ' + label + '-----\n' + b64 + '\n-----END ' + label + '-----\n';
}

// 公网/局域网 IP 判定（RFC1918 与常见私有段）
export function isPrivateIPv4(ip) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function sanEntries(hosts) {
  const entries = [];
  for (const h of hosts) {
    if (h === 'localhost' || h.endsWith('.local')) entries.push({ type: 'dns', value: h });
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      entries.push({ type: 'ip', bytes: Buffer.from(h.split('.').map(Number)) });
    } else entries.push({ type: 'dns', value: h });
  }
  return entries;
}

/**
 * 确保存在可用的本地 CA + 服务器证书。
 * hosts 变化时会用同一个 CA 重签服务器证书（手机无需重装 CA）。
 */
export function ensureCertificate(tlsDir, hosts) {
  fs.mkdirSync(tlsDir, { recursive: true });
  const caKeyPath = path.join(tlsDir, 'ca.key');
  const caCertPath = path.join(tlsDir, 'ca.pem');
  const srvKeyPath = path.join(tlsDir, 'server.key');
  const srvCertPath = path.join(tlsDir, 'server.pem');
  const metaPath = path.join(tlsDir, 'cert-info.json');

  const wanted = Array.from(new Set(hosts.filter(Boolean))).sort();
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { meta = null; }

  // 1) 本地根 CA
  let caKeyPem = fs.existsSync(caKeyPath) ? fs.readFileSync(caKeyPath, 'utf8') : null;
  let caCertPem = fs.existsSync(caCertPath) ? fs.readFileSync(caCertPath, 'utf8') : null;
  let caSubject = null;
  if (!caKeyPem || !caCertPem) {
    const ca = newKeyPair();
    caSubject = name('canvas-hub Local CA', 'canvas-hub');
    const now = new Date();
    const caDer = assemble({
      subject: caSubject,
      issuer: caSubject,
      spki: ca.spki,
      serial: crypto.randomBytes(16),
      notBefore: new Date(now.getTime() - 86400000),
      notAfter: new Date(now.getTime() + 3650 * 86400000),
      isCa: true,
      keyUsageBits: [0, 5, 6],
      ski: ca.ski,
    }, ca.privateKey);
    caKeyPem = toPem(ca.pkcs8, 'PRIVATE KEY');
    caCertPem = toPem(caDer, 'CERTIFICATE');
    fs.writeFileSync(caKeyPath, caKeyPem, { mode: 0o600 });
    fs.writeFileSync(caCertPath, caCertPem, { mode: 0o644 });
    console.log('[cert] 已生成新的本地根 CA: ' + caCertPath);
  }
  const caKeyObject = crypto.createPrivateKey(caKeyPem);

  // 2) 服务器证书（hosts 未变则复用）
  const needLeaf = !fs.existsSync(srvKeyPath) || !fs.existsSync(srvCertPath) ||
    !meta || JSON.stringify(meta.hosts || []) !== JSON.stringify(wanted);
  if (needLeaf) {
    const srv = newKeyPair();
    const caObj = new crypto.X509Certificate(caCertPem);
    caSubject = name('canvas-hub Local CA', 'canvas-hub');
    // CA 的 SKI 必须与 CA 证书里的 subjectKeyIdentifier 扩展一致：
    // 统一用 P-256 公钥点（SPKI 末尾 65 字节）的 SHA-1 重新计算，避免解析歧义
    const caSpki = caObj.publicKey.export({ type: 'spki', format: 'der' });
    const caSki = crypto.createHash('sha1').update(caSpki.subarray(caSpki.length - 65)).digest();
    const now = new Date();
    const leafDer = assemble({
      subject: name('canvas-hub', 'canvas-hub'),
      issuer: caSubject,
      spki: srv.spki,
      serial: crypto.randomBytes(16),
      notBefore: new Date(now.getTime() - 86400000),
      notAfter: new Date(now.getTime() + 825 * 86400000),
      isCa: false,
      sans: sanEntries(wanted),
      keyUsageBits: [0],
      eku: ['1.3.6.1.5.5.7.3.1'],
      ski: srv.ski,
      aki: caSki,
    }, caKeyObject);
    fs.writeFileSync(srvKeyPath, toPem(srv.pkcs8, 'PRIVATE KEY'), { mode: 0o600 });
    fs.writeFileSync(srvCertPath, toPem(leafDer, 'CERTIFICATE'), { mode: 0o644 });
    fs.writeFileSync(metaPath, JSON.stringify({ hosts: wanted, createdAt: new Date().toISOString() }, null, 2) + '\n');
    console.log('[cert] 已签发服务器证书，覆盖: ' + wanted.join(', '));
  }

  const caDer = new crypto.X509Certificate(caCertPem).raw;
  return {
    key: fs.readFileSync(srvKeyPath, 'utf8'),
    cert: fs.readFileSync(srvCertPath, 'utf8') + caCertPem,
    caCertPem,
    caDer,
    caPath: caCertPath,
    hosts: wanted,
  };
}

/** 证书信息（供 doctor / 设置页展示） */
export function describeCertificate(certPem) {
  const c = new crypto.X509Certificate(certPem);
  return {
    subject: c.subject,
    issuer: c.issuer,
    validFrom: c.validFrom,
    validTo: c.validTo,
    fingerprint: c.fingerprint256,
    san: c.subjectAltName || '',
  };
}
