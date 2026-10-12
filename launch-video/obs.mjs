// Drives OBS over obs-websocket for the launch video recordings.
//   node obs.mjs setup                     scenes "App" (Benana window) and "Minecraft" (game window), 1080p30, footage/ output
//   node obs.mjs start <scene> <name>      switch scene and start recording; the file is renamed to footage/<name>.mkv on stop
//   node obs.mjs stop                      stop recording, print the file path
//   node obs.mjs windows                   list capturable windows
import fs from 'node:fs';
import path from 'node:path';
import { OBSWebSocket } from 'obs-websocket-js';

const cfgFile = path.join(process.env.APPDATA, 'obs-studio/plugin_config/obs-websocket/config.json');
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const footage = path.resolve(import.meta.dirname, 'footage');
const pending = path.join(footage, '.pending-name');

const obs = new OBSWebSocket();
await obs.connect(`ws://127.0.0.1:${cfg.server_port}`, cfg.auth_required ? cfg.server_password : undefined);
const [cmd, ...args] = process.argv.slice(2);

async function ensureScene(name) {
  const { scenes } = await obs.call('GetSceneList');
  if (!scenes.some((s) => s.sceneName === name)) await obs.call('CreateScene', { sceneName: name });
}

async function ensureInput(scene, inputName, inputKind, inputSettings) {
  const { inputs } = await obs.call('GetInputList');
  if (inputs.some((i) => i.inputName === inputName)) {
    await obs.call('SetInputSettings', { inputName, inputSettings });
  } else {
    await obs.call('CreateInput', { sceneName: scene, inputName, inputKind, inputSettings });
  }
  // Fill the 1920x1080 canvas whatever the window size.
  const { sceneItemId } = await obs.call('GetSceneItemId', { sceneName: scene, sourceName: inputName });
  await obs.call('SetSceneItemTransform', {
    sceneName: scene, sceneItemId,
    sceneItemTransform: { boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1920, boundsHeight: 1080, positionX: 0, positionY: 0, boundsAlignment: 0 },
  });
}

async function windows(kind) {
  const { propertyItems } = await obs.call('GetInputPropertiesListPropertyItems', { inputName: kind, propertyName: 'window' });
  return propertyItems.map((p) => p.itemValue);
}

if (cmd === 'setup') {
  await obs.call('SetVideoSettings', { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 30, fpsDenominator: 1 });
  await obs.call('SetRecordDirectory', { recordDirectory: footage });
  await obs.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: 'RecFormat2', parameterValue: 'mkv' });
  await obs.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: 'RecQuality', parameterValue: 'Small' });
  await obs.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: 'RecEncoder', parameterValue: 'nvenc' });
  await ensureScene('App');
  await ensureScene('Minecraft');
  // Window title is matched by OBS as "title:class:exe"; priority 2 = same executable, any title.
  await ensureInput('App', 'Benana window', 'window_capture', { window: 'benana:Chrome_WidgetWin_1:electron.exe', priority: 2, method: 2, cursor: true, client_area: true });
  await ensureInput('Minecraft', 'Minecraft window', 'game_capture', { capture_mode: 'window', window: process.argv[3] || 'Minecraft* 1.21.4:GLFW30:javaw.exe', priority: 2, capture_cursor: false });
  console.log('setup done; app windows:', (await windows('Benana window')).filter((w) => w.includes('electron')).join(' | '));
} else if (cmd === 'windows') {
  console.log((await windows(args[0] || 'Benana window')).join('\n'));
} else if (cmd === 'retarget') {
  // retarget <input> <window string from `windows`>
  await obs.call('SetInputSettings', { inputName: args[0], inputSettings: { window: args[1] } });
  console.log('ok');
} else if (cmd === 'start') {
  const [scene, name] = args;
  await obs.call('SetCurrentProgramScene', { sceneName: scene });
  fs.writeFileSync(pending, name);
  await obs.call('StartRecord');
  console.log(`recording ${scene} -> ${name}`);
} else if (cmd === 'stop') {
  const { outputPath } = await obs.call('StopRecord');
  let out = outputPath;
  if (fs.existsSync(pending)) {
    const name = fs.readFileSync(pending, 'utf8').trim();
    out = path.join(footage, `${name}${path.extname(outputPath)}`);
    // OBS keeps the file open for a moment after StopRecord resolves.
    for (let i = 0; i < 20; i++) {
      try { fs.renameSync(outputPath, out); break; } catch { await new Promise((r) => setTimeout(r, 300)); }
    }
    fs.rmSync(pending);
  }
  console.log(out);
} else if (cmd === 'status') {
  console.log(await obs.call('GetRecordStatus'), (await obs.call('GetCurrentProgramScene')).currentProgramSceneName);
} else if (cmd === 'shot') {
  // shot <source> <file.png>: what OBS sees, to check a capture is not black.
  await obs.call('SaveSourceScreenshot', { sourceName: args[0], imageFormat: 'png', imageFilePath: path.resolve(args[1]), imageWidth: 960 });
  console.log(path.resolve(args[1]));
}
await obs.disconnect();
