// src/lib/headless-vnc/unit-templates.ts
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import os from 'os'

export interface VncStackConfig {
  prefix: string
  display: string
  resolution: string
  vncPort: number
  websockifyPort: number
  vncPasswordFile: string
  appCommand: string
  appDescription: string
  appEnv?: Record<string, string>
  openboxConfigFile?: string
  /** Enable fcitx5 input method service in the VNC stack */
  inputMethod?: boolean
}

function userUnitDir(): string {
  return join(os.homedir(), '.config', 'systemd', 'user')
}

export function writeOpenboxConfig(config: VncStackConfig): string {
  const configFile = config.openboxConfigFile
    ?? join(os.homedir(), '.config', 'openbox', `rc-${config.prefix}.xml`)
  const configDir = join(configFile, '..')

  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <applications>
    <application class="*">
      <maximized>yes</maximized>
      <decor>no</decor>
    </application>
  </applications>
</openbox_config>`

  writeFileSync(configFile, xml)
  return configFile
}

export function writeSystemdUnits(config: VncStackConfig): string[] {
  const dir = userUnitDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const openboxConfig = writeOpenboxConfig(config)

  const envLines = config.appEnv
    ? Object.entries(config.appEnv).map(([k, v]) => `Environment=${k}=${v}`).join('\n')
    : ''

  const units: Record<string, string> = {
    [`xvfb-${config.prefix}.service`]: `[Unit]
Description=Xvfb virtual framebuffer (${config.prefix})

[Service]
ExecStart=/usr/bin/Xvfb ${config.display} -extension GLX -screen 0 ${config.resolution}x16
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target`,

    [`openbox-${config.prefix}.service`]: `[Unit]
Description=Openbox window manager (${config.prefix})
Requires=xvfb-${config.prefix}.service
After=xvfb-${config.prefix}.service

[Service]
Environment=DISPLAY=${config.display}
ExecStart=/usr/bin/openbox --config-file ${openboxConfig}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target`,

    ...(config.inputMethod ? {
      [`fcitx5-${config.prefix}.service`]: `[Unit]
Description=Fcitx5 input method (${config.prefix})
Requires=openbox-${config.prefix}.service
After=openbox-${config.prefix}.service

[Service]
Environment=DISPLAY=${config.display}
ExecStart=/usr/bin/fcitx5 --replace
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target`,
    } : {}),

    [`${config.prefix}-headless.service`]: `[Unit]
Description=${config.appDescription}
Requires=openbox-${config.prefix}.service${config.inputMethod ? `\nRequires=fcitx5-${config.prefix}.service` : ''}
After=openbox-${config.prefix}.service${config.inputMethod ? `\nAfter=fcitx5-${config.prefix}.service` : ''}

[Service]
Environment=DISPLAY=${config.display}${config.inputMethod ? `
Environment=GTK_IM_MODULE=fcitx
Environment=QT_IM_MODULE=fcitx
Environment=XMODIFIERS=@im=fcitx
Environment=LANG=zh_TW.UTF-8` : ''}
${envLines}
ExecStart=${config.appCommand}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target`,

    [`x11vnc-${config.prefix}.service`]: `[Unit]
Description=x11vnc VNC server (${config.prefix})
After=xvfb-${config.prefix}.service
Requires=xvfb-${config.prefix}.service

[Service]
ExecStartPre=/bin/sh -c 'for i in $(seq 1 30); do test -e /tmp/.X11-unix/X${config.display.replace(':', '')} && exit 0; sleep 0.5; done; exit 1'
ExecStart=/usr/bin/x11vnc -display ${config.display} -rfbport ${config.vncPort} -rfbauth ${config.vncPasswordFile} -forever -shared -localhost
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target`,

    [`websockify-${config.prefix}.service`]: `[Unit]
Description=websockify VNC to WebSocket bridge (${config.prefix})
After=x11vnc-${config.prefix}.service
Requires=x11vnc-${config.prefix}.service

[Service]
ExecStartPre=/bin/sh -c 'for i in $(seq 1 30); do ss -tln | grep -q ":${config.vncPort} " && exit 0; sleep 0.5; done; exit 1'
ExecStart=/usr/bin/websockify --web /usr/share/novnc ${config.websockifyPort} 127.0.0.1:${config.vncPort}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target`,
  }

  const written: string[] = []
  for (const [name, content] of Object.entries(units)) {
    writeFileSync(join(dir, name), content)
    written.push(name)
  }

  return written
}

export function getUnitNames(prefix: string, opts?: { inputMethod?: boolean }): string[] {
  return [
    `xvfb-${prefix}.service`,
    `openbox-${prefix}.service`,
    ...(opts?.inputMethod ? [`fcitx5-${prefix}.service`] : []),
    `${prefix}-headless.service`,
    `x11vnc-${prefix}.service`,
    `websockify-${prefix}.service`,
  ]
}

export function removeSystemdUnits(prefix: string): void {
  const dir = userUnitDir()
  // Always try to remove fcitx5 unit as well in case it was previously created
  const names = getUnitNames(prefix, { inputMethod: true })
  for (const name of names) {
    const p = join(dir, name)
    if (existsSync(p)) {
      try { unlinkSync(p) } catch {}
    }
  }
}

export function removeUnprefixedUnits(oldUnitNames: string[]): void {
  const dir = userUnitDir()
  for (const name of oldUnitNames) {
    const p = join(dir, name)
    if (existsSync(p)) {
      try { unlinkSync(p) } catch {}
    }
  }
}
