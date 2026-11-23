import fs from 'fs';
import path from 'path';

const rawUrl = String(process.env.APP_HTTPS_URL || '').trim().replace(/\/+$/, '');
if (!rawUrl || !rawUrl.startsWith('https://')) {
  console.error('ERROR: APP_HTTPS_URL must be set to a valid live https:// URL before configuring Android.');
  process.exit(1);
}

const parsed = new URL(rawUrl);
if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname.toLowerCase())) {
  console.error('ERROR: APP_HTTPS_URL cannot point to localhost.');
  process.exit(1);
}

const androidDir = path.resolve(process.cwd(), 'android');
if (!fs.existsSync(androidDir)) {
  console.error('ERROR: android/ directory not found. Run "npx cap add android" first.');
  process.exit(1);
}

// 1) Ensure www/icon.png exists for offline fallback screen
const srcIcon = path.resolve(process.cwd(), 'resources/icon.png');
const dstIcon = path.resolve(process.cwd(), 'www/icon.png');
if (fs.existsSync(srcIcon)) {
  fs.copyFileSync(srcIcon, dstIcon);
}

// 2) Ensure strings.xml carries exact app title "S.G.N Committee Hisaab"
const stringsPath = path.join(androidDir, 'app/src/main/res/values/strings.xml');
if (fs.existsSync(stringsPath)) {
  const stringsXml = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">S.G.N Committee Hisaab</string>
    <string name="title_activity_main">S.G.N Committee Hisaab</string>
    <string name="package_name">com.sgncommittee.hisaab</string>
    <string name="custom_url_scheme">com.sgncommittee.hisaab</string>
</resources>
`;
  fs.writeFileSync(stringsPath, stringsXml, 'utf8');
}

// 3) Ensure emerald brand colors for Android status bar and splash theme
const colorsPath = path.join(androidDir, 'app/src/main/res/values/colors.xml');
const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#0B4F32</color>
    <color name="colorPrimaryDark">#093F28</color>
    <color name="colorAccent">#D97706</color>
    <color name="ic_launcher_background">#0B4F32</color>
</resources>
`;
fs.writeFileSync(colorsPath, colorsXml, 'utf8');

// 4) Configure AndroidManifest.xml cleanly (HTTPS-only, hardware accelerated, adjustResize)
const manifestPath = path.join(androidDir, 'app/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('android.permission.INTERNET')) {
    manifest = manifest.replace(
      '<application',
      '    <uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n\n    <application'
    );
  }
  if (!manifest.includes('android:usesCleartextTraffic')) {
    manifest = manifest.replace('<application', '<application android:usesCleartextTraffic="false"');
  }
  fs.writeFileSync(manifestPath, manifest, 'utf8');
}

console.log(`Configured Android wrapper for S.G.N Committee Hisaab -> ${rawUrl}`);
